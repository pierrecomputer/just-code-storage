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

interface DemoSession {
  bash: Bash;
  cwd: string;
}

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
    'echo "" >> README.md',
    'echo "A small repository used to exercise collaborative git-shaped workflows." >> README.md',
    'mkdir -p src/git src/storage docs/adr test/fixtures scripts',
    'echo "export * from \\"./git/branches.js\\";" > src/index.ts',
    'echo "export * from \\"./storage/client.js\\";" >> src/index.ts',
    'echo "export function defaultBranch() {" > src/git/branches.ts',
    'echo "  return \\"main\\";" >> src/git/branches.ts',
    'echo "}" >> src/git/branches.ts',
    'echo "export function createClient(repoId: string) {" > src/storage/client.ts',
    'echo "  return { repoId, provider: \\"code.storage\\" };" >> src/storage/client.ts',
    'echo "}" >> src/storage/client.ts',
    'echo "# ADR 0001: Storage-backed git" > docs/adr/0001-code-storage.md',
    'echo "" >> docs/adr/0001-code-storage.md',
    'echo "The repository stores canonical history in code.storage." >> docs/adr/0001-code-storage.md',
    'echo "README.md" > test/fixtures/sample-repo.txt',
    'echo "src/index.ts" >> test/fixtures/sample-repo.txt',
    'echo "echo checking collaborative repository" > scripts/check.sh',
    'git add README.md',
    'git add src docs test scripts',
    'git commit -m "Initial shared project"',
    'git log --oneline',
  ]);

  await runSession('bob', bob, [
    `git clone ${repoId} reviewer-worktree`,
    'cd reviewer-worktree',
    'git switch -c docs/collaboration',
    'mkdir -p docs/collaboration src/git/commands test/integration',
    'echo "## Collaboration review" > docs/collaboration/review.md',
    'echo "" >> docs/collaboration/review.md',
    'echo "- Reviewed from a separate just-bash session." >> docs/collaboration/review.md',
    'echo "- Added command scaffolding and an integration fixture." >> docs/collaboration/review.md',
    'echo "" >> README.md',
    'echo "## Collaboration" >> README.md',
    'echo "" >> README.md',
    'echo "The docs/collaboration tree records review notes from another shell." >> README.md',
    'echo "export * from \\"./git/commands/merge.js\\";" >> src/index.ts',
    'echo "export function mergeSummary(source: string, target: string) {" > src/git/commands/merge.ts',
    'echo "  return \\"merge \\" + source + \\" into \\" + target;" >> src/git/commands/merge.ts',
    'echo "}" >> src/git/commands/merge.ts',
    'echo "merge docs/collaboration into main" > test/integration/collaboration.test.ts',
    'git add README.md docs src test',
    'git status',
    'git commit -m "Add collaboration feature tree"',
    'git log --oneline -n 2',
  ]);

  await runSession('alice', alice, [
    'git fetch',
    'git merge docs/collaboration',
    'git pull',
    'git ls-files',
    'cat README.md',
    'cat docs/collaboration/review.md',
    'cat src/git/commands/merge.ts',
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
): DemoSession {
  const bash = new Bash({
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
  return { bash, cwd: bash.getCwd() };
}

async function runSession(
  label: string,
  session: DemoSession,
  commands: string[]
): Promise<void> {
  for (const command of commands) {
    console.log(`${label}$ ${command}`);
    const result = await session.bash.exec(command, { cwd: session.cwd });
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.exitCode !== 0) {
      throw new Error(`${command} exited with ${result.exitCode}`);
    }
    const cdTarget = parseCdTarget(command);
    if (cdTarget) {
      session.cwd = session.bash.fs.resolvePath(session.cwd, cdTarget);
    }
  }
}

function parseCdTarget(command: string): string | null {
  const match = /^cd(?:\s+(.+))?$/.exec(command.trim());
  return match ? (match[1] ?? '/') : null;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
