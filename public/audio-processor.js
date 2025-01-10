class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (input.length > 0) {
      // Send the audio data to the main thread
      this.port.postMessage(input[0]);

      // Copy input to output for passthrough
      for (let channel = 0; channel < output.length; ++channel) {
        output[channel].set(input[channel]);
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
