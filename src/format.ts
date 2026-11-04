import type { BlameLine, Branch, Commit, FileDiff, Tag } from '@pierre/sdk';

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function subject(message: string): string {
  return message.split(/\r?\n/, 1)[0] || '(no message)';
}

export function formatLog(commits: Commit[], oneline: boolean): string {
  if (oneline) {
    const lines = commits.map(
      (commit) => `${shortSha(commit.sha)} ${subject(commit.message)}`
    );
    return lines.join('\n') + (lines.length > 0 ? '\n' : '');
  }
  return commits.map(formatCommitHeader).join('\n');
}

export function formatCommitHeader(commit: Commit): string {
  const message = commit.message
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
  return [
    `commit ${commit.sha}`,
    `Author: ${commit.author_name} <${commit.author_email}>`,
    `Date:   ${commit.date}`,
    '',
    message,
    '',
  ].join('\n');
}

export function formatDiff(files: FileDiff[]): string {
  return files.map((file) => file.raw).join('');
}

export function formatBranches(
  branches: Branch[],
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

export function formatTags(tags: Tag[]): string {
  return tags.map((tag) => tag.name).join('\n') + (tags.length > 0 ? '\n' : '');
}

export function formatBlame(lines: BlameLine[], fileLines: string[]): string {
  return (
    lines
      .map((line) => {
        const text = fileLines[line.line_number - 1] ?? '';
        return `${shortSha(line.commit_sha)} (${line.author_name} ${line.author_time} ${line.line_number}) ${text}`;
      })
      .join('\n') + (lines.length > 0 ? '\n' : '')
  );
}
