// AudioRecorder.tsx
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
  ExtendedVADOptions
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
  const voiceStartTimeRef = useRef<number | null>(null);
  const [transcriptions, setTranscriptions] = useState<string[]>([]);

  const BUFFER_DURATION = 1000; // 1 second buffer
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

  const vadOptions: ExtendedVADOptions = {
      onVoiceStart: () => {
        setIsVoiceActive(true);
        console.log('[VAD] Voice started');

        // Record the timestamp
        voiceStartTimeRef.current = Date.now();
      
        // Delay the recorder start slightly
        setTimeout(() => {
          if (isVoiceActive && recorderRef.current) {
            recorderRef.current.startRecording();
          }
        }, 300);
      },

      onVoiceStop: async () => {
        setIsVoiceActive(false);
        console.log('[VAD] Voice stopped');
      
        // Optional short delay if you need to buffer any trailing audio
        await new Promise((resolve) => setTimeout(resolve, 500));
      
        if (recorderRef.current) {
          try {
            const voiceEndTime = Date.now();
            const duration = voiceStartTimeRef.current
              ? voiceEndTime - voiceStartTimeRef.current
              : 0;
      
            // 1 second threshold
            if (duration < 1000) {
              console.log('[VAD] Chunk < 1 second. Discarding...');
              recorderRef.current.stopRecording(() => {
                // Clean up any internal references,
                // but DO NOT push chunk to queue
                recorderRef.current?.reset();
              });
              return; // Skip queue push
            }
      
            // Otherwise, get the blob and push it to the queue
            const blob = await new Promise<Blob>((resolve) => {
              recorderRef.current?.stopRecording(() => {
                const blob = recorderRef.current?.getBlob();
                if (blob) {
                  resolve(blob);
                }
              });
            });
      
            // Proceed as usual
            const audioBuffer = await blob.arrayBuffer();
            const currentSequence = sequenceCounterRef.current++;
      
            console.log('[VAD] Logging valid audio chunk');
      
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
      minNoiseLevel: 0.5,           // Reduced sensitivity
      maxNoiseLevel: 0.7,           // Increased range
      minCaptureFreq: 85,           // Voice frequency range
      maxCaptureFreq: 255,
      noiseCaptureDuration: 2000,   // Longer noise analysis
      minSpeechDuration: 750,       // Minimum 500ms of speech
      maxSpeechDuration: 15000,     // Maximum 15s per segment
      silenceDuration: 1000,         // Shorter silence detection
      smoothingTimeConstant: 0.2,  // More smoothing
      audioBuffering: {
          enabled: true,
          duration: 500
      }
  };


  // Initialize Voice Activity Detection with configuration
  vadRef.current = await VAD(audioContext, stream, vadOptions);
  console.log('[VAD] Voice Activity Detection initialized with options:', vadOptions);
};


  // Process audio chunks from the queue and send them to the server for transcription
  const processQueue = async () => {

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
            console.log('[QUEUE] Emitted audioDataPartial'),
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
    // Reset the sequence counter for new recording session
    sequenceCounterRef.current = 0;
    console.log('[CLIENT] Start Listening... invoked');
    try {
      // Request access to user's microphone with specific audio constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Mono audio
          sampleRate: 48000, // High quality sample rate
          echoCancellation: true, // Reduce echo
          noiseSuppression: true, // Reduce background noise
          autoGainControl: true, // Adjust microphone gain
        },
      });

      // Initialize Voice Activity Detection with the audio stream
      await initializeVAD(stream);

      // Configure and create new RecordRTC instance for audio recording
      recorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav', // WAV format for high quality
        recorderType: RecordRTC.StereoAudioRecorder, // Use stereo recorder
        numberOfAudioChannels: 1, // But record in mono
        desiredSampRate: 48000, // Match input sample rate
        disableLogs: false, // Keep logs enabled for debugging
      });

      // Verify socket connection before proceeding
      if (!socket.connected) {
        throw new Error('Socket not connected');
      }

      // Update component state to reflect recording status
      setIsListening(true);
      setProposals([]); // Clear any existing proposals
      setError(null); // Clear any previous errors
    } catch (err) {
      // Handle and log any errors during setup
      setError(err instanceof Error ? err.message : String(err));
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
      <ListeningStatus isListening={isListening} isRecording={isVoiceActive} />
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
