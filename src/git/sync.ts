import type { Repo } from '@pierre/storage';
import type { CommandContext, ExecResult } from 'just-bash';

import { basenamePath } from '../path.js';
import type { GitCommandOptions, GitState } from '../types.js';
import {
  ensureParentDir,
  fail,
  fsPathForRepoPath,
  ok,
  requireRepo,
  responseBytes,
} from './common.js';
import { commitStagedOrAll } from './write.js';

export async function gitClone(
  state: GitState,
  opts: Pick<GitCommandOptions, 'store'>,
  args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  const repoId = args[0];
  if (!repoId || repoId.startsWith('-')) {
    return fail('usage: git clone <repo-id> [<dir>]\n', 129);
  }
  const dir = args[1] ?? basenamePath(repoId);
  const repo = await opts.store.findOne({ id: repoId });
  if (!repo) {
    return fail(`fatal: repository '${repoId}' was not found\n`, 128);
  }

  state.repo = repo;
  state.branch = repo.defaultBranch;
  state.stage.clear();
  state.cloneDir = ctx.fs.resolvePath(ctx.cwd, dir);
  await ctx.fs.mkdir(state.cloneDir, { recursive: true });
  const count = await materializeRemote(state, ctx);
  return ok(`Cloned ${repoId} into ${dir} (${count} files)\n`);
}

export async function gitPull(
  state: GitState,
  _args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  requireRepo(state);
  const count = await materializeRemote(state, ctx);
  return ok(`Already up to date. Refreshed ${count} files.\n`);
}

export async function gitFetch(
  state: GitState,
  _args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  const branches = await repo.listBranches();
  const lines = branches.branches.map(
    (branch) => `From code.storage/${repo.id} ${branch.name} ${branch.headSha}`
  );
  return ok(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
}

export async function gitPush(
  state: GitState,
  opts: Pick<GitCommandOptions, 'author'>,
  _args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  requireRepo(state);
  return commitStagedOrAll(
    state,
    opts,
    ctx,
    `Update ${state.branch} from just-bash`
  );
}

async function materializeRemote(
  state: GitState,
  ctx: CommandContext
): Promise<number> {
  const repo = requireRepo(state);
  const root = state.cloneDir ?? ctx.cwd;
  await ctx.fs.mkdir(root, { recursive: true });

  const listing = await repo.listFiles({
    ref: state.branch,
    recursive: true,
  } as Parameters<Repo['listFiles']>[0] & { recursive?: boolean });
  let count = 0;
  for (const repoPath of listing.paths) {
    const target = fsPathForRepoPath(state, ctx, repoPath);
    const response = await repo.getFileStream({
      ref: state.branch,
      path: repoPath,
    });
    await ensureParentDir(ctx.fs, target);
    await ctx.fs.writeFile(target, await responseBytes(response));
    count++;
  }
  return count;
}
