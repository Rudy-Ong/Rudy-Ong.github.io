// static-refs.js -- pre-generated VOICEVOX references, served as static files.
//
// tools/build-references.py renders every word once with the VOICEVOX Nemo
// engine and commits the result under data/refs/. This module is how the
// browser reads it, so the natural-voice reference, the karaoke and the
// same-gender pitch range all work on a static host (GitHub Pages) with no
// server at all.
//
// Per word key `<reading>.<accentNum>.<frame>` (frame `desu` / `koto`):
//   data/refs/audio/f/<key>.mp3, data/refs/audio/m/<key>.mp3
//   data/refs/detail/<key>.json  { voices: { female, male }, range: { female,
//                                  male }, devoiced: [word mora index, ...] }
// and data/refs/manifest.json, which also lists every word with devoicing.
//
// Only speed 1.0 is rendered. Slower and faster speech is the same audio at a
// pitch-preserving playbackRate, so the timeline is scaled here to match --
// VOICEVOX's own speedScale divides every length by the speed the same way.
//
// Exposed as a UMD-style global (StaticRefs) so the pure helpers can be
// required from Node tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StaticRefs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'data/refs/';
  // Same frames as server/accent.py's FRAMES and js/coach.js.
  var FRAMES = { verb: 'こと', prenominal: 'こと', other: 'です' };
  var FRAME_KEYS = { 'です': 'desu', 'こと': 'koto' };
  var GENDERS = ['female', 'male'];

  var state = { manifest: null, available: false };
  var details = {};

  function frameFor(word) {
    return FRAMES[word && word.pos] || FRAMES.other;
  }

  // Must match word_key() in tools/build-references.py.
  function keyFor(word) {
    return word.reading + '.' + word.accentNum + '.' + FRAME_KEYS[frameFor(word)];
  }

  function genderOf(value) {
    return value === 'male' ? 'male' : 'female';
  }

  // Resolves true once the manifest loads. A missing data/refs/ (an older
  // checkout, or a build that was never run) is a normal false, not an
  // error: the app then falls back to the browser voice exactly as before.
  function load(fetchImpl) {
    var get = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!get) return Promise.resolve(false);
    return get(BASE + 'manifest.json')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (manifest) {
        state.manifest = manifest && manifest.version ? manifest : null;
        state.available = !!state.manifest;
        return state.available;
      })
      .catch(function () {
        state.available = false;
        return false;
      });
  }

  function audioUrl(word, gender) {
    return BASE + 'audio/' + genderOf(gender).charAt(0) + '/' + encodeURIComponent(keyFor(word)) + '.mp3';
  }

  function rawDetail(word, fetchImpl) {
    var key = keyFor(word);
    if (!details[key]) {
      var get = fetchImpl || fetch;
      details[key] = get(BASE + 'detail/' + encodeURIComponent(key) + '.json')
        .then(function (res) {
          if (!res.ok) throw new Error('no reference for ' + word.reading);
          return res.json();
        })
        .catch(function (err) {
          delete details[key];   // a transient failure may be retried
          throw err;
        });
    }
    return details[key];
  }

  // A reference rendered at 1.0x, as heard at `speed`: every time divided by
  // the speed, the pitch untouched.
  function scaleReference(reference, speed) {
    var s = speed > 0 ? speed : 1;
    var out = {};
    Object.keys(reference).forEach(function (k) { out[k] = reference[k]; });
    out.speed = s;
    out.duration_s = reference.duration_s / s;
    out.moras = reference.moras.map(function (m) {
      var copy = {};
      Object.keys(m).forEach(function (k) { copy[k] = m[k]; });
      copy.start_s = m.start_s / s;
      copy.end_s = m.end_s / s;
      if (m.vowel_start_s != null) copy.vowel_start_s = m.vowel_start_s / s;
      return copy;
    });
    return out;
  }

  // The reference for the karaoke and the target diagram, in the shape
  // /api/reference/detail returns, plus `range_rels`: the pitch plan of
  // every voice of the LEARNER's gender, which js/karaoke.js judges each
  // pitch step against. The voice heard and the learner's own voice type are
  // independent choices, so a man can practise against a female model voice
  // and still be judged against how men say the word.
  function fromDetail(detail, voiceGender, learnerGender, speed) {
    var heard = detail.voices[genderOf(voiceGender)];
    if (!heard) throw new Error('reference has no ' + voiceGender + ' voice');
    var reference = scaleReference(heard, speed);
    reference.range_rels = detail.range[genderOf(learnerGender)] || null;
    reference.devoiced_word_moras = detail.devoiced || [];
    return reference;
  }

  function detail(word, voiceGender, learnerGender, speed, fetchImpl) {
    return rawDetail(word, fetchImpl).then(function (raw) {
      return fromDetail(raw, voiceGender, learnerGender, speed);
    });
  }

  // Word-mora indices that the reference devoices, or null when unknown.
  function devoicedIndices(word) {
    if (!state.manifest || !word) return null;
    return state.manifest.devoiced[keyFor(word)] || [];
  }

  function hasDevoicing(word) {
    var idx = devoicedIndices(word);
    return !!(idx && idx.length);
  }

  return {
    GENDERS: GENDERS,
    state: state,
    load: load,
    keyFor: keyFor,
    frameFor: frameFor,
    audioUrl: audioUrl,
    detail: detail,
    fromDetail: fromDetail,
    scaleReference: scaleReference,
    devoicedIndices: devoicedIndices,
    hasDevoicing: hasDevoicing,
    // Test hook: seed the manifest without a fetch.
    _setManifest: function (manifest) {
      state.manifest = manifest;
      state.available = !!manifest;
    },
  };
});
