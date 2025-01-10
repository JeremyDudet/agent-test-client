import React, { useState, useRef, useEffect } from 'react';
import RecordRTC from 'recordrtc';
import VAD from 'voice-activity-detection';
import { socket } from '../services/socket';
import { Button, Stack, Alert, Text } from '@mantine/core';
import { ProposalsList } from './ProposalsList';
import { ListeningStatus } from './ListeningStatus';
import type {
  Proposal,
  SemanticContext,
  QueuedAudioChunk,
  TranscriptionResponse,
  AudioChunkMetadata,
} from '../types';

interface VADInstance {
  destroy: () => void;
}

export function AudioRecorder() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const sequenceCounterRef = useRef<number>(0);
  const pendingTranscriptionsRef = useRef<Map<number, AudioChunkMetadata>>(new Map());
  const nextExpectedSequenceRef = useRef<number>(0);
  const [transcriptions, setTranscriptions] = useState<string[]>([]);

  const BUFFER_DURATION = 1000; // 1 second buffer
  const PRE_RECORDING_BUFFER: Float32Array[] = [];

  // Process audio chunks from the queue and send them to the server for transcription
  const processQueue = async () => {
    console.log('[QUEUE] Starting queue processing');

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
    console.log('[QUEUE] Set processing flag to true');

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

  // Initialize Voice Activity Detection (VAD) with the given audio stream
  // This sets up audio processing and voice detection logic
  const initializeVAD = async (stream: MediaStream) => {
    // Create new audio context to process the stream
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

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
      const inputData = e.data;
      // Add new audio data to pre-recording buffer
      PRE_RECORDING_BUFFER.push(new Float32Array(inputData));
      // Remove oldest data if buffer exceeds size limit
      if (PRE_RECORDING_BUFFER.length > BUFFER_DURATION / (4096 / audioContext.sampleRate)) {
        PRE_RECORDING_BUFFER.shift();
      }
    };

    // Connect audio source to processor
    source.connect(processor);

    // Initialize Voice Activity Detection with configuration
    vadRef.current = await VAD(audioContext, stream, {
      // Called when voice activity starts
      onVoiceStart: () => {
        // Prevent duplicate starts
        if (isVoiceActive) {
          console.log('[VAD] Ignoring voice start - already active');
          return;
        }
        setIsVoiceActive(true);

        // Log detection events
        console.log('[VAD] Voice activity detected - Starting recording');

        // Initialize semantic context for this voice segment
        semanticContextRef.current = {
          timestamp: Date.now(),
          isComplete: false,
          confidence: 0,
        };

        // Start recording if recorder is ready
        if (recorderRef.current) {
          console.log('[RECORDER] Starting recording');
          recorderRef.current.startRecording();
        } else {
          console.warn('[RECORDER] Recorder not ready when voice activity started');
        }
      },

      // Called when voice activity ends
      onVoiceStop: async () => {
        setIsVoiceActive(false);

        // Add small delay to capture trailing audio
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log('[CLIENT] Voice activity stopped');

        // Process recorded audio if available
        if (recorderRef.current) {
          try {
            console.log('[RECORDER] Stopping recording and getting blob');
            // Get recorded audio blob
            const blob = await new Promise<Blob>((resolve) => {
              recorderRef.current?.stopRecording(() => {
                const blob = recorderRef.current?.getBlob();
                if (blob) {
                  console.log('[RECORDER] Got audio blob, size:', blob.size);
                  resolve(blob);
                }
              });
            });

            // Convert blob to buffer and prepare for queue
            console.log('[RECORDER] Converting blob to buffer');
            const audioBuffer = await blob.arrayBuffer();
            const currentSequence = sequenceCounterRef.current++;
            console.log('[QUEUE] Preparing chunk with sequence ID:', currentSequence);

            // Add to processing queue with metadata
            audioQueueRef.current.push({
              audio: audioBuffer,
              context: semanticContextRef.current,
              timestamp: Date.now(),
              sequenceId: currentSequence,
            });
            console.log('[QUEUE] Added chunk to queue, size:', audioQueueRef.current.length);

            // Trigger queue processing
            console.log('[QUEUE] Triggering queue processing');
            processQueue();
            // Reset recorder for next segment
            console.log('[RECORDER] Resetting recorder');
            recorderRef.current?.reset();
          } catch (err) {
            console.error('[CLIENT] Error processing voice segment:', err);
            setError(err instanceof Error ? err.message : String(err));
          }
        } else {
          console.warn('[RECORDER] No recorder available when voice activity ended');
        }
      },

      // VAD configuration parameters
      minNoiseLevel: 0.2, // Minimum audio level to consider as noise
      maxNoiseLevel: 0.7, // Maximum audio level to consider as noise
      silenceTimeout: 2000, // Time of silence before stopping (ms)
      noiseCaptureDuration: 750, // Duration to analyze noise levels (ms)
      minVoiceDuration: 500, // Minimum duration to consider as voice (ms)
    });
    console.log('[VAD] Voice Activity Detection initialized successfully');
  };

  // Function to start audio recording with voice activity detection
  const startListening = async () => {
    // Reset the sequence counter for new recording session
    sequenceCounterRef.current = 0;
    console.log('[CLIENT] Start Listening... invoked');
    console.log('[CLIENT] Initial sequence counter:', sequenceCounterRef.current);
    try {
      // Request access to user's microphone with specific audio constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Mono audio
          sampleRate: 48000, // High quality sample rate
          echoCancellation: true, // Reduce echo
          noiseSuppression: true, // Reduce background noise
        },
      });

      // Initialize Voice Activity Detection with the audio stream
      console.log('[CLIENT] Initializing VAD...');
      await initializeVAD(stream);
      console.log('[CLIENT] VAD initialization complete');

      // Configure and create new RecordRTC instance for audio recording
      console.log('[CLIENT] Configuring RecordRTC...');
      recorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav', // WAV format for high quality
        recorderType: RecordRTC.StereoAudioRecorder, // Use stereo recorder
        numberOfAudioChannels: 1, // But record in mono
        desiredSampRate: 48000, // Match input sample rate
        disableLogs: false, // Keep logs enabled for debugging
      });
      console.log('[CLIENT] RecordRTC instance created');

      // Verify socket connection before proceeding
      if (!socket.connected) {
        throw new Error('Socket not connected');
      }

      // Update component state to reflect recording status
      setIsListening(true);
      setProposals([]); // Clear any existing proposals
      setError(null); // Clear any previous errors
      console.log('[CLIENT] Recording ready');
    } catch (err) {
      // Handle and log any errors during setup
      console.error('[CLIENT] Start Recording error:', err);
      console.error('[CLIENT] Error details:', {
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : 'No stack trace',
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stopListening = () => {
    console.log('[CLIENT] STOP Listening invoked');
    if (recorderRef.current) {
      recorderRef.current.stopRecording(() => {
        socket.emit('audioComplete');
        setIsListening(false);
        cleanupAudioResources();
      });
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

      console.log('[CLEANUP] Clearing pre-recording buffer and audio queue');
      PRE_RECORDING_BUFFER.length = 0;
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
      console.error('[CLEANUP] Error details:', {
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : 'No stack trace',
      });
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
      <ListeningStatus isListening={isListening} />
      <Button
        color={isListening ? 'red' : 'blue'}
        onClick={isListening ? stopListening : startListening}
      >
        {isListening ? 'Stop Listening' : 'Start Listening'}
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
