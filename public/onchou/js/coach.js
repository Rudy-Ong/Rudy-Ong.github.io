// coach.js -- client for the optional server-side pronunciation coach
// (VOICEVOX Nemo reference audio + alignment-based scoring + LLM feedback).
//
// The app must behave exactly as it always has when there is no coach. That
// is not a nicety: the same files are deployed both to GitHub Pages, where
// no API exists at all, and into the Space's own container, where one does.
// So every entry point here is written to fail quietly and let the caller
// fall back to `ReferenceAudio` + the client-side pitch pipeline.
//
// Pure helpers (URL building, availability logic, response shaping) also run
// in Node for testing; anything touching fetch/Audio is browser-only --
// matching the split js/reference-audio.js already uses.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Coach = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Same-origin by design: the app and the API are served by one container,
  // which is what removes CORS and any backend-URL setting from the picture.
  var BASE = '/api';

  // How long to wait on the health probe. A sleeping free Space takes 30-60s
  // to resume, which is far too long to block the first paint on -- so the
  // probe gives up quickly and the coach simply appears later, once /warm
  // reports ready.
  var HEALTH_TIMEOUT_MS = 4000;
  var WARM_POLL_MS = 5000;
  var WARM_MAX_WAIT_MS = 120000;

  var state = {
    available: false,
    checked: false,
    warming: false,
    health: null,
  };

  function supported() {
    return typeof fetch === 'function' && typeof FormData === 'function';
  }

  // --- pure helpers (tested in Node) ------------------------------------

  // Builds the reference-audio URL. Exported mainly so the test can assert
  // the query is encoded correctly -- a kana reading in a URL is exactly the
  // sort of thing that silently breaks when concatenated by hand.
  function referenceUrl(word, styleId, speed) {
    var params = referenceParams(word, styleId, speed);
    return params ? BASE + '/reference?' + params.toString() : null;
  }

  // The same reference as JSON: per-mora timing, devoicing and the pitch the
  // engine rendered. The karaoke draws its bars and paces its lyric line from
  // this, so it must be built from exactly the parameters the audio and the
  // attempt use -- speed included, since every boundary moves with it.
  function referenceDetailUrl(word, styleId, speed) {
    var params = referenceParams(word, styleId, speed);
    return params ? BASE + '/reference/detail?' + params.toString() : null;
  }

  // The speech rate goes on the wire only when it is not the default. That
  // keeps every 1.0x URL byte-identical to what it was before speed existed,
  // so references already in the HTTP cache stay valid.
  function speedParam(speed) {
    var value = Number(speed);
    if (!isFinite(value) || value <= 0 || Math.abs(value - 1) < 1e-6) return null;
    return String(Math.round(value * 100) / 100);
  }

  function referenceParams(word, styleId, speed) {
    if (!word || !word.reading || !styleId) return null;
    var params = new URLSearchParams({
      reading: word.reading,
      accentNum: String(word.accentNum),
      styleId: String(styleId),
      // Without this the server would frame the word with the noun suffix
      // while the prompt showed the verb one.
      pos: word.pos || DEFAULT_POS,
    });
    // The response is cached hard for a day, so the engine version has to be
    // part of the URL. Otherwise a deploy that changes VOICEVOX leaves the
    // learner hearing a stale reference while /api/attempt scores them
    // against the new one, for the same parameters.
    var version = state.health && state.health.voicevox && state.health.voicevox.version;
    if (version) params.set('v', version);
    // The frame text itself, for the same reason. `pos` alone does not pin
    // what is synthesized: when the verb frame changed from から to こと, the
    // URL stayed identical, and browsers kept playing the cached
    // 「つくるから」 for a day while the screen asked for 「つくること」 and the
    // server scored against it. The server ignores this parameter; it only
    // makes the URL change whenever the spoken sentence does.
    params.set('frame', frameFor(word.pos));
    var rate = speedParam(speed);
    if (rate) params.set('speed', rate);
    return params;
  }

  // The carrier frames, keyed by the `pos` field data/words.json carries.
  // Must match server/accent.py's FRAMES, or the learner is prompted to say
  // one sentence while the reference says another.
  //
  // Duplicated rather than fetched because the UI needs the prompt before any
  // request has been made -- and because the whole sentence is what the
  // learner is asked to say, not the bare word.
  var FRAMES = { verb: 'こと', prenominal: 'こと', other: 'です' };
  var DEFAULT_POS = 'other';

  function frameFor(pos) {
    return FRAMES[pos] || FRAMES[DEFAULT_POS];
  }

  // The sentence to show and to say. Every word gets one: the mora after the
  // word is what separates heiban from odaka, and what gives an accent whose
  // drop lands on a devoiced mora somewhere measurable to fall. Verbs need
  // their own frame because 〜です after a dictionary-form verb is not
  // Japanese.
  function carrierText(word) {
    if (!word || !word.reading) return '';
    return word.reading + frameFor(word.pos);
  }

  // The coach is only offered when the server says the TTS engine is up.
  // Everything else it does (scoring, feedback) depends on having a
  // reference to compare against, so engine-down means coach-off rather
  // than a degraded half-coach.
  function isAvailable(health) {
    return !!(health && health.coach_available);
  }

  // Picks a default voice for a learner's declared gender, preferring a
  // matching one. Matching matters acoustically, not cosmetically: a large
  // F0 gap between learner and reference degrades the spectral alignment.
  function pickVoice(voices, gender) {
    if (!voices || !voices.length) return null;
    var match = voices.filter(function (v) { return v.gender === gender; })[0];
    return (match || voices[0]).styleId;
  }

  // Turns a server verdict into the short line shown under the diagrams.
  // Kept pure and separate from the DOM so the wording is testable.
  function summaryFor(verdict, lang) {
    if (!verdict) return '';
    return (lang === 'ja' ? verdict.summary_ja : verdict.summary_en) || '';
  }

  // --- network ----------------------------------------------------------

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(
        function (value) { clearTimeout(timer); resolve(value); },
        function (err) { clearTimeout(timer); reject(err); }
      );
    });
  }

  // Probes once at startup. Never throws: an absent API is the normal case
  // on GitHub Pages, not an error worth surfacing to a learner.
  function probe() {
    if (!supported()) {
      state.checked = true;
      return Promise.resolve(false);
    }
    return withTimeout(fetch(BASE + '/health', { cache: 'no-store' }), HEALTH_TIMEOUT_MS)
      .then(function (response) {
        if (!response.ok) throw new Error('health ' + response.status);
        return response.json();
      })
      .then(function (health) {
        state.health = health;
        state.available = isAvailable(health);
        state.checked = true;
        return state.available;
      })
      .catch(function () {
        state.checked = true;
        state.available = false;
        return false;
      });
  }

  // Polls /warm while a sleeping Space wakes up. Resolves true once the
  // engine answers, false if it never does within the budget.
  function waitUntilWarm(onProgress) {
    if (!supported()) return Promise.resolve(false);
    state.warming = true;
    var deadline = Date.now() + WARM_MAX_WAIT_MS;

    function attempt() {
      return fetch(BASE + '/warm', { cache: 'no-store' })
        .then(function (response) {
          if (response.ok) return true;
          // The server distinguishes "still loading" from "gave up". Only
          // the first is worth waiting on -- polling a server that has
          // already reported no engine just burns two minutes and then
          // reaches the same conclusion.
          //
          // A body that is not JSON is not this endpoint at all: a static
          // host's 404 page, or a proxy's error page. Treating that as
          // "starting" made a purely static deployment poll every five
          // seconds for the full two-minute budget, waiting for an API that
          // does not exist. The real endpoint always answers JSON.
          return response.json().then(
            function (payload) { return payload && payload.starting === true; },
            function () { return false; }
          ).then(function (stillStarting) {
            if (!stillStarting || Date.now() > deadline) return false;
            if (onProgress) onProgress();
            return new Promise(function (resolve) {
              setTimeout(function () { resolve(attempt()); }, WARM_POLL_MS);
            });
          });
        })
        .catch(function () { return false; });
    }

    return attempt().then(function (ready) {
      state.warming = false;
      if (ready) return probe();
      return false;
    });
  }

  function voices() {
    return fetch(BASE + '/voices')
      .then(function (response) {
        if (!response.ok) throw new Error('voices ' + response.status);
        return response.json();
      })
      .then(function (payload) { return payload.voices || []; });
  }

  // Submits a recording or an uploaded file for scoring. `audio` is any Blob
  // or File -- the server decodes whatever the browser recorded (WebM/Opus in
  // Chrome, Ogg in Firefox) as well as whatever a learner uploads.
  //
  // `extra` is optional: { speed, karaokeLeadInS, karaokeToleranceS }. The
  // speed must match the reference the learner heard, or the server aligns
  // them against a reference at a different tempo. The two karaoke fields go
  // together or not at all (the server rejects one without the other).
  function submitAttempt(word, audio, styleId, filename, extra) {
    extra = extra || {};
    if (!supported()) return Promise.reject(new Error('coach unavailable'));
    if (!styleId) return Promise.reject(new Error('no reference voice selected'));

    var form = new FormData();
    form.append('audio', audio, filename || 'attempt.webm');
    form.append('word', word.word);
    form.append('reading', word.reading);
    form.append('accentNum', String(word.accentNum));
    // Omitted rather than sent as 0: the server resolves a real Nemo style
    // for a missing value, but 0 is not a speaker any version of Nemo has.
    if (styleId) form.append('styleId', String(styleId));
    form.append('pos', word.pos || DEFAULT_POS);
    var rate = speedParam(extra.speed);
    if (rate) form.append('speed', rate);
    // The learner's own voice type: which voices the pitch range is built
    // from. The style above is only the voice they heard.
    if (extra.learnerGender === 'male' || extra.learnerGender === 'female') {
      form.append('learnerGender', extra.learnerGender);
    }
    if (isFinite(extra.karaokeLeadInS) && isFinite(extra.karaokeToleranceS)) {
      form.append('karaokeLeadInS', String(Math.round(extra.karaokeLeadInS * 1000) / 1000));
      form.append('karaokeToleranceS', String(Math.round(extra.karaokeToleranceS * 1000) / 1000));
    }

    return fetch(BASE + '/attempt', { method: 'POST', body: form })
      .then(function (response) {
        if (response.ok) return response.json();
        return response.json().then(
          function (payload) {
            throw new Error(payload && payload.detail ? payload.detail : 'attempt ' + response.status);
          },
          function () { throw new Error('attempt ' + response.status); }
        );
      });
  }

  function referenceDetail(word, styleId, speed) {
    var url = referenceDetailUrl(word, styleId, speed);
    if (!url || !supported()) return Promise.reject(new Error('no reference'));
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('reference ' + response.status);
      return response.json();
    });
  }

  // Per-mora levels in the shape js/pitch-diagram.js already renders, so the
  // server's result can reuse the existing diagram rather than introducing a
  // second way of drawing the same thing.
  function levelsFrom(evidence) {
    if (!evidence || !evidence.moras) return [];
    return evidence.moras.map(function (mora) { return mora.level; });
  }

  return {
    supported: supported,
    probe: probe,
    waitUntilWarm: waitUntilWarm,
    voices: voices,
    submitAttempt: submitAttempt,
    referenceUrl: referenceUrl,
    referenceDetailUrl: referenceDetailUrl,
    referenceDetail: referenceDetail,
    speedParam: speedParam,
    isAvailable: isAvailable,
    pickVoice: pickVoice,
    summaryFor: summaryFor,
    levelsFrom: levelsFrom,
    carrierText: carrierText,
    frameFor: frameFor,
    FRAMES: FRAMES,
    state: state,
  };
});
