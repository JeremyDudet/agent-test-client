import { io } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:3000';

export const socket = io(BACKEND_URL, {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// Enhanced socket events for semantic processing
socket.on('semanticUpdate', (data) => {
  console.log('[SOCKET] Semantic understanding update:', data);
});

socket.on('contextProgress', (data) => {
  console.log('[SOCKET] Context building progress:', data);
});

socket.on('learningUpdate', (data) => {
  console.log('[SOCKET] Learning system update:', data);
});

socket.on(
  'contextUpdate',
  (data: {
    contextComplete: boolean;
    enhancedUnderstanding: boolean;
    learningUpdates?: string[];
  }) => {
    console.log('[SOCKET] Context update:', data);
  }
);

socket.on(
  'semanticUnitDetected',
  (data: { unit: string; confidence: number; requiresMoreContext: boolean }) => {
    console.log('[SOCKET] Semantic unit detected:', data);
  }
);

// Add handler for ordered transcriptions
socket.on(
  'orderedTranscription',
  (data: { transcription: string; sequenceId: number; isComplete: boolean }) => {
    console.log('[SOCKET] Received ordered transcription:', data);
  }
);

// Socket connection error handling
socket.on('connect_error', (error: Error) => {
  console.error('[CLIENT] Socket connection error:', error);
});

socket.on('disconnect', (reason: string) => {
  console.error('[CLIENT] Socket disconnected:', reason);
});

socket.on('error', (error) => {
  console.error('[SOCKET] Socket error:', error);
});
