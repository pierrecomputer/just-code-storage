import type { GitIdentity, Pierre } from '@pierre/sdk';

export interface Repo {
  readonly pierre: Pierre;
  readonly id: string;
  readonly defaultBranch: string;
}

export interface GitCommandOptions {
  pierre: Pierre;
  repo?: Repo;
  branch?: string;
  author?: GitIdentity;
}

export interface StageEntry {
  operation: 'upsert' | 'delete';
  repoPath: string;
  fsPath?: string;
}

export interface GitState {
  repo: Repo | null;
  branch: string;
  stage: Map<string, StageEntry>;
  cloneDir?: string;
  headSha?: string;
}
