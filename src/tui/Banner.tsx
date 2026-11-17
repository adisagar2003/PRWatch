import React from 'react';
import { Box, Text } from 'ink';
import { gradientAt } from './btop.js';

const ART_LINES = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⢀⢀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⡴⠰⠞⠿⠛⠁⠓⠖⠲⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⢸⠆⢁⠶⠿⠇⠹⠁⠸⠷⠏⣈⡀⢰⠀⠈⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⡁⠴⠛⢀⡀⠀⠀⢀⠀⠀⠀⠀⡀⠀⠀⠂⠄⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠠⠀⢠⣴⣿⠀⠄⠈⠉⠀⠀⢀⠀⢻⡗⠀⠀⠐⠡⣄⡀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⣤⠒⢺⣿⣿⣆⠙⠄⢤⠠⠔⠘⢢⣞⠋⠀⢀⣰⣧⣬⡇⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠈⠪⡅⠲⢿⢽⣿⣿⣶⣶⣦⣶⣿⠇⠴⠋⠍⢉⣹⣿⠿⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠰⠆⠁⠀⢈⠉⠹⣹⠈⠁⠀⠆⢰⢆⢀⣾⣾⠉⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠃⠷⠀⠄⣤⡀⠀⣠⠠⣤⠄⠼⠟⠉⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠁⠈⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
];

const TITLE_LINES = [
  '@@@@@@@  @@@@@@@       @@@  @@@  @@@  @@@@@@  @@@@@@@  @@@@@@@ @@@  @@@',
  '@@@@@@@@ @@@@@@@@      @@@  @@@  @@@ @@@@@@@@ @@@@@@@ @@@@@@@@ @@@  @@@',
  '@@!  @@@ @@!  @@@      @@!  @@!  @@! @@!  @@@   @@!   !@@      @@!  @@@',
  '!@!  @!@ !@!  @!@      !@!  !@!  !@! !@!  @!@   !@!   !@!      !@!  @!@',
  '@!@@!@!  @!@!!@!       @!!  !!@  @!@ @!@!@!@!   @!!   !@!      @!@!@!@!',
  '!!@!!!   !!@!@!        !@!  !!!  !@! !!!@!!!!   !!!   !!!      !!!@!!!!',
  '!!:      !!: :!!       !!:  !!:  !!: !!:  !!!   !!:   :!!      !!:  !!!',
  ':!:      :!:  !:!      :!:  :!:  :!: :!:  !:!   :!:   :!:      :!:  !:!',
  ' ::      ::   :::       :::: :: :::  ::   :::    ::    ::: ::: ::   :::',
  ' :        :   : :        :: :  : :    :   : :    :     :: :: :  :   : :',
];

/** Eye: cyan iris fading to magenta, the PRWatch colours. */
const STOPS = ['#a5f3fc', '#22d3ee', '#3b82f6', '#a855f7', '#e879f9'];

/** Empty-state splash: the eye beside the wordmark, or stacked when narrow. */
export function Banner({ width = 100 }: { width?: number }) {
  const wide = width >= ART_LINES[0].length + TITLE_LINES[0].length + 4;
  return (
    <Box flexDirection={wide ? 'row' : 'column'} alignItems={wide ? 'center' : 'flex-start'}>
      <Box flexDirection="column">
        {ART_LINES.map((line, i) => (
          <Text key={i} color={gradientAt(STOPS, i / (ART_LINES.length - 1))}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginLeft={wide ? 2 : 0} marginTop={wide ? 0 : 1}>
        {width >= TITLE_LINES[0].length + 2 ? (
          TITLE_LINES.map((line, i) => (
            <Text key={i} color={gradientAt(STOPS, i / (TITLE_LINES.length - 1))}>
              {line}
            </Text>
          ))
        ) : (
          <Text color="#22d3ee" bold>
            PRWATCH
          </Text>
        )}
        <Text color="#9ca3af">code review for every new pull request · with the agent you already pay for</Text>
      </Box>
    </Box>
  );
}
