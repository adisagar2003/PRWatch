// A small btop-style kit: titled boxes with superscript hotkeys, braille graphs and gradient meters.
import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';

// ── theme ────────────────────────────────────────────────────────────────────
export const theme = {
  title: '#eeeeee',
  bg: '#111111',
  hotkey: '#ee4b4b',
  dim: '#6b7280',
  text: '#d4d4d4',
  selBg: '#2563eb',
  selFg: '#ffffff',
  box: {
    activity: '#7c3aed',
    system: '#4d7c5a',
    repos: '#6b6b3f',
    reviews: '#5c588d',
    log: '#4b5563',
  },
  /** Low → high, for graphs and meters (btop's green → yellow → red). */
  heat: ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#ef4444'],
  cool: ['#1e3a8a', '#2563eb', '#38bdf8', '#a5f3fc'],
  magenta: ['#4c1d95', '#a21caf', '#e879f9', '#f5d0fe'],
  ok: '#4ade80',
  bad: '#ef4444',
  warn: '#facc15',
} as const;

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const superscript = (n: number | string) =>
  String(n).split('').map((d) => SUPER[Number(d)] ?? d).join('');

// ── colour helpers ───────────────────────────────────────────────────────────
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Colour at t∈[0,1] along a list of hex stops. */
export function gradientAt(stops: readonly string[], t: number): string {
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  const f = x - i;
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
}

// ── terminal size ────────────────────────────────────────────────────────────
export function useTerminalSize(): { cols: number; rows: number } {
  const { stdout } = useStdout();
  const read = () => ({ cols: stdout?.columns ?? 100, rows: stdout?.rows ?? 30 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (!stdout?.on) return;
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return size;
}

/** Re-renders every `ms`; returns the current time. */
export function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
export function Spinner({ color }: { color?: string }) {
  const now = useNow(120);
  return <Text color={color}>{SPIN[Math.floor(now.getTime() / 120) % SPIN.length]}</Text>;
}

// ── segments: coloured text with a known width ───────────────────────────────
export interface Seg {
  text: string;
  color?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
}
export const segWidth = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.text].length, 0);

export function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <Text key={i} color={s.color} backgroundColor={s.bg} bold={s.bold} dimColor={s.dim}>
          {s.text}
        </Text>
      ))}
    </>
  );
}

/** Clip/pad a segment list to exactly `width` cells. */
export function fitSegs(segs: Seg[], width: number): Seg[] {
  const out: Seg[] = [];
  let left = width;
  for (const s of segs) {
    if (left <= 0) break;
    const chars = [...s.text];
    if (chars.length <= left) {
      out.push(s);
      left -= chars.length;
    } else {
      out.push({ ...s, text: chars.slice(0, Math.max(0, left - 1)).join('') + '…' });
      left = 0;
    }
  }
  if (left > 0) out.push({ text: ' '.repeat(left) });
  return out;
}

/** Pad or clip plain text to `width` (adds … when clipped). */
export function cell(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const chars = [...s];
  if (chars.length > width) return width <= 1 ? chars.slice(0, width).join('') : chars.slice(0, width - 1).join('') + '…';
  return align === 'left' ? s.padEnd(width) : s.padStart(width);
}

// ── the box ──────────────────────────────────────────────────────────────────
/**
 * btop box: `╭─¹title───────── right ─╮`, side rails, and an optional hint row in
 * the bottom border. Every edge is drawn by hand so the box is exactly
 * `width` × `height` cells; content is clipped to the inside.
 */
