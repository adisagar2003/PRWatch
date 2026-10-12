import type { PR } from '../forge/types.js';
import { conflictAttemptsLeft, type RepoState } from '../state.js';

/** New PRs, plus (with reReview) reviewed PRs whose head moved past the reviewed SHA. */
export function prsNeedingReview(prs: PR[], rs: RepoState, reReview = true): PR[] {
  const started = Date.parse(rs.watchStartedAt);
  return prs.filter((pr) => {
    if (Date.parse(pr.createdAt) <= started || rs.failed.includes(pr.number)) return false;
    if (!rs.reviewed.includes(pr.number)) return true;
    const reviewedHead = rs.reviewedHeads?.[String(pr.number)];
    return reReview && reviewedHead !== undefined && reviewedHead !== pr.headSha;
  });
}

/** Any watched PR we haven't given up on — conflicts can appear long after the review. */
export function prsNeedingConflictCheck(prs: PR[], rs: RepoState): PR[] {
  const started = Date.parse(rs.watchStartedAt);
  return prs.filter(
    (pr) => Date.parse(pr.createdAt) > started && conflictAttemptsLeft(rs, pr.number, pr.headSha),
  );
}
