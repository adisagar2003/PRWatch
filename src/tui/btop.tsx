// Small TUI kit: a titled box, coloured text segments, a spinner and terminal size.
import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';

export const theme = {
  title: '#eeeeee',
  bg: '#111111',
  dim: '#6b7280',
  text: '#d4d4d4',
  key: '#ee4b4b',
  border: '#4b5563',
  accent: '#22d3ee',
  selBg: '#2563eb',
  selFg: '#ffffff',
  ok: '#4ade80',
  bad: '#ef4444',
  warn: '#facc15',
} as const;

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Colour at t∈[0,1] along a list of hex stops. */
export function gradientAt(stops: readonly string[], t: number): string {
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  return toHex(a.map((v, k) => v + (b[k] - v) * (x - i)));
}

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

export interface Seg {
  text: string;
  color?: string;
  bg?: string;
  bold?: boolean;
}

export function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <Text key={i} color={s.color} backgroundColor={s.bg} bold={s.bold}>
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
  if (left > 0) out.push({ text: ' '.repeat(left), bg: segs.at(-1)?.bg });
  return out;
}

/** Pad or clip plain text to `width` (adds … when clipped). */
export function cell(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const chars = [...s];
  if (chars.length > width) return width <= 1 ? chars.slice(0, width).join('') : chars.slice(0, width - 1).join('') + '…';
  return align === 'left' ? s.padEnd(width) : s.padStart(width);
}

/** A rounded box `width` × `height` cells, with the title (and optional right text) in the top border. */
export function BBox({
  title, width, height, right = '', color = theme.border, children,
}: {
  title: string;
  width: number;
  height: number;
  right?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  const inner = Math.max(0, width - 2);
  const label = `─ ${title} `;
  const tail = right ? ` ${right} ─` : '';
  const fill = Math.max(0, inner - [...label].length - [...tail].length);
  const body = Math.max(0, height - 2);
  const rail = (
    <Box flexDirection="column" width={1}>
      {Array.from({ length: body }, (_, i) => (
        <Text key={i} color={color}>│</Text>
      ))}
    </Box>
  );
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text wrap="truncate">
        <Text color={color}>╭─ </Text>
        <Text color={theme.title} bold>{title}</Text>
        <Text color={color}> {'─'.repeat(fill)}</Text>
        {tail && <Text color={theme.dim}> {right} </Text>}
        <Text color={color}>{tail ? '─' : ''}╮</Text>
      </Text>
      <Box flexDirection="row" height={body}>
        {rail}
        <Box flexDirection="column" width={inner} height={body} overflow="hidden" paddingX={1}>
          {children}
        </Box>
        {rail}
      </Box>
      <Text color={color}>╰{'─'.repeat(inner)}╯</Text>
    </Box>
  );
}

/** Status glyph that still reads without colour. */
export const dot = (ok: boolean | null): Seg =>
  ok === null ? { text: '◌', color: theme.warn } : { text: '●', color: ok ? theme.ok : theme.bad };

/** Bottom key-hint line. */
export function Keys({ keys }: { keys: Array<[string, string]> }) {
  return (
    <Text wrap="truncate">
      {keys.map(([k, l], i) => (
        <Text key={k}>
          {i === 0 ? ' ' : '   '}
          <Text color={theme.key} bold>{k}</Text>
          <Text color={theme.dim}> {l}</Text>
        </Text>
      ))}
    </Text>
  );
}
