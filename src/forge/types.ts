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

/** A comment pinned to new-side lines startLine..line (or just line) of a file in the PR diff. */
export interface LineComment {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

/** A top-level comment on a PR (not a line comment). */
export interface PRComment {
  id: number;
  pr: number;
  body: string;
  author: string;
  /** GitHub's author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ... */
  association: string;
}

export interface ForgeAdapter {
  name: string;
  listOpenPRs(repo: string): Promise<PR[]>;
  /** Whether the PR is still open (not closed or merged). */
  isOpen(repo: string, pr: number): Promise<boolean>;
  /** Whether the PR has merge conflicts with its base branch. */
  isConflicting(repo: string, pr: number): Promise<boolean>;
  /** Shallow-clone the repo into dir, check out the PR branch, and return its head SHA. */
  clone(repo: string, pr: number, dir: string): Promise<string>;
  /** Whether any comment contains marker (default: any prwatch review). */
  hasMarkerComment(repo: string, pr: number, marker?: string): Promise<boolean>;
  /** Comments on any issue or PR in the repo created or edited since an ISO time, oldest first. */
  listCommentsSince(repo: string, since: string): Promise<PRComment[]>;
  postComment(repo: string, pr: number, body: string): Promise<void>;
  /** The unified diff of headSha against baseRef's merge base: the PR diff, frozen at that commit. */
  getDiff(repo: string, baseRef: string, headSha: string): Promise<string>;
  /** Post line comments as one review on headSha. The forge rejects all of them if any line is outside that diff. */
  postLineComments(repo: string, pr: number, comments: LineComment[], headSha: string): Promise<void>;
}
