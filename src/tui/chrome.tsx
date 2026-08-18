import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { ui } from './ui.js';

const BLOCKS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Horizontal meter, exactly `width` cells wide. Fractional cells use a partial block. */
export function bar(value: number, max: number, width: number): string {
  if (max <= 0 || width <= 0) return ' '.repeat(Math.max(0, width));
  const cells = Math.min(1, Math.max(0, value / max)) * width;
  const full = Math.floor(cells);
  const rest = cells - full;
  const partial =
    rest > 0 ? BLOCKS[Math.min(BLOCKS.length - 1, Math.ceil(rest * BLOCKS.length) - 1)] : '';
  return ('█'.repeat(full) + partial).padEnd(width);
}

/** History graph: one block per value, scaled against the series peak. */
export function sparkline(values: number[]): string {
  const max = Math.max(0, ...values);
  return values
    .map((v) =>
      max <= 0 ? SPARKS[0] : SPARKS[Math.round((Math.max(0, v) / max) * (SPARKS.length - 1))],
    )
    .join('');
}

/** Terminal columns, kept current across resizes. */
export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout?.on) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return cols;
}

/**
 * A btop box: the title sits inside the top border next to its hotkey digit.
 * Ink can't draw a titled border, so the top edge is drawn by hand and the
 * other three come from the Box — which is why `width` has to be explicit.
 */
export function Panel({
  title,
  hotkey,
  width,
  color = ui.info,
  children,
}: {
  title: string;
  hotkey?: string;
  width: number;
  color?: string;
  children: React.ReactNode;
}) {
  const labelWidth = title.length + (hotkey === undefined ? 0 : hotkey.length + 1);
  const fill = Math.max(0, width - labelWidth - 5);
  return (
    <Box flexDirection="column" width={width}>
      <Text color={ui.border}>
        {'╭─┤'}
        {hotkey !== undefined && (
          <Text color={ui.accent} bold>
            {hotkey}{' '}
          </Text>
        )}
        <Text color={color} bold>
          {title}
        </Text>
        {'├'}
        {'─'.repeat(fill)}
        {'╮'}
      </Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={ui.border}
        borderTop={false}
        paddingX={1}
        width={width}
        flexGrow={1}
      >
        {children}
      </Box>
    </Box>
  );
}
