# Audio Recorder Client

A simple React client application that:

- Records audio using RecordRTC
- Detects speech using Voice Activity Detection (VAD)
- Sends recorded audio chunks to a server via sockets for transcription
- Displays incoming transcription proposals and final transcribed text

# Features

- Voice Activity Detection (VAD) to automatically start/stop recording.
- Pre-recording buffer to avoid clipping the first few milliseconds of audio.
- Socket-based communication for real-time transcription.
