export interface PR {
  number: number;
  title: string;
  body: string;
  createdAt: string; // ISO timestamp
  headRef: string;
  /** Head commit; a new one from the author earns a fresh set of conflict attempts. */
  headSha: string;
  /** Branch the PR merges into. */
  baseRef: string;
  /** PRs from forks can't be pushed to, so conflicts in them can't be fixed. */
  fromFork: boolean;
  author: string;
}

export interface ForgeAdapter {
  name: string;
  listOpenPRs(repo: string): Promise<PR[]>;
  /** Whether the PR is still open (not closed or merged). */
  isOpen(repo: string, pr: number): Promise<boolean>;
  /** Whether the PR has merge conflicts with its base branch. */
  isConflicting(repo: string, pr: number): Promise<boolean>;
  /** Shallow-clone the repo into dir and check out the PR branch. */
  clone(repo: string, pr: number, dir: string): Promise<void>;
  hasMarkerComment(repo: string, pr: number): Promise<boolean>;
  postComment(repo: string, pr: number, body: string): Promise<void>;
}
