import React from 'react';
import { Group, Badge } from '@mantine/core';

interface ListeningStatusProps {
  isListening: boolean;
  isRecording: boolean;
  isInitializing?: boolean;
}

export function ListeningStatus({
  isListening,
  isRecording,
  isInitializing,
}: ListeningStatusProps) {
  return (
    <Group>
      <Badge color={isListening ? 'blue' : 'gray'}>
        {isListening ? 'Listening' : 'Not Listening'}
      </Badge>
      {isInitializing && <Badge color="yellow">Initializing...</Badge>}
      {isListening && !isInitializing && (
        <Badge color={isRecording ? 'red' : 'blue'} variant={isRecording ? 'filled' : 'light'}>
          {isRecording ? 'Recording' : 'Ready for voice'}
        </Badge>
      )}
    </Group>
  );
}
