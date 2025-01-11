/**
 * audioMerging.ts
 *
 * This file contains helper functions that:
 * 1) Flatten an array of Float32Array chunks (the "pre-recording buffer"),
 * 2) Decode a recorded audio Blob into raw Float32 samples,
 * 3) Merge them into one continuous set of samples,
 * 4) Encode back into a WAV Blob.
 */

/**
 * Merges pre-recorded Float32 samples with the recorded Blob from RecordRTC.
 *
 * @param preBufferFrames   An array of Float32Arrays representing buffered audio frames
 * @param recordedBlob      The final Blob produced by RecordRTC
 * @param audioContext      An AudioContext used for decoding
 * @returns                 A Promise that resolves to a merged WAV Blob
 */
export async function mergePreRecordingBufferWithRecordedAudio(
  preBufferFrames: Float32Array[],
  recordedBlob: Blob,
  audioContext: AudioContext | null
): Promise<Blob> {
  // If there's no valid audioContext, return the original blob (fallback)
  if (!audioContext) {
    console.warn('[merge] No audioContext provided, skipping merge.');
    return recordedBlob;
  }

  // 1) Flatten all frames from preBufferFrames
  const flattenedPreBuffer = flattenFloat32Arrays(preBufferFrames);

  // 2) Decode the recorded Blob into Float32 samples
  const recordedArrayBuffer = await recordedBlob.arrayBuffer();
  const recordedAudioBuffer = await audioContext.decodeAudioData(recordedArrayBuffer);
  const recordedSamples = recordedAudioBuffer.getChannelData(0); // assuming mono

  // 3) Merge them into one continuous Float32Array
  const mergedLength = flattenedPreBuffer.length + recordedSamples.length;
  const mergedSamples = new Float32Array(mergedLength);

  mergedSamples.set(flattenedPreBuffer, 0);
  mergedSamples.set(recordedSamples, flattenedPreBuffer.length);

  // 4) Encode the merged float data back into a WAV Blob
  const mergedBlob = encodeWAV(mergedSamples, recordedAudioBuffer.sampleRate);

  return mergedBlob;
}

/**
 * Utility to flatten an array of Float32Array chunks into one Float32Array.
 */
function flattenFloat32Arrays(chunks: Float32Array[]): Float32Array {
  let totalLength = 0;
  for (const c of chunks) {
    totalLength += c.length;
  }
  const result = new Float32Array(totalLength);

  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }

  return result;
}

/**
 * Minimal WAV encoder that merges raw PCM float samples into a 16-bit PCM WAV buffer.
 * Returns a Blob of type 'audio/wav'.
 *
 * @param samples     The raw Float32 samples (mono)
 * @param sampleRate  Sample rate in Hz (e.g., 48000)
 */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  // For mono, 16-bit PCM
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample >> 3);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * (bitsPerSample >> 3);

  // 44-byte header + PCM data
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  /* RIFF chunk descriptor */
  writeString(view, 0, 'RIFF'); // ChunkID
  view.setUint32(4, 36 + dataSize, true); // ChunkSize = 36 + SubChunk2Size
  writeString(view, 8, 'WAVE'); // Format

  /* "fmt " sub-chunk */
  writeString(view, 12, 'fmt '); // Subchunk1ID
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  /* "data" sub-chunk */
  writeString(view, 36, 'data'); // Subchunk2ID
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    // Clamp to [-1, 1]
    let s = Math.max(-1, Math.min(1, samples[i]));
    // Scale to 16-bit signed int
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Helper to write a string into a DataView at a specific offset.
 */
function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
