import React from 'react';
import { Box, Text } from 'ink';

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

// vertical gradient: cool top → warm bottom
const COLORS = ['cyanBright', 'cyan', 'blueBright', 'blueBright', 'magentaBright', 'magenta'];

const gradientColor = (i: number, total: number): string =>
  COLORS[Math.floor((i / total) * COLORS.length)];

export function Banner() {
  return (
    <Box flexDirection="column">
      {ART_LINES.map((line, i) => (
        <Text key={`art-${i}`} color={gradientColor(i, ART_LINES.length)}>
          {line}
        </Text>
      ))}
      {TITLE_LINES.map((line, i) => (
        <Text key={`title-${i}`} color={gradientColor(i, TITLE_LINES.length)}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
