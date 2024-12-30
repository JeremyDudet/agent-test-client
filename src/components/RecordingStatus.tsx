import React from 'react';
import { Text } from '@mantine/core';

interface RecordingStatusProps {
  isRecording: boolean;
}

export function RecordingStatus({ isRecording }: RecordingStatusProps) {
  return (
    <Text color={isRecording ? 'red' : 'gray'}>
      {isRecording ? 'Recording...' : 'Not Recording'}
    </Text>
  );
}
