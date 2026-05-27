import type { ListFilesResult, Repo } from '@pierre/storage';
import type { ExecResult } from 'just-bash';

import {
  formatBlame,
  formatCommitHeader,
  formatDiff,
  formatLog,
} from '../format.js';
import type { GitState } from '../types.js';
import { fail, ok, requireRepo, resolveRef, responseBytes } from './common.js';

export async function gitLog(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  let oneline = false;
  let limit: number | undefined;
  let path: string | undefined;
  let afterDashDash = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      afterDashDash = true;
    } else if (!afterDashDash && arg === '--oneline') {
      oneline = true;
    } else if (!afterDashDash && (arg === '-n' || arg === '--max-count')) {
      const value = args[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        return fail("fatal: option '-n' expects a positive integer\n", 129);
      }
      limit = Number(value);
      i++;
    } else if (
      !afterDashDash &&
      arg.startsWith('-n') &&
      /^\d+$/.test(arg.slice(2))
    ) {
      limit = Number(arg.slice(2));
    } else if (!afterDashDash && arg.startsWith('-')) {
      return fail(`fatal: unrecognized argument: ${arg}\n`, 129);
    } else {
      path = arg;
    }
  }

  const result = await repo.listCommits({
    branch: state.branch,
    limit,
    path,
  } as Parameters<Repo['listCommits']>[0] & { path?: string });
  state.headSha = result.commits[0]?.sha ?? state.headSha;
  return ok(formatLog(result.commits, oneline));
}

export async function gitShow(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  const target = args[0] ?? 'HEAD';
  const fileTarget = splitFileTarget(target);

  if (fileTarget) {
    const response = await repo.getFileStream({
      ref: resolveRef(state, fileTarget.ref),
      path: fileTarget.path,
    });
    return bytesResult(await responseBytes(response));
  }

  const ref = resolveRef(state, target);
  const [{ commit }, diff] = await Promise.all([
    repo.getCommit({ sha: ref }),
    repo.getCommitDiff({ sha: ref }),
  ]);
  state.headSha = commit.sha;
  return ok(formatCommitHeader(commit) + formatDiff(diff.files));
}

export async function gitCatFile(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  if (args[0] !== '-p' || !args[1]) {
    return fail('usage: git cat-file -p <ref>:<path>\n', 129);
  }
  const target = splitFileTarget(args[1]);
  if (!target) {
    return fail(
      'fatal: only <ref>:<path> cat-file targets are supported\n',
      128
    );
  }
  const response = await repo.getFileStream({
    ref: resolveRef(state, target.ref),
    path: target.path,
  });
  return bytesResult(await responseBytes(response));
}

export async function gitLsFiles(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  const path = args[0];
  const result = await repo.listFiles({
    ref: state.branch,
    path,
    recursive: true,
  } as ListFilesOptionsWithPath);
  return ok(result.paths.join('\n') + (result.paths.length > 0 ? '\n' : ''));
}

export async function gitLsTree(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  let recursive = false;
  let ref: string | undefined;
  let path: string | undefined;

  for (const arg of args) {
    if (arg === '-r') {
      recursive = true;
    } else if (arg.startsWith('-')) {
      return fail(`error: unknown option '${arg}'\n`, 129);
    } else if (!ref) {
      ref = arg;
    } else if (!path) {
      path = arg;
    } else {
      return fail(`fatal: unexpected argument '${arg}'\n`, 129);
    }
  }

  const result = await repo.listFiles({
    ref: resolveRef(state, ref),
    path,
    recursive,
  } as ListFilesOptionsWithPath);
  const entries = getTreeEntries(result);
  const displayEntries =
    entries.length > 0
      ? entries
      : result.paths.map((entryPath) => ({
          mode: '100644',
          type: 'blob' as const,
          path: entryPath,
        }));
  return ok(
    displayEntries
      .map((entry) => `${entry.mode} ${entry.type}\t${entry.path}`)
      .join('\n') + (displayEntries.length > 0 ? '\n' : '')
  );
}

export async function gitBlame(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  const filePath = args[0];
  if (!filePath) {
    return fail('usage: git blame <path>\n', 129);
  }
  const [blame, fileResponse] = await Promise.all([
    repo.getBlame({ path: filePath, ref: state.branch }),
    repo.getFileStream({ path: filePath, ref: state.branch }),
  ]);
  const text = new TextDecoder().decode(await responseBytes(fileResponse));
  return ok(formatBlame(blame.lines, text.split(/\r?\n/)));
}

export async function gitRevParse(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  if (args[0] === '--abbrev-ref' && args[1] === 'HEAD') {
    return ok(`${state.branch}\n`);
  }
  const ref = resolveRef(state, args[0]);
  const { commit } = await repo.getCommit({ sha: ref });
  state.headSha = commit.sha;
  return ok(`${commit.sha}\n`);
}

function splitFileTarget(target: string): { ref: string; path: string } | null {
  const sep = target.indexOf(':');
  if (sep <= 0 || sep === target.length - 1) {
    return null;
  }
  return { ref: target.slice(0, sep), path: target.slice(sep + 1) };
}

function bytesResult(bytes: Uint8Array): ExecResult {
  return {
    stdout: Buffer.from(bytes).toString('latin1'),
    stderr: '',
    exitCode: 0,
    stdoutKind: 'bytes',
    stdoutEncoding: 'binary',
  };
}

type ListFilesOptionsWithPath = Parameters<Repo['listFiles']>[0] & {
  path?: string;
  recursive?: boolean;
};

interface TreeEntry {
  path: string;
  type: string;
  mode: string;
}

function getTreeEntries(result: ListFilesResult): TreeEntry[] {
  if ('entries' in result && Array.isArray(result.entries)) {
    return result.entries;
  }
  return [];
}
