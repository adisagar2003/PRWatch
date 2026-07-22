import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyFilter } from './fuzzy.js';

describe('fuzzyMatch', () => {
  it('matches an in-order subsequence, case-insensitively', () => {
    expect(fuzzyMatch('prw', 'adisagar2003/PRWatch')).toBe(true);
    expect(fuzzyMatch('agpw', 'adisagar2003/PRWatch')).toBe(true); // gaps allowed
  });

  it('rejects when characters are out of order or missing', () => {
    expect(fuzzyMatch('wrp', 'adisagar2003/PRWatch')).toBe(false); // wrong order
    expect(fuzzyMatch('xyz', 'adisagar2003/PRWatch')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});

describe('fuzzyFilter', () => {
  const repos = ['adisagar2003/PRWatch', 'adisagar2003/groundwork', 'adisagar2003/TheGrid'];

  it('keeps matches in original order', () => {
    // "gw": g(adisaGar)+w(prWatch) and g(Ground)+w(groundWork) match; TheGrid has no w.
    expect(fuzzyFilter('gw', repos)).toEqual([
      'adisagar2003/PRWatch',
      'adisagar2003/groundwork',
    ]);
  });

  it('returns all items when the query is blank', () => {
    expect(fuzzyFilter('   ', repos)).toEqual(repos);
  });

  it('returns nothing when no item matches', () => {
    expect(fuzzyFilter('zzz', repos)).toEqual([]);
  });
});
