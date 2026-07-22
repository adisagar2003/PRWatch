// Lightweight subsequence fuzzy match: every character of `query` must appear
// in `text` in order (case-insensitive), not necessarily adjacent. An empty
// query matches everything.
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Keep only items matching `query`, preserving the original order. */
export function fuzzyFilter(query: string, items: string[]): string[] {
  const q = query.trim();
  if (q === '') return items;
  return items.filter((item) => fuzzyMatch(q, item));
}
