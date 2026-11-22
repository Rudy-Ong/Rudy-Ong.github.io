// karaoke.js -- the karaoke practice mode: the learner reads the carrier
// sentence's hiragana off a moving lyric line while their live pitch is drawn
// against the reference's per-mora pitch bars, each hop turning the bar it
// lands on green (within tolerance) or red (outside it).
//
// The reference comes from the coach's /api/reference/detail: per-mora
// timing, devoicing and the pitch the engine actually rendered
// (rel_semitones, relative to the reference's own median). So the mode only
// exists when the coach does -- a browser voice reports no timing at all.
//
// Split like js/pitch-contour.js: the timeline and scorer are pure and
// Node-tested (js/__tests__/karaoke-test.js); createView() is a thin canvas
// and DOM renderer left to manual verification.
//
// Timeline, in seconds, with t = 0 where the reference starts speaking:
//
//   recording:  |-- count-in --|-- tol --|====== speech ======|-- tol --|
//   karaoke t:  -countIn-tol   -tol      0                    span  span+tol
//
// The time bar runs from -tol to span+tol: "zero minus tolerance" to "the
// TTS audio's end plus tolerance". Every tolerance is a duration, so each one
// scales with 1/speed. A learner practising at 0.75x is speaking every mora
// 1.33x longer, and holding them to the 1.0x slack would penalise exactly
// the slowed-down practice the speed setting exists for.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Karaoke = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The speeds the settings panel offers. The server snaps any speed to a
  // 0.05 grid and accepts 0.5-2.0; these four are all on that grid.
  var SPEEDS = [0.75, 0.9, 1.0, 1.2];

  // Bar margin either side of the reference speech, at 1.0x.
  var BASE_TOLERANCE_S = 0.5;
  // How far a hop may sit from its mora's window and still be judged against
  // it. Learners rarely land a mora boundary to within one 10 ms hop, and a
  // frame scored against the neighbouring mora's pitch would flash red on
  // speech that was actually right.
  var BASE_SLACK_S = 0.12;
  // ...but never more than this share of the mora itself. A fixed 120 ms is
  // most of a short mora, and a hop that may be judged against its
  // neighbour's pitch for most of its length lets a flat contour score green
  // across a real step -- which is the one error this mode exists to show.
  var MAX_SLACK_SHARE = 0.35;
  // Same number as the server's MATCH_TOLERANCE_SEMITONES, so a hop that is
  // green here is a mora the server would also call matched.
  var PITCH_TOLERANCE_ST = 2.0;
  // A count-in before the bar starts, because 0.5 s of lead-in is not enough
  // time to look from the Record button to the first syllable.
  var COUNT_IN_BEATS = 3;
  var BASE_BEAT_S = 0.5;
  // Share of a mora's scored hops that must be green for its lyric to turn
  // green. Not 100%: the first hops of a voiced mora are often the pitch
  // still gliding out of the previous one.
  var MORA_HIT_RATIO = 0.6;
  // Hops that only count once enough of them have been heard. Fewer than this
  // inside a mora means "not enough voice to judge", not a miss.
  var MIN_MORA_FRAMES = 3;
  // Consecutive voiced hops that mark the start of speech. One stray voiced
  // hop in the count-in (a cough, a chair) must not read as starting early.
  var ONSET_RUN = 3;
  // Pace difference (as a fraction) below which the final alignment only
  // shifts the take instead of also stretching it. See finalMap().
  var MIN_STRETCH = 0.15;
  // A hop further than this from the take's own median pitch is a tracker
  // error (a subharmonic at a vowel's onset, a consonant burst), not speech:
  // Japanese accent steps are a few semitones. Dropped before the final
  // alignment, so it can neither set the detected start nor anchor a step.
  var OUTLIER_ST = 7;
  // The learner's pitch is smoothed before it is judged: a Gaussian over
  // this many seconds, on voiced hops only (voicing itself is never changed,
  // so a whispered mora stays whispered). Same 20 ms as the server's
  // analyze.SMOOTH_SIGMA_S, measured there to trim cross-voice false alarms
  // slightly without blunting a real drop; 40 ms blurred drops and was worse.
  var SMOOTH_SIGMA_S = 0.02;

  // OpenJTalk consonants with no voicing, so the tracker hears nothing until
  // the vowel.
  var VOICELESS = ['k', 'ky', 's', 'sh', 't', 'ts', 'ch', 'h', 'hy', 'f', 'p', 'py', 'cl'];

  function speedOf(speed) {
    var value = Number(speed);
    return isFinite(value) && value > 0 ? value : 1.0;
  }

  function toleranceFor(speed) { return BASE_TOLERANCE_S / speedOf(speed); }
  function slackFor(speed) { return BASE_SLACK_S / speedOf(speed); }
  function countInFor(speed) { return (COUNT_IN_BEATS * BASE_BEAT_S) / speedOf(speed); }

  function hzToSemitones(hz) {
    return 12 * Math.log2(hz / 100);
  }

  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }

  // Builds the karaoke timeline from the server's Reference JSON. The
  // reference's times are already scaled for its speed by the server, so
  // only the tolerances are derived here.
  function buildTimeline(reference, speed) {
    if (!reference || !reference.moras || !reference.moras.length) return null;
    var s = speedOf(speed != null ? speed : reference.speed);
    var origin = reference.moras[0].start_s;
    var moras = reference.moras.map(function (m, index) {
      var rel = (m.devoiced || m.rel_semitones == null) ? null : m.rel_semitones;
      // Where voicing begins in this mora: at its start when the consonant
      // is voiced (or absent), at its vowel when the consonant is voiceless
      // -- the tracker cannot hear た's t, only its a.
      var voicelessOnset = m.consonant && VOICELESS.indexOf(m.consonant) !== -1;
      var vowelStart = m.vowel_start_s != null ? m.vowel_start_s : m.start_s;
      return {
        index: index,
        kana: m.kana,
        start: m.start_s - origin,
        end: m.end_s - origin,
        voiceStart: (voicelessOnset ? vowelStart : m.start_s) - origin,
        rel: rel,
        devoiced: !!m.devoiced,
        // Three roles (2026-11-22, the "middle option"):
        //   the word          judged (green/red) and COUNTED
        //   the mora after it judged (green/red), NOT counted -- it is the
        //                     only place heiban and odaka differ, and where
        //                     the engine often lands a word's drop, so not
        //                     judging it hid 40% of wrong accents
        //   the rest of frame never judged, always shown correct ('given')
        // So たまごです reads out of 3, while a wrong drop into で still shows.
        scored: m.is_scored !== false,
        counted: m.is_scored !== false && !m.is_particle,
        particle: !!m.is_particle,
      };
    });
    var span = moras[moras.length - 1].end;
    // Where voicing should stop: the end of the last mora that carries pitch.
    // A final devoiced mora (the す of です) is whispered, so the live tracker
    // never hears it, and comparing the learner's last voiced hop with the
    // sentence end would call every correct です "too fast".
    var voicedEnd = span;
    for (var v = moras.length - 1; v >= 0; v--) {
      if (moras[v].rel != null) { voicedEnd = moras[v].end; break; }
    }
    var voiceStart = 0;
    for (var f = 0; f < moras.length; f++) {
      if (moras[f].rel != null) { voiceStart = moras[f].voiceStart; break; }
    }
    var tolerance = toleranceFor(s);
    var countIn = countInFor(s);

    var rels = moras.filter(function (m) { return m.rel != null; }).map(function (m) { return m.rel; });
    var lo = rels.length ? Math.min.apply(null, rels) : -3;
    var hi = rels.length ? Math.max.apply(null, rels) : 3;
    // Headroom for the tolerance band plus room to show a miss above or
    // below it; a range that only just fits the bars would clip every red
    // hop to the edge, which hides how far off it was.
    var pad = PITCH_TOLERANCE_ST + 3;

    // The pitch plans of every reference voice of the learner's gender
    // (js/static-refs.js), one array per voice, masked to the morae this
    // timeline gives a pitch. Each step is judged against the span of steps
    // those voices produce rather than against the one voice heard -- two
    // natural voices shape the same accent differently, and judging against
    // only one flagged correct speech far too often. See the design doc's
    // "Judging against a range of same-gender voices".
    var voiceRels = null;
    if (Array.isArray(reference.range_rels) && reference.range_rels.length) {
      voiceRels = reference.range_rels
        .filter(function (v) { return Array.isArray(v) && v.length >= moras.length; })
        .map(function (v) {
          return moras.map(function (m, i) { return m.rel == null || v[i] == null ? null : v[i]; });
        });
      if (!voiceRels.length) voiceRels = null;
    }

    return {
      speed: s,
      tolerance: tolerance,
      slack: slackFor(s),
      countIn: countIn,
      beat: countIn / COUNT_IN_BEATS,
      // Where reference speech is cued, in recording seconds. Sent to the
      // server as karaokeLeadInS (plus the recorder's own start offset).
      leadIn: countIn + tolerance,
      span: span,
      voiceStart: voiceStart,
      voicedEnd: voicedEnd,
      barStart: -tolerance,
      barEnd: span + tolerance,
      totalS: countIn + tolerance + span + tolerance,
      moras: moras,
      range: { min: lo - pad, max: hi + pad },
      voiceRels: voiceRels,
      text: moras.map(function (m) { return m.kana; }).join(''),
    };
  }

  // [lowest, highest] step from mora `from` to mora `to` across the reference
  // voices, always including the heard voice's own step. Null without a range.
  function stepRange(timeline, from, to) {
    var a = timeline.moras[from];
    var b = timeline.moras[to];
    if (!timeline.voiceRels || a.rel == null || b.rel == null) return null;
    var lo = b.rel - a.rel;
    var hi = lo;
    timeline.voiceRels.forEach(function (v) {
      if (v[from] == null || v[to] == null) return;
      var step = v[to] - v[from];
      if (step < lo) lo = step;
      if (step > hi) hi = step;
    });
    return [lo, hi];
  }

  // Gaussian smoothing of a take's voiced hops, in semitones. Unvoiced hops
  // stay unvoiced and voiced ones stay voiced; only the pitch of each voiced
  // hop is replaced by the weighted mean of its voiced neighbours, so a
  // single jittery hop cannot flip a mora between green and red.
  function smoothFrames(frames, sigmaS) {
    var sigma = sigmaS != null ? sigmaS : SMOOTH_SIGMA_S;
    if (!(sigma > 0)) return frames;
    var voiced = [];
    frames.forEach(function (f, i) {
      if (f.hz > 0) voiced.push({ i: i, t: f.tMs / 1000, st: hzToSemitones(f.hz) });
    });
    if (voiced.length < 3) return frames;
    var reach = 3 * sigma;
    var out = frames.slice();
    var lo = 0;
    for (var k = 0; k < voiced.length; k++) {
      var t = voiced[k].t;
      while (voiced[lo].t < t - reach) lo++;
      var sum = 0;
      var weight = 0;
      for (var j = lo; j < voiced.length && voiced[j].t <= t + reach; j++) {
        var d = (voiced[j].t - t) / sigma;
        var w = Math.exp(-0.5 * d * d);
        sum += w * voiced[j].st;
        weight += w;
      }
      var st = sum / weight;
      out[voiced[k].i] = { tMs: frames[voiced[k].i].tMs, hz: 100 * Math.pow(2, st / 12) };
    }
    return out;
  }

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // The mora whose own window holds t (no slack), or null.
  function moraAt(timeline, t) {
    for (var i = 0; i < timeline.moras.length; i++) {
      var m = timeline.moras[i];
      if (t >= m.start && t < m.end) return m;
    }
    return null;
  }

  // Scored moras with a pitch target whose slack-widened window holds t.
  // The rest of the carrier frame (the す of です, the と of こと) is drawn
  // but never judged: it is there so the sentence sounds natural, and the
  // server does not score it either.
  function candidatesAt(timeline, t) {
    var out = [];
    for (var i = 0; i < timeline.moras.length; i++) {
      var m = timeline.moras[i];
      if (m.rel == null || !m.scored) continue;
      var slack = Math.min(timeline.slack, MAX_SLACK_SHARE * (m.end - m.start));
      if (t >= m.start - slack && t < m.end + slack) out.push(m);
    }
    return out;
  }

  // Undo octave errors, the classic failure of every YIN-family tracker on a
  // creaky or breathy voice: a jump of ~12 st against the target is a tracker
  // error, not a pitch-accent error, because Japanese accent steps are a few
  // semitones. Singing games fold the same way for the same reason.
  function foldOctave(diff) {
    while (diff > 9) diff -= 12;
    while (diff < -9) diff += 12;
    return diff;
  }

  // createScorer(timeline) -> { push(frame), summary(), frames }
  //
  // push() takes one capture frame { tMs, hz } on the RECORDING clock and
  // returns the judged frame:
  //   { t, hz, st, mapped, status, moraIndex }
  // where status is one of
  //   'hit'      within PITCH_TOLERANCE_ST of a reference bar
  //   'miss'     voiced over a bar, but outside tolerance
  //   'idle'     voiced inside the time bar with no bar to judge against
  //              (a gap, or a devoiced mora, which carries no pitch)
  //   'out'      outside the time bar altogether (count-in, after the end)
  //   'unvoiced' no pitch in this hop
  //
  // What is judged is the STEP into each mora, not its level -- the same
  // choice the server makes, for the same reason. Matching levels needs an
  // offset between the two voices, and any offset estimated from the take
  // itself (a running median, say) lands between the two halves of a real
  // drop: measured in the browser, a completely flat reading of a 4-semitone
  // fall sat exactly +-2 st from both bars and scored 100%. A step is immune
  // to the offset, and pitch accent is a pattern of steps anyway.
  //
  // So a hop in mora k is compared with the learner's own level on the last
  // earlier mora that carries pitch (the running median of the hops heard
  // there), plus the reference's step between the two. A devoiced mora in
  // between is skipped on both sides, as the server's _deltas does. The first
  // pitched mora has nothing before it; it is judged against a running
  // offset, which only places it -- it cannot fail on its own.
  //
  // Judging is done on the REFERENCE's timeline, after aligning the take to
  // it -- the same thing the coach does (a linear stretch, then DTW) before it
  // compares anything. Without it, a correct reading started 0.15 s late
  // (well inside the timing tolerance, and normal for someone reading along)
  // put every hop over the previous mora's bar and scored 1 of 4 in the
  // browser, while the coach scored the same take 4 of 4. Live, the bars are
  // shifted by the learner's measured start once it is known; at the end the
  // take is re-judged with its start AND end mapped onto the reference's, so
  // a slightly slow or fast reading is not mistaken for a wrong pitch.
  // Timing itself is still judged on the raw times, by timingIssue().
  //
  // opts.map (used internally for that final pass) fixes the raw -> reference
  // time mapping instead of deriving it live.
  function createScorer(timeline, opts) {
    opts = opts || {};
    var fixedMap = typeof opts.map === 'function' ? opts.map : null;
    var inputs = [];
    var offsets = [];
    var frames = [];
    // hits/misses: judged hops on a mora with pitch. quiet/loud: unvoiced and
    // voiced hops on a scored mora with none (devoiced, or the silence of っ),
    // which is right when it is kept quiet.
    var perMora = timeline.moras.map(function () { return { hits: 0, misses: 0, quiet: 0, loud: 0 }; });
    // Voiced semitone values heard inside each mora's own window.
    var heard = timeline.moras.map(function () { return []; });
    var voicedRun = 0;
    var onset = null;
    var lastVoiced = null;

    // The learner's level on the last pitched mora before `index` that has
    // been heard enough to have one, with the reference's level there.
    function anchorBefore(index) {
      for (var j = index - 1; j >= 0; j--) {
        var m = timeline.moras[j];
        if (m.rel == null) continue;
        if (heard[j].length >= MIN_MORA_FRAMES) return { level: median(heard[j]), rel: m.rel, index: j };
        // A pitched mora the learner did not voice breaks the chain: the step
        // would be measured across a mora they skipped.
        return null;
      }
      return null;
    }

    // Signed distance, in semitones, between this hop and where the learner
    // should be on mora m. `inside` is the mora the hop actually falls in.
    // When the slack offers the NEXT mora as a candidate, the anchor must
    // still come from before `inside`: anchoring on `inside` itself compares
    // the hop with its own mora, which a flat contour always passes -- in
    // testing that turned half of every missed drop green.
    function deviation(st, m, inside) {
      var from = inside != null ? Math.min(m.index, inside) : m.index;
      var anchor = anchorBefore(from);
      if (anchor) {
        var span = stepRange(timeline, anchor.index, m.index);
        if (span) {
          // Inside the span the voices produce is no error; outside it, the
          // distance to the nearer edge.
          var step = st - anchor.level;
          return foldOctave(step - Math.max(span[0], Math.min(span[1], step)));
        }
        return foldOctave(st - (anchor.level + (m.rel - anchor.rel)));
      }
      var offset = offsets.length ? median(offsets) : st - m.rel;
      return foldOctave(st - offset - m.rel);
    }

    function clampTol(value) {
      return Math.max(-timeline.tolerance, Math.min(timeline.tolerance, value));
    }

    function toReference(rawT) {
      if (fixedMap) return fixedMap(rawT);
      if (onset === null) return rawT;
      return rawT - clampTol(onset - timeline.voiceStart);
    }

    function push(frame) {
      inputs.push(frame);
      var rawT = frame.tMs / 1000 - timeline.leadIn;
      // Drawn and judged on the reference's timeline; see above.
      var judged = { t: rawT, rawT: rawT, hz: frame.hz, st: null, mapped: null, status: 'unvoiced', moraIndex: null };

      if (frame.hz == null || !(frame.hz > 0)) {
        voicedRun = 0;
        if (rawT >= timeline.barStart && rawT <= timeline.barEnd) {
          judged.t = toReference(rawT);
          var silentIn = moraAt(timeline, judged.t);
          if (silentIn && silentIn.scored && silentIn.rel == null) perMora[silentIn.index].quiet += 1;
        }
        frames.push(judged);
        return judged;
      }

      var st = hzToSemitones(frame.hz);
      judged.st = st;

      voicedRun += 1;
      if (onset === null && voicedRun >= ONSET_RUN) {
        // Back-date to the first hop of the run, which is where speech began.
        onset = frames.length >= ONSET_RUN - 1
          ? frames[frames.length - (ONSET_RUN - 1)].rawT : rawT;
      }
      lastVoiced = rawT;

      // The bar is real time: outside it is outside it, however aligned.
      if (rawT < timeline.barStart || rawT > timeline.barEnd) {
        frames.push(judged);
        judged.status = 'out';
        return judged;
      }
      var t = toReference(rawT);
      judged.t = t;

      var exact = moraAt(timeline, t);
      var candidates = candidatesAt(timeline, t);
      if (!candidates.length) {
        if (exact && !exact.scored && exact.rel != null) {
          // Unscored frame mora: placed against its bar so the learner sees
          // the whole sentence's shape, but with no verdict either way.
          judged.status = 'context';
          judged.mapped = exact.rel + deviation(st, exact, exact.index);
        } else {
          judged.status = 'idle';
          if (exact && exact.scored && exact.rel == null) perMora[exact.index].loud += 1;
        }
        judged.moraIndex = exact ? exact.index : null;
        frames.push(judged);
        return judged;
      }

      var best = null;
      var bestDiff = Infinity;
      candidates.forEach(function (m) {
        var diff = deviation(st, m, exact ? exact.index : null);
        if (Math.abs(diff) < Math.abs(bestDiff)) { bestDiff = diff; best = m; }
      });

      // Attribute the hop to the mora it is actually inside when that mora
      // has a target, so a slack-matched hop does not inflate a neighbour.
      // Never an unscored frame mora: a hop just inside で that the slack
      // matched against the word's last mora belongs to that mora, or it
      // would paint red on a bar that is always treated as correct.
      var owner = (exact && exact.rel != null && exact.scored) ? exact : best;
      var ownerDiff = owner === best ? bestDiff : deviation(st, owner, exact ? exact.index : null);
      var hit = Math.abs(bestDiff) <= PITCH_TOLERANCE_ST;

      if (exact && exact.rel != null && exact.scored) {
        heard[exact.index].push(st);
        offsets.push(st - exact.rel);
      }

      // Drawn where the hop sits relative to the bar it was judged against,
      // so "inside the bar" on screen is exactly "green".
      judged.mapped = owner.rel + ownerDiff;
      judged.status = hit ? 'hit' : 'miss';
      judged.moraIndex = owner.index;
      if (hit) perMora[owner.index].hits += 1;
      else perMora[owner.index].misses += 1;

      frames.push(judged);
      return judged;
    }

    // Every scored mora with a pitch target gets a verdict, including one the
    // learner never reached: too little voice there is a miss, not a mora
    // left out of the count. Leaving unreached morae out made a take stopped
    // after the first syllable read "100% (1/1)".
    // The carrier frame (です, こと) is always 'given': treated as correct,
    // shown green, never counted. Whatever the learner does on it is not
    // judged -- including the drop after the word, which is the only place
    // heiban and odaka differ, so the karaoke does not tell those two apart.
    // That is a deliberate choice (2026-11-22): a frame syllable can never
    // turn red, so it can never be a false alarm either.
    function moraStatus(counts, mora) {
      if (!mora.scored) return 'given';
      if (mora.rel == null) {
        // Devoiced, or っ: right when kept quiet, wrong when voiced, and a
        // miss when never reached -- it is still one of the word's morae.
        var heardHops = counts.quiet + counts.loud;
        if (heardHops < MIN_MORA_FRAMES) return 'miss';
        return counts.loud / heardHops >= 0.5 ? 'miss' : 'hit';
      }
      var total = counts.hits + counts.misses;
      if (total < MIN_MORA_FRAMES) return 'miss';
      return counts.hits / total >= MORA_HIT_RATIO ? 'hit' : 'miss';
    }

    // Same classification order as the server's karaoke timing check, on the
    // live frames: so the karaoke's own verdict and the coach's agree on
    // whether the learner was early, late, slow or fast. The onset comes
    // first because it is usually the cause: a start later than the
    // tolerance necessarily runs past the end of the bar, and "cut off"
    // would describe the symptom instead.
    function timingIssue(onsetS, endS, ranPastEnd) {
      var tol = timeline.tolerance;
      if (onsetS === null) return 'none';
      if (onsetS < -tol) return 'early';
      if (onsetS > tol) return 'late';
      if (ranPastEnd) return 'cut_off';
      if (endS - timeline.voicedEnd > tol) return 'too_slow';
      if (endS - timeline.voicedEnd < -tol) return 'too_fast';
      return 'none';
    }

    // The final alignment: the learner's voiced span mapped onto the
    // reference's. Falls back to a start-only shift when the two spans are
    // too different to be the same sentence at a different pace (a take
    // stopped after one syllable must not be stretched over the whole bar).
    function finalMap(start, end, stretch) {
      if (start === null) return null;
      if (!stretch) {
        var only = clampTol(start - timeline.voiceStart);
        return function (rawT) { return rawT - only; };
      }
      var rawSpan = end - start;
      var refSpan = timeline.voicedEnd - timeline.voiceStart;
      var shift = clampTol(start - timeline.voiceStart);
      if (rawSpan > 0 && refSpan > 0) {
        var scale = refSpan / rawSpan;
        // Only a clear difference in pace is stretched. The end anchor is the
        // weaker of the two: a voice trails off at the end of a sentence, and
        // the tracker loses the last ~50 ms of it. On the engine's own たべること
        // that alone read as a 10% pace difference, and stretching by it
        // pushed こ out of its own window. Small differences are left to the
        // slack instead.
        if (Math.abs(scale - 1) > MIN_STRETCH && scale >= 0.67 && scale <= 1.5
            && Math.abs(start - timeline.voiceStart) <= timeline.tolerance) {
          return function (rawT) { return timeline.voiceStart + (rawT - start) * scale; };
        }
      }
      return function (rawT) { return rawT - shift; };
    }

    // The take with tracker errors removed: hops far from its median pitch.
    function cleanedInputs() {
      var sts = [];
      inputs.forEach(function (f) {
        var rawT = f.tMs / 1000 - timeline.leadIn;
        if (f.hz > 0 && rawT >= timeline.barStart && rawT <= timeline.barEnd) sts.push(hzToSemitones(f.hz));
      });
      var mid = median(sts);
      if (mid === null) return inputs;
      return smoothFrames(inputs.map(function (f) {
        if (!(f.hz > 0) || Math.abs(hzToSemitones(f.hz) - mid) <= OUTLIER_ST) return f;
        return { tMs: f.tMs, hz: null };
      }));
    }

    // summary() judges the finished take. snapshot() is the same judgement
    // for a take still in progress: start-aligned only, because the end is
    // not known yet. The live view redraws from snapshots, so what turns
    // green or red while the learner speaks is what the final result says,
    // rather than a cruder live pass that disagreed with it -- in Chrome a
    // correct reading flashed two red syllables that the end-of-take
    // judgement then turned green.
    function summary() { return judge(true); }
    function snapshot() { return judge(false); }

    function judge(stretch) {
      if (!fixedMap) {
        // Re-derive the start and end from the cleaned take, then judge it
        // again on the reference's timeline.
        var cleaned = cleanedInputs();
        var probe = createScorer(timeline, { map: function (t) { return t; } });
        cleaned.forEach(function (frame) { probe.push(frame); });
        var bounds = probe.bounds();
        var map = finalMap(bounds.onset, bounds.lastVoiced, stretch);
        if (map) {
          var pass = createScorer(timeline, { map: map });
          cleaned.forEach(function (frame) { pass.push(frame); });
          var result = pass.summary();
          result.frames = pass.frames;
          return result;
        }
      }
      var hits = 0;
      var misses = 0;
      var moras = timeline.moras.map(function (mora, i) {
        var counts = perMora[i];
        // Hop totals over every judged mora (word + the mora after it), kept
        // for diagnostics; the score itself is per mora, below.
        if (mora.scored) { hits += counts.hits; misses += counts.misses; }
        return {
          index: i,
          kana: mora.kana,
          hits: counts.hits,
          misses: counts.misses,
          scored: mora.scored,
          counted: mora.counted,
          status: moraStatus(counts, mora),
        };
      });
      var scoredTotal = hits + misses;
      // The score is over ALL scored morae that carry pitch -- the word plus
      // the frame's first -- not over the hops that happened to be voiced.
      // Counting hops rewarded the long stretches a learner got right and
      // simply ignored morae they never reached, so a flat reading of a
      // falling word read ~80% and a take stopped after one syllable read
      // 100%. Devoiced morae have no pitch to judge and are left out.
      // Every scored mora is hit or miss, so this is always the word's mora
      // count: 2 of 3 right reads 2/3, never 2/2.
      var judgedMoras = moras.filter(function (m) { return m.counted; });
      var moraHits = judgedMoras.filter(function (m) { return m.status === 'hit'; }).length;
      // The mora after the word: judged, not counted. Reported separately so
      // a wrong drop after the word is still said, without changing 3/3.
      var after = moras.filter(function (m) { return m.scored && !m.counted; })[0] || null;
      var anyVoice = frames.some(function (f) { return f.st !== null && f.status !== 'out'; });
      // Voice still present at the very end of the bar: the recording window
      // closed on speech. Same 60 ms margin the server uses.
      var ranPastEnd = lastVoiced !== null && lastVoiced >= timeline.barEnd - 0.06;
      var endS = lastVoiced;
      return {
        // Share of judged hops that were on target, kept for diagnostics.
        hitRatio: scoredTotal ? hits / scoredTotal : null,
        // Null only when nothing was voiced inside the bar at all: "no voice
        // detected" tells the learner more than a 0% would.
        score: anyVoice && judgedMoras.length
          ? Math.round((100 * moraHits) / judgedMoras.length) : null,
        hits: hits,
        misses: misses,
        moraHits: moraHits,
        moraTotal: judgedMoras.length,
        afterWord: after ? { kana: after.kana, status: after.status } : null,
        moras: moras,
        onsetS: onset === null ? null : round3(onset),
        endS: endS === null ? null : round3(endS),
        ranPastEnd: ranPastEnd,
        timing: timingIssue(onset, endS, ranPastEnd),
        frames: frames,
      };
    }

    function bounds() {
      return { onset: onset, lastVoiced: lastVoiced };
    }

    // Per-mora status from the live hops alone, cheap enough to call on every
    // animation frame for the lyric colours. summary() re-judges the whole
    // take and is meant to be called once, at the end.
    function liveMoras() {
      return timeline.moras.map(function (mora, i) {
        return { index: i, status: moraStatus(perMora[i], mora) };
      });
    }

    return {
      push: push,
      summary: summary,
      snapshot: snapshot,
      frames: frames,
      bounds: bounds,
      liveMoras: liveMoras,
    };
  }

  // Short bilingual line for the karaoke's own result, shown above the
  // coach's verdict. The coach remains the authority on pitch accent; this
  // only reports what the learner watched happen.
  var TIMING_TEXT = {
    none: { ja: 'タイミング◎', en: 'on time' },
    early: { ja: '始めるのが早い', en: 'started early' },
    late: { ja: '始めるのが遅い', en: 'started late' },
    too_slow: { ja: '少しゆっくり', en: 'a little slow' },
    too_fast: { ja: '少し速い', en: 'a little fast' },
    cut_off: { ja: '最後まで入りませんでした', en: 'ran past the end of the bar' },
  };

  function summaryText(summary) {
    if (!summary) return '';
    if (summary.score === null) {
      return '声が検出できませんでした / no voice detected inside the bar';
    }
    var timing = TIMING_TEXT[summary.timing] || TIMING_TEXT.none;
    var moras = summary.moraTotal
      ? { ja: '（' + summary.moraHits + '/' + summary.moraTotal + '拍）', en: ' (' + summary.moraHits + ' of ' + summary.moraTotal + ' morae)' }
      : { ja: '', en: '' };
    // The mora after the word is not in the count, so a miss there is said
    // in words -- otherwise "3/3" would hide a wrong drop after the word.
    var after = summary.afterWord && summary.afterWord.status === 'miss'
      ? { ja: ' ・ 「' + summary.afterWord.kana + '」の高さが違います',
          en: '; the pitch on ' + summary.afterWord.kana + ' after the word is off' }
      : { ja: '', en: '' };
    return '音程 ' + summary.score + '%' + moras.ja + after.ja + ' ・ ' + timing.ja
      + ' / pitch ' + summary.score + '% on target' + moras.en + after.en + ', ' + timing.en;
  }

  // 'good' only when no judged syllable missed: colouring a missed accent
  // drop green because most hops were fine would contradict the red syllable
  // directly above it.
  function grade(summary) {
    if (!summary || summary.score === null) return '';
    var afterMissed = summary.afterWord && summary.afterWord.status === 'miss';
    if (summary.moraTotal && summary.moraHits === summary.moraTotal && !afterMissed) return 'good';
    return summary.score >= 50 ? 'fair' : 'poor';
  }

  // --- browser-only rendering ---------------------------------------------

  function cssVar(el, name, fallback) {
    try {
      var value = getComputedStyle(el).getPropertyValue(name).trim();
      return value || fallback;
    } catch (e) {
      return fallback;
    }
  }

  // createView(container, timeline) -> { update(t, frames), countIn(n), finish(summary), destroy() }
  //
  // Builds the lyric line, the pitch lane (canvas) and the time bar inside
  // `container`, replacing whatever was there.
  function createView(container, timeline) {
    container.innerHTML = '';
    container.hidden = false;

    var countEl = document.createElement('div');
    countEl.className = 'karaoke-countin';
    countEl.setAttribute('aria-live', 'assertive');

    var lyrics = document.createElement('p');
    lyrics.className = 'karaoke-lyrics';
    lyrics.setAttribute('lang', 'ja');
    var moraEls = timeline.moras.map(function (m) {
      var span = document.createElement('span');
      span.className = 'k-mora' + (m.scored ? '' : ' k-frame') + (m.devoiced ? ' k-devoiced' : '');
      span.textContent = m.kana;
      if (m.devoiced) span.title = '無声化 / devoiced';
      lyrics.appendChild(span);
      return span;
    });

    var canvas = document.createElement('canvas');
    canvas.className = 'karaoke-lane';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Pitch bars for ' + timeline.text + ', with your live pitch drawn over them');

    var bar = document.createElement('div');
    bar.className = 'karaoke-timebar';
    var span = timeline.barEnd - timeline.barStart;
    function pct(t) { return ((t - timeline.barStart) / span) * 100; }
    bar.innerHTML =
      '<div class="kt-zone kt-tol" style="left:0;width:' + pct(0) + '%"></div>'
      + '<div class="kt-zone kt-speech" style="left:' + pct(0) + '%;width:' + (pct(timeline.span) - pct(0)) + '%"></div>'
      + '<div class="kt-zone kt-tol" style="left:' + pct(timeline.span) + '%;right:0"></div>'
      + '<div class="kt-fill"></div><div class="kt-cursor"></div>';
    var fill = bar.querySelector('.kt-fill');
    var cursor = bar.querySelector('.kt-cursor');

    var result = document.createElement('p');
    result.className = 'karaoke-result';
    result.hidden = true;

    container.appendChild(countEl);
    container.appendChild(lyrics);
    container.appendChild(canvas);
    container.appendChild(bar);
    container.appendChild(result);

    var colors = {
      hit: cssVar(container, '--correct', '#2e7d32'),
      miss: cssVar(container, '--incorrect', '#c62828'),
      bar: cssVar(container, '--karaoke-bar', 'rgba(120,120,120,0.28)'),
      grid: cssVar(container, '--border', '#ddd'),
      // Not --accent: in this palette it is the same red as --incorrect, and
      // a red cursor reads as a miss.
      cursor: cssVar(container, '--accent-learner', '#2f6fb5'),
      learner: cssVar(container, '--fg', '#2b2b2b'),
      fg: cssVar(container, '--fg', '#222'),
    };

    var ctx = canvas.getContext('2d');
    var width = 0;
    var height = 0;
    // The last thing drawn, so a resize can redraw it. Setting canvas.width
    // wipes the bitmap, and a resize after the take ends (a phone rotating,
    // the page reflowing as the coach's verdict arrives) otherwise left the
    // finished result as an empty box.
    var last = null;

    function resize() {
      var ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth || 320;
      height = canvas.clientHeight || 140;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      halfBand = (PITCH_TOLERANCE_ST / (timeline.range.max - timeline.range.min)) * height;
      if (last) draw(last.t, last.frames);
    }

    function x(t) { return ((t - timeline.barStart) / span) * width; }
    function y(st) {
      var r = timeline.range;
      return height - ((st - r.min) / (r.max - r.min)) * height;
    }
    var halfBand = 0;
    resize();

    function draw(t, frames) {
      last = { t: t, frames: frames };
      ctx.clearRect(0, 0, width, height);

      // Tolerance zones either side of the speech, lightly shaded so the
      // learner can see the bar is forgiving there rather than empty.
      ctx.fillStyle = colors.grid;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, 0, x(0), height);
      ctx.fillRect(x(timeline.span), 0, width - x(timeline.span), height);
      ctx.globalAlpha = 1;

      // Reference pitch bars. Each is as tall as the hit tolerance, so "the
      // dot is inside the bar" and "this hop is green" are the same thing.
      var previousRel = null;
      timeline.moras.forEach(function (m) {
        var x0 = x(m.start) + 1;
        var w = Math.max(2, x(m.end) - x(m.start) - 2);
        if (m.rel == null) {
          // A devoiced mora has no pitch to match: drawn as an outline at the
          // previous level so the timing is still visible.
          var level = previousRel != null ? previousRel : (timeline.range.min + timeline.range.max) / 2;
          ctx.strokeStyle = colors.fg;
          ctx.globalAlpha = 0.4;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(x0, y(level) - halfBand, w, halfBand * 2);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          return;
        }
        previousRel = m.rel;
        ctx.fillStyle = colors.bar;
        ctx.globalAlpha = m.scored ? 1 : 0.55;
        ctx.fillRect(x0, y(m.rel) - halfBand, w, halfBand * 2);
        ctx.globalAlpha = 1;
      });

      // Green/red wipe on the bars: each judged hop paints its slice of the
      // bar it was judged against, so the bar fills in as the learner speaks.
      var hopW = Math.max(1.5, x(0.012) - x(0));
      frames.forEach(function (f) {
        if ((f.status !== 'hit' && f.status !== 'miss') || f.moraIndex == null) return;
        var m = timeline.moras[f.moraIndex];
        if (m.rel == null) return;
        ctx.fillStyle = f.status === 'hit' ? colors.hit : colors.miss;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x(f.t) - hopW / 2, y(m.rel) - halfBand, hopW, halfBand * 2);
      });
      ctx.globalAlpha = 1;

      // The learner's own mapped pitch, as dots coloured by verdict. Dots
      // rather than a line: unvoiced hops break the contour, and joining
      // across them draws pitch that was never there.
      frames.forEach(function (f) {
        if (f.mapped == null) return;
        ctx.fillStyle = f.status === 'hit' ? colors.hit : f.status === 'miss' ? colors.miss : colors.learner;
        ctx.beginPath();
        ctx.arc(x(f.t), y(f.mapped), 2.2, 0, Math.PI * 2);
        ctx.fill();
      });

      // Cursor.
      if (t >= timeline.barStart && t <= timeline.barEnd) {
        ctx.strokeStyle = colors.cursor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x(t), 0);
        ctx.lineTo(x(t), height);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    function updateLyrics(t, live) {
      timeline.moras.forEach(function (m, i) {
        var el = moraEls[i];
        var active = t >= m.start && t < m.end;
        el.classList.toggle('active', active);
        if (t >= m.end && live) {
          var status = live[i] && live[i].status;
          el.classList.toggle('hit', status === 'hit' || status === 'given');
          el.classList.toggle('miss', status === 'miss');
          el.classList.add('past');
        }
      });
    }

    function update(t, frames, live) {
      var clamped = Math.max(timeline.barStart, Math.min(timeline.barEnd, t));
      var p = pct(clamped);
      fill.style.width = p + '%';
      cursor.style.left = p + '%';
      bar.classList.toggle('kt-waiting', t < timeline.barStart);
      updateLyrics(t, live);
      draw(t, frames || []);
    }

    function countIn(n) {
      countEl.textContent = n > 0 ? String(n) : '';
      countEl.hidden = !(n > 0);
    }

    function finish(summary, frames) {
      countIn(0);
      update(timeline.barEnd + 1, frames, summary && summary.moras);
      result.hidden = false;
      result.textContent = summaryText(summary);
      var g = grade(summary);
      result.className = 'karaoke-result' + (g ? ' ' + g : '');
    }

    function destroy() {
      container.innerHTML = '';
      container.hidden = true;
    }

    window.addEventListener('resize', resize);
    update(timeline.barStart - 1, []);

    return {
      update: update,
      countIn: countIn,
      finish: finish,
      destroy: function () {
        window.removeEventListener('resize', resize);
        destroy();
      },
    };
  }

  return {
    SPEEDS: SPEEDS,
    BASE_TOLERANCE_S: BASE_TOLERANCE_S,
    BASE_SLACK_S: BASE_SLACK_S,
    PITCH_TOLERANCE_ST: PITCH_TOLERANCE_ST,
    COUNT_IN_BEATS: COUNT_IN_BEATS,
    toleranceFor: toleranceFor,
    slackFor: slackFor,
    countInFor: countInFor,
    hzToSemitones: hzToSemitones,
    buildTimeline: buildTimeline,
    createScorer: createScorer,
    summaryText: summaryText,
    stepRange: stepRange,
    smoothFrames: smoothFrames,
    SMOOTH_SIGMA_S: SMOOTH_SIGMA_S,
    grade: grade,
    createView: createView,
  };
});
