# @piere/just-code-storage

`@pierre/just-code-storage` is a git-flavored command for
[`just-bash`](https://www.npmjs.com/package/just-bash), backed by
[code.storage](https://code.storage). Made with love by
[The Pierre Computer Company](https://pierre.computer).

It gives a `just-bash` shell a custom `git` command that talks to the
`@pierre/storage` SDK, so scripts can create repositories, stage files, commit
changes, inspect history, manage refs, search code, and sync a virtual working
tree without shelling out to system Git.

## Features

- Git-shaped setup and sync commands: `init`, `clone`, `fetch`, `pull`, and
  `push`.
- Staging and committing through the `just-bash` virtual file system with `add`,
  `rm`, `commit`, and `status`.
- History and file browsing with `log`, `show`, `cat-file`, `ls-files`,
  `ls-tree`, `blame`, and `rev-parse`.
- Search, diff, and ref workflows with `grep`, `diff`, `branch`, `tag`,
  `checkout`, `switch`, and `merge`.
- Binary-safe commits via the SDK commit builder.
- Optimistic ref updates with git-style conflict messages when the remote has
  moved.

## Install

```bash
bun i @pierre/just-code-storage just-bash
```

`just-bash` is a peer dependency because your app owns the shell instance that
receives the custom command. The code.storage SDK is a regular dependency of
this package, and `GitStorage` is re-exported for convenience.

## Usage

You need a Pierre org name and private key to create the SDK client.

```ts
import { Bash } from 'just-bash';
import { GitStorage, createGitCommand } from '@pierre/just-code-storage';

const store = new GitStorage({
  name: process.env.ORG_NAME ?? 'pierre',
  key: process.env.PIERRE_PRIVATE_KEY!,
});

const git = createGitCommand({
  store,
  author: {
    name: 'agent',
    email: 'agent@example.com',
  },
});

const bash = new Bash({
  customCommands: [git],
});

await bash.exec('git init my-repo');
await bash.exec('echo data > file.txt');
await bash.exec('git add file.txt');
await bash.exec("git commit -m 'initial'");
await bash.exec('git log --oneline');
```

Create one `git` command per session and reuse it with the same `Bash` instance.
The command keeps the selected repo, current branch, staged paths, and cloned
working directory in memory between `bash.exec()` calls.

Once registered, the command works like any other `just-bash` command:

```bash
git status
git log --oneline -n 5
git diff main..feature
git grep -n "createGitCommand"
git branch release
git switch release
git push
```

## Supported Commands

| Command     | Example                          | Description                                                                |
| ----------- | -------------------------------- | -------------------------------------------------------------------------- |
| `init`      | `git init my-repo`               | Create a code.storage repository and select it for the session.            |
| `clone`     | `git clone my-repo worktree`     | Select an existing repository and materialize its files into the VFS.      |
| `add`       | `git add README.md`              | Stage files or directories from the selected worktree for commit.          |
| `rm`        | `git rm old.txt`                 | Remove paths from the VFS and stage deletions.                             |
| `commit`    | `git commit -m "initial"`        | Send staged changes through the SDK commit builder.                        |
| `status`    | `git status`                     | Show staged and unstaged VFS changes against the selected branch.          |
| `log`       | `git log --oneline -n 5`         | List commits for the current branch, optionally limited or path-filtered.  |
| `show`      | `git show HEAD`                  | Show a commit and its diff, or emit file bytes with `<ref>:<path>`.        |
| `cat-file`  | `git cat-file -p HEAD:README.md` | Emit file bytes from a ref and path.                                       |
| `ls-files`  | `git ls-files src`               | List repository paths.                                                     |
| `ls-tree`   | `git ls-tree -r HEAD`            | List tree entries for a ref.                                               |
| `blame`     | `git blame README.md`            | Show line attribution for a file.                                          |
| `rev-parse` | `git rev-parse HEAD`             | Resolve a ref to a commit SHA or print the current branch.                 |
| `grep`      | `git grep -n pattern -- src/**`  | Search repository contents.                                                |
| `diff`      | `git diff main..feature`         | Show branch or commit diffs.                                               |
| `branch`    | `git branch release`             | List, create, or delete branches.                                          |
| `tag`       | `git tag v1 HEAD`                | List, create, or delete tags.                                              |
| `checkout`  | `git checkout main`              | Select a branch, or create one with `-b`.                                  |
| `switch`    | `git switch -c feature`          | Select branches with the modern Git spelling.                              |
| `merge`     | `git merge feature`              | Merge a source branch into the current branch with a default message.      |
| `fetch`     | `git fetch`                      | List remote branch heads from code.storage.                                |
| `pull`      | `git pull`                       | Refresh the VFS working tree from the current branch.                      |
| `push`      | `git push`                       | Commit staged changes, or stage the current VFS tree if nothing is staged. |

`git --help` and `git help` print the command summary.

## Development

This package uses Bun, TypeScript, `tsdown`, Bun's native test runner, and
`oxfmt`.

```bash
bun install
bun run build
bun run dev
bun test
bun run tsc
bun run format:check
```

`bun run build` emits the package entry at `dist/index.js` and declarations at
`dist/index.d.ts`.

## Examples

The live examples are gated on `PIERRE_PRIVATE_KEY` so they can be run safely
without credentials:

```bash
bun examples/demo.ts
bun examples/git-operations.ts
```

To run them against code.storage:

```bash
PIERRE_PRIVATE_KEY="$(cat key.pem)" ORG_NAME=my-org bun examples/demo.ts
PIERRE_PRIVATE_KEY="$(cat key.pem)" ORG_NAME=my-org bun examples/git-operations.ts
```

`examples/demo.ts` creates a temporary repository, then simulates three
independent `just-bash` sessions. Alice seeds a nested project tree, Bob clones
it and commits a feature branch with docs, source, and test files, Carol clones
it and commits a release hardening branch with a deletion and new subtrees, and
Alice fetches, merges, tags, pulls, searches, and reads files from the merged
tree.

`examples/git-operations.ts` focuses on operation coverage. It creates a
temporary repository and touches every supported `git` command listed above,
including setup, staging, history, file reads, refs, diff, merge, sync, and help
commands.

Optional environment variables:

- `CODE_STORAGE_REPO`: browse an existing repository after the collaboration
  demo.
- `CODE_STORAGE_API_BASE_URL`: override the code.storage API endpoint.
- `CODE_STORAGE_STORAGE_BASE_URL`: override the storage endpoint.
- `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL`: set the commit author used by the
  demo.

## License

Apache-2.0. See [LICENSE](./LICENSE).
