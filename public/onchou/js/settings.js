// settings.js -- user preferences (auto-play, etc.), persisted to their own
// localStorage entry, separate from any future learning-progress storage so
// the two can be reset independently. Thin localStorage wrapper with no
// meaningful pure logic beyond merging defaults, so (matching this
// codebase's own testing convention of unit-testing pure/DOM-free logic,
// not framework wrappers) it has no test file -- verified manually
// in-browser, same as js/reference-audio.js's live speechSynthesis calls.
var SettingsManager = (function () {
  'use strict';

  var STORAGE_KEY = 'onchou-settings';
  // autoPlayReference defaults to false: the learner taps "Play" to hear
  // the reference on their own schedule by default; turning this on speaks
  // it automatically as soon as a new word loads.
  // showContour defaults to false: the raw F0 contour graph is an advanced/
  // supplementary view alongside the primary per-mora H/L diagrams, hidden
  // until a learner opts in.
  // level defaults to 'all' (see js/word-select.js's LEVELS): an existing
  // learner who never opens Settings keeps seeing every word length they
  // always have, rather than being silently restricted to 2-mora words by
  // an update.
  // coachEnabled defaults to false: the coach sends the learner's recording
  // off the device to be analysed, and that should be an explicit choice
  // rather than something an update quietly turns on. The setting is only
  // shown at all when a coach backend is actually reachable.
  // voiceGender defaults to 'female' purely because it is the first voice
  // VOICEVOX Nemo lists; it is not a default worth attaching meaning to, and
  // matching it to the learner's own range is what actually matters (a large
  // pitch gap between learner and reference degrades the alignment).
  // karaoke defaults to true, unlike coachEnabled: it changes how a take is
  // recorded, not where it goes, and it only ever takes effect once the
  // learner has already opted into the coach (it needs the reference's
  // timing). A learner who turned the coach on gets the guided mode without
  // hunting for a second switch, and can turn it off.
  // speechRate defaults to 1.0, VOICEVOX's natural tempo. It drives both
  // the reference's speedScale and every karaoke tolerance (js/karaoke.js).
  var DEFAULTS = {
    autoPlayReference: false,
    showContour: false,
    level: 'all',
    coachEnabled: false,
    voiceGender: 'female',
    // The learner's own voice type, chosen in the side panel. Decides which
    // reference voices the pitch range is built from; voiceGender above is
    // only the voice they hear.
    learnerGender: 'female',
    karaoke: true,
    speechRate: 1.0,
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      // localStorage unavailable (private mode, quota, etc.) -- fail silently
    }
  }

  function get(key) {
    return load()[key];
  }

  function set(key, value) {
    var settings = load();
    settings[key] = value;
    save(settings);
  }

  return { get: get, set: set };
})();
