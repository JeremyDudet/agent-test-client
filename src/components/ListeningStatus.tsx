import React from 'react';
import { Text } from '@mantine/core';

interface ListeningStatusProps {
  isListening: boolean;
}

export function ListeningStatus({ isListening }: ListeningStatusProps) {
  return (
    <Text color={isListening ? 'red' : 'gray'}>
      {isListening ? 'Listening...' : 'Not Listening'}
    </Text>
  );
}
