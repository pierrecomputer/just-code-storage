import type { Repo } from '@pierre/storage';
import type { CommandContext, ExecResult } from 'just-bash';

import { formatBranches, formatTags, shortSha } from '../format.js';
import type { GitCommandOptions, GitState } from '../types.js';
import {
  fail,
  getAuthor,
  GitAbort,
  ok,
  requireRepo,
  resolveRef,
} from './common.js';

export async function gitBranch(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  if (args.length === 0 || (args.length === 1 && args[0] === '-a')) {
    const result = await repo.listBranches();
    return ok(formatBranches(result.branches, state.branch));
  }
  if (args[0] === '-d') {
    const name = args[1];
    if (!name) {
      return fail('error: branch name required\n', 129);
    }
    await repo.deleteBranch({ name });
    if (state.branch === name) {
      state.branch = repo.defaultBranch;
    }
    return ok(`Deleted branch ${name}.\n`);
  }
  if (args.length === 1 && !args[0].startsWith('-')) {
    const result = await repo.createBranch({
      baseRef: state.branch,
      targetBranch: args[0],
    });
    return ok(`Branch ${result.targetBranch} set up.\n`);
  }
  return fail('usage: git branch [-a] [-d <name>] [<name>]\n', 129);
}

export async function gitTag(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  if (args.length === 0) {
    const result = await repo.listTags();
    return ok(formatTags(result.tags));
  }
  if (args[0] === '-d') {
    const name = args[1];
    if (!name) {
      return fail('error: tag name required\n', 129);
    }
    await repo.deleteTag({ name });
    return ok(`Deleted tag '${name}'.\n`);
  }
  const [name, target = 'HEAD'] = args;
  if (!name || name.startsWith('-')) {
    return fail('usage: git tag [<name> <sha>] | git tag -d <name>\n', 129);
  }
  const result = await repo.createTag({
    name,
    target: resolveRef(state, target),
  });
  return ok(`${result.name} ${shortSha(result.sha)}\n`);
}

export async function gitCheckout(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  if (args[0] === '-b') {
    const targetBranch = args[1];
    const baseRef = args[2] ?? state.branch;
    if (!targetBranch) {
      return fail('usage: git checkout -b <new-branch> [<base>]\n', 129);
    }
    await repo.createBranch({ baseRef, targetBranch });
    state.branch = targetBranch;
    state.stage.clear();
    return ok(`Switched to a new branch '${targetBranch}'\n`);
  }

  const branch = args[0];
  if (!branch || branch.startsWith('-')) {
    return fail('usage: git checkout <branch>\n', 129);
  }
  await verifyBranch(repo, branch);
  state.branch = branch;
  state.stage.clear();
  return ok(`Switched to branch '${branch}'\n`);
}

export async function gitSwitch(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  if (args[0] === '-c') {
    return gitCheckout(state, ['-b', ...args.slice(1)]);
  }
  return gitCheckout(state, args);
}

export async function gitMerge(
  state: GitState,
  opts: Pick<GitCommandOptions, 'author'>,
  args: string[],
  ctx: CommandContext
): Promise<ExecResult> {
  const repo = requireRepo(state);
  const sourceBranch = args[0];
  if (!sourceBranch || sourceBranch.startsWith('-')) {
    return fail('usage: git merge <source-branch>\n', 129);
  }
  const result = await repo.merge({
    sourceBranch,
    targetBranch: state.branch,
    strategy: 'merge',
    commitMessage: `Merge branch '${sourceBranch}' into ${state.branch}`,
    author: getAuthor(opts, ctx),
  });
  state.headSha = result.target.newSha;
  return ok(
    `Merge made by code.storage '${result.result}' strategy.\n${shortSha(
      result.target.oldSha
    )}..${shortSha(result.target.newSha)} ${state.branch}\n`
  );
}

async function verifyBranch(repo: Repo, name: string) {
  const result = await repo.listBranches();
  if (!result.branches.some((branch) => branch.name === name)) {
    throw new GitAbort(
      fail(`error: pathspec '${name}' did not match any branch\n`, 1)
    );
  }
}
