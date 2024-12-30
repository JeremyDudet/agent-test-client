import React from 'react';
import { useState, useRef, useEffect } from 'react';
import RecordRTC, { RecordRTCPromisesHandler } from 'recordrtc';
import { socket } from '../services/socket';
import { Button, Stack, Text, Alert } from '@mantine/core';
import { Proposal } from '../types';
import { ProposalsList } from './ProposalsList';
import { RecordingStatus } from './RecordingStatus';

export function AudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const recorderRef = useRef<RecordRTC | null>(null);

// Start recording audio
const startRecording = async () => {
    console.log('AudioRecorder: startRecording invoked');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('AudioRecorder: obtained audio stream');
      recorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav',
        recorderType: RecordRTC.StereoAudioRecorder,
        numberOfAudioChannels: 1,
        desiredSampRate: 16000,
        bitrate: 128000,
        // Remove timeSlice and ondataavailable
      });
  
      recorderRef.current.startRecording();
      setIsRecording(true);
      setError(null);
      console.log('AudioRecorder: recording started');
    } catch (err: any) {
      setError('Failed to start recording: ' + err.message);
      console.error('AudioRecorder: error starting recording', err);
    }
  };
  
  // Stop recording audio
  const stopRecording = () => {
    console.log('AudioRecorder: stopRecording invoked');
    if (recorderRef.current) {
      recorderRef.current.stopRecording(async () => {
        const blob = recorderRef.current?.getBlob();
        console.log('AudioRecorder: final blob type:', blob?.type);
        console.log('AudioRecorder: final blob size:', blob?.size);
        
        if (blob) {
          const arrayBuffer = await blob.arrayBuffer();
          socket.emit('audioData', arrayBuffer);
          socket.emit('audioComplete');
        }
        
        setIsRecording(false);
      });
    }
  };

  // Socket listeners
  useEffect(() => {
    console.log('AudioRecorder: setting up socket listeners');
    socket.on('proposals', (data) => {
      console.log('AudioRecorder: received proposals from server', data);
      setProposals((prev) => [...prev, data.proposals]);
    });

    socket.on('error', (errorMessage) => {
      console.error('AudioRecorder: received error from server', errorMessage);
      setError(errorMessage.message);
    });

    return () => {
      console.log('AudioRecorder: unmounting, removing socket listeners');
      socket.off('proposals');
      socket.off('error');
    };
  }, []);

  // Example methods for approving/rejecting proposals
  const handleApprove = (proposal: Proposal) => {
    console.log('AudioRecorder: Approved proposal', proposal);
  };

  const handleReject = (proposal: Proposal) => {
    console.log('AudioRecorder: Rejected proposal', proposal);
  };

  return (
    <Stack gap="md" p="md">
      <RecordingStatus isRecording={isRecording} />

      <Button
        color={isRecording ? 'red' : 'blue'}
        onClick={isRecording ? stopRecording : startRecording}
      >
        {isRecording ? 'Stop Recording' : 'Start Recording'}
      </Button>

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      {proposals.length > 0 && (
        <ProposalsList
          proposals={proposals}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </Stack>
  );
}