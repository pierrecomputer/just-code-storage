import {
  RefUpdateError,
  type CommitBuilder,
  type CommitFileSource,
  type CommitResult,
  type Repo,
} from '@pierre/storage';
import { describe, expect, test } from 'bun:test';
import type { CommandContext, IFileSystem } from 'just-bash';
import path from 'node:path/posix';

import { createGitCommand } from '../src/index.js';

describe('createGitCommand phase 0', () => {
  test('creates a repo, stages a VFS file, commits it, and logs it', async () => {
    const builder = new MockCommitBuilder();
    const repo = makeRepo(builder);
    const store = {
      createRepo: async (options: { id?: string; defaultBranch?: string }) => {
        expect(options).toEqual({ id: 'smoke', defaultBranch: 'main' });
        return repo;
      },
    };
    const command = createGitCommand({
      store: store as never,
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

    expect(builder.files).toEqual([
      {
        path: 'README.md',
        bytes: [...new TextEncoder().encode('# Hello code.storage\n')],
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

  test('routes every supported operational subcommand', async () => {
    const command = createGitCommand({
      store: {
        createRepo: async () => makeRepo(new MockCommitBuilder()),
        findOne: async () => null,
      } as never,
      repo: makeRepo(new MockCommitBuilder()),
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

  test('requires commit messages', async () => {
    const repo = makeRepo(new MockCommitBuilder());
    const command = createGitCommand({
      store: {} as never,
      repo,
    });
    await expect(command.execute(['commit'], makeCtx())).resolves.toEqual({
      stdout: '',
      stderr: "error: switch `m' requires a value\n",
      exitCode: 129,
    });
  });

  test('maps SDK ref update conflicts to git-style push errors', async () => {
    const builder = new MockCommitBuilder(
      new RefUpdateError('precondition failed', {
        status: 'precondition_failed',
      })
    );
    const command = createGitCommand({
      store: {} as never,
      repo: makeRepo(builder),
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
});

class MockCommitBuilder implements CommitBuilder {
  readonly files: Array<{ path: string; bytes: number[] }> = [];

  constructor(private readonly sendError?: unknown) {}

  addFile(pathName: string, source: CommitFileSource): CommitBuilder {
    this.files.push({ path: pathName, bytes: bytesFromSource(source) });
    return this;
  }

  addFileFromString(pathName: string, contents: string): CommitBuilder {
    this.files.push({
      path: pathName,
      bytes: [...new TextEncoder().encode(contents)],
    });
    return this;
  }

  deletePath(): CommitBuilder {
    return this;
  }

  async send(): Promise<CommitResult> {
    if (this.sendError) {
      throw this.sendError;
    }

    return {
      commitSha: 'abc1234567890',
      treeSha: 'tree',
      targetBranch: 'main',
      packBytes: 32,
      blobCount: this.files.length,
      refUpdate: {
        branch: 'main',
        oldSha: '0000000000000000000000000000000000000000',
        newSha: 'abc1234567890',
      },
    };
  }
}

function bytesFromSource(source: CommitFileSource): number[] {
  if (source instanceof Uint8Array) {
    return [...source];
  }
  if (typeof source === 'string') {
    return [...new TextEncoder().encode(source)];
  }
  throw new Error('mock only supports string and Uint8Array sources');
}

function makeRepo(builder: CommitBuilder): Repo {
  return {
    id: 'smoke',
    defaultBranch: 'main',
    createdAt: '2026-01-01T00:00:00.000Z',
    createCommit: () => builder,
    listCommits: async () => ({
      commits: [
        {
          sha: 'abc1234567890',
          message: 'Initial commit',
          authorName: 'agent',
          authorEmail: 'agent@example.com',
          committerName: 'agent',
          committerEmail: 'agent@example.com',
          date: new Date('2026-01-01T00:00:00.000Z'),
          rawDate: '2026-01-01T00:00:00.000Z',
        },
      ],
      hasMore: false,
    }),
  } as unknown as Repo;
}

function makeCtx(files: Record<string, string> = {}): CommandContext {
  const fs = new FakeFs(files);
  return {
    fs: fs as unknown as IFileSystem,
    cwd: '/',
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
