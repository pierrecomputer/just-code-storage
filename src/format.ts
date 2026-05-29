import type {
  BlameLine,
  BranchInfo,
  CommitInfo,
  FileDiff,
  TagInfo,
} from '@pierre/storage';

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function subject(message: string): string {
  return message.split(/\r?\n/, 1)[0] || '(no message)';
}

export function formatLog(commits: CommitInfo[], oneline: boolean): string {
  if (oneline) {
    const lines = commits.map(
      (commit) => `${shortSha(commit.sha)} ${subject(commit.message)}`
    );
    return lines.join('\n') + (lines.length > 0 ? '\n' : '');
  }
  return commits.map(formatCommitHeader).join('\n');
}

export function formatCommitHeader(commit: CommitInfo): string {
  const message = commit.message
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
  return [
    `commit ${commit.sha}`,
    `Author: ${commit.authorName} <${commit.authorEmail}>`,
    `Date:   ${formatDate(commit)}`,
    '',
    message,
    '',
  ].join('\n');
}

export function formatDiff(files: FileDiff[]): string {
  return files.map((file) => file.raw).join('');
}

export function formatBranches(
  branches: BranchInfo[],
  currentBranch: string
): string {
  return (
    branches
      .map((branch) => {
        const marker = branch.name === currentBranch ? '*' : ' ';
        return `${marker} ${branch.name}`;
      })
      .join('\n') + (branches.length > 0 ? '\n' : '')
  );
}

export function formatTags(tags: TagInfo[]): string {
  return tags.map((tag) => tag.name).join('\n') + (tags.length > 0 ? '\n' : '');
}

export function formatBlame(lines: BlameLine[], fileLines: string[]): string {
  return (
    lines
      .map((line) => {
        const text = fileLines[line.lineNumber - 1] ?? '';
        return `${shortSha(line.commitSha)} (${line.authorName} ${line.rawAuthorTime} ${line.lineNumber}) ${text}`;
      })
      .join('\n') + (lines.length > 0 ? '\n' : '')
  );
}

function formatDate(commit: CommitInfo): string {
  return commit.rawDate || commit.date.toISOString();
}
