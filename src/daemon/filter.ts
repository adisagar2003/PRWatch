import type { PR } from '../forge/types.js';
import type { RepoState } from '../state.js';

export function prsNeedingReview(prs: PR[], rs: RepoState): PR[] {
  const started = Date.parse(rs.watchStartedAt);
  return prs.filter(
    (pr) =>
      Date.parse(pr.createdAt) > started &&
      !rs.reviewed.includes(pr.number) &&
      !rs.failed.includes(pr.number),
  );
}
