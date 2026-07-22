export interface PR {
  number: number;
  title: string;
  body: string;
  createdAt: string; // ISO timestamp
  headRef: string;
  author: string;
}

export interface ForgeAdapter {
  name: string;
  listOpenPRs(repo: string): Promise<PR[]>;
  /** Shallow-clone the repo into dir and check out the PR branch. */
  clone(repo: string, pr: number, dir: string): Promise<void>;
  hasMarkerComment(repo: string, pr: number): Promise<boolean>;
  postComment(repo: string, pr: number, body: string): Promise<void>;
}
