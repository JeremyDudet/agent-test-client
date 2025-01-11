// AudioRecorder.tsx
import React, { useState, useRef, useEffect } from 'react';
import RecordRTC from 'recordrtc';
import VAD from 'voice-activity-detection';
import { socket } from '../services/socket';
import { Button, Stack, Alert, Text } from '@mantine/core';
import { ProposalsList } from './ProposalsList';
import { ListeningStatus } from './ListeningStatus';
import { mergePreRecordingBufferWithRecordedAudio } from '../services/audioMerging';
import type {
  Proposal,
  SemanticContext,
  QueuedAudioChunk,
  TranscriptionResponse,
  AudioChunkMetadata,
  ExtendedVADOptions,
} from '../types';

interface VADInstance {
  destroy: () => void;
}

export function AudioRecorder() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptions, setTranscriptions] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);

  const semanticContextRef = useRef<SemanticContext>({
    timestamp: 0,
    isComplete: false,
    confidence: 0,
  });
  const recorderRef = useRef<RecordRTC | null>(null);
  const vadRef = useRef<VADInstance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<QueuedAudioChunk[]>([]);
  const sequenceCounterRef = useRef<number>(0);
  const pendingTranscriptionsRef = useRef<Map<number, AudioChunkMetadata>>(new Map());
  const nextExpectedSequenceRef = useRef<number>(0);
  const voiceStartTimeRef = useRef<number | null>(null);
  const isVoiceActiveRef = useRef<boolean>(false);

  const BUFFER_DURATION = 200; // 100 millisecond buffer
  const PRE_RECORDING_BUFFER: Float32Array[] = [];

  // Initialize Voice Activity Detection (VAD) with the given audio stream
  const initializeVAD = async (stream: MediaStream) => {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    // Add error handling for AudioContext state
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Set up audio processing pipeline
    // Create audio source from input stream
    const source = audioContext.createMediaStreamSource(stream);

    // Load custom audio processor worklet for handling raw audio data
    await audioContext.audioWorklet.addModule('/audio-processor.js');

    // Create processor node instance
    const processor = new AudioWorkletNode(audioContext, 'audio-processor');

    // Handle processed audio data from worklet
    // Maintains a circular buffer of recent audio data
    processor.port.onmessage = (e) => {
      if (!isVoiceActiveRef.current) {
        PRE_RECORDING_BUFFER.push(new Float32Array(e.data));
        // Remove oldest data if buffer exceeds size limit
        if (PRE_RECORDING_BUFFER.length > BUFFER_DURATION / (4096 / audioContext.sampleRate)) {
          PRE_RECORDING_BUFFER.shift();
        }
      }
    };

    // Connect audio source to processor
    source.connect(processor);

    const vadOptions: ExtendedVADOptions = {
      onVoiceStart: () => {
        if (!recorderRef.current) {
          console.error('[VAD] Recorder not initialized');
          return;
        }

        isVoiceActiveRef.current = true;
        setIsVoiceActive(true);
        console.log('[VAD] Voice started');
        voiceStartTimeRef.current = Date.now();

        try {
          // Ensure recorder is in ready state before starting
          if (recorderRef.current.state === 'inactive' || recorderRef.current.state === 'stopped') {
            recorderRef.current?.startRecording();
            console.log('[VAD] Recording started');
          } else {
            console.warn('[VAD] Recorder already active, state:', recorderRef.current.state);
          }
        } catch (err) {
          console.error('[VAD] Error starting recording:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      },

      onVoiceStop: async () => {
        isVoiceActiveRef.current = false;
        setIsVoiceActive(false);
        console.log('[VAD] Voice stopped');

        if (!recorderRef.current) {
          console.warn('[VAD] No recorder instance available');
          return;
        }

        // Add a small delay to capture trailing audio
        await new Promise((resolve) => setTimeout(resolve, 300));

        try {
          const voiceEndTime = Date.now();
          const duration = voiceStartTimeRef.current ? voiceEndTime - voiceStartTimeRef.current : 0;

          if (duration < 150) {
            console.log('[VAD] Chunk < 1/3 second. Discarding...');
            await new Promise<void>((resolve) => {
              recorderRef.current?.stopRecording(() => {
                recorderRef.current?.reset();
                resolve();
              });
            });
            return;
          }

          // Stop and get final blob
          const blob = await new Promise<Blob>((resolve, reject) => {
            if (!recorderRef.current) {
              reject(new Error('Recorder not initialized'));
              return;
            }
            recorderRef.current.stopRecording(() => {
              const b = recorderRef.current?.getBlob();
              if (b) {
                resolve(b);
              } else {
                reject(new Error('Failed to get recording blob'));
              }
            });
          });

          // Merge the 1-second pre-recording buffer with RecordRTC's blob
          const mergedBlob = await mergePreRecordingBufferWithRecordedAudio(
            PRE_RECORDING_BUFFER, // your ring buffer array
            blob,
            audioContextRef.current || null // your AudioContext
          );

          // Clear the buffer once merged
          PRE_RECORDING_BUFFER.length = 0;

          // Convert mergedBlob to ArrayBuffer and push to queue
          const audioBuffer = await mergedBlob.arrayBuffer();
          const currentSequence = sequenceCounterRef.current++;

          audioQueueRef.current.push({
            audio: audioBuffer,
            context: semanticContextRef.current,
            timestamp: Date.now(),
            sequenceId: currentSequence,
          });

          processQueue();
          recorderRef.current?.reset();
        } catch (err) {
          console.error('[VAD] Error processing voice segment:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      },

      onUpdate: (amplitude: number) => {
        // if recording is active, log amplitude
        if (isVoiceActive) {
          console.log('[VAD] Amplitude:', amplitude);
        }
      },

      // VAD configuration parameters
      bufferLen: 1024,
      avgNoiseMultiplier: 1.5,
      minNoiseLevel: 0.4, // Reduced sensitivity
      maxNoiseLevel: 0.7, // Increased range
      minCaptureFreq: 85, // Voice frequency range
      maxCaptureFreq: 255,
      noiseCaptureDuration: 2000, // Longer noise analysis
      minSpeechDuration: 250, // Minimum 250ms of speech
      maxSpeechDuration: 60000, // Maximum 60s per segment (1 minute)
      silenceDuration: 1500, // Shorter silence detection
      smoothingTimeConstant: 0.2, // More smoothing
      audioBuffering: {
        enabled: true,
        duration: 500,
      },
    };

    // Initialize Voice Activity Detection with configuration
    vadRef.current = await VAD(audioContext, stream, vadOptions);
    console.log('[VAD] Voice Activity Detection initialized with options:', vadOptions);
  };

  // Process audio chunks from the queue and send them to the server for transcription
  const processQueue = async () => {
    console.log('[DEBUG] ProcessQueue called:', {
      isProcessing,
      queueLength: audioQueueRef.current.length,
    });

    // Skip if already processing or queue is empty
    if (isProcessing || audioQueueRef.current.length === 0) {
      console.log(
        '[QUEUE] Skipping - isProcessing:',
        isProcessing,
        'queueLength:',
        audioQueueRef.current.length
      );
      return;
    }

    // Set processing flag to prevent concurrent processing
    setIsProcessing(true);
    console.log('[QUEUE] Starting queue processing');

    // Process chunks while there are items in the queue
    while (audioQueueRef.current.length > 0) {
      // Get the next chunk from the front of the queue
      const chunk = audioQueueRef.current[0];
      console.log('[QUEUE] Processing chunk with sequenceId:', chunk.sequenceId);

      try {
        // Create a promise to handle the server communication
        await new Promise<void>((resolve, reject) => {
          console.log('[QUEUE] Setting up server communication for chunk:', chunk.sequenceId);

          // Set timeout of 5 seconds for server response
          const timeout = setTimeout(() => reject(new Error('Server timeout')), 5000);

          // Send audio chunk to server via socket
          socket.emit(
            'audioDataPartial',
            {
              audio: chunk.audio,
              context: chunk.context,
              sequenceId: chunk.sequenceId,
              timestamp: chunk.timestamp,
            },
            (response: TranscriptionResponse) => {
              // Clear timeout since we got a response
              clearTimeout(timeout);

              if (response.success) {
                console.log('[QUEUE] Successfully processed chunk:', chunk.sequenceId);
                // Store the transcription with metadata in pending transcriptions map
                pendingTranscriptionsRef.current.set(chunk.sequenceId, {
                  sequenceId: chunk.sequenceId,
                  timestamp: chunk.timestamp,
                  isProcessed: true,
                  transcription: response.transcription,
                });

                console.log(
                  '[QUEUE] Added to pending transcriptions, current size:',
                  pendingTranscriptionsRef.current.size
                );

                // Process any transcriptions that are ready to be ordered
                processOrderedTranscriptions();
                resolve();
              } else {
                // Reject if server returned an error
                console.error(
                  '[QUEUE] Server returned error for chunk:',
                  chunk.sequenceId,
                  response.error
                );
                reject(new Error(response.error || 'Unknown error occurred'));
              }
            }
          );
        });

        // Remove processed chunk from queue after successful processing
        audioQueueRef.current.shift();
        console.log(
          '[QUEUE] Removed processed chunk, remaining queue size:',
          audioQueueRef.current.length
        );
      } catch (err) {
        // Log error and update error state
        console.error('[QUEUE] Error processing chunk:', err);

        // Handle timeout errors specifically
        if (err instanceof Error && err.message === 'Server timeout') {
          console.warn('[QUEUE] Server timeout occurred for chunk:', chunk.sequenceId);
          // Optional: Implement retry logic here
          // Example: if (retryCount < maxRetries) { ... }
        }

        // Set error state and break processing loop
        setError(err instanceof Error ? err.message : String(err));
        break;
      }
    }

    // Reset processing flag when done
    setIsProcessing(false);
    console.log('[QUEUE] Queue processing complete, processing flag reset');
  };

  // Helper function to process transcriptions in order
  const processOrderedTranscriptions = () => {
    const pending = pendingTranscriptionsRef.current;
    while (pending.has(nextExpectedSequenceRef.current)) {
      const nextChunk = pending.get(nextExpectedSequenceRef.current)!;

      if (nextChunk.transcription) {
        setTranscriptions((prev) => [...prev, nextChunk.transcription!]);
      }

      pending.delete(nextExpectedSequenceRef.current);
      nextExpectedSequenceRef.current++;
    }
  };

  // Function to start audio recording with voice activity detection
  const startListening = async () => {
    sequenceCounterRef.current = 0;
    console.log('[CLIENT] Start Listening... invoked');
    setIsInitializing(true);

    try {
      // Clean up any existing resources first
      await cleanupAudioResources();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Initialize recorder before VAD to ensure it's ready
      recorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav',
        recorderType: RecordRTC.StereoAudioRecorder,
        numberOfAudioChannels: 1,
        desiredSampRate: 48000,
        disableLogs: false,
      });

      // Verify recorder initialization
      if (!recorderRef.current) {
        throw new Error('Failed to initialize recorder');
      }

      // Initialize VAD after recorder is ready
      await initializeVAD(stream);

      // Add a small delay after VAD initialization
      await new Promise((resolve) => setTimeout(resolve, 2100));

      if (!socket.connected) {
        throw new Error('Socket not connected');
      }

      setIsListening(true);
      setProposals([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await cleanupAudioResources();
    } finally {
      setIsInitializing(false);
    }
  };

  const stopListening = () => {
    console.log('[CLIENT] STOP Listening invoked');

    // Immediately update UI state
    setIsListening(false);
    setIsVoiceActive(false);

    // First, destroy VAD instance to stop amplitude logging
    if (vadRef.current) {
      console.log('[CLEANUP] Destroying VAD instance');
      vadRef.current.destroy();
      vadRef.current = null;
    }

    // Then stop the recorder if it exists
    if (recorderRef.current) {
      recorderRef.current.stopRecording(() => {
        socket.emit('audioComplete');
        cleanupAudioResources();
        console.log('[CLEANUP] Audio resources cleaned up');
      });
    } else {
      // If no recorder exists, still cleanup
      cleanupAudioResources();
      console.log('[CLEANUP] Audio resources cleaned up');
    }
  };

  const cleanupAudioResources = () => {
    console.log('[CLEANUP] Starting cleanup of audio resources');
    try {
      console.log('[CLEANUP] Setting voice active state to false');
      setIsVoiceActive(false);

      if (vadRef.current) {
        console.log('[CLEANUP] Destroying VAD instance');
        vadRef.current.destroy();
        vadRef.current = null;
      }

      if (audioContextRef.current) {
        console.log('[CLEANUP] Closing audio context');
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      console.log('[CLEANUP] Clearing audio queue');
      audioQueueRef.current = [];

      if (recorderRef.current) {
        console.log('[CLEANUP] Cleaning up recorder and media stream');
        const recorder = recorderRef.current.getInternalRecorder();
        if (recorder && 'stream' in recorder) {
          const mediaRecorder = recorder as { stream: MediaStream };
          mediaRecorder.stream.getTracks().forEach((track) => {
            console.log('[CLEANUP] Stopping media track:', track.kind);
            track.stop();
          });
        }
        recorderRef.current = null;
      }

      console.log('[CLEANUP] Resetting transcription state');
      pendingTranscriptionsRef.current.clear();
      nextExpectedSequenceRef.current = 0;
      setTranscriptions([]);

      console.log('[CLEANUP] Audio resource cleanup completed successfully');
    } catch (err) {
      console.error('[CLEANUP] Error cleaning up audio resources:', err);
    }
  };

  useEffect(() => {
    const handleTranscription = (response: TranscriptionResponse) => {
      if (response.success && response.transcription) {
        pendingTranscriptionsRef.current.set(response.sequenceId, {
          sequenceId: response.sequenceId,
          timestamp: Date.now(),
          isProcessed: true,
          transcription: response.transcription,
        });
        processOrderedTranscriptions();
      }
    };

    socket.on('transcription', handleTranscription);

    return () => {
      socket.off('transcription', handleTranscription);
    };
  }, []);

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
      <ListeningStatus
        isListening={isListening}
        isRecording={isVoiceActive}
        isInitializing={isInitializing}
      />
      <Button
        color={isListening ? 'red' : 'blue'}
        onClick={isListening ? stopListening : startListening}
        disabled={isInitializing}
      >
        {isInitializing ? 'Initializing...' : isListening ? 'Stop Listening' : 'Start Listening'}
      </Button>
      {error && (
        <Alert color="red" title="Error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {transcriptions.map((text, index) => (
        <Text key={index}>{text}</Text>
      ))}
      {proposals.length > 0 && (
        <ProposalsList proposals={proposals} onApprove={handleApprove} onReject={handleReject} />
      )}
    </Stack>
  );
}
