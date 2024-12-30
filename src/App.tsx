import React from 'react';
import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { AudioRecorder } from './components/AudioRecorder';

function App() {
  return (
    <MantineProvider>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1>Expense Tracker</h1>
        <AudioRecorder />
      </div>
    </MantineProvider>
  );
}

export default App;