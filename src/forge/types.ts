export interface PR {
  number: number;
  title: string;
  body: string;
  createdAt: string; // ISO timestamp
  headRef: string;
  author: string;
}

/** A comment pinned to new-side lines startLine..line (or just line) of a file in the PR diff. */
export interface LineComment {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

export interface ForgeAdapter {
  name: string;
  listOpenPRs(repo: string): Promise<PR[]>;
  /** Whether the PR is still open (not closed or merged). */
  isOpen(repo: string, pr: number): Promise<boolean>;
  /** Shallow-clone the repo into dir and check out the PR branch. */
  clone(repo: string, pr: number, dir: string): Promise<void>;
  hasMarkerComment(repo: string, pr: number): Promise<boolean>;
  postComment(repo: string, pr: number, body: string): Promise<void>;
  /** The PR's unified diff, exactly as the forge reviews it. */
  getDiff(repo: string, pr: number): Promise<string>;
  /** Post line comments as one review. The forge rejects all of them if any line is outside the diff. */
  postLineComments(repo: string, pr: number, comments: LineComment[]): Promise<void>;
}
