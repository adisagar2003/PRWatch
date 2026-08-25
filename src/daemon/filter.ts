import type { PR } from '../forge/types.js';
import { conflictAttemptsLeft, type RepoState } from '../state.js';

export function prsNeedingReview(prs: PR[], rs: RepoState): PR[] {
  const started = Date.parse(rs.watchStartedAt);
  return prs.filter(
    (pr) =>
      Date.parse(pr.createdAt) > started &&
      !rs.reviewed.includes(pr.number) &&
      !rs.failed.includes(pr.number),
  );
}

/** Any watched PR we haven't given up on — conflicts can appear long after the review. */
export function prsNeedingConflictCheck(prs: PR[], rs: RepoState): PR[] {
  const started = Date.parse(rs.watchStartedAt);
  return prs.filter(
    (pr) => Date.parse(pr.createdAt) > started && conflictAttemptsLeft(rs, pr.number, pr.headSha),
  );
}
