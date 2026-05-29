import {
  ApiError,
  RefUpdateError,
  type CommitSignature,
  type Repo,
} from '@pierre/storage';
import type { CommandContext, ExecResult, IFileSystem } from 'just-bash';

import { dirnamePath, joinPath, normalizePath, relativePath } from '../path.js';
import type { GitCommandOptions, GitState } from '../types.js';

export class GitAbort extends Error {
  constructor(readonly result: ExecResult) {
    super(result.stderr);
  }
}

export function ok(stdout = ''): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

export function fail(stderr: string, exitCode = 1): ExecResult {
  return { stdout: '', stderr, exitCode };
}

export function usage(exitCode = 129): ExecResult {
  const stdout =
    [
      'usage: git <command> [<args>]',
      '',
      'commands: init, add, commit, log, show, cat-file, ls-files, ls-tree,',
      '          blame, grep, branch, tag, diff, rev-parse, checkout, switch,',
      '          merge, status, rm, clone, pull, push, fetch',
    ].join('\n') + '\n';
  return exitCode === 0 ? ok(stdout) : fail(stdout, exitCode);
}

export function requireRepo(state: GitState): Repo {
  if (!state.repo) {
    throw new GitAbort(
      fail("fatal: not a git repository (run 'git init <id>' first)\n", 128)
    );
  }
  return state.repo;
}

export async function runGitOperation(
  operation: () => Promise<ExecResult>
): Promise<ExecResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GitAbort) {
      return error.result;
    }
    return sdkError(error);
  }
}

export function sdkError(error: unknown): ExecResult {
  if (error instanceof RefUpdateError) {
    return refUpdateError(error);
  }

  const status =
    error instanceof ApiError ? error.status : readNumber(error, 'status');
  if (typeof status === 'number') {
    if (status === 401) {
      return fail('fatal: code.storage authentication failed\n', 128);
    }
    if (status === 403) {
      return fail('fatal: code.storage permission denied\n', 128);
    }
    if (status === 404) {
      return fail('fatal: code.storage object was not found\n', 128);
    }
    if (status === 409 || status === 412) {
      return fail(
        'error: failed to push some refs to code.storage\nhint: fetch or pull before retrying.\n',
        1
      );
    }
    if (status === 429) {
      return fail('fatal: code.storage rate limit exceeded\n', 1);
    }
    if (status >= 500) {
      return fail(`fatal: code.storage server error (${status})\n`, 1);
    }
  }

  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'unknown error';
  return fail(`fatal: ${message}\n`, 1);
}

function refUpdateError(error: RefUpdateError): ExecResult {
  if (error.reason === 'unauthorized') {
    return fail('fatal: code.storage authentication failed\n', 128);
  }
  if (error.reason === 'forbidden') {
    return fail('fatal: code.storage permission denied\n', 128);
  }
  if (error.reason === 'not_found') {
    return fail('fatal: code.storage object was not found\n', 128);
  }
  if (error.reason === 'conflict' || error.reason === 'precondition_failed') {
    return fail(
      'error: failed to push some refs to code.storage\nhint: fetch or pull before retrying.\n',
      1
    );
  }

  const message = error.message.trim() || 'unknown error';
  return fail(`fatal: ${message}\n`, 1);
}

export function parseDefaultBranch(args: string[]): {
  repoId?: string;
  branch: string;
} {
  let branch = 'main';
  let repoId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--default-branch' || arg === '-b') {
      const value = args[i + 1];
      if (!value) {
        throw new GitAbort(
          fail("error: option '--default-branch' requires a value\n", 129)
        );
      }
      branch = value;
      i++;
    } else if (arg.startsWith('-')) {
      throw new GitAbort(fail(`error: unknown option '${arg}'\n`, 129));
    } else if (!repoId) {
      repoId = arg;
    } else {
      throw new GitAbort(fail(`fatal: unexpected argument '${arg}'\n`, 129));
    }
  }

  return { repoId, branch };
}

export function parsePathspecs(args: string[]): string[] {
  const paths: string[] = [];
  let afterDashDash = false;

  for (const arg of args) {
    if (arg === '--') {
      afterDashDash = true;
      continue;
    }
    if (!afterDashDash && arg.startsWith('-')) {
      throw new GitAbort(fail(`error: unknown option '${arg}'\n`, 129));
    }
    paths.push(arg);
  }

  return paths;
}

export function getAuthor(
  opts: Pick<GitCommandOptions, 'author'>,
  ctx: CommandContext
): CommitSignature {
  const name =
    opts.author?.name ??
    ctx.env.get('GIT_AUTHOR_NAME') ??
    ctx.env.get('GIT_COMMITTER_NAME') ??
    'agent';
  const email =
    opts.author?.email ??
    ctx.env.get('GIT_AUTHOR_EMAIL') ??
    ctx.env.get('GIT_COMMITTER_EMAIL') ??
    'agent@example.com';
  return { name, email };
}

export function resolveRef(state: GitState, ref?: string): string {
  if (!ref || ref === 'HEAD') {
    return state.branch;
  }
  return ref;
}

export function normalizeRepoPath(input: string): string {
  const normalized = normalizePath(input).replace(/^\/+/, '');
  if (!normalized || normalized === '.') {
    return '';
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new GitAbort(fail(`fatal: invalid path '${input}'\n`, 128));
  }
  return normalized;
}

export function workingRoot(state: GitState, ctx: CommandContext): string {
  return state.cloneDir ?? ctx.cwd;
}

export function fsPathForRepoPath(
  state: GitState,
  ctx: CommandContext,
  repoPath: string
): string {
  return joinPath(workingRoot(state, ctx), repoPath);
}

export function pathFromArg(
  state: GitState,
  ctx: CommandContext,
  arg: string
): { repoPath: string; fsPath: string } {
  const fsPath = ctx.fs.resolvePath(ctx.cwd, arg);
  const root = workingRoot(state, ctx);
  const relative = relativePath(root, fsPath);
  if (relative === '..' || relative.startsWith('../')) {
    throw new GitAbort(
      fail(`fatal: path '${arg}' is outside repository\n`, 128)
    );
  }
  const repoPath = relative === '.' ? '' : normalizeRepoPath(relative);
  return { repoPath, fsPath };
}

export async function collectFiles(
  fs: IFileSystem,
  fsPath: string
): Promise<string[]> {
  const stat = await fs.stat(fsPath);
  if (stat.isFile) {
    return [fsPath];
  }
  if (!stat.isDirectory) {
    return [];
  }

  const out: string[] = [];
  const names = (await fs.readdir(fsPath)).sort();
  for (const name of names) {
    out.push(...(await collectFiles(fs, joinPath(fsPath, name))));
  }
  return out;
}

export async function ensureParentDir(
  fs: IFileSystem,
  filePath: string
): Promise<void> {
  const dir = dirnamePath(filePath);
  if (dir && dir !== '.' && !(await fs.exists(dir))) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function responseBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' ? candidate : undefined;
}
