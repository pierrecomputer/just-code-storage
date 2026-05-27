import type { ExecResult } from 'just-bash';

import type { GitState } from '../types.js';
import { fail, ok, requireRepo } from './common.js';

export async function gitGrep(
  state: GitState,
  args: string[]
): Promise<ExecResult> {
  const repo = requireRepo(state);
  let caseSensitive = true;
  let showLineNumbers = false;
  let pattern: string | undefined;
  const includeGlobs: string[] = [];
  let afterDashDash = false;

  for (const arg of args) {
    if (arg === '--') {
      afterDashDash = true;
    } else if (!afterDashDash && arg === '-i') {
      caseSensitive = false;
    } else if (!afterDashDash && arg === '-n') {
      showLineNumbers = true;
    } else if (!afterDashDash && arg.startsWith('-')) {
      return fail(`error: unknown option '${arg}'\n`, 129);
    } else if (!pattern) {
      pattern = arg;
    } else {
      includeGlobs.push(arg);
    }
  }

  if (!pattern) {
    return fail('usage: git grep [-i] [-n] <pattern> [-- <glob>]\n', 129);
  }

  const result = await repo.grep({
    ref: state.branch,
    query: { pattern, caseSensitive },
    fileFilters: includeGlobs.length > 0 ? { includeGlobs } : undefined,
  });

  const lines = result.matches.flatMap((match) =>
    match.lines.map((line) =>
      showLineNumbers
        ? `${match.path}:${line.lineNumber}:${line.text}`
        : `${match.path}:${line.text}`
    )
  );
  return ok(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
}
