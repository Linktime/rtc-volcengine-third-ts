class AudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.chunkSize = options.processorOptions.chunkSize || 128;
        this.buffer = new Float32Array(this.chunkSize * 2); // Allocate a bit more space
        this.bufferPosition = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const data = input[0];
            
            // Append new data to the buffer
            if (this.bufferPosition + data.length > this.buffer.length) {
                // If buffer is full, process and clear
                this.sendChunk();
                this.buffer.fill(0);
                this.bufferPosition = 0;
            }
            this.buffer.set(data, this.bufferPosition);
            this.bufferPosition += data.length;

            // Process chunks
            while (this.bufferPosition >= this.chunkSize) {
                this.sendChunk();
                
                // Move remaining data to the beginning of the buffer
                const remaining = this.buffer.slice(this.chunkSize, this.bufferPosition);
                this.buffer.fill(0);
                this.buffer.set(remaining, 0);
                this.bufferPosition = remaining.length;
            }
        }
        return true;
    }

    sendChunk() {
        const chunk = this.buffer.slice(0, this.chunkSize);
        const pcm16 = this.float32ToPcm16(chunk);
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    float32ToPcm16(float32Array) {
        const pcm16 = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return pcm16;
    }
}

registerProcessor('audio-processor', AudioProcessor);