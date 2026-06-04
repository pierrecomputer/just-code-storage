/**
 * code.storage-backed git operation coverage example.
 *
 * Run with:
 *   PIERRE_PRIVATE_KEY="$(cat key.pem)" ORG_NAME=my-org bun examples/git-operations.ts
 */

import { Bash } from 'just-bash';

import { GitStorage, createGitCommand } from '../src/index.js';

const key = process.env.PIERRE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!key) {
  console.log('Skipping code.storage git operations example.');
  console.log('Set PIERRE_PRIVATE_KEY and ORG_NAME to run the live example.');
  process.exit(0);
}

const store = new GitStorage({
  name: process.env.ORG_NAME ?? 'pierre',
  key,
  apiBaseUrl: process.env.CODE_STORAGE_API_BASE_URL,
  storageBaseUrl: process.env.CODE_STORAGE_STORAGE_BASE_URL,
});

const author = {
  name: process.env.GIT_AUTHOR_NAME ?? 'agent',
  email: process.env.GIT_AUTHOR_EMAIL ?? 'agent@example.com',
};

async function main(): Promise<void> {
  const repoId = `code-storage-git-ops-${Date.now()}`;
  const owner = createGitShell(`${author.name}-ops-owner`);
  const worker = createGitShell(`${author.name}-ops-worker`);

  console.log('=== Git operation coverage ===\n');
  await runScript('owner', owner, [
    'git help',
    'git --help',
    `git init ${repoId}`,
    'git status',
    'mkdir -p src docs scripts test',
    'echo "# Git operation coverage" > README.md',
    'echo "" >> README.md',
    'echo "This repository exercises each @pierre/just-code-storage git command." >> README.md',
    'echo "export const command = \\"git\\";" > src/index.ts',
    'echo "# Operations guide" > docs/guide.md',
    'echo "temporary script" > scripts/remove-me.sh',
    'echo "fixture" > test/fixture.txt',
    'git add README.md src docs scripts test',
    'git commit -m "Seed operation coverage repo"',
    'git status',
    'git log --oneline',
    'echo "# Push coverage" > docs/push.md',
    'git push',
    'git branch scratch/delete-me',
    'git branch',
    'git branch -d scratch/delete-me',
    'git tag ops-base HEAD',
    'git tag',
    'git tag -d ops-base',
  ]);

  await runScript('worker', worker, [
    `git clone ${repoId} ops-worktree`,
    'cd ops-worktree',
    'git fetch',
    'git ls-files',
    'git ls-tree -r HEAD',
    'git show HEAD:README.md',
    'git cat-file -p HEAD:README.md',
    'git blame README.md',
    'git rev-parse --abbrev-ref HEAD',
    'git grep -n coverage -- README.md docs src',
    'git checkout -b ops/checkout-only',
    'git checkout main',
    'git switch -c ops/feature',
    'mkdir -p src/commands docs/feature test/integration',
    'echo "export function operationName() {" > src/commands/operation.ts',
    'echo "  return \\"coverage\\";" >> src/commands/operation.ts',
    'echo "}" >> src/commands/operation.ts',
    'echo "# Feature notes" > docs/feature/notes.md',
    'echo "operation coverage" > test/integration/operation.test.ts',
    'echo "" >> README.md',
    'echo "## Feature branch" >> README.md',
    'echo "The feature branch adds nested source, docs, and tests." >> README.md',
    'git add README.md src docs test',
    'git status',
    'git commit -m "Add feature operation tree"',
    'git rm scripts/remove-me.sh',
    'git commit -m "Remove obsolete script"',
    'git log --oneline -n 3',
    'git diff main..ops/feature',
    'git checkout main',
    'git merge ops/feature',
    'git pull',
    'git tag ops-final HEAD',
    'git tag',
    'git rev-parse --abbrev-ref HEAD',
    'git show HEAD:docs/push.md',
    'git ls-files',
    'git log --oneline -n 5',
  ]);
}

function createGitShell(name: string): Bash {
  return new Bash({
    customCommands: [
      createGitCommand({
        store,
        author: {
          ...author,
          name,
        },
      }),
    ],
  });
}

async function runScript(
  label: string,
  bash: Bash,
  commands: string[]
): Promise<void> {
  for (const command of commands) {
    console.log(`${label}$ ${command}`);
  }

  const result = await bash.exec(['set -e', ...commands].join('\n'));
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${label} script exited with ${result.exitCode}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
