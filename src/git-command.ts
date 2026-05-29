import { defineCommand, type Command, type ExecResult } from 'just-bash';

import {
  fail,
  ok,
  parseDefaultBranch,
  runGitOperation,
  usage,
} from './git/common.js';
import { gitDiff } from './git/diff.js';
import {
  gitBlame,
  gitCatFile,
  gitLog,
  gitLsFiles,
  gitLsTree,
  gitRevParse,
  gitShow,
} from './git/read.js';
import {
  gitBranch,
  gitCheckout,
  gitMerge,
  gitSwitch,
  gitTag,
} from './git/refs.js';
import { gitGrep } from './git/search.js';
import { gitClone, gitFetch, gitPull, gitPush } from './git/sync.js';
import { gitAdd, gitCommit, gitRm, gitStatus } from './git/write.js';
import type { GitCommandOptions, GitState } from './types.js';

export type { GitCommandOptions, GitState } from './types.js';

export function createGitCommand(opts: GitCommandOptions): Command {
  const state: GitState = {
    repo: opts.repo ?? null,
    branch: opts.branch ?? opts.repo?.defaultBranch ?? 'main',
    stage: new Map(),
  };

  return defineCommand('git', async (args, ctx) =>
    runGitOperation(async () => {
      const [subcommand, ...rest] = args;
      switch (subcommand) {
        case undefined:
        case '--help':
        case 'help':
          return usage();
        case 'init':
          return gitInit(opts, state, rest);
        case 'add':
          return gitAdd(state, rest, ctx);
        case 'commit':
          return gitCommit(state, opts, rest, ctx);
        case 'log':
          return gitLog(state, rest);
        case 'show':
          return gitShow(state, rest);
        case 'cat-file':
          return gitCatFile(state, rest);
        case 'ls-files':
          return gitLsFiles(state, rest);
        case 'ls-tree':
          return gitLsTree(state, rest);
        case 'blame':
          return gitBlame(state, rest);
        case 'grep':
          return gitGrep(state, rest);
        case 'branch':
          return gitBranch(state, rest);
        case 'tag':
          return gitTag(state, rest);
        case 'diff':
          return gitDiff(state, rest);
        case 'rev-parse':
          return gitRevParse(state, rest);
        case 'checkout':
          return gitCheckout(state, rest);
        case 'switch':
          return gitSwitch(state, rest);
        case 'merge':
          return gitMerge(state, opts, rest, ctx);
        case 'rm':
          return gitRm(state, rest, ctx);
        case 'status':
          return gitStatus(state, rest, ctx);
        case 'clone':
          return gitClone(state, opts, rest, ctx);
        case 'pull':
          return gitPull(state, rest, ctx);
        case 'push':
          return gitPush(state, opts, rest, ctx);
        case 'fetch':
          return gitFetch(state, rest);
        default:
          return fail(
            `git: '${subcommand}' is not a git command. See 'git --help'.\n`,
            1
          );
      }
    })
  );
}

async function gitInit(
  opts: Pick<GitCommandOptions, 'store'>,
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const { repoId, branch } = parseDefaultBranch(args);
  if (!repoId) {
    return fail('usage: git init <id> [--default-branch <branch>]\n', 129);
  }

  const repo = await opts.store.createRepo({
    id: repoId,
    defaultBranch: branch,
  });
  state.repo = repo;
  state.branch = repo.defaultBranch || branch;
  state.stage.clear();
  state.headSha = undefined;
  state.cloneDir = undefined;
  return ok(`Initialized empty code.storage repository ${repo.id}\n`);
}
