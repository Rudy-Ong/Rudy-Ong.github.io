/**
 * Play mode: the mouth says a word silently; you guess which one.
 *
 * The four options in every round share an identical vowel sequence, so the
 * vowels — the most visible part — give nothing away and the answer rests
 * entirely on consonant visemes. Some of those are genuinely indistinguishable,
 * which is the point being made rather than a flaw in the puzzle.
 */

import { createArticulator } from '../articulate';
import { MORA_BY_KANA, VISEME_CLASS_INFO, type Mora } from '../data/visemes';

interface Word {
  kana: string;
  romaji: string;
  gloss: string;
}

/** Each set shares one vowel pattern. */
const CONFUSION_SETS: Word[][] = [
  [
    { kana: 'はな', romaji: 'hana', gloss: 'flower' },
    { kana: 'かた', romaji: 'kata', gloss: 'shoulder' },
    { kana: 'さか', romaji: 'saka', gloss: 'slope' },
    { kana: 'たな', romaji: 'tana', gloss: 'shelf' },
  ],
  [
    { kana: 'ねこ', romaji: 'neko', gloss: 'cat' },
    { kana: 'めも', romaji: 'memo', gloss: 'memo' },
    { kana: 'へそ', romaji: 'heso', gloss: 'navel' },
    { kana: 'てこ', romaji: 'teko', gloss: 'lever' },
  ],
  [
    { kana: 'くち', romaji: 'kuchi', gloss: 'mouth' },
    { kana: 'つき', romaji: 'tsuki', gloss: 'moon' },
    { kana: 'むぎ', romaji: 'mugi', gloss: 'wheat' },
    { kana: 'ふじ', romaji: 'fuji', gloss: 'wisteria' },
  ],
  [
    { kana: 'そら', romaji: 'sora', gloss: 'sky' },
    { kana: 'ほか', romaji: 'hoka', gloss: 'elsewhere' },
    { kana: 'こな', romaji: 'kona', gloss: 'powder' },
    { kana: 'とら', romaji: 'tora', gloss: 'tiger' },
  ],
  [
    { kana: 'あめ', romaji: 'ame', gloss: 'rain' },
    { kana: 'はれ', romaji: 'hare', gloss: 'clear sky' },
    { kana: 'まえ', romaji: 'mae', gloss: 'front' },
    { kana: 'たけ', romaji: 'take', gloss: 'bamboo' },
  ],
  [
    { kana: 'ふね', romaji: 'fune', gloss: 'boat' },
    { kana: 'つめ', romaji: 'tsume', gloss: 'fingernail' },
    { kana: 'うめ', romaji: 'ume', gloss: 'plum' },
    { kana: 'むね', romaji: 'mune', gloss: 'chest' },
  ],
  [
    { kana: 'いま', romaji: 'ima', gloss: 'now' },
    { kana: 'きた', romaji: 'kita', gloss: 'north' },
    { kana: 'しま', romaji: 'shima', gloss: 'island' },
    { kana: 'ちか', romaji: 'chika', gloss: 'underground' },
  ],
  [
    { kana: 'おと', romaji: 'oto', gloss: 'sound' },
    { kana: 'こと', romaji: 'koto', gloss: 'thing' },
    { kana: 'もの', romaji: 'mono', gloss: 'object' },
    { kana: 'のど', romaji: 'nodo', gloss: 'throat' },
  ],
];

function toMorae(kana: string): Mora[] {
  return [...kana].map((ch) => {
    const m = MORA_BY_KANA.get(ch);
    if (!m) throw new Error(`Word uses an unsupported kana: ${ch}`);
    return m;
  });
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function createPlay(): { el: HTMLElement; deactivate(): void } {
  const root = document.createElement('div');
  root.className = 'mode mode-play';

  const art = createArticulator();

  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.appendChild(art.mouth.svg);

  const side = document.createElement('div');
  side.className = 'panel';

  const score = document.createElement('div');
  score.className = 'score';

  const prompt = document.createElement('p');
  prompt.className = 'panel-note';
  prompt.textContent = 'Watch the mouth, then pick the word it said.';

  const options = document.createElement('div');
  options.className = 'options';

  const feedback = document.createElement('div');
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');

  const controls = document.createElement('div');
  controls.className = 'controls';
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'btn';
  replay.textContent = 'Replay';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-primary';
  next.textContent = 'Next word';
  next.hidden = true;
  controls.append(replay, next);

  side.append(score, prompt, options, feedback, controls);

  const top = document.createElement('div');
  top.className = 'explore-top';
  top.append(stage, side);
  root.append(top);

  let answer: Word = CONFUSION_SETS[0]![0]!;
  let round: Word[] = [];
  let answered = false;
  let correct = 0;
  let total = 0;
  let lastSetIndex = -1;

  function renderScore(): void {
    score.textContent = total === 0 ? 'No guesses yet' : `${correct} of ${total} correct`;
  }

  function say(): void {
    void art.say(toMorae(answer.kana));
  }

  function newRound(): void {
    let idx = Math.floor(Math.random() * CONFUSION_SETS.length);
    if (CONFUSION_SETS.length > 1 && idx === lastSetIndex) {
      idx = (idx + 1) % CONFUSION_SETS.length;
    }
    lastSetIndex = idx;

    const set = CONFUSION_SETS[idx]!;
    round = shuffle(set);
    answer = round[Math.floor(Math.random() * round.length)]!;
    answered = false;
    feedback.textContent = '';
    feedback.className = 'feedback';
    next.hidden = true;

    options.innerHTML = '';
    for (const word of round) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.innerHTML = `<span class="option-kana">${word.kana}</span><span class="option-romaji">${word.romaji}</span>`;
      btn.addEventListener('click', () => guess(word, btn));
      options.appendChild(btn);
    }

    renderScore();
    say();
  }

  function guess(word: Word, btn: HTMLButtonElement): void {
    if (answered) return;
    answered = true;
    total += 1;
    const right = word.kana === answer.kana;
    if (right) correct += 1;

    for (const b of options.querySelectorAll('button')) b.disabled = true;
    btn.classList.add(right ? 'is-correct' : 'is-wrong');
    if (!right) {
      const answerBtn = [...options.querySelectorAll('button')].find(
        (b) => b.querySelector('.option-kana')?.textContent === answer.kana,
      );
      answerBtn?.classList.add('is-correct');
    }

    // Name the specific confusion rather than just right/wrong — that is the
    // part worth taking away.
    const firstAnswer = MORA_BY_KANA.get([...answer.kana][0]!);
    const firstGuess = MORA_BY_KANA.get([...word.kana][0]!);
    let why = '';
    if (!right && firstAnswer && firstGuess && firstAnswer.cls === firstGuess.cls) {
      why = ` Both start with a ${VISEME_CLASS_INFO[firstAnswer.cls].label.toLowerCase()} shape — from outside they look the same.`;
    }

    feedback.className = `feedback ${right ? 'is-correct' : 'is-wrong'}`;
    feedback.textContent = right
      ? `Correct — ${answer.kana} (${answer.romaji}), ${answer.gloss}.`
      : `It was ${answer.kana} (${answer.romaji}), ${answer.gloss}.${why}`;

    renderScore();
    next.hidden = false;
    next.focus();
  }

  replay.addEventListener('click', say);
  next.addEventListener('click', newRound);

  newRound();

  return {
    el: root,
    deactivate() {
      art.stop();
    },
  };
}
