import { ApiError, type Repo } from '@pierre/storage';
import type { CommandContext, ExecResult } from 'just-bash';

import { shortSha, subject } from '../format.js';
import type { GitCommandOptions, GitState } from '../types.js';
import {
  collectFiles,
  fail,
  fsPathForRepoPath,
  getAuthor,
  GitAbort,
  ok,
  parsePathspecs,
  pathFromArg,
  requireRepo,
} from './common.js';

interface CommitArgs {
  message: string;
  all: boolean;
}

export async function gitAdd(
  state: GitState,
  args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  const pathspecs = parsePathspecs(args);
  if (pathspecs.length === 0) {
    return fail('Nothing specified, nothing added.\n', 1);
  }

  for (const spec of pathspecs) {
    const target = pathFromArg(state, ctx, spec);
    if (!(await ctx.fs.exists(target.fsPath))) {
      return fail(`fatal: pathspec '${spec}' did not match any files\n`, 128);
    }

    const files = await collectFiles(ctx.fs, target.fsPath);
    if (files.length === 0 && target.repoPath) {
      continue;
    }
    for (const fsPath of files) {
      const repoPath = pathFromArg(state, ctx, fsPath).repoPath;
      if (repoPath) {
        state.stage.set(repoPath, { operation: 'upsert', repoPath, fsPath });
      }
    }
  }

  return ok();
}

export async function gitCommit(
  state: GitState,
  opts: Pick<GitCommandOptions, 'author'>,
  args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  const repo = requireRepo(state);
  const parsed = parseCommitArgs(args);

  if (parsed.all) {
    await stageAll(state, ctx);
  }

  const entries = [...state.stage.values()].sort((a, b) =>
    a.repoPath.localeCompare(b.repoPath)
  );
  if (entries.length === 0) {
    return ok('nothing to commit, working tree clean\n');
  }

  const builder = repo.createCommit({
    targetBranch: state.branch,
    commitMessage: parsed.message,
    expectedHeadSha: state.headSha,
    author: getAuthor(opts, ctx),
  });

  for (const entry of entries) {
    if (entry.operation === 'delete') {
      builder.deletePath(entry.repoPath);
      continue;
    }
    const fsPath =
      entry.fsPath ?? fsPathForRepoPath(state, ctx, entry.repoPath);
    builder.addFile(entry.repoPath, await ctx.fs.readFileBuffer(fsPath));
  }

  const result = await builder.send();
  state.headSha = result.refUpdate.newSha || result.commitSha;
  for (const entry of entries) {
    state.stage.delete(entry.repoPath);
  }

  const rootLabel = isZeroSha(result.refUpdate.oldSha) ? ' (root-commit)' : '';
  return ok(
    `[${state.branch}${rootLabel} ${shortSha(result.commitSha)}] ${subject(parsed.message)}\n`
  );
}

export async function gitRm(
  state: GitState,
  args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  const pathspecs = parsePathspecs(args);
  if (pathspecs.length === 0) {
    return fail('usage: git rm <path>...\n', 129);
  }

  for (const spec of pathspecs) {
    const target = pathFromArg(state, ctx, spec);
    state.stage.set(target.repoPath, {
      operation: 'delete',
      repoPath: target.repoPath,
    });
    await ctx.fs.rm(target.fsPath, { force: true, recursive: true });
  }

  return ok();
}

