import { io } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:3000';

export const socket = io(BACKEND_URL, {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  console.log('[SOCKET] Connected to server');
});

socket.on('disconnect', () => {
  console.log('[SOCKET] Disconnected from server');
});

socket.on('connect_error', (error) => {
  console.error('[SOCKET] Connection error:', error);
});

socket.on('error', (error) => {
  console.error('[SOCKET] Socket error:', error);
});
