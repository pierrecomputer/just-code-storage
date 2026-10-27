import {
  NotFoundError,
  RefUpdateError,
  type Commit,
  type CommitFile,
  type CommitWriteResponse,
  type Pierre,
  type ReposCommitsCreateParams,
  type ReposCreateParams,
  type ReposFilesMetadataListParams,
  type ReposMergeParams,
  type ReposMergeResponse,
  type ReposTagsCreateParams,
} from '@pierre/sdk';
import { describe, expect, test } from 'bun:test';
import type { CommandContext, IFileSystem } from 'just-bash';
import path from 'node:path/posix';

import { createGitCommand, type Repo } from '../src/index.js';

describe('createGitCommand phase 0', () => {
  test('creates a repo, stages a VFS file, commits it, and logs it', async () => {
    const commits = new MockCommits();
    const store = makePierre({
      ...commitOperations(commits),
      'repos.create': async (params: ReposCreateParams) => {
        expect(params).toEqual({ repo_name: 'smoke', default_branch: 'main' });
        return { repo_name: 'smoke', message: 'created' };
      },
    });
    const command = createGitCommand({
      store,
      author: { name: 'agent', email: 'agent@example.com' },
    });
    const ctx = makeCtx({ '/README.md': '# Hello code.storage\n' });

    await expect(command.execute(['init', 'smoke'], ctx)).resolves.toEqual({
      stdout: 'Initialized empty code.storage repository smoke\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(command.execute(['add', 'README.md'], ctx)).resolves.toEqual({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    await expect(
      command.execute(['commit', '-m', 'Initial commit'], ctx)
    ).resolves.toEqual({
      stdout: '[main (root-commit) abc1234] Initial commit\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(command.execute(['log', '--oneline'], ctx)).resolves.toEqual({
      stdout: 'abc1234 Initial commit\n',
      stderr: '',
      exitCode: 0,
    });

    expect(commits.files).toEqual([
      {
        path: 'README.md',
        content: new TextEncoder().encode('# Hello code.storage\n'),
      },
    ]);
  });

  test('returns a git-style error before a repo is selected', async () => {
    const command = createGitCommand({ store: {} as never });
    await expect(command.execute(['log'], makeCtx())).resolves.toEqual({
      stdout: '',
      stderr: "fatal: not a git repository (run 'git init <id>' first)\n",
      exitCode: 128,
    });
  });

  test('rejects unknown subcommands', async () => {
    const command = createGitCommand({ store: {} as never });
    await expect(command.execute(['nope'], makeCtx())).resolves.toEqual({
      stdout: '',
      stderr: "git: 'nope' is not a git command. See 'git --help'.\n",
      exitCode: 1,
    });
  });

  test('prints explicit help successfully', async () => {
    const command = createGitCommand({ store: {} as never });

    await expect(command.execute(['help'], makeCtx())).resolves.toEqual({
      stdout:
        'usage: git <command> [<args>]\n\ncommands: init, add, commit, log, show, cat-file, ls-files, ls-tree,\n          blame, grep, branch, tag, diff, rev-parse, checkout, switch,\n          merge, status, rm, clone, pull, push, fetch\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(command.execute(['--help'], makeCtx())).resolves.toMatchObject(
      {
        stderr: '',
        exitCode: 0,
      }
    );
    await expect(command.execute([], makeCtx())).resolves.toMatchObject({
      stdout: '',
      exitCode: 129,
    });
  });

  test('routes every supported operational subcommand', async () => {
    const command = createGitCommand({
      store: makePierre({
        'repos.create': async () => ({ repo_name: 'smoke', message: '' }),
        'repos.get': async () => {
          throw notFoundError();
        },
      }),
      repo: makeRepo(),
    });
    const ctx = makeCtx({ '/README.md': '# Hello code.storage\n' });
    const knownSubcommands = [
      ['init'],
      ['add'],
      ['rm'],
      ['commit'],
      ['status'],
      ['log'],
      ['show'],
      ['cat-file'],
      ['ls-files'],
      ['ls-tree'],
      ['blame'],
      ['rev-parse'],
      ['grep'],
      ['diff'],
      ['branch'],
      ['tag'],
      ['checkout'],
      ['switch'],
      ['merge'],
      ['clone'],
      ['pull'],
      ['push'],
      ['fetch'],
    ];

    for (const args of knownSubcommands) {
      const result = await command.execute(args, ctx);

      expect(result.stderr).not.toBe(
        `git: '${args[0]}' is not a git command. See 'git --help'.\n`
      );
    }
  });

  test('status reads metadata from the current branch ref', async () => {
    let metadataOptions: ReposFilesMetadataListParams | undefined;
    const repo = makeRepo({
      'repos.files.metadata.list': async (
        params: ReposFilesMetadataListParams
      ) => {
        metadataOptions = params;
        return { data: [] };
      },
    });
    const command = createGitCommand({
      store: {} as never,
      repo,
      branch: 'feature/foo',
    });

    await expect(command.execute(['status'], makeCtx())).resolves.toEqual({
      stdout: 'On branch feature/foo\nnothing to commit, working tree clean\n',
      stderr: '',
      exitCode: 0,
    });

    expect(metadataOptions).toMatchObject({
      ref: 'feature/foo',
      recursive: true,
    });
  });

  test('status treats an unborn branch metadata 404 as an empty baseline', async () => {
    const repo = makeRepo({
      'repos.files.metadata.list': async () => {
        throw notFoundError();
      },
      'repos.branches.list': async () => ({ data: [] }),
    });
    const command = createGitCommand({
      store: {} as never,
      repo,
    });

    await expect(
      command.execute(['status'], makeCtx({ '/README.md': '# Hello\n' }))
    ).resolves.toEqual({
      stdout:
        'On branch main\n\nChanges not staged for commit:\n  added: README.md\n',
      stderr: '',
      exitCode: 0,
    });
  });

  test('status does not treat a missing checked-out branch as unborn', async () => {
    let metadataOptions: ReposFilesMetadataListParams | undefined;
    const repo = makeRepo({
      'repos.files.metadata.list': async (
        params: ReposFilesMetadataListParams
      ) => {
        metadataOptions = params;
        throw notFoundError();
      },
      'repos.branches.list': async () => ({
        data: [
          {
            cursor: 'main',
            name: 'main',
            head_sha: 'abc1234567890',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    });
    const command = createGitCommand({
      store: {} as never,
      repo,
      branch: 'feature/foo',
    });

    await expect(command.execute(['status'], makeCtx())).resolves.toEqual({
      stdout: '',
      stderr: 'fatal: code.storage object was not found\n',
      exitCode: 128,
    });

    expect(metadataOptions).toMatchObject({
      ref: 'feature/foo',
      recursive: true,
    });
  });

  test('requires commit messages', async () => {
    const command = createGitCommand({
      store: {} as never,
      repo: makeRepo(),
    });
    await expect(command.execute(['commit'], makeCtx())).resolves.toEqual({
      stdout: '',
      stderr: "error: switch `m' requires a value\n",
      exitCode: 129,
    });
  });

  test('maps SDK ref update conflicts to git-style push errors', async () => {
    const commits = new MockCommits(
      new RefUpdateError(412, {
        result: { status: 'precondition_failed' },
      })
    );
    const command = createGitCommand({
      store: {} as never,
      repo: makeRepo(commitOperations(commits)),
    });
    const ctx = makeCtx({ '/README.md': '# Hello code.storage\n' });

    await command.execute(['add', 'README.md'], ctx);

    await expect(
      command.execute(['commit', '-m', 'Update'], ctx)
    ).resolves.toEqual({
      stdout: '',
      stderr:
        'error: failed to push some refs to code.storage\nhint: fetch or pull before retrying.\n',
      exitCode: 1,
    });
  });

  test('supplies a default commit message for merge commits', async () => {
    let mergeOptions: ReposMergeParams | undefined;
    const repo = makeRepo({
      'repos.merge': async (
        params: ReposMergeParams
      ): Promise<ReposMergeResponse> => {
        mergeOptions = params;
        return {
          result: 'merge_commit',
          commit_sha: 'def4567890abc',
          tree_sha: 'tree',
          source: {
            branch: 'docs/collaboration',
            ref: 'docs/collaboration',
            ephemeral: false,
            sha: 'abc1234567890',
          },
          target: {
            branch: 'main',
            ephemeral: false,
            old_sha: 'abc1234567890',
            new_sha: 'def4567890abc',
          },
          promoted_commits: 1,
        };
      },
    });
    const command = createGitCommand({
      store: {} as never,
      repo,
      author: { name: 'agent', email: 'agent@example.com' },
    });

    await expect(
      command.execute(['merge', 'docs/collaboration'], makeCtx())
    ).resolves.toEqual({
      stdout:
        "Merge made by code.storage 'merge_commit' strategy.\nabc1234..def4567 main\n",
      stderr: '',
      exitCode: 0,
    });

    expect(mergeOptions).toMatchObject({
      repo_name: 'smoke',
      source_ref: 'docs/collaboration',
      target_branch: 'main',
      strategy: 'merge',
      commit_message: "Merge branch 'docs/collaboration' into main",
      author: { name: 'agent', email: 'agent@example.com' },
    });
  });

  test('resolves HEAD before creating a tag', async () => {
    let tagOptions: ReposTagsCreateParams | undefined;
    const repo = makeRepo({
      'repos.commits.get': async () => ({
        commit: makeCommit('abc1234567890abc1234567890abc1234567890ab'),
      }),
      'repos.tags.create': async (params: ReposTagsCreateParams) => {
        tagOptions = params;
        return {
          name: params.name,
          sha: params.ref,
          message: 'created',
        };
      },
    });
    const command = createGitCommand({
      store: {} as never,
      repo,
    });

    await expect(
      command.execute(['tag', 'v0', 'HEAD'], makeCtx())
    ).resolves.toEqual({
      stdout: 'v0 abc1234\n',
      stderr: '',
      exitCode: 0,
    });

    expect(tagOptions).toEqual({
      repo_name: 'smoke',
      name: 'v0',
      ref: 'abc1234567890abc1234567890abc1234567890ab',
    });
  });

  test('rejects paths outside a cloned working tree', async () => {
    const command = createGitCommand({
      store: makePierre({
        'repos.get': async () => ({
          repo_name: 'smoke',
          default_branch: 'main',
          created_at: '2026-01-01T00:00:00.000Z',
        }),
        'repos.files.list': async () => ({
          data: [],
          body: { paths: [], ref: 'main' },
        }),
      }),
    });
    const ctx = makeCtx(
      { '/home/user/COLLABORATION.md': 'outside worktree\n' },
      '/home/user'
    );

    await expect(
      command.execute(['clone', 'smoke', 'reviewer-worktree'], ctx)
    ).resolves.toEqual({
      stdout: 'Cloned smoke into reviewer-worktree (0 files)\n',
      stderr: '',
      exitCode: 0,
    });

    await expect(
      command.execute(['add', 'COLLABORATION.md'], ctx)
    ).resolves.toEqual({
      stdout: '',
      stderr: "fatal: path 'COLLABORATION.md' is outside repository\n",
      exitCode: 128,
    });
  });
});

type Operation = (...args: never[]) => unknown;

function makePierre(operations: Record<string, Operation> = {}): Pierre {
  const root: Record<string, unknown> = {};
  for (const [id, operation] of Object.entries(operations)) {
    const names = id.split('.');
    let node = root;
    for (const name of names.slice(0, -1)) {
      node = (node[name] ??= {}) as Record<string, unknown>;
    }
    node[names[names.length - 1]] = operation;
  }
  return root as unknown as Pierre;
}

function makeRepo(operations: Record<string, Operation> = {}): Repo {
  return {
    pierre: makePierre({
      ...commitOperations(new MockCommits()),
      ...operations,
    }),
    id: 'smoke',
    defaultBranch: 'main',
  };
}

class MockCommits {
  readonly files: CommitFile[] = [];

  constructor(private readonly createError?: unknown) {}

  async create(params: ReposCommitsCreateParams): Promise<CommitWriteResponse> {
    for await (const file of params.files) {
      this.files.push(file);
    }
    if (this.createError) {
      throw this.createError;
    }

    return {
      commit: {
        commit_sha: 'abc1234567890',
        tree_sha: 'tree',
        target_branch: 'main',
        pack_bytes: 32,
        blob_count: this.files.length,
      },
      result: {
        branch: 'main',
        target_branch: 'main',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'abc1234567890',
        status: 'ok',
        success: true,
      },
    };
  }
}

function commitOperations(commits: MockCommits): Record<string, Operation> {
  return {
    'repos.commits.create': (params: ReposCommitsCreateParams) =>
      commits.create(params),
    'repos.commits.list': async () => ({
      data: [makeCommit('abc1234567890')],
    }),
  };
}

function makeCommit(sha: string): Commit {
  return {
    sha,
    message: 'Initial commit',
    author_name: 'agent',
    author_email: 'agent@example.com',
    committer_name: 'agent',
    committer_email: 'agent@example.com',
    date: '2026-01-01T00:00:00.000Z',
    parent_shas: [],
  };
}

function notFoundError(): NotFoundError {
  return new NotFoundError(404, { code: 'not_found', detail: 'not found' });
}

function makeCtx(
  files: Record<string, string> = {},
  cwd = '/'
): CommandContext {
  const fs = new FakeFs(files);
  return {
    fs: fs as unknown as IFileSystem,
    cwd,
    env: new Map(),
    stdin: '' as unknown as CommandContext['stdin'],
  };
}

class FakeFs {
  private readonly files = new Map<string, Uint8Array>();

  constructor(files: Record<string, string>) {
    for (const [filePath, contents] of Object.entries(files)) {
      this.files.set(
        path.resolve('/', filePath),
        new TextEncoder().encode(contents)
      );
    }
  }

  async readFileBuffer(filePath: string): Promise<Uint8Array> {
    const contents = this.files.get(path.resolve('/', filePath));
    if (!contents) {
      throw new Error(`${filePath}: No such file`);
    }
    return contents;
  }

  async writeFile(
    filePath: string,
    contents: string | Uint8Array
  ): Promise<void> {
    this.files.set(
      path.resolve('/', filePath),
      typeof contents === 'string'
        ? new TextEncoder().encode(contents)
        : contents
    );
  }

  async exists(filePath: string): Promise<boolean> {
    const resolved = path.resolve('/', filePath);
    return this.files.has(resolved) || this.hasChild(resolved);
  }

  async stat(filePath: string) {
    const resolved = path.resolve('/', filePath);
    if (this.files.has(resolved)) {
      return { isFile: true, isDirectory: false, isSymbolicLink: false };
    }
    if (this.hasChild(resolved)) {
      return { isFile: false, isDirectory: true, isSymbolicLink: false };
    }
    throw new Error(`${filePath}: No such file`);
  }

  async readdir(dirPath: string): Promise<string[]> {
    const dir = path.resolve('/', dirPath);
    const names = new Set<string>();
    for (const filePath of this.files.keys()) {
      const rel = path.relative(dir, filePath);
      if (rel && !rel.startsWith('..')) {
        names.add(rel.split('/')[0]);
      }
    }
    return [...names];
  }

  async mkdir(): Promise<void> {}

  async rm(filePath: string): Promise<void> {
    this.files.delete(path.resolve('/', filePath));
  }

  resolvePath(base: string, target: string): string {
    return path.resolve(base, target);
  }

  private hasChild(dir: string): boolean {
    return [...this.files.keys()].some((filePath) =>
      filePath.startsWith(`${dir === '/' ? '' : dir}/`)
    );
  }
}
