/* global AudioWorkletProcessor, registerProcessor */
class PebblePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.packet = new Int16Array(960);
    this.length = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      const sample = Math.max(-1, Math.min(1, value));
      this.packet[this.length++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      this.energy += sample * sample;
      if (this.length === this.packet.length) {
        const level = Math.min(1, Math.sqrt(this.energy / this.packet.length) * 5);
        this.port.postMessage({ pcm: this.packet.buffer, level }, [this.packet.buffer]);
        this.packet = new Int16Array(960);
        this.length = 0;
        this.energy = 0;
      }
    }
    return true;
  }
}

registerProcessor('pebble-pcm-capture', PebblePcmCapture);
