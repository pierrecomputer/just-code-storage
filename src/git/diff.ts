import type { ExecResult } from 'just-bash';

import { formatDiff } from '../format.js';
import type { GitState } from '../types.js';
import { fail, ok, requireRepo } from './common.js';

export async function gitDiff(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  if (args.length === 0) {
    return ok('');
  }
  if (args.length > 1) {
    return fail('usage: git diff [<branch>|<sha>|<base>..<branch>]\n', 129);
  }

  const target = args[0];
  if (target.includes('..')) {
    const [base, branch] = target.split('..', 2);
    if (!base || !branch) {
      return fail('fatal: invalid revision range\n', 128);
    }
    const result = await repo.getBranchDiff({ base, branch });
    return ok(formatDiff(result.files));
  }

  if (looksLikeSha(target)) {
    const result = await repo.getCommitDiff({ sha: target });
    return ok(formatDiff(result.files));
  }

  const result = await repo.getBranchDiff({
    base: target,
    branch: state.branch,
  });
  return ok(formatDiff(result.files));
}

function looksLikeSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}
