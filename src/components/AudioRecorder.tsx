import React, { useState, useRef, useEffect } from 'react';
import RecordRTC from 'recordrtc';
import VAD from 'voice-activity-detection';
import { socket } from '../services/socket';
import { Button, Stack, Alert } from '@mantine/core';
import { ProposalsList } from './ProposalsList';
import { RecordingStatus } from './RecordingStatus';
import { Proposal } from '../types';

interface VADInstance {
  connect: () => void;
  disconnect: () => void;
  destroy: () => void;
}

export function AudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const audioChunksRef = useRef<ArrayBuffer[]>([]);
  const recorderRef = useRef<RecordRTC | null>(null);
  const vadRef = useRef<VADInstance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastVoiceStateRef = useRef(false);

  const initializeVAD = async (stream: MediaStream) => {
    try {
      audioContextRef.current = new AudioContext();

      let voiceStartTime: number | null = null;
      const MIN_VOICE_DURATION = 100;

      vadRef.current = VAD(audioContextRef.current, stream, {
        onVoiceStart: () => {
          voiceStartTime = Date.now();
          console.log('[CLIENT] Potential voice detected');
          lastVoiceStateRef.current = true;
        },
        onVoiceStop: () => {
          if (voiceStartTime && Date.now() - voiceStartTime >= MIN_VOICE_DURATION) {
            console.log('[CLIENT] Valid voice segment ended');
            setTimeout(() => {
              lastVoiceStateRef.current = false;
            }, 750);
          } else {
            console.log('[CLIENT] Ignored short voice segment');
          }
          voiceStartTime = null;
        },
        noiseCaptureDuration: 1500,
        minNoiseLevel: 0.15,
        maxNoiseLevel: 0.75,
        onUpdate: () => {
          if (voiceStartTime && Date.now() - voiceStartTime >= MIN_VOICE_DURATION) {
            lastVoiceStateRef.current = true;
          }
        },
      }) as VADInstance;

      vadRef.current.connect();
    } catch (err) {
      console.error('[CLIENT] VAD initialization error:', err);
      throw err;
    }
  };

  const startRecording = async () => {
    console.log('[CLIENT] startRecording invoked');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      await initializeVAD(stream);

      recorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav',
        recorderType: RecordRTC.StereoAudioRecorder,
        timeSlice: 1000,
        numberOfAudioChannels: 1,
        desiredSampRate: 48000,
        disableLogs: false,
        ondataavailable: async (blob) => {
          try {
            const arrayBuffer = await blob.arrayBuffer();

            if (lastVoiceStateRef.current) {
              console.log('[CLIENT] Voice detected in chunk, size:', arrayBuffer.byteLength);
              audioChunksRef.current.push(arrayBuffer);
              socket.emit('audioDataPartial', arrayBuffer);
            } else {
              console.log('[CLIENT] Silence detected, skipping chunk');
            }
          } catch (err) {
            console.error('[CLIENT] Error processing chunk:', err);
            setError(err instanceof Error ? err.message : String(err));
          }
        },
      });

      if (!socket.connected) {
        throw new Error('Socket not connected');
      }
      console.log('[CLIENT] Socket connected:', socket.connected);

      recorderRef.current.startRecording();
      setIsRecording(true);
      setProposals([]);
      setError(null);
      console.log('[CLIENT] recording started');
    } catch (err) {
      console.error('[CLIENT] Recording error:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stopRecording = () => {
    console.log('[CLIENT] stopRecording invoked');
    if (recorderRef.current) {
      recorderRef.current.stopRecording(async () => {
        try {
          if (audioChunksRef.current.length > 0) {
            const totalLength = audioChunksRef.current.reduce(
              (acc, chunk) => acc + chunk.byteLength,
              0
            );
            const concatenatedBuffer = new Uint8Array(totalLength);
            let offset = 0;

            audioChunksRef.current.forEach((chunk) => {
              concatenatedBuffer.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
            });

            socket.emit('audioData', concatenatedBuffer.buffer);
          }
          socket.emit('audioComplete');

          audioChunksRef.current = [];
        } catch (err) {
          console.error('[CLIENT] Error sending final audio:', err);
          setError(err instanceof Error ? err.message : String(err));
        }

        setIsRecording(false);
        cleanupAudioResources();
      });
    }
  };

  const cleanupAudioResources = () => {
    try {
      audioChunksRef.current = [];
      if (vadRef.current) {
        vadRef.current.destroy();
        vadRef.current = null;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      if (recorderRef.current) {
        const recorder = recorderRef.current.getInternalRecorder();
        if (recorder && 'stream' in recorder) {
          const mediaRecorder = recorder as { stream: MediaStream };
          mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        }
      }
    } catch (err) {
      console.error('[CLIENT] Error cleaning up audio resources:', err);
    }
  };

  useEffect(() => {
    console.log('[CLIENT] Setting up socket listeners');

    const handleProposals = (data: { proposals }) => {
      console.log('[CLIENT] Received proposals:', data);

      if (!data.proposals) return;

      setProposals((prevProposals) => {
        try {
          let parsedData = data.proposals;

          if (typeof data.proposals === 'string') {
            if (data.proposals.trim() === 'No proposals.') {
              return prevProposals;
            }
            const jsonString = data.proposals.split('\n')[0];
            parsedData = JSON.parse(jsonString);
          }

          if (!parsedData || parsedData === 'No proposals') {
            return prevProposals;
          }

          const proposalsArray = Object.values(parsedData).filter(
            (p): p is Proposal =>
              Boolean(p) &&
              typeof p === 'object' &&
              p !== null &&
              'description' in p &&
              'amount' in p &&
              'suggestedCategory' in p
          );

          const newProposals = proposalsArray.filter(
            (p) =>
              !prevProposals.some(
                (existing) => existing.description === p.description && existing.amount === p.amount
              )
          );

          console.log('[CLIENT] Adding new proposals:', newProposals);
          return [...prevProposals, ...newProposals];
        } catch (err) {
          console.error('[CLIENT] Error parsing proposals:', err);
          return prevProposals;
        }
      });
    };

    const handleError = (error: { message: string }) => {
      console.error('[CLIENT] Socket error:', error);
      setError(error.message);
    };

    socket.on('proposals', handleProposals);
    socket.on('error', handleError);

    return () => {
      socket.off('proposals', handleProposals);
      socket.off('error', handleError);

      if (recorderRef.current && isRecording) {
        recorderRef.current.stopRecording();
        try {
          const recorder = recorderRef.current.getInternalRecorder();
          if (recorder && 'stream' in recorder) {
            const mediaRecorder = recorder as { stream: MediaStream };
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
          }
        } catch (err) {
          console.error('[CLIENT] Error cleaning up recorder:', err);
        }
      }
    };
  }, []);

  const handleApprove = (proposal: Proposal) => {
    console.log('[CLIENT] Approved proposal:', proposal);
  };

  const handleReject = (proposal: Proposal) => {
    console.log('[CLIENT] Rejected proposal:', proposal);
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
        <Alert color="red" title="Error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {proposals.length > 0 && (
        <ProposalsList proposals={proposals} onApprove={handleApprove} onReject={handleReject} />
      )}
    </Stack>
  );
}
