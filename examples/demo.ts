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
  await runSmokeDemo();

  if (process.env.CODE_STORAGE_REPO) {
    await runBrowseDemo(process.env.CODE_STORAGE_REPO);
  }
}

async function runSmokeDemo(): Promise<void> {
  const repoId = `code-storage-git-smoke-${Date.now()}`;
  const bash = new Bash({
    customCommands: [createGitCommand({ store, author })],
  });

  console.log('=== Smoke: create -> add -> commit -> log ===\n');
  await runSession(bash, [
    `git init ${repoId}`,
    'echo "# Hello code.storage" > README.md',
    'git add README.md',
    'git commit -m "Initial commit"',
    'git log --oneline',
  ]);
}

async function runBrowseDemo(repoId: string): Promise<void> {
  const repo = await store.findOne({ id: repoId });
  if (!repo) {
    console.log(`Skipping browse demo: ${repoId} was not found.`);
    return;
  }

  const bash = new Bash({
    customCommands: [createGitCommand({ store, repo, author })],
  });

  console.log(`\n=== Browse: ${repoId} ===\n`);
  await runSession(bash, [
    'git log --oneline -n 5',
    'git ls-files',
    'git branch',
  ]);
}

async function runSession(bash: Bash, commands: string[]): Promise<void> {
  for (const command of commands) {
    console.log(`$ ${command}`);
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
