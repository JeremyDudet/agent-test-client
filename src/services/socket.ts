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

// Error handling
socket.on('error', (error) => {
  console.error('[SOCKET] Socket error:', error);
});
