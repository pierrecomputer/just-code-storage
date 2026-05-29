/**
 * code.storage-backed git command example.
 *
 * Run with:
 *   PIERRE_PRIVATE_KEY="$(cat key.pem)" ORG_NAME=my-org bun examples/demo.ts
 */

import { Bash } from 'just-bash';

import { GitStorage, createGitCommand } from '../src/index.js';

const key = process.env.PIERRE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!key) {
  console.log('Skipping code.storage git demo.');
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
  await runCollaborativeDemo();

  if (process.env.CODE_STORAGE_REPO) {
    await runBrowseDemo(process.env.CODE_STORAGE_REPO);
  }
}

async function runCollaborativeDemo(): Promise<void> {
  const repoId = `code-storage-git-collab-${Date.now()}`;
  const alice = createShell(`${author.name}-alice`);
  const bob = createShell(`${author.name}-bob`);

  console.log('=== Collaborative: owner + reviewer on one repo ===\n');
  await runSession('alice', alice, [
    `git init ${repoId}`,
    'echo "# Shared code.storage project" > README.md',
    'git add README.md',
    'git commit -m "Initial shared project"',
    'git log --oneline',
  ]);

  await runSession('bob', bob, [
    `git clone ${repoId} reviewer-worktree`,
    'cd reviewer-worktree',
    'git switch -c docs/collaboration',
    'echo "Reviewed from a separate just-bash session." > COLLABORATION.md',
    'git add COLLABORATION.md',
    'git commit -m "Add collaboration notes"',
    'git log --oneline -n 2',
  ]);

  await runSession('alice', alice, [
    'git fetch',
    'git merge docs/collaboration',
    'git pull',
    'git ls-files',
    'cat COLLABORATION.md',
    'git log --oneline -n 3',
  ]);
}

async function runBrowseDemo(repoId: string): Promise<void> {
  const repo = await store.findOne({ id: repoId });
  if (!repo) {
    console.log(`Skipping browse demo: ${repoId} was not found.`);
    return;
  }

  const bash = createShell(author.name, repo);

  console.log(`\n=== Browse: ${repoId} ===\n`);
  await runSession('browse', bash, [
    'git log --oneline -n 5',
    'git ls-files',
    'git branch',
  ]);
}

function createShell(
  name: string,
  repo?: Awaited<ReturnType<typeof store.findOne>>
): Bash {
  return new Bash({
    customCommands: [
      createGitCommand({
        store,
        repo: repo ?? undefined,
        author: {
          ...author,
          name,
        },
      }),
    ],
  });
}

async function runSession(
  label: string,
  bash: Bash,
  commands: string[]
): Promise<void> {
  for (const command of commands) {
    console.log(`${label}$ ${command}`);
    const result = await bash.exec(command);
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.exitCode !== 0) {
      throw new Error(`${command} exited with ${result.exitCode}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
