import React from 'react';
import { Box, Text } from 'ink';

// Semantic color tokens — color encodes meaning, not decoration. Every signal
// is paired with a symbol so it still reads under NO_COLOR / monochrome.
export const ui = {
  accent: 'magenta',
  info: 'cyan',
  success: 'green',
  error: 'red',
  warn: 'yellow',
  border: 'gray',
} as const;

// A grouped content box. Borders are used sparingly (one per screen) to keep
// the chrome-vs-data ratio low.
export function Panel({
  title,
  borderColor = ui.border,
  children,
}: {
  title?: string;
  borderColor?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      alignSelf="flex-start"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      {title !== undefined && (
        <Text bold color={ui.info}>
          {title}
        </Text>
      )}
      {children}
    </Box>
  );
}

// Persistent key-hint bar. Keys are highlighted, labels dimmed.
export function Footer({ hints }: { hints: Array<[string, string]> }) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {hints.map(([key, label], i) => (
          <Text key={key}>
            {i > 0 ? '    ' : ''}
            <Text color={ui.info} bold>
              {key}
            </Text>{' '}
            {label}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

// Status indicator: ● green (ok) / ● red (bad) / ◌ yellow (pending). The glyph
// carries the state on its own, so it survives loss of color.
export function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Text color={ui.warn}>◌</Text>;
  return <Text color={ok ? ui.success : ui.error}>●</Text>;
}
