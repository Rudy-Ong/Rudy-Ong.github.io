// live-pitch.js -- streaming F0 tracker for the karaoke mode, backed by aubio
// (third-party/aubiojs, WebAssembly) with onchou's own autocorrelation
// estimator as the fallback.
//
// Why a second tracker at all, when js/pitch-detect.js already estimates F0:
// the karaoke mode colours every hop green or red *while the learner is
// speaking*, so a wrong frame is seen immediately rather than averaged away
// into a per-mora median. That needs a tracker that sees every sample once
// (see js/pcm-tap-worklet.js) and reports a confidence that actually
// separates voice from noise. aubio's `yinfast` does both; see
// third-party/aubiojs/NOTICE.md for the measurement that picked it over
// aubio's own default, `yinfft`, whose confidence is always 0 in this build.
//
// Loading aubio is best-effort. If the script is missing (someone deleted
// third-party/aubiojs over its GPL licence), fails to compile, or the browser
// has no WebAssembly, every tracker silently uses PitchDetect's estimator
// instead. The karaoke still works; it is only less exact.
//
// The tracker itself is pure (no DOM, no Web Audio) and runs in Node, which
// is how js/__tests__/live-pitch-test.js checks it against synthetic tones
// with both backends.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LivePitch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AUBIO_SRC = 'third-party/aubiojs/aubio.js';
  var AUBIO_METHOD = 'yinfast';

  // Same plausible-voice bounds as js/pitch-detect.js, widened slightly at
  // the top: a high female voice on an emphatic H mora reaches 450 Hz, and
  // the karaoke shows that frame rather than dropping it.
  var MIN_HZ = 70;
  var MAX_HZ = 500;

  // YIN confidence is 1 minus the dip of the normalised difference function.
  // Measured on this build: voiced synthetic vowels sit at 1.00, white noise
  // at 0.09-0.11. Speech is noisier than either, so the gate sits well below
  // the voiced end but far above the noise.
  var MIN_CONFIDENCE = 0.75;

  // Below this the frame is silence, whatever the tracker thinks. aubio has
  // its own gate (setSilence, dB), and the fallback path applies the same
  // number by hand so the two backends agree on what "silent" means.
  var SILENCE_DB = -50;

  var aubioModule = null;
  var aubioPromise = null;

  // The analysis window: at least 40 ms, rounded up to a power of two
  // because aubio's FFT needs one. 2048 at 44.1/48 kHz, which spans two
  // periods of a 50 Hz voice -- enough for YIN to find the lowest male F0.
  function windowSizeFor(sampleRate) {
    var target = sampleRate * 0.04;
    var size = 256;
    while (size < target) size *= 2;
    return size;
  }

  // A quarter-window hop: ~10.7 ms at 48 kHz. Finer than pitch-detect's
  // 20 ms, because here every hop is drawn and a coarse hop makes the live
  // line visibly stair-step through a 120 ms mora.
  function hopSizeFor(sampleRate) {
    return windowSizeFor(sampleRate) / 4;
  }

  function rmsDb(samples) {
    var sum = 0;
    for (var i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    var rms = Math.sqrt(sum / Math.max(samples.length, 1));
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  // --- loading -------------------------------------------------------------

  // Resolves with the instantiated aubio module, or null. Never rejects: the
  // caller's only decision is which backend to build, and null answers it.
  //
  // `factory` lets Node tests hand in require('../../third-party/aubiojs/
  // aubio.js') directly; in the browser the script tag defines the global.
  function load(factory) {
    if (aubioModule) return Promise.resolve(aubioModule);
    if (aubioPromise) return aubioPromise;

    aubioPromise = obtainFactory(factory)
      .then(function (make) { return make ? make() : null; })
      .then(function (mod) {
        aubioModule = mod && typeof mod.Pitch === 'function' ? mod : null;
        return aubioModule;
      })
      .catch(function () { return null; })
      .then(function (mod) {
        // A failed load is not cached as a permanent failure in the promise:
        // the next call retries, since the usual cause is a flaky network on
        // the very first karaoke attempt.
        if (!mod) aubioPromise = null;
        return mod;
      });
    return aubioPromise;
  }

  function obtainFactory(factory) {
    if (typeof factory === 'function') return Promise.resolve(factory);
    var g = typeof self !== 'undefined' ? self : null;
    if (g && typeof g.aubio === 'function') return Promise.resolve(g.aubio);
    if (typeof WebAssembly !== 'object' || typeof document === 'undefined') {
      return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = AUBIO_SRC;
      script.async = true;
      script.onload = function () { resolve(typeof g.aubio === 'function' ? g.aubio : null); };
      script.onerror = function () { resolve(null); };
      document.head.appendChild(script);
    });
  }

  function backend() {
    return aubioModule ? 'aubio-' + AUBIO_METHOD : 'autocorrelation';
  }

  // --- tracker -------------------------------------------------------------

  // createTracker(sampleRate, opts) -> { push(Float32Array) -> frame[], backend }
  //
  // Feed it every captured sample, in order, in chunks of any size. It hands
  // back zero or more frames per push, one per completed hop:
  //   { tMs, hz, confidence }
  // `tMs` is the centre of the analysis window on the sample clock, measured
  // from the first sample pushed. It is derived from the sample count rather
  // than from wall-clock time, so a busy main thread delays frames but never
  // shifts them in time -- which is what keeps the karaoke's green/red
  // colouring attached to the right syllable.
  //
  // opts.estimate(samples, sampleRate) -> hz|null is the fallback estimator.
  // In the browser it defaults to PitchDetect._estimatePitch.
  // opts.aubio forces a module (tests); opts.forceFallback ignores aubio.
  function createTracker(sampleRate, opts) {
    opts = opts || {};
    var windowSize = windowSizeFor(sampleRate);
    var hop = hopSizeFor(sampleRate);
    var mod = opts.forceFallback ? null : (opts.aubio || aubioModule);

    var pitch = null;
    if (mod) {
      try {
        pitch = new mod.Pitch(AUBIO_METHOD, windowSize, hop, sampleRate);
        if (typeof pitch.setSilence === 'function') pitch.setSilence(SILENCE_DB);
      } catch (e) {
        pitch = null;
      }
    }

    var estimate = opts.estimate || defaultEstimator();
    // The fallback is a whole-window estimator, so it needs the trailing
    // window kept by hand; aubio keeps its own.
    var ring = new Float32Array(windowSize);
    var pending = new Float32Array(hop);
    var pendingFilled = 0;
    var consumed = 0;

    function analyseHop() {
      consumed += hop;
      // Slide the window left by one hop and append the new hop. Done even
      // on the aubio path, because the silence check below reads it.
      ring.copyWithin(0, hop);
      ring.set(pending, windowSize - hop);

      var hz = null;
      var confidence = 0;
      var silent = rmsDb(pending) < SILENCE_DB;

      if (pitch) {
        var value = pitch.do(pending);
        confidence = typeof pitch.getConfidence === 'function' ? pitch.getConfidence() : 1;
        if (!silent && value >= MIN_HZ && value <= MAX_HZ && confidence >= MIN_CONFIDENCE) {
          hz = value;
        }
      } else if (!silent && estimate && consumed >= windowSize) {
        var guess = estimate(ring, sampleRate);
        if (guess != null && guess >= MIN_HZ && guess <= MAX_HZ) {
          hz = guess;
          confidence = 1;
        }
      }

      return {
        // The window ends at `consumed`; its centre is half a window back.
        tMs: (consumed - windowSize / 2) / sampleRate * 1000,
        hz: hz,
        confidence: confidence,
      };
    }

    function push(samples) {
      var frames = [];
      var frame;
      var offset = 0;
      while (offset < samples.length) {
        var take = Math.min(samples.length - offset, hop - pendingFilled);
        pending.set(samples.subarray(offset, offset + take), pendingFilled);
        pendingFilled += take;
        offset += take;
        if (pendingFilled === hop) {
          frame = analyseHop();
          // Nothing is reported until a whole window of real audio exists:
          // before that the window is partly the zeros it was initialised
          // with, and its centre would sit before the first sample.
          if (consumed >= windowSize) frames.push(frame);
          pendingFilled = 0;
        }
      }
      return frames;
    }

    return {
      push: push,
      backend: pitch ? 'aubio-' + AUBIO_METHOD : 'autocorrelation',
      windowSize: windowSize,
      hop: hop,
    };
  }

  function defaultEstimator() {
    var g = typeof self !== 'undefined' ? self : null;
    var detect = g && g.PitchDetect;
    if (detect && typeof detect._estimatePitch === 'function') return detect._estimatePitch;
    return null;
  }

  return {
    load: load,
    backend: backend,
    createTracker: createTracker,
    windowSizeFor: windowSizeFor,
    hopSizeFor: hopSizeFor,
    MIN_CONFIDENCE: MIN_CONFIDENCE,
    SILENCE_DB: SILENCE_DB,
  };
});
