// pcm-tap-worklet.js -- AudioWorklet that forwards raw microphone samples to
// the main thread, for js/live-pitch.js to run aubio on.
//
// Exists because the original capture path (AnalyserNode polled by
// setInterval, see js/pitch-detect.js) only ever sees "the last 1024 samples
// at whatever moment the timer happened to fire". aubio's trackers are
// streaming: they expect every sample exactly once, in order, one hop at a
// time. Polling either repeats samples or skips them, so the tap has to run
// on the audio thread.
//
// Loaded with audioWorklet.addModule(), never with a <script> tag, and kept
// out of sw.js's precache list for no reason other than that it is tiny; the
// stale-while-revalidate handler caches it on first use anyway.
class OnchouPcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    // 128-sample render quanta batched into 512-sample messages: about 94
    // messages a second at 48 kHz instead of 375, which is what keeps the
    // main thread's message queue from becoming the bottleneck on a phone.
    this.batch = new Float32Array(512);
    this.filled = 0;
  }

  process(inputs) {
    var channel = inputs[0] && inputs[0][0];
    if (channel) {
      var offset = 0;
      while (offset < channel.length) {
        var take = Math.min(channel.length - offset, this.batch.length - this.filled);
        this.batch.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.batch.length) {
          // Transferred, not copied; a fresh buffer is allocated for the next
          // batch because the transferred one is detached on this side.
          this.port.postMessage(this.batch, [this.batch.buffer]);
          this.batch = new Float32Array(512);
          this.filled = 0;
        }
      }
    }
    // Keep processing even when the input momentarily has no channel data
    // (some browsers report an empty input for the first quanta after
    // connect); returning false would end the node for good.
    return true;
  }
}

registerProcessor('onchou-pcm-tap', OnchouPcmTap);
