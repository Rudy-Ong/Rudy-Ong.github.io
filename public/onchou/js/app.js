// app.js -- orchestrator wiring data/words.json + PitchDiagram + PitchDetect +
// MoraSegment + ReferenceAudio into the word-card UI described in the design
// spec's "UI flow" section. Owns DOM/state; every other js/*.js module is a
// pure or thin-wrapper dependency loaded before this file.
(function () {
  'use strict';

  var els = {
    unsupportedNotice: document.getElementById('unsupported-notice'),
    unsupportedNoticeText: document.getElementById('unsupported-notice-text'),
    quiz: document.getElementById('quiz'),
    wordText: document.getElementById('word-text'),
    wordReading: document.getElementById('word-reading'),
    targetDiagram: document.getElementById('target-diagram'),
    playBtn: document.getElementById('play-btn'),
    playBtnNote: document.getElementById('play-btn-note'),
    learnerDiagramRow: document.getElementById('learner-diagram-row'),
    learnerDiagram: document.getElementById('learner-diagram'),
    playbackRow: document.getElementById('playback-row'),
    compareBtn: document.getElementById('compare-btn'),
    playAttemptBtn: document.getElementById('play-attempt-btn'),
    playbackNote: document.getElementById('playback-note'),
    contourRow: document.getElementById('contour-row'),
    contourGraph: document.getElementById('contour-graph'),
    moraFeedback: document.getElementById('mora-feedback'),
    scoreText: document.getElementById('score-text'),
    detectMessage: document.getElementById('detect-message'),
    micMessage: document.getElementById('mic-message'),
    recIndicator: document.getElementById('rec-indicator'),
    recordBtn: document.getElementById('record-btn'),
    retryBtn: document.getElementById('retry-btn'),
    nextBtn: document.getElementById('next-btn'),
    btnSettings: document.getElementById('btn-settings'),
    btnSettingsClose: document.getElementById('btn-settings-close'),
    settingsOverlay: document.getElementById('settings-overlay'),
    settingsPanel: document.getElementById('settings-panel'),
    settingAutoPlay: document.getElementById('setting-auto-play'),
    settingShowContour: document.getElementById('setting-show-contour'),
    coachRow: document.getElementById('coach-row'),
    coachSentenceHint: document.getElementById('coach-sentence-hint'),
    coachStatus: document.getElementById('coach-status'),
    coachSummary: document.getElementById('coach-summary'),
    coachNotes: document.getElementById('coach-notes'),
    uploadRow: document.getElementById('upload-row'),
    uploadInput: document.getElementById('upload-input'),
    uploadName: document.getElementById('upload-name'),
    settingCoachRow: document.getElementById('setting-coach-row'),
    settingCoach: document.getElementById('setting-coach'),
    settingVoiceRow: document.getElementById('setting-voice-row'),
    settingVoice: document.getElementById('setting-voice'),
    settingKaraokeRow: document.getElementById('setting-karaoke-row'),
    settingKaraoke: document.getElementById('setting-karaoke'),
    settingRateRow: document.getElementById('setting-rate-row'),
    settingRate: document.getElementById('setting-rate'),
    karaokePanel: document.getElementById('karaoke-panel'),
    settingLevelButtons: Array.prototype.slice.call(
      document.querySelectorAll('#setting-level .segmented-btn')
    ),
    installButton: document.getElementById('btn-install'),
    installHint: document.getElementById('settings-install-hint'),
    sidePanel: document.getElementById('side-panel'),
    quickVoiceButtons: document.querySelectorAll('#side-panel [data-quick]'),
    devoicingButtons: document.querySelectorAll('#side-panel [data-focus]'),
    devoicingStatus: document.getElementById('devoicing-status'),
  };

  var words = [];
  var currentWord = null;
  var isRecording = false;
  // recordingActive covers the FULL span from clicking Record until
  // handleTrace() finishes processing -- including the async window where
  // startRecording()'s promise is still pending on the mic-permission
  // prompt, which isRecording (only set true once that promise resolves)
  // does not cover. Next/Play are disabled for this whole span so a word
  // switch can never happen mid-recording; recordingWord snapshots which
  // word the in-flight recording actually belongs to, so a race that still
  // somehow got through can't score a trace against the wrong word.
  var recordingActive = false;
  var recordingWord = null;
  // True if the tab was hidden at any point during the recording span.
  // Chrome (and other browsers) throttle setInterval to ~1Hz in a hidden
  // tab, so pitch-detect.js's 20ms polling collapses to ~1 frame/second
  // there: the trace still segments and scores, but off 2-3 frames instead
  // of ~150, which is noise dressed up as a result. Scoring that silently
  // would teach the learner the wrong thing about their own pronunciation,
  // so handleTrace() reports it instead. See pitch-detect.js's header.
  var recordingWasHidden = false;
  // Set once (permanently) when no Japanese voice exists on this device at
  // all -- distinguishes that permanent condition from a transient per-click
  // playback failure, both of which write to els.playBtnNote (see
  // disablePlayButton and the Play click handler's .catch).
  var playPermanentlyUnavailable = false;

  // Playback of the learner's own take. `attemptSeq` is bumped for every
  // recording started; PitchDetect's onAudio callback carries the sequence
  // number its recording began with, so a Blob that arrives after the
  // learner has already hit Retry or Next (MediaRecorder flushes
  // asynchronously, so this ordering is normal, not exotic) is discarded
  // instead of being offered as playback of the attempt now on screen.
  // Coach state. All of it stays inert when no backend answered the probe,
  // which is the normal case for the GitHub Pages deployment.
  var coachVoices = [];
  // Null until /api/voices resolves a real style. Nemo's talk styles start at
  // 10000, so the old default of 0 was never a valid speaker -- sending it
  // produced a synthesis failure rather than a voice. `coachActive()` gates
  // on this, so nothing can be submitted before a usable voice is known.
  var coachStyleId = null;
  var coachReferenceAudio = null;
  // The word a pending analysis belongs to. Separate from `recordingWord`
  // because that is cleared in handleTrace, and the audio Blob arrives
  // *after* the trace -- MediaRecorder flushes asynchronously -- so by the
  // time there is anything to submit, recordingWord is already null.
  var coachWord = null;

  // The live karaoke take, or null. Holds its timeline, scorer, view and
  // animation frame; see startKaraokeFlow.
  var karaokeSession = null;
  // What the take with sequence `seq` was recorded under: the speech rate,
  // and for a karaoke take where in the recording speech was cued. Read when
  // the audio Blob arrives (after the trace), so it cannot live on the
  // karaoke session alone -- Retry may already have cleared that.
  var attemptContext = null;

  // True once data/refs/manifest.json loaded: the pre-generated VOICEVOX
  // references (tools/build-references.py) are on this host, so the natural
  // voice, the karaoke and the same-gender range work with no server.
  var staticRefsReady = false;
  // The devoicing shortcut in force ('2', '3', '4', '5+'), or null. Kept for
  // the session only: it is a practice drill, not a preference.
  var devoicingFocus = null;

  var attemptSeq = 0;
  var attemptAudioUrl = null;
  var attemptAudio = null;
  var comparing = false;

  // Selection is delegated to js/word-select.js: the learner's chosen level
  // caps word length, and the pick is balanced across whichever accent
  // patterns that level makes available (heiban otherwise dominates the
  // pool -- see that module's header and the learning-progression design
  // spec).
  function pickNextWord() {
    if (devoicingFocus) {
      var pool = devoicingPool(devoicingFocus);
      if (pool.length) return WordSelect.pickWord(pool, 'all');
    }
    return WordSelect.pickWord(words, SettingsManager.get('level'));
  }

  // The learner's own voice type, which decides which reference voices the
  // pitch range is built from, and the voice they hear. Independent: a man
  // may practise against a female model and is still judged against how men
  // say the word.
  function learnerGender() {
    return SettingsManager.get('learnerGender') === 'male' ? 'male' : 'female';
  }

  function voiceGender() {
    return SettingsManager.get('voiceGender') === 'male' ? 'male' : 'female';
  }

  // The pre-generated references are in use. They are what the karaoke
  // reads, so turning karaoke off returns to the original bare-word mode
  // with the browser voice -- unless a live coach is on.
  function staticRefsActive() {
    return staticRefsReady && SettingsManager.get('karaoke') !== false;
  }

  // The learner practises the whole carrier sentence (さくらです), against a
  // VOICEVOX reference, rather than the bare word.
  function sentenceMode() {
    return staticRefsActive() || coachActive();
  }

  function moraBucket(word) {
    var n = moraCountFor(word);
    return n >= 5 ? '5+' : String(n);
  }

  function devoicingPool(bucket) {
    if (!staticRefsReady) return [];
    return words.filter(function (w) {
      return StaticRefs.hasDevoicing(w) && moraBucket(w) === bucket;
    });
  }

  function moraCountFor(word) {
    return PitchDiagram.moraSplit(word.reading).length;
  }

  function targetLevelsFor(word) {
    return PitchDiagram.pitchLevels(moraCountFor(word), word.accentNum);
  }

  // Resets everything that reflects a previous recording attempt, without
  // touching which word is loaded -- used both when loading a brand-new
  // word and before a Retry re-recording.
  function resetAttemptUI() {
    releaseAttemptAudio();
    els.learnerDiagramRow.hidden = true;
    els.learnerDiagram.innerHTML = '';
    els.contourRow.hidden = true;
    els.contourGraph.innerHTML = '';
    els.moraFeedback.hidden = true;
    els.moraFeedback.innerHTML = '';
    els.scoreText.hidden = true;
    els.scoreText.textContent = '';
    els.detectMessage.hidden = true;
    els.micMessage.hidden = true;
    els.retryBtn.hidden = true;
    els.recordBtn.hidden = false;
    els.recordBtn.disabled = false;
    els.recordBtn.textContent = 'Record';
    clearCoachFeedback();
    els.coachRow.hidden = true;
    teardownKaraoke();
    // Only clear a TRANSIENT play-error note here -- a PERMANENT
    // "no Japanese voice on this device" note (see disablePlayButton) must
    // survive a word change, since that condition doesn't change per word
    // and the button stays disabled for the whole session; blindly clearing
    // playBtnNote on every word/retry would erase that explanation while
    // leaving the button visibly disabled with no reason shown.
    if (!playPermanentlyUnavailable) {
      els.playBtnNote.hidden = true;
      els.playBtnNote.textContent = '';
    }
  }

  function renderWord(word) {
    // A reference utterance for the PREVIOUS word may still be speaking (or
    // queued): speechSynthesis has its own queue, so without this the old
    // word is spoken over the new one, or after it.
    ReferenceAudio.cancel();
    // The VOICEVOX reference plays through an <audio> element, which
    // speechSynthesis.cancel() knows nothing about.
    cancelCoachReference();
    currentWord = word;
    els.wordText.textContent = word.word;
    renderReading(word);
    renderTargetDiagram();
    resetAttemptUI();
    updateSentenceHint();
    if (SettingsManager.get('autoPlayReference')) playReference();
  }

  // The reading, with each mora the reference devoices marked: those vowels
  // are whispered, so the learner can see which ones before they hear them.
  function renderReading(word) {
    var devoiced = staticRefsReady ? StaticRefs.devoicedIndices(word) : null;
    if (!devoiced || !devoiced.length) {
      els.wordReading.textContent = word.reading;
      els.wordReading.removeAttribute('title');
      return;
    }
    els.wordReading.textContent = '';
    PitchDiagram.moraSplit(word.reading).forEach(function (kana, i) {
      var span = document.createElement('span');
      span.textContent = kana;
      if (devoiced.indexOf(i) !== -1) {
        span.className = 'devoiced-kana';
        span.title = '無声化 devoiced: whisper this vowel';
      }
      els.wordReading.appendChild(span);
    });
    els.wordReading.title = '点線の拍は無声化 / dotted morae are devoiced';
  }

  // The target diagram. In coach mode the learner says a whole carrier
  // sentence (さくらです), so the diagram shows all of it with kana under each
  // dot: the word solid, the mora after it as the hollow dot (judged, since
  // it is what separates heiban from odaka, but not counted), and the rest of
  // the frame faded and dashed (never judged). Without the coach it stays the
  // word-plus-hollow-dot diagram it has always been.
  function renderTargetDiagram() {
    var word = currentWord;
    if (!word) return;
    var levels = targetLevelsFor(word);
    if (!sentenceMode()) {
      els.targetDiagram.innerHTML = PitchDiagram.renderSVG(levels, { variant: 'target' });
      return;
    }
    var frame = PitchDiagram.moraSplit(Coach.frameFor(word.pos));
    // After the word, the frame keeps the trailing level: a heiban word
    // never falls (the engine renders it that way, nucleus past the whole
    // phrase), and an accented one has already fallen.
    var trailing = levels[levels.length - 1];
    var full = levels.concat(frame.slice(1).map(function () { return trailing; }));
    els.targetDiagram.innerHTML = PitchDiagram.renderSVG(full, {
      variant: 'target',
      context: frame.length - 1,
      kana: PitchDiagram.moraSplit(word.reading).concat(frame),
      label: Coach.carrierText(word) + ' ' + full.join(''),
    });
  }

  function nextWord() {
    var word = pickNextWord();
    if (word) {
      renderWord(word);
      return;
    }
    // No word survived the level filter. Can't happen with the shipped
    // data/words.json (the narrowest level, "2", still has 291 words), but
    // silently doing nothing on a "Next word" tap would be a dead-end with
    // no explanation if that ever changed -- say so instead.
    els.detectMessage.hidden = false;
    els.detectMessage.textContent = 'No words available at this practice level -- widen it in Settings.';
  }

  // ---- Reference audio ("▶ Play") ----

  function setupReferenceAudio() {
    if (!ReferenceAudio.supported()) {
      disablePlayButton('speechSynthesis is not supported in this browser.');
      return;
    }
    ReferenceAudio.readyVoices().then(function () {
      if (!ReferenceAudio.hasJapaneseVoice()) {
        disablePlayButton('No Japanese voice found on this device/browser.');
      }
    });
    els.playBtn.addEventListener('click', function () {
      playReference();
    });
  }

  // Speaks the current word's reading -- shared by the "▶ Play" button and,
  // when the auto-play setting is on, renderWord()'s new-word path. Snapshots
  // `reading` synchronously at call time rather than re-reading
  // currentWord.reading once readyVoices() resolves: readyVoices() can take
  // up to VOICES_TIMEOUT_MS on a browser's first use (the voice list loads
  // asynchronously), and without a snapshot a word change during that wait
  // could end up speaking the wrong word.
  function playReference() {
    if (!currentWord) return;
    var reading = currentWord.reading;

    // Prefer the VOICEVOX reference when a backend is available: it is a
    // natural voice and, unlike a browser voice, it is guaranteed to be
    // saying the accent the learner is actually being scored against. The
    // shared helper also handles falling back to speechSynthesis.
    if (sentenceMode()) {
      playReferenceLeg(currentWord)
        .catch(function () { /* both routes gone; the note below covers it */ });
      return;
    }

    ReferenceAudio.readyVoices().then(function () {
      return ReferenceAudio.speak(reading);
    }).catch(function (err) {
      els.playBtnNote.hidden = false;
      els.playBtnNote.textContent = (err && err.message) || 'Could not play reference audio.';
    });
  }

  // ---- Coach (optional server-side analysis) ----

  // True only when a backend answered AND the learner opted in. Both halves
  // matter: the settings toggle is meaningless without a backend, and a
  // reachable backend must not start receiving someone's voice because it
  // happens to exist.
  function coachActive() {
    return !!(typeof Coach !== 'undefined' && Coach.state.available
      && coachStyleId
      && SettingsManager.get('coachEnabled'));
  }

  // Probes once at boot. Everything it touches stays hidden on failure, so a
  // static deployment simply never learns the coach exists.
  function setupCoach() {
    if (typeof Coach === 'undefined' || !Coach.supported()) return;
    Coach.probe().then(function (available) {
      if (available) return true;
      // A sleeping Space takes 30-60s to resume and the first probe will
      // have given up long before then. Keep polling /warm in the
      // background so the coach appears once it is genuinely up, rather
      // than staying hidden until the learner happens to reload.
      var health = Coach.state.health;
      var worthWaiting = !health || (health.voicevox && health.voicevox.starting);
      if (!worthWaiting) return false;
      // Without a progress callback the cold start was completely silent for
      // the 30-60 seconds a sleeping Space takes to resume, even though the
      // deployment docs promise a waking state.
      showCoachStatus('Waking the pronunciation coach… this takes up to a minute.');
      return Coach.waitUntilWarm(function () {
        showCoachStatus('Still waking the pronunciation coach…');
      });
    }).then(function (available) {
      if (!available) {
        clearCoachFeedback();
        els.coachRow.hidden = true;
        return;
      }
      // The voice must resolve before the coach is offered: without a real
      // style id every request would carry an invalid speaker.
      return Coach.voices().then(function (voices) {
        coachVoices = voices;
        coachStyleId = Coach.pickVoice(voices, SettingsManager.get('voiceGender'));
        if (!coachStyleId) return;
        els.settingVoiceRow.hidden = voices.length === 0;
        els.settingCoachRow.hidden = false;
        els.settingCoach.checked = SettingsManager.get('coachEnabled') === true;
        // Both depend on the VOICEVOX reference, so they appear with it.
        els.settingKaraokeRow.hidden = false;
        els.settingKaraoke.checked = SettingsManager.get('karaoke') !== false;
        els.settingRateRow.hidden = false;
        syncRateButtons();
        clearCoachFeedback();
        els.coachRow.hidden = true;
        applyCoachVisibility();
      });
    }).catch(function () {
      // An absent backend is the normal case on GitHub Pages, and a failed
      // voice lookup leaves the coach off rather than half-enabled.
      clearCoachFeedback();
      els.coachRow.hidden = true;
    });
  }

  // Reveals the parts of the UI that only work with a backend.
  function applyCoachVisibility() {
    var on = coachActive();
    els.uploadRow.hidden = !on;
    if (!on) {
      clearCoachFeedback();
      els.coachRow.hidden = true;
    }
    updateSentenceHint();
    renderTargetDiagram();
  }

  // Shows the sentence to say. Every word is practised inside a carrier
  // frame, not on its own: the mora right after the word is what separates
  // heiban from odaka, and what gives an accent whose drop lands on a
  // devoiced mora somewhere to land. Saying the bare word would produce
  // fewer morae than the reference and misalign everything after.
  function updateSentenceHint() {
    if (!els.coachSentenceHint) return;
    var show = !!(currentWord && sentenceMode());
    els.coachSentenceHint.hidden = !show;
    if (!show) {
      els.coachSentenceHint.textContent = '';
      return;
    }
    els.coachSentenceHint.textContent =
      '「' + Coach.carrierText(currentWord) + '」と文で言ってください'
      + ' / say the whole sentence';
  }

  function clearCoachFeedback() {
    els.coachStatus.hidden = true;
    els.coachStatus.textContent = '';
    els.coachSummary.hidden = true;
    els.coachSummary.textContent = '';
    els.coachNotes.hidden = true;
    els.coachNotes.innerHTML = '';
    els.uploadName.textContent = '';
  }

  function showCoachStatus(text) {
    els.coachRow.hidden = false;
    els.coachStatus.hidden = false;
    els.coachStatus.textContent = text;
  }

  // Sends one take (recorded or uploaded) for analysis. `seq` guards against
  // a late response being shown against a word the learner already moved on
  // from -- the same attemptSeq guard the audio Blob path already uses.
  function submitToCoach(blob, word, seq, filename) {
    if (!coachActive() || !blob || !word) return;
    showCoachStatus('Analysing your pronunciation…');

    // The reference this take was made against: same speed, and for a
    // karaoke take, the cue position so the server can judge timing.
    var extra = (attemptContext && attemptContext.seq === seq)
      ? attemptContext
      : { speed: currentSpeed() };
    extra = Object.assign({}, extra, { learnerGender: learnerGender() });

    Coach.submitAttempt(word, blob, coachStyleId, filename, extra)
      .then(function (response) {
        if (seq !== attemptSeq) return;
        renderCoachResult(response);
      })
      .catch(function (err) {
        if (seq !== attemptSeq) return;
        // A sleeping Space answers nothing until it wakes, so say that
        // rather than reporting a failure the learner cannot act on.
        showCoachStatus(
          'Detailed feedback is unavailable right now. Your attempt was still '
          + 'scored on-device. (' + ((err && err.message) || 'no response') + ')'
        );
      });
  }

  function renderCoachResult(response) {
    var evidence = response && response.evidence;
    var verdict = response && response.verdict;
    if (!evidence || !verdict) return;

    els.coachRow.hidden = false;
    els.coachStatus.hidden = true;

    // The server's alignment is better informed than the client's
    // equal-time-slot split, so its per-mora levels replace the local ones
    // in the learner diagram -- but only when the server trusted its own
    // alignment. A low-confidence result keeps the local diagram rather than
    // redrawing it from numbers the server itself would not stand behind.
    if (evidence.alignment && evidence.alignment.confidence === 'high') {
      var levels = Coach.levelsFrom(evidence);
      if (levels.length) {
        els.learnerDiagramRow.hidden = false;
        els.learnerDiagram.innerHTML =
          PitchDiagram.renderSVG(levels, { variant: 'learner', trailing: false });
      }
    }

    els.coachSummary.hidden = false;
    els.coachSummary.textContent = Coach.summaryFor(verdict, 'ja');

    var notes = verdict.mora_notes || [];
    els.coachNotes.innerHTML = '';
    if (notes.length) {
      notes.forEach(function (note) {
        var item = document.createElement('li');
        var label = evidence.moras[note.index] ? evidence.moras[note.index].kana : '';
        item.textContent = (label ? label + ' — ' : '') + note.advice;
        els.coachNotes.appendChild(item);
      });
      els.coachNotes.hidden = false;
    } else {
      els.coachNotes.hidden = true;
    }

    // What the recogniser heard, when it ran. Shown as kana rather than
    // phonemes because that is what a learner can read, and only when it
    // differs from the target -- confirming a correct attempt back to them
    // adds noise rather than information.
    if (evidence.asr && evidence.asr.kana && !evidence.asr.matches_expected) {
      var heard = document.createElement('li');
      heard.className = 'coach-note-heard';
      heard.textContent = '聞こえた音: ' + evidence.asr.kana
        + ' / heard: ' + evidence.asr.kana;
      els.coachNotes.appendChild(heard);
      els.coachNotes.hidden = false;
    }

    var english = Coach.summaryFor(verdict, 'en');
    if (english) {
      var item = document.createElement('li');
      item.className = 'coach-note-en';
      item.textContent = english;
      els.coachNotes.appendChild(item);
      els.coachNotes.hidden = false;
    }
  }

  // Plays the VOICEVOX reference instead of the browser voice. Falls back by
  // rejecting, so the caller can hand off to ReferenceAudio unchanged.
  function playCoachReference(word) {
    var url = Coach.referenceUrl(word, coachStyleId, currentSpeed());
    if (!url) return Promise.reject(new Error('no reference url'));

    if (!coachReferenceAudio) {
      coachReferenceAudio = new Audio();
      coachReferenceAudio.preload = 'auto';
    }
    coachReferenceAudio.src = url;
    return coachReferenceAudio.play();
  }

  // The pre-generated reference, in the voice the learner picked. Rendered at
  // 1.0x only: other speeds are the same clip at a pitch-preserving
  // playbackRate, which the karaoke timeline is scaled to match.
  function playStaticReference(word) {
    if (!coachReferenceAudio) {
      coachReferenceAudio = new Audio();
      coachReferenceAudio.preload = 'auto';
    }
    var audio = coachReferenceAudio;
    audio.src = StaticRefs.audioUrl(word, voiceGender());
    var rate = currentSpeed();
    // Loading a new src resets playbackRate to defaultPlaybackRate, so both.
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
    return audio.play();
  }

  function cancelCoachReference() {
    if (!coachReferenceAudio) return;
    try {
      coachReferenceAudio.pause();
      coachReferenceAudio.currentTime = 0;
    } catch (e) { /* ignore */ }
  }

  // Plays whichever reference is authoritative right now, and cancels
  // whichever might still be playing. Both Play and Compare route through
  // these, so there is one path rather than three.
  //
  // Compare in particular has to: its whole point is hearing the reference
  // and the attempt back to back, and in coach mode the attempt was scored
  // against the VOICEVOX carrier sentence. Speaking the bare reading through
  // the browser voice instead would compare against audio that was never
  // involved, and could overlap a coach clip still playing.
  function playReferenceLeg(word) {
    if (staticRefsActive()) {
      return playStaticReference(word).catch(function () {
        return ReferenceAudio.readyVoices().then(function () {
          return ReferenceAudio.speak(word.reading);
        });
      });
    }
    if (coachActive()) {
      return playCoachReference(word).catch(function () {
        // A failed coach clip falls back rather than aborting the compare.
        return ReferenceAudio.readyVoices().then(function () {
          return ReferenceAudio.speak(word.reading);
        });
      });
    }
    return ReferenceAudio.readyVoices().then(function () {
      return ReferenceAudio.speak(word.reading);
    });
  }

  function cancelAnyReference() {
    ReferenceAudio.cancel();
    cancelCoachReference();
  }

  function disablePlayButton(noteText) {
    playPermanentlyUnavailable = true;
    els.playBtn.disabled = true;
    els.playBtn.classList.add('disabled');
    els.playBtnNote.hidden = false;
    els.playBtnNote.textContent = noteText;
  }

  // ---- Playback of the learner's own attempt ----

  // One reused <audio> element rather than one per take: a fresh element per
  // attempt would leak both the element and (on some browsers) its decoder
  // until GC, and reusing it keeps any user-set volume across attempts.
  function attemptAudioEl() {
    if (!attemptAudio) {
      attemptAudio = new Audio();
      attemptAudio.preload = 'auto';
    }
    return attemptAudio;
  }

  // Drops whatever recording is currently held. Must run on every path that
  // ends an attempt (new word, Retry, a fresh Record) -- an object URL is a
  // reference the browser keeps the whole Blob alive for until it's revoked,
  // so not revoking here would retain every take of the session.
  function releaseAttemptAudio() {
    comparing = false;
    // Invalidate any recording still being flushed for the attempt being
    // dropped: Retry doesn't start a new recording (so nothing else bumps
    // the sequence), and a Blob landing a moment later would otherwise be
    // offered as playback of an attempt that has just been cleared.
    attemptSeq++;
    if (attemptAudio) {
      try { attemptAudio.pause(); } catch (e) { /* ignore */ }
      attemptAudio.removeAttribute('src');
      // Detach the old media resource properly -- without load(), the
      // element keeps the previous src's decoded state, and the revoked
      // object URL below can resurface as a stale 'error' on the next play.
      try { attemptAudio.load(); } catch (e) { /* ignore */ }
    }
    if (attemptAudioUrl) {
      URL.revokeObjectURL(attemptAudioUrl);
      attemptAudioUrl = null;
    }
    els.playbackRow.hidden = true;
    els.playbackNote.hidden = true;
    els.playbackNote.textContent = '';
    setPlaybackButtonsDisabled(false);
  }

  // Playback can fail two very different ways, and telling them apart is the
  // difference between "tap again" and "this take is unusable": the browser's
  // autoplay policy rejects with NotAllowedError when play() wasn't reached
  // from a user gesture (which is what happens to the second leg of Compare
  // on stricter settings, since it starts after the reference finishes
  // speaking), whereas a decode/network failure means the recording itself
  // is no good.
  function playbackErrorText(err) {
    if (err && err.name === 'NotAllowedError') {
      return 'Your browser blocked playback -- tap "▶ Your voice" to hear your attempt.';
    }
    return 'Could not play the recording.';
  }

  function showPlaybackNote(err) {
    els.playbackNote.hidden = false;
    els.playbackNote.textContent = playbackErrorText(err);
  }

  function setPlaybackButtonsDisabled(disabled) {
    els.compareBtn.disabled = disabled;
    els.playAttemptBtn.disabled = disabled;
  }

  // Called by PitchDetect once the take has been flushed. `seq` is the
  // attempt this Blob belongs to (see attemptSeq above).
  function receiveAttemptAudio(blob, seq) {
    if (seq !== attemptSeq || !blob) return;
    attemptAudioUrl = URL.createObjectURL(blob);
    attemptAudioEl().src = attemptAudioUrl;
    els.playbackRow.hidden = false;
    // The same Blob the learner can play back is the one that gets scored,
    // so what the coach analysed is exactly what they can hear.
    submitToCoach(blob, coachWord || currentWord, seq, 'attempt.webm');
  }

  // Upper bound on how long a playback is allowed to be considered "still
  // going". Recording itself is capped at PitchDetect's MAX_DURATION_MS (3s),
  // so a take can never legitimately outlast this -- and media events are not
  // dependable enough to wait on unconditionally: on a machine with no
  // working audio output, play() never settles and neither 'playing' nor
  // 'ended' ever fires (verified in-browser), which would otherwise leave
  // Compare's buttons disabled forever with no error shown.
  var ATTEMPT_PLAY_CAP_MS = 5000;

  // Plays the held recording, resolving when it finishes (or rejecting if
  // the browser refuses to play it -- notably an autoplay block on the
  // second leg of Compare, which starts outside the original click gesture).
  // Also resolves, rather than hanging, once ATTEMPT_PLAY_CAP_MS has passed.
  function playAttempt() {
    if (!attemptAudioUrl) return Promise.reject(new Error('No recording to play.'));
    var audio = attemptAudioEl();
    return new Promise(function (resolve, reject) {
      var settled = false;
      var capTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }, ATTEMPT_PLAY_CAP_MS);
      function cleanup() {
        clearTimeout(capTimer);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      }
      function onEnded() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }
      function onError() {
        if (settled) return;
        settled = true;
        cleanup();
        // A media-element error (decode failure, revoked URL) -- deliberately
        // NOT named NotAllowedError, so playbackErrorText() reports it as a
        // bad recording rather than telling the learner to tap again.
        reject(new Error('Could not play the recording.'));
      }
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      try { audio.currentTime = 0; } catch (e) { /* not yet seekable -- starts at 0 anyway */ }
      var started = audio.play();
      if (started && typeof started.catch === 'function') {
        started.catch(function (err) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        });
      }
    });
  }

  // Reference-then-attempt, back to back with a short gap. The comparison is
  // the point of playback -- hearing either clip alone tells the learner far
  // less than hearing the drop land in two different places -- so this, not
  // the single "Your voice" button, is the primary control.
  var COMPARE_GAP_MS = 350;

  // Hard cap on how long Compare waits for the reference leg. speechSynthesis
  // does not reliably fire 'end': a remote (network) voice with no working
  // audio path can leave speak()'s promise pending forever, which -- since
  // Compare disables both buttons while it runs -- would leave playback
  // permanently unusable with no error shown. Verified in-browser: without
  // this, the buttons never re-enabled. The cap is generous enough for any
  // single word (the longest entries are 5-6 moras, well under a second of
  // speech) plus voice-list loading.
  var REFERENCE_TIMEOUT_MS = 3000;

  // Resolves with `promise`'s result, or with null once `ms` has elapsed --
  // never rejects, so a caller can use it as a "best-effort, bounded" step.
  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(null);
      }, ms);
      promise.then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  function compareWithReference() {
    if (comparing || !attemptAudioUrl || !currentWord) return;
    comparing = true;
    setPlaybackButtonsDisabled(true);
    els.playbackNote.hidden = true;
    els.playbackNote.textContent = '';

    var word = currentWord;
    // A missing, failed, or silently-hanging reference voice must not swallow
    // the learner's own playback -- both the .catch and the timeout fall
    // through to the attempt rather than aborting the compare.
    //
    // `playPermanentlyUnavailable` only describes the browser voice, so it
    // must not skip the coach reference, which is a different source entirely.
    var referenceLeg = (playPermanentlyUnavailable && !sentenceMode())
      ? Promise.resolve(null)
      : withTimeout(playReferenceLeg(word), REFERENCE_TIMEOUT_MS);

    referenceLeg
      .then(function () {
        // If the clip is still going (i.e. the timeout above won the race),
        // stop it so the two don't talk over each other.
        cancelAnyReference();
      })
      .then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, COMPARE_GAP_MS); });
      })
      .then(playAttempt)
      .catch(showPlaybackNote)
      .then(function () {
        comparing = false;
        setPlaybackButtonsDisabled(false);
      });
  }

  function setupPlayback() {
    els.playAttemptBtn.addEventListener('click', function () {
      if (comparing) return;
      // Stop any reference utterance first, so the two don't overlap into an
      // unintelligible mush.
      ReferenceAudio.cancel();
      playAttempt().catch(showPlaybackNote);
    });
    els.compareBtn.addEventListener('click', compareWithReference);
  }

  // ---- Karaoke (coach-only guided take) ----
  //
  // The learner reads the carrier sentence's hiragana off a lyric line that
  // lights up mora by mora, paced by the VOICEVOX reference's own timing,
  // while their live pitch is drawn over the reference's per-mora pitch bars
  // and each hop turns green or red. The recording window is fixed: a
  // count-in, then the time bar from -tolerance to the reference's end plus
  // tolerance, then it stops by itself. The take is submitted to the coach
  // exactly like an ordinary recording, plus where speech was cued, so the
  // verdict and its feedback stay the coach's; the karaoke adds its own live
  // score and timing line on top. See js/karaoke.js for the timeline.

  function currentSpeed() {
    var value = Number(SettingsManager.get('speechRate'));
    return isFinite(value) && value > 0 ? value : 1.0;
  }

  function karaokeActive() {
    return (staticRefsReady || coachActive())
      && SettingsManager.get('karaoke') !== false
      && typeof Karaoke !== 'undefined'
      && typeof LivePitch !== 'undefined'
      && typeof requestAnimationFrame === 'function';
  }

  function teardownKaraoke() {
    if (karaokeSession) {
      karaokeSession.done = true;
      if (karaokeSession.raf) cancelAnimationFrame(karaokeSession.raf);
      if (karaokeSession.view) karaokeSession.view.destroy();
      karaokeSession = null;
    }
    if (els.karaokePanel) {
      els.karaokePanel.hidden = true;
      els.karaokePanel.innerHTML = '';
    }
    els.quiz.classList.remove('karaoke-running');
  }

  // Shared by both recording flows: puts the controls back after a take
  // could not start at all, and says why.
  function recordingFailed(err) {
    isRecording = false;
    recordingActive = false;
    recordingWord = null;
    els.recIndicator.hidden = true;
    els.recordBtn.disabled = false;
    els.recordBtn.textContent = 'Record';
    els.nextBtn.disabled = false;
    els.playBtn.disabled = playPermanentlyUnavailable;
    if (err && err.type === 'permission-denied') {
      els.micMessage.hidden = false;
      els.micMessage.textContent = 'Microphone access is needed to practice pronunciation -- allow it and try again.';
    } else {
      els.micMessage.hidden = false;
      els.micMessage.textContent = (err && err.message) || 'Could not start recording.';
    }
  }

  function startKaraokeFlow() {
    resetAttemptUI();
    // Nothing may be playing when the mic opens -- the reference would be
    // scored as the learner's own voice. The karaoke is deliberately silent:
    // the learner listens first with Play, then reads along.
    cancelAnyReference();
    els.recordBtn.disabled = true;
    recordingActive = true;
    recordingWord = currentWord;
    coachWord = currentWord;
    recordingWasHidden = document.hidden === true;
    els.nextBtn.disabled = true;
    els.playBtn.disabled = true;

    var seq = ++attemptSeq;
    var word = currentWord;
    var speed = currentSpeed();
    attemptContext = { seq: seq, speed: speed };
    showCoachStatus('カラオケを準備中… / Preparing karaoke…');

    // The static reference when it is on this host: it carries the pitch
    // plans of every voice of the learner's gender, which the karaoke judges
    // each step against. The live coach's detail is the fallback.
    var detail = staticRefsReady
      ? StaticRefs.detail(word, voiceGender(), learnerGender(), speed)
      : Coach.referenceDetail(word, coachStyleId, speed);
    Promise.all([detail, LivePitch.load()])
      .then(function (results) {
        if (seq !== attemptSeq) return null;
        var timeline = Karaoke.buildTimeline(results[0], speed);
        if (!timeline) throw new Error('The reference for this word has no morae.');
        els.coachStatus.hidden = true;
        els.coachRow.hidden = true;

        var session = {
          seq: seq,
          timeline: timeline,
          scorer: Karaoke.createScorer(timeline),
          view: Karaoke.createView(els.karaokePanel, timeline),
          raf: null,
          done: false,
          offsetS: 0,
        };
        karaokeSession = session;
        els.quiz.classList.add('karaoke-running');

        return PitchDetect.startRecording({
          tracker: function (sampleRate) { return LivePitch.createTracker(sampleRate); },
          onFrame: function (frame) { session.scorer.push(frame); },
          // The karaoke stops itself at the end of the bar; this is only the
          // backstop for a hidden tab, where animation frames stop entirely.
          maxDurationMs: timeline.totalS * 1000 + 1500,
          onAutoStop: function (trace) { finishKaraoke(session, trace); },
          onAudio: function (blob) { receiveAttemptAudio(blob, seq); },
        }).then(function () {
          if (session.done) return;
          isRecording = true;
          els.recIndicator.hidden = false;
          els.recordBtn.disabled = false;
          els.recordBtn.textContent = 'Stop';
          session.offsetS = PitchDetect.recordingOffsetMs() / 1000;
          attemptContext = {
            seq: seq,
            speed: speed,
            karaokeLeadInS: timeline.leadIn + session.offsetS,
            karaokeToleranceS: timeline.tolerance,
          };
          session.raf = requestAnimationFrame(function () { karaokeTick(session); });
        });
      })
      .catch(function (err) {
        if (seq !== attemptSeq) return;
        teardownKaraoke();
        if (err && err.type) {
          recordingFailed(err);
          return;
        }
        // The reference could not be fetched (a sleeping Space, an engine
        // error). The controls come back; the ordinary recording path is
        // one setting away, so say so rather than silently switching modes.
        recordingFailed({ message: 'Karaoke is unavailable right now ('
          + ((err && err.message) || 'no reference') + '). Turn karaoke off in Settings to record normally.' });
      });
  }

  function karaokeTick(session) {
    if (session.done || karaokeSession !== session) return;
    var ms = PitchDetect.elapsedMs();
    if (ms === null) return;
    var timeline = session.timeline;
    var elapsed = ms / 1000;

    if (elapsed < timeline.countIn) {
      session.view.countIn(Karaoke.COUNT_IN_BEATS - Math.floor(elapsed / timeline.beat));
    } else {
      session.view.countIn(0);
    }
    // Re-judged from scratch every 50 ms rather than on every frame: the
    // snapshot replays the whole take, and 20 times a second is smooth
    // enough for colours while leaving the main thread to the audio tap.
    var now = Date.now();
    if (!session.snap || now - session.snapAt >= 50) {
      session.snap = session.scorer.snapshot();
      session.snapAt = now;
    }
    session.view.update(elapsed - timeline.leadIn, session.snap.frames, session.snap.moras);

    if (elapsed >= timeline.totalS) {
      finishKaraoke(session, PitchDetect.stopRecording());
      return;
    }
    session.raf = requestAnimationFrame(function () { karaokeTick(session); });
  }

  // Ends a karaoke take: by itself at the end of the bar, by the learner's
  // Stop, or by PitchDetect's backstop. Runs once per session.
  function finishKaraoke(session, trace) {
    if (session.done) return;
    session.done = true;
    if (session.raf) cancelAnimationFrame(session.raf);
    els.quiz.classList.remove('karaoke-running');
    // The summary re-judges the whole take aligned to the reference, so its
    // own hops (not the live ones) are what the final picture shows.
    var summary = session.scorer.summary();
    session.view.finish(summary, summary.frames || session.scorer.frames);
    // Restores the controls. In coach mode it returns before any local
    // scoring, which is right: the coach scores the take.
    handleTrace(trace);
  }

  // ---- Recording / scoring ----

  function handleTrace(trace) {
    isRecording = false;
    recordingActive = false;
    els.recIndicator.hidden = true;
    els.recordBtn.textContent = 'Record';
    els.recordBtn.disabled = false;
    els.retryBtn.hidden = false;
    els.nextBtn.disabled = false;
    els.playBtn.disabled = playPermanentlyUnavailable;

    // Use the word this recording was actually FOR, snapshotted when
    // recording started -- not the live `currentWord`, which Next/Play
    // being disabled for the whole recordingActive span should normally
    // keep in sync anyway, but this is the belt-and-suspenders half of that
    // fix: even if some other path still let the word change mid-recording,
    // scoring stays correct rather than silently comparing against the
    // wrong word's pattern.
    var word = recordingWord || currentWord;
    recordingWord = null;
    // No word loaded at all (only reachable if a recording somehow started
    // before data/words.json resolved) -- say so rather than throwing inside
    // moraCountFor(null) and leaving the UI stuck with no explanation.
    if (!word) {
      els.detectMessage.hidden = false;
      els.detectMessage.textContent = 'No word is loaded -- reload the page and try again.';
      return;
    }
    // Captured in a hidden/backgrounded tab: the trace is far too sparse to
    // mean anything (see recordingWasHidden). Say so instead of drawing a
    // diagram and a score off a handful of frames. Playback, if it arrives,
    // stays available -- MediaRecorder is not throttled the way timers are,
    // so the learner can still hear what was captured.
    if (recordingWasHidden) {
      recordingWasHidden = false;
      els.detectMessage.hidden = false;
      els.detectMessage.textContent =
        'This tab was in the background while recording, so the pitch trace is too sparse to score -- keep onchou visible and try again.';
      return;
    }

    // In coach mode the learner said a whole carrier sentence (さくらです),
    // but this local path can only divide a trace into the *word's* morae --
    // it knows nothing about the frame. Scoring anyway squeezes the entire
    // sentence into the word's mora count, producing a diagram and a score
    // that look plausible and are simply wrong. The server segments against
    // the reference's real boundaries, so it is authoritative here; a coach
    // failure reports itself rather than falling back to this.
    // A karaoke take with the static references has already been judged in
    // the karaoke panel; there is no server to hand it to.
    if (sentenceMode()) return;

    var moraCount = moraCountFor(word);
    var segmented = MoraSegment.segmentByMora(trace, moraCount);
    var learnerPattern = segmented.pattern;

    var allUnclear = learnerPattern.length > 0 &&
      learnerPattern.every(function (p) { return p === 'unclear'; });
    if (allUnclear) {
      els.detectMessage.hidden = false;
      els.detectMessage.textContent = "Couldn't detect your voice clearly -- try again.";
      return;
    }

    var fullTargetLevels = targetLevelsFor(word);
    var targetPattern = fullTargetLevels.slice(0, moraCount);
    var score = MoraSegment.scorePattern(learnerPattern, targetPattern);

    // Append a trailing hollow dot to the learner diagram too, mirroring the
    // TARGET's trailing level -- purely for visual alignment with the
    // target diagram above it (same dot count, same x-positions), not a
    // claim about anything actually measured. The mic recording stops at
    // the word itself, so there's no real detected pitch for whatever comes
    // after it (see docs/2026-09-05-pitch-accent-evaluation-research-plan.md
    // for the future-data-collection note this gap motivates).
    var trailingLevel = fullTargetLevels[fullTargetLevels.length - 1];
    els.learnerDiagramRow.hidden = false;
    els.learnerDiagram.innerHTML = PitchDiagram.renderSVG(learnerPattern.concat([trailingLevel]), {
      variant: 'learner',
    });

    if (SettingsManager.get('showContour')) {
      els.contourRow.hidden = false;
      els.contourGraph.innerHTML = PitchContour.renderSVG(trace, fullTargetLevels, segmented);
    }

    els.moraFeedback.hidden = false;
    els.moraFeedback.innerHTML = score.perMora.map(function (status, i) {
      return '<span class="mora-chip ' + status + '">' + (i + 1) + '</span>';
    }).join('');

    els.scoreText.hidden = false;
    els.scoreText.textContent = score.matched + ' of ' + score.total + ' matched';
  }

  function startRecordingFlow() {
    resetAttemptUI();
    // Silence any reference audio before the mic opens -- an utterance still
    // playing through the speakers is picked up by the microphone and
    // analyzed as if it were the learner's own voice, which both corrupts
    // the score and (now that the take is playable) is audible in playback.
    // The VOICEVOX reference plays through an <audio> element rather than
    // speechSynthesis, so it needs stopping separately or the exact same
    // corruption happens by a different route.
    ReferenceAudio.cancel();
    cancelCoachReference();
    els.recordBtn.disabled = true;

    // Disable Next/Play for the WHOLE recording span, starting synchronously
    // right here -- not just after PitchDetect.startRecording()'s promise
    // resolves (isRecording only becomes true then). Without this, a click
    // on Next or Record during the async mic-permission-prompt window could
    // switch words while pitch-detect.js is still setting up the actual
    // capture for the old word.
    recordingActive = true;
    recordingWord = currentWord;
    coachWord = currentWord;
    recordingWasHidden = document.hidden === true;
    els.nextBtn.disabled = true;
    els.playBtn.disabled = true;

    var seq = ++attemptSeq;
    attemptContext = { seq: seq, speed: currentSpeed() };
    PitchDetect.startRecording({
      onAutoStop: function (trace) {
        handleTrace(trace);
      },
      onAudio: function (blob) {
        receiveAttemptAudio(blob, seq);
      },
    }).then(function () {
      isRecording = true;
      els.recIndicator.hidden = false;
      els.recordBtn.disabled = false;
      els.recordBtn.textContent = 'Stop';
    }).catch(recordingFailed);
  }

  function setupRecording() {
    els.recordBtn.addEventListener('click', function () {
      if (isRecording) {
        var trace = PitchDetect.stopRecording();
        if (karaokeSession && !karaokeSession.done) finishKaraoke(karaokeSession, trace);
        else handleTrace(trace);
      } else if (karaokeActive()) {
        startKaraokeFlow();
      } else {
        startRecordingFlow();
      }
    });

    els.retryBtn.addEventListener('click', function () {
      resetAttemptUI();
    });

    // Uploading a file is scored by the server only. There is no local path
    // for it: the client-side pipeline reads the live AnalyserNode as the mic
    // runs and has nothing to offer a file that was never recorded here.
    els.uploadInput.addEventListener('change', function () {
      var file = els.uploadInput.files && els.uploadInput.files[0];
      if (!file || !currentWord) return;

      resetAttemptUI();
      var seq = ++attemptSeq;
      attemptContext = { seq: seq, speed: currentSpeed() };
      coachWord = currentWord;
      els.uploadName.textContent = file.name;
      els.retryBtn.hidden = false;

      // Let the learner hear the file they submitted, exactly as they can
      // hear their own recording.
      attemptAudioUrl = URL.createObjectURL(file);
      attemptAudioEl().src = attemptAudioUrl;
      els.playbackRow.hidden = false;

      submitToCoach(file, currentWord, seq, file.name);
      // Allow the same file to be chosen twice in a row; without this the
      // change event never fires again for an identical selection.
      els.uploadInput.value = '';
    });

    // Switching tabs (or minimizing) mid-take throttles the capture timer --
    // see recordingWasHidden. Latch it for the whole recording span rather
    // than only sampling document.hidden at the start and end, since a
    // learner who tabs away and back would otherwise look like they never
    // left.
    document.addEventListener('visibilitychange', function () {
      if (recordingActive && document.hidden) recordingWasHidden = true;
    });

    els.nextBtn.addEventListener('click', function () {
      // Belt-and-suspenders: the button is already disabled for the whole
      // recordingActive span (see startRecordingFlow/handleTrace), but
      // guard here too rather than relying solely on the disabled attribute
      // blocking the click.
      if (recordingActive) return;
      nextWord();
    });

    // Spacebar toggles Record/Stop from anywhere on the page, so the
    // learner doesn't need to re-aim the mouse at the button between every
    // take. Skipped when focus is already on a button/input -- the browser's
    // own spacebar-activates-focused-control behavior would fire first, and
    // also calling recordBtn.click() here would double-toggle it.
    document.addEventListener('keydown', function (e) {
      if (e.repeat || e.code !== 'Space') return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Not while the settings dialog is open: focus lands on the panel
      // itself after a backdrop-adjacent click (activeElement === body), so
      // the tag check above doesn't cover it, and a spacebar there would
      // start a recording behind the modal.
      if (!els.settingsOverlay.hidden) return;
      if (els.quiz.hidden || els.recordBtn.disabled) return;
      e.preventDefault();
      els.recordBtn.click();
    });
  }

  // ---- Settings dialog ----
  //
  // A plain modal (backdrop click / Escape / close button dismiss it)
  // rather than a full focus trap -- reached by mouse/touch or Tab, same
  // scope jlpt/kotoba/jed/wanikanji's own settings dialogs use.

  function openSettings() {
    els.settingsOverlay.hidden = false;
    renderInstallRow();
    els.btnSettingsClose.focus();
  }

  function closeSettings() {
    els.settingsOverlay.hidden = true;
    els.btnSettings.focus();
  }

  // PWA install: Chrome/Edge/Android fire `beforeinstallprompt`, which is
  // stashed until the learner opens Settings. Browsers with no such event
  // (iOS Safari, desktop Safari/Firefox) get a manual "Add to Home Screen"
  // hint instead, since there's no install API to call there.
  var deferredInstallPrompt = null;

  function isStandaloneDisplay() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function renderInstallRow() {
    if (isStandaloneDisplay()) {
      els.installButton.hidden = true;
      els.installHint.textContent = 'インストール済み — Already installed';
      els.installHint.hidden = false;
      return;
    }
    if (deferredInstallPrompt) {
      els.installButton.hidden = false;
      els.installHint.hidden = true;
      return;
    }
    els.installButton.hidden = true;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    els.installHint.textContent = isIOS
      ? '共有ボタン → ホーム画面に追加 — Share button → Add to Home Screen'
      : 'ブラウザメニューの「インストール」から追加できます — Use your browser menu → Install app';
    els.installHint.hidden = false;
  }

  // Reflects the stored level on the segmented control. Also used at setup
  // time, so the markup's hardcoded `.active` (on "All", the default) is
  // corrected to whatever the learner actually chose last session.
  function syncLevelButtons() {
    var level = SettingsManager.get('level');
    els.settingLevelButtons.forEach(function (btn) {
      var active = btn.dataset.value === level;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  // Queried lazily rather than cached in `els`, because the voice row is
  // hidden until the coach probe succeeds and this keeps the two in step
  // without a second initialisation path.
  function voiceButtons() {
    if (!els.settingVoice) return [];
    return Array.prototype.slice.call(els.settingVoice.querySelectorAll('.segmented-btn'));
  }

  function syncVoiceButtons() {
    var gender = SettingsManager.get('voiceGender');
    voiceButtons().forEach(function (btn) {
      var active = btn.dataset.value === gender;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function setVoiceGender(value) {
    SettingsManager.set('voiceGender', value);
    if (coachVoices.length) coachStyleId = Coach.pickVoice(coachVoices, value);
    syncVoiceButtons();
    syncQuickButtons();
  }

  // ---- Side panel: quick voice choices and devoicing shortcuts ----

  function syncQuickButtons() {
    var values = { learnerGender: learnerGender(), voiceGender: voiceGender() };
    Array.prototype.forEach.call(els.quickVoiceButtons, function (btn) {
      var active = values[btn.dataset.quick] === btn.dataset.value;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function syncDevoicingButtons() {
    Array.prototype.forEach.call(els.devoicingButtons, function (btn) {
      var value = btn.dataset.focus;
      var active = value === 'all' ? !devoicingFocus : devoicingFocus === value;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      var count = btn.querySelector('.shortcut-count');
      if (count && value !== 'all') count.textContent = String(devoicingPool(value).length);
      btn.disabled = value !== 'all' && devoicingPool(value).length === 0;
    });
    if (els.devoicingStatus) {
      els.devoicingStatus.textContent = devoicingFocus
        ? '無声化のある' + devoicingFocus + '拍の語 / devoicing words, ' + devoicingFocus + ' morae'
        : 'すべての語 / all words, by your practice level';
    }
  }

  function setupSidePanel() {
    if (!els.sidePanel) return;
    Array.prototype.forEach.call(els.quickVoiceButtons, function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.quick === 'voiceGender') {
          setVoiceGender(btn.dataset.value);
        } else {
          SettingsManager.set('learnerGender', btn.dataset.value);
          syncQuickButtons();
        }
        // Takes effect from the next Play / Record.
      });
    });
    Array.prototype.forEach.call(els.devoicingButtons, function (btn) {
      btn.addEventListener('click', function () {
        if (recordingActive) return;
        var value = btn.dataset.focus;
        devoicingFocus = (value === 'all' || devoicingFocus === value) ? null : value;
        syncDevoicingButtons();
        if (words.length) nextWord();
      });
    });
    syncQuickButtons();
    syncDevoicingButtons();
  }

  // Loads the pre-generated references. The quick voice choices are useful
  // either way (a live coach reads them too); the devoicing shortcuts need
  // the manifest, so they appear only once it has loaded.
  function setupStaticRefs() {
    if (typeof StaticRefs === 'undefined') return Promise.resolve(false);
    return StaticRefs.load().then(function (ok) {
      staticRefsReady = ok;
      if (els.sidePanel) els.sidePanel.classList.toggle('no-refs', !ok);
      if (!ok) return false;
      els.settingVoiceRow.hidden = false;
      els.settingKaraokeRow.hidden = false;
      els.settingKaraoke.checked = SettingsManager.get('karaoke') !== false;
      els.settingRateRow.hidden = false;
      syncRateButtons();
      syncDevoicingButtons();
      if (currentWord) {
        renderReading(currentWord);
        renderTargetDiagram();
        updateSentenceHint();
      }
      return true;
    });
  }

  function rateButtons() {
    if (!els.settingRate) return [];
    return Array.prototype.slice.call(els.settingRate.querySelectorAll('.segmented-btn'));
  }

  function syncRateButtons() {
    var speed = currentSpeed();
    rateButtons().forEach(function (btn) {
      var active = Math.abs(Number(btn.dataset.value) - speed) < 1e-6;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function setupSettingsPanel() {
    els.btnSettings.addEventListener('click', openSettings);
    els.btnSettingsClose.addEventListener('click', closeSettings);
    els.settingsOverlay.addEventListener('click', function (e) {
      if (e.target === els.settingsOverlay) closeSettings();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.settingsOverlay.hidden) closeSettings();
    });

    els.settingAutoPlay.checked = SettingsManager.get('autoPlayReference');
    els.settingAutoPlay.addEventListener('change', function () {
      SettingsManager.set('autoPlayReference', els.settingAutoPlay.checked);
    });

    els.settingShowContour.checked = SettingsManager.get('showContour');
    els.settingShowContour.addEventListener('change', function () {
      SettingsManager.set('showContour', els.settingShowContour.checked);
      // Take effect immediately on the attempt already on screen, not just
      // the next recording -- turning it off should hide it right away,
      // and turning it on should reveal it if a trace has already been
      // scored (contourGraph.innerHTML is only ever populated when a
      // completed attempt exists, so an empty one here is never mistaken
      // for "should be showing").
      if (!els.settingShowContour.checked) {
        els.contourRow.hidden = true;
      } else if (els.contourGraph.innerHTML) {
        els.contourRow.hidden = false;
      }
    });

    // The coach toggle is only ever visible when a backend answered the
    // probe (see setupCoach), so no availability check is needed here.
    els.settingCoach.addEventListener('change', function () {
      SettingsManager.set('coachEnabled', els.settingCoach.checked);
      applyCoachVisibility();
    });

    syncVoiceButtons();
    voiceButtons().forEach(function (btn) {
      btn.addEventListener('click', function () {
        setVoiceGender(btn.dataset.value);
        // Changing voice invalidates nothing already scored -- the reference
        // is regenerated on the next Play, and the accent it encodes is the
        // same either way, since the server imposes it from words.json
        // rather than taking whatever the voice would have guessed.
      });
    });

    if (els.settingKaraoke) {
      els.settingKaraoke.addEventListener('change', function () {
        SettingsManager.set('karaoke', els.settingKaraoke.checked);
        updateSentenceHint();
        renderTargetDiagram();
      });
    }

    syncRateButtons();
    rateButtons().forEach(function (btn) {
      btn.addEventListener('click', function () {
        SettingsManager.set('speechRate', Number(btn.dataset.value));
        syncRateButtons();
        // Takes effect from the next Play / Record. A take already on screen
        // keeps the verdict it was scored with, at the speed it was made at.
      });
    });

    syncLevelButtons();
    els.settingLevelButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        SettingsManager.set('level', btn.dataset.value);
        syncLevelButtons();
        // Deliberately does NOT re-pick the current word -- the new level
        // applies from the next "Next word" on, matching how the auto-play
        // and pitch-curve settings above also only affect what happens
        // next rather than rewriting what's already on screen.
      });
    });

    els.installButton.addEventListener('click', function () {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(function () {
        deferredInstallPrompt = null;
        renderInstallRow();
      });
    });

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      renderInstallRow();
    });
    window.addEventListener('appinstalled', function () {
      deferredInstallPrompt = null;
      renderInstallRow();
    });
  }

  // ---- Boot ----

  // Distinct, accurate copy per PitchDetect.unsupportedReason() -- telling a
  // modern browser on an insecure origin to "try a recent browser" would be
  // wrong advice (switching browsers won't fix it) and would send the
  // learner on a pointless goose chase, so this must not collapse to one
  // generic message.
  var UNSUPPORTED_MESSAGES = {
    'insecure-context':
      'マイク録音には安全な接続が必要です。\n' +
      'Microphone recording requires a secure context. You’re viewing this page over an insecure connection (' +
      (typeof location !== 'undefined' ? location.protocol + '//' + location.host : '') +
      '). Use http://localhost (not an IP address or LAN hostname) when serving locally, or HTTPS when deployed.',
    'no-media-devices':
      'お使いのブラウザはマイク録音に対応していません。\n' +
      'This browser doesn’t support microphone recording, so onchou’s practice feature can’t run here. Try a recent Chrome, Firefox, Edge, or Safari.',
    'no-audio-context':
      'お使いのブラウザは音声解析に対応していません。\n' +
      'This browser doesn’t support the Web Audio API, so onchou can’t analyze your pitch. Try a recent Chrome, Firefox, Edge, or Safari.',
  };

  function boot() {
    // Independent of mic/Web Audio support -- the settings dialog (install
    // prompt, auto-play toggle) works the same whether or not the quiz UI
    // below is available.
    setupSettingsPanel();

    var reason = PitchDetect.unsupportedReason();
    if (reason) {
      els.unsupportedNoticeText.textContent = UNSUPPORTED_MESSAGES[reason] || UNSUPPORTED_MESSAGES['no-media-devices'];
      els.unsupportedNotice.hidden = false;
      els.quiz.hidden = true;
      if (els.sidePanel) els.sidePanel.hidden = true;
      return;
    }

    els.quiz.hidden = false;
    els.recordBtn.disabled = true;
    setupReferenceAudio();
    setupRecording();
    setupPlayback();
    setupSidePanel();
    // Fire-and-forget: the app is fully usable before (and without) either
    // resolving, so nothing below waits on them.
    setupStaticRefs();
    setupCoach();

    fetch('data/words.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        // A response that parses as JSON but isn't a non-empty array (an
        // empty `[]`, or a malformed shape) isn't caught by the .catch()
        // below, which only covers network/parse failures -- without this,
        // pickNextWord() would quietly return null forever, Record would
        // stay enabled with no word loaded, and the first attempt would
        // throw inside handleTrace() (moraCountFor(null)) with no
        // user-visible message at all.
        words = Array.isArray(data) ? data : [];
        if (!words.length) {
          els.detectMessage.hidden = false;
          els.detectMessage.textContent = 'Could not load word data.';
          return;
        }
        nextWord();
        syncDevoicingButtons();
        els.recordBtn.disabled = false;
      })
      .catch(function () {
        els.wordText.textContent = '';
        els.detectMessage.hidden = false;
        els.detectMessage.textContent = 'Could not load word data.';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