export function BBox({
  title,
  hotkey,
  width,
  height,
  color,
  right = [],
  footer = [],
  children,
}: {
  title: string;
  hotkey?: number | string;
  width: number;
  height: number;
  color: string;
  right?: Seg[];
  footer?: Seg[];
  children?: React.ReactNode;
}) {
  const inner = Math.max(0, width - 2);
  const label: Seg[] = [
    { text: '─', color },
    ...(hotkey !== undefined ? [{ text: superscript(hotkey), color: theme.hotkey, bold: true }] : []),
    { text: title, color: theme.title, bold: true },
  ];
  const rightSegs = right.length > 0 ? [{ text: '─', color }, ...right, { text: '─', color }] : [];
  let fill = inner - segWidth(label) - segWidth(rightSegs);
  const top = fill >= 1 ? [...label, { text: '─'.repeat(fill), color }, ...rightSegs] : fitSegs(label, inner);
  const footSegs = footer.length > 0 ? [{ text: '─', color }, ...footer] : [];
  fill = inner - segWidth(footSegs);
  const bottom = fill >= 0 ? [...footSegs, { text: '─'.repeat(fill), color }] : [{ text: '─'.repeat(inner), color }];
  const bodyHeight = Math.max(0, height - 2);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text wrap="truncate">
        <Text color={color}>╭</Text>
        <Segs segs={top} />
        <Text color={color}>╮</Text>
      </Text>
      <Box flexDirection="row" height={bodyHeight}>
        <Box flexDirection="column" width={1}>
          {Array.from({ length: bodyHeight }, (_, i) => (
            <Text key={i} color={color}>
              │
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" width={inner} height={bodyHeight} overflow="hidden">
          {children}
        </Box>
        <Box flexDirection="column" width={1}>
          {Array.from({ length: bodyHeight }, (_, i) => (
            <Text key={i} color={color}>
              │
            </Text>
          ))}
        </Box>
      </Box>
      <Text wrap="truncate">
        <Text color={color}>╰</Text>
        <Segs segs={bottom} />
        <Text color={color}>╯</Text>
      </Text>
    </Box>
  );
}

/** A `key label` pair for a box's bottom border. */
export const hint = (key: string, label: string, color: string): Seg[] => [
  { text: '┤', color },
  { text: key, color: theme.hotkey, bold: true },
  { text: ' ' + label, color: theme.title },
  { text: '├', color },
];

// ── braille graph ────────────────────────────────────────────────────────────
// Dot bits per braille cell, bottom row first: [left, right].
const DOTS: [number, number][] = [
  [0x40, 0x80],
  [0x04, 0x20],
  [0x02, 0x10],
  [0x01, 0x08],
];

/**
 * Filled area graph in braille: each cell holds 2 samples × 4 levels, so a
 * `width`×`height` graph shows 2·width samples at 4·height vertical steps.
 * `values` are aligned to the right edge (newest last). `down` grows from the
 * top, for btop's mirrored up/down graphs.
 */
export function brailleGraph(
  values: number[],
  width: number,
  height: number,
  opts: { max?: number; down?: boolean } = {},
): string[] {
  const samples = width * 2;
  const vals = values.slice(-samples);
  const padded = [...new Array<number>(Math.max(0, samples - vals.length)).fill(0), ...vals];
  const max = opts.max ?? Math.max(1, ...padded);
  const levels = height * 4;
  // Any non-zero value shows at least one dot, so a single event is visible.
  const lv = padded.map((v) => (v <= 0 ? 0 : Math.max(1, Math.round((Math.min(v, max) / max) * levels))));
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    // Distance of this row from the graph's baseline, in cells.
    const fromBase = opts.down ? r : height - 1 - r;
    let line = '';
    for (let c = 0; c < width; c++) {
      let bits = 0;
      for (let side = 0; side < 2; side++) {
        const filled = Math.min(4, Math.max(0, lv[c * 2 + side] - fromBase * 4));
        for (let d = 0; d < filled; d++) {
          const dot = opts.down ? DOTS[3 - d] : DOTS[d];
          bits |= dot[side as 0 | 1];
        }
      }
      line += bits === 0 ? ' ' : String.fromCharCode(0x2800 + bits);
    }
    rows.push(line);
  }
  return rows;
}

/** A braille graph coloured by height: each row takes its colour from the gradient. */
export function Graph({
  values,
  width,
  height,
  stops,
  down = false,
  max,
}: {
  values: number[];
  width: number;
  height: number;
  stops: readonly string[];
  down?: boolean;
  max?: number;
}) {
  const rows = brailleGraph(values, width, height, { down, max });
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => {
        const fromBase = down ? i : height - 1 - i;
        return (
          <Text key={i} color={gradientAt(stops, height <= 1 ? 0.5 : fromBase / (height - 1))}>
            {row}
          </Text>
        );
      })}
    </Box>
  );
}

// ── meter ────────────────────────────────────────────────────────────────────
/** btop meter: filled cells take the gradient colour of their position; the rest are dim ■. */
export function meterSegs(value: number, max: number, width: number, stops: readonly string[]): Seg[] {
  const filled = max <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, value / max)) * width);
  const segs: Seg[] = [];
  for (let i = 0; i < width; i++) {
    segs.push(
      i < filled
        ? { text: '■', color: gradientAt(stops, width <= 1 ? 1 : i / (width - 1)) }
        : { text: '■', color: '#2a2a2a' },
    );
  }
  return segs;
}

/** Status glyph that still reads without colour. */
export const dot = (ok: boolean | null): Seg =>
  ok === null ? { text: '◌', color: theme.warn } : { text: '●', color: ok ? theme.ok : theme.bad };
