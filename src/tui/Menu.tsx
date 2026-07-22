import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export function Menu({
  items,
  onSelect,
}: {
  items: string[];
  onSelect: (item: string, index: number) => void;
}) {
  const [cursor, setCursor] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1));
    if (key.return) onSelect(items[cursor], cursor);
  });
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={item} color={i === cursor ? 'cyan' : undefined}>
          {i === cursor ? '❯ ' : '  '}
          {item}
        </Text>
      ))}
    </Box>
  );
}
