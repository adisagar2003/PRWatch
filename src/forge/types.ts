export interface PR {
  number: number;
  title: string;
  body: string;
  createdAt: string; // ISO timestamp
  headRef: string;
  author: string;
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
  /** Shallow-clone the repo into dir and check out the PR branch. */
  clone(repo: string, pr: number, dir: string): Promise<void>;
  /** Comments on any issue or PR in the repo created or edited since an ISO time, oldest first. */
  listCommentsSince(repo: string, since: string): Promise<PRComment[]>;
  hasMarkerComment(repo: string, pr: number): Promise<boolean>;
  postComment(repo: string, pr: number, body: string): Promise<void>;
}
