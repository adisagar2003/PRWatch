import { describe, it, expect } from 'vitest';
import { bar, sparkline } from './chrome.js';

describe('bar', () => {
  it('fills half the width at half the value', () => {
    expect(bar(5, 10, 10)).toBe('█████     ');
  });

  it('renders empty and full without partial blocks', () => {
    expect(bar(0, 10, 10)).toBe('          ');
    expect(bar(10, 10, 10)).toBe('██████████');
  });

  it('uses a partial block for a fraction of a cell', () => {
    expect(bar(1, 8, 4)).toBe('▌   ');
  });

  it('clamps out-of-range input instead of overflowing the width', () => {
    expect(bar(99, 10, 6)).toBe('██████');
    expect(bar(-5, 10, 6)).toBe('      ');
  });

  it('renders empty when max is zero rather than dividing by it', () => {
    expect(bar(3, 0, 5)).toBe('     ');
  });
});

describe('sparkline', () => {
  it('scales values across the eight block heights', () => {
    expect(sparkline([0, 4, 8])).toBe('▁▅█');
  });

  it('draws a flat baseline when every value is zero', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁');
  });

  it('returns nothing for no data', () => {
    expect(sparkline([])).toBe('');
  });
});
