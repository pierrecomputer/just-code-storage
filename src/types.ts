import type { CommitSignature, GitStorage, Repo } from '@pierre/storage';

export interface GitCommandOptions {
  store: GitStorage;
  repo?: Repo;
  branch?: string;
  author?: CommitSignature;
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
