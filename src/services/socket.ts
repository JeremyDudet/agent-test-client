// socket.ts
import { io } from 'socket.io-client';
import { AgentState } from '../types';

const BACKEND_URL = 'http://localhost:3000';

export const socket = io(BACKEND_URL, {
  transports: ['websocket'],
  withCredentials: true,
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

// State change handler
socket.on('stateChanged', (state: AgentState) => {
  console.log('[SOCKET] Agent state updated:', {
    isProcessing: state.isProcessing,
    messageCount: {
      processed: state.messageWindow.processedMessages.length,
      new: state.messageWindow.newMessages.length,
    },
    proposalsCount: state.existingProposals.length,
    categories: state.userExpenseCategories.map((cat) => cat.name),
    time: state.timeContext.formattedNow,
  });

  // You can emit a custom event or use a state management solution here
  // For example, using a custom event:
  const stateChangeEvent = new CustomEvent('agentStateChanged', {
    detail: state,
  });
  window.dispatchEvent(stateChangeEvent);
});
