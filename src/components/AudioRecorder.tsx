import React, { useState, useRef, useEffect } from 'react';
import RecordRTC from 'recordrtc';
import { socket } from '../services/socket';
import { Button, Stack, Alert } from '@mantine/core';
import { ProposalsList } from './ProposalsList';
import { RecordingStatus } from './RecordingStatus';
import { Proposal } from '../types';

export function AudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const recorderRef = useRef<RecordRTC | null>(null);
  
  const startRecording = async () => {
    console.log('[CLIENT] startRecording invoked');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[CLIENT] obtained audio stream');
      
      recorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav',
        recorderType: RecordRTC.StereoAudioRecorder,
        timeSlice: 3000, // Send chunk every 3 seconds
        numberOfAudioChannels: 1,
        desiredSampRate: 16000, // Match Whisper's preferred rate
        disableLogs: false,
        ondataavailable: async (blob) => {
          console.log('[CLIENT] ondataavailable called, blob size:', blob.size);
          try {
            const arrayBuffer = await blob.arrayBuffer();
            console.log('[CLIENT] Sending WAV chunk to server, size:', arrayBuffer.byteLength);
            socket.emit('audioDataPartial', arrayBuffer);
          } catch (err) {
            console.error('[CLIENT] Error processing chunk:', err);
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      });
    
      recorderRef.current.startRecording();
      setIsRecording(true);
      setProposals([]); // Clear previous proposals when starting new recording
      setError(null); // Clear any previous errors
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
        const blob = recorderRef.current?.getBlob();
        console.log('[CLIENT] final blob size:', blob?.size);
        
        try {
          if (blob) {
            const arrayBuffer = await blob.arrayBuffer();
            socket.emit('audioData', arrayBuffer);
          }
          socket.emit('audioComplete');
        } catch (err) {
          console.error('[CLIENT] Error sending final audio:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
        
        setIsRecording(false);
        
        // Clean up the recorder
        try {
          const recorder = recorderRef.current?.getInternalRecorder();
          if (recorder && 'stream' in recorder) {
            const mediaRecorder = recorder as { stream: MediaStream };
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
          }
        } catch (err) {
          console.error('[CLIENT] Error cleaning up recorder:', err);
        }
      });
    }
  };
  
  useEffect(() => {
    console.log('[CLIENT] Setting up socket listeners');
    
    const handleProposals = (data: { proposals: any }) => {
      console.log('[CLIENT] Received proposals:', data);
      
      if (!data.proposals) return;

      setProposals(prevProposals => {
        try {
          let parsedData = data.proposals;
          
          // If it's a string, try to parse it
          if (typeof data.proposals === 'string') {
            if (data.proposals.trim() === "No proposals.") {
              return prevProposals;
            }
            // Take only the first line which contains the JSON
            const jsonString = data.proposals.split('\n')[0];
            parsedData = JSON.parse(jsonString);
          }

          // If parsedData is empty or "No proposals", return existing proposals
          if (!parsedData || parsedData === "No proposals") {
            return prevProposals;
          }

          // Extract expense proposals
          const proposalsArray = Object.values(parsedData)
            .filter((p): p is Proposal => 
              Boolean(p) && 
              typeof p === 'object' && 
              p !== null &&
              'description' in p &&
              'amount' in p &&
              'suggestedCategory' in p
            );

          // Filter out duplicates
          const newProposals = proposalsArray.filter(p => 
            !prevProposals.some(existing => 
              existing.description === p.description && 
              existing.amount === p.amount
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
      
      // Clean up recorder if component unmounts while recording
      if (recorderRef.current && isRecording) {
        recorderRef.current.stopRecording();
        try {
          const recorder = recorderRef.current.getInternalRecorder();
          if (recorder && 'stream' in recorder) {
            const mediaRecorder = recorder as { stream: MediaStream };
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
          }
        } catch (err) {
          console.error('[CLIENT] Error cleaning up recorder:', err);
        }
      }
    };
  }, []); // Empty dependency array since we don't need to re-run this effect

  const handleApprove = (proposal: Proposal) => {
    console.log('[CLIENT] Approved proposal:', proposal);
    // Implement approval logic here
  };

  const handleReject = (proposal: Proposal) => {
    console.log('[CLIENT] Rejected proposal:', proposal);
    // Implement rejection logic here
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
        <ProposalsList
          proposals={proposals}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </Stack>
  );
}