export async function gitStatus(
  state: GitState,
  _args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  const repo = requireRepo(state);
  const remote = await listStatusRemoteFiles(repo, state);
  const remotePaths = new Set(remote.files.map((file) => file.path));
  const localPaths = new Set<string>();
  const root = fsPathForRepoPath(state, ctx, '');

  if (await ctx.fs.exists(root)) {
    for (const fsPath of await collectFiles(ctx.fs, root)) {
      const repoPath = pathFromArg(state, ctx, fsPath).repoPath;
      if (repoPath) {
        localPaths.add(repoPath);
      }
    }
  }

  const staged = [...state.stage.values()]
    .map((entry) => entry.repoPath)
    .sort();
  const added = [...localPaths].filter((name) => !remotePaths.has(name)).sort();
  const deleted = [...remotePaths]
    .filter((name) => !localPaths.has(name))
    .sort();

  const lines = [`On branch ${state.branch}`];
  if (staged.length > 0) {
    lines.push('', 'Changes to be committed:');
    for (const name of staged) {
      const label =
        state.stage.get(name)?.operation === 'delete' ? 'deleted' : 'modified';
      lines.push(`  ${label}: ${name}`);
    }
  }
  const unstaged = [...new Set([...added, ...deleted])].sort();
  if (unstaged.length > 0) {
    lines.push('', 'Changes not staged for commit:');
    for (const name of unstaged) {
      lines.push(`  ${deleted.includes(name) ? 'deleted' : 'added'}: ${name}`);
    }
  }
  if (staged.length === 0 && unstaged.length === 0) {
    lines.push('nothing to commit, working tree clean');
  }

  return ok(lines.join('\n') + '\n');
}

async function listStatusRemoteFiles(
  repo: Repo,
  state: GitState
): Promise<Awaited<ReturnType<Repo['listFilesWithMetadata']>>> {
  try {
    return await repo.listFilesWithMetadata({
      ref: state.branch,
      recursive: true,
    } as Parameters<Repo['listFilesWithMetadata']>[0] & {
      recursive?: boolean;
    });
  } catch (error) {
    if (await is404ForUnbornBranch(repo, state, error)) {
      return { files: [], commits: {}, ref: state.branch };
    }
    throw error;
  }
}

async function is404ForUnbornBranch(
  repo: Repo,
  state: GitState,
  error: unknown
): Promise<boolean> {
  if (!isStatus(error, 404)) {
    return false;
  }

  try {
    const result = await repo.listBranches();
    if (result.branches.length === 0) {
      return true;
    }
    const branch = result.branches.find((entry) => entry.name === state.branch);
    return Boolean(branch && isZeroSha(branch.headSha));
  } catch {
    return false;
  }
}

export async function stageAll(
  state: GitState,
  ctx: CommandContext
): Promise<void> {
  const root = fsPathForRepoPath(state, ctx, '');
  if (!(await ctx.fs.exists(root))) {
    return;
  }
  for (const fsPath of await collectFiles(ctx.fs, root)) {
    const repoPath = pathFromArg(state, ctx, fsPath).repoPath;
    if (repoPath) {
      state.stage.set(repoPath, { operation: 'upsert', repoPath, fsPath });
    }
  }
}

export async function commitStagedOrAll(
  state: GitState,
  opts: Pick<GitCommandOptions, 'author'>,
  ctx: CommandContext,
  message: string
): Promise<ExecResult> {
  if (state.stage.size === 0) {
    await stageAll(state, ctx);
  }
  if (state.stage.size === 0) {
    return ok('Everything up-to-date\n');
  }
  return gitCommit(state, opts, ['-m', message], ctx);
}

function parseCommitArgs(args: string[]): CommitArgs {
  let message: string | undefined;
  let all = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-m' || arg === '--message') {
      const value = args[i + 1];
      if (!value) {
        return throwUsage("error: option '-m' requires a value\n");
      }
      message = value;
      i++;
    } else if (arg === '-a' || arg === '--all') {
      all = true;
    } else {
      return throwUsage(`error: unknown option '${arg}'\n`);
    }
  }

  if (!message) {
    return throwUsage("error: switch `m' requires a value\n");
  }

  return { message, all };
}

function throwUsage(message: string): never {
  throw new GitAbort(fail(message, 129));
}

function isZeroSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

function isStatus(error: unknown, status: number): boolean {
  if (error instanceof ApiError) {
    return error.status === status;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (error as Record<string, unknown>).status === status;
}
