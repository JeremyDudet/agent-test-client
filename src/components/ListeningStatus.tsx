import React from 'react';
import { Text, Group, Badge } from '@mantine/core';

interface ListeningStatusProps {
  isListening: boolean;
  isRecording: boolean;
}

export function ListeningStatus({ isListening, isRecording }: ListeningStatusProps) {
  return (
    <Group>
      <Badge color={isListening ? 'blue' : 'gray'}>
        {isListening ? 'Listening' : 'Not Listening'}
      </Badge>
      {isListening && (
        <Badge color={isRecording ? 'red' : 'blue'} variant={isRecording ? 'filled' : 'light'}>
          {isRecording ? 'Recording' : 'Waiting for voice'}
        </Badge>
      )}
    </Group>
  );
}
