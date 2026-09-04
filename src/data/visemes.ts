/**
 * The articulatory model behind the mouth.
 *
 * Shapes are described by a handful of numbers rather than hand-drawn paths, so
 * any two can be interpolated by simply blending the numbers. Everything here
 * is tunable in one place without touching rendering code.
 */

export interface MouthShape {
  /** Vertical opening between the lips, 0 = sealed, 1 = fully open. */
  aperture: number;
  /** Horizontal lip spread. 0 = pursed, 1 = wide as in a smile. */
  spread: number;
  /** Lip rounding and forward protrusion, as in /u/ and /o/. */
  rounding: number;
  /** Jaw drop. Tracks aperture loosely but not exactly. */
  jaw: number;
  /** How much of the upper teeth show. */
  teeth: number;
  /** Tongue height in the opening; visible for /l/, /n/, /r/-type sounds. */
  tongue: number;
}

export const NEUTRAL: MouthShape = {
  aperture: 0.06,
  spread: 0.45,
  rounding: 0.1,
  jaw: 0.08,
  teeth: 0,
  tongue: 0,
};

/** The five Japanese vowels — the backbone of every mora. */
export const VOWELS: Record<string, MouthShape> = {
  a: { aperture: 0.88, spread: 0.58, rounding: 0.04, jaw: 0.92, teeth: 0.35, tongue: 0.15 },
  i: { aperture: 0.2, spread: 1.0, rounding: 0.0, jaw: 0.16, teeth: 0.85, tongue: 0.5 },
  u: { aperture: 0.26, spread: 0.14, rounding: 0.88, jaw: 0.24, teeth: 0.1, tongue: 0.3 },
  e: { aperture: 0.52, spread: 0.82, rounding: 0.04, jaw: 0.46, teeth: 0.6, tongue: 0.35 },
  o: { aperture: 0.58, spread: 0.3, rounding: 0.66, jaw: 0.56, teeth: 0.15, tongue: 0.2 },
};

/**
 * Viseme classes: groups of sounds that look the same on the lips.
 *
 * This grouping is the entire reason lip reading is hard, and the reason an
 * audio-visual model beats a video-only one. /m/, /b/ and /p/ are a single
 * visual event — the lips close and reopen — and no amount of video resolution
 * separates them. The game leans on this deliberately.
 */
export type VisemeClass = 'bilabial' | 'labiodental' | 'alveolar' | 'velar' | 'palatal' | 'open';

export const VISEME_CLASS_INFO: Record<VisemeClass, { label: string; note: string }> = {
  bilabial: {
    label: 'Bilabial',
    note: 'Both lips close completely. /m/, /b/ and /p/ are visually identical — only audio tells them apart.',
  },
  labiodental: {
    label: 'Labiodental',
    note: 'Lower lip meets the upper teeth. One of the few visually distinctive consonants.',
  },
  alveolar: {
    label: 'Alveolar',
    note: 'Tongue tip at the ridge behind the teeth. /t/, /d/, /n/, /s/, /r/ look nearly the same from outside.',
  },
  velar: {
    label: 'Velar',
    note: 'Closure at the back of the mouth, almost invisible from the front. /k/ and /g/ hide here.',
  },
  palatal: { label: 'Palatal', note: 'Tongue body raised toward the hard palate; the lips spread slightly.' },
  open: { label: 'Open', note: 'No consonant constriction — the vowel shape shows through unobstructed.' },
};

/** How a consonant's closure modifies the following vowel's shape. */
const ONSETS: Record<string, { cls: VisemeClass; shape: Partial<MouthShape> }> = {
  '': { cls: 'open', shape: {} },
  k: { cls: 'velar', shape: { aperture: 0.3, teeth: 0.3 } },
  g: { cls: 'velar', shape: { aperture: 0.3, teeth: 0.3 } },
  s: { cls: 'alveolar', shape: { aperture: 0.16, spread: 0.8, teeth: 0.9, tongue: 0.55 } },
  z: { cls: 'alveolar', shape: { aperture: 0.16, spread: 0.8, teeth: 0.9, tongue: 0.55 } },
  t: { cls: 'alveolar', shape: { aperture: 0.14, teeth: 0.8, tongue: 0.7 } },
  d: { cls: 'alveolar', shape: { aperture: 0.14, teeth: 0.8, tongue: 0.7 } },
  n: { cls: 'alveolar', shape: { aperture: 0.16, teeth: 0.6, tongue: 0.8 } },
  h: { cls: 'open', shape: { aperture: 0.34 } },
  b: { cls: 'bilabial', shape: { aperture: 0, spread: 0.4, teeth: 0, tongue: 0 } },
  p: { cls: 'bilabial', shape: { aperture: 0, spread: 0.4, teeth: 0, tongue: 0 } },
  m: { cls: 'bilabial', shape: { aperture: 0, spread: 0.4, teeth: 0, tongue: 0 } },
  f: { cls: 'labiodental', shape: { aperture: 0.08, spread: 0.55, teeth: 0.75, tongue: 0 } },
  y: { cls: 'palatal', shape: { aperture: 0.24, spread: 0.85, tongue: 0.6 } },
  r: { cls: 'alveolar', shape: { aperture: 0.22, tongue: 0.75 } },
  w: { cls: 'bilabial', shape: { aperture: 0.18, spread: 0.16, rounding: 0.85 } },
};

export interface Mora {
  kana: string;
  romaji: string;
  onset: string;
  vowel: keyof typeof VOWELS;
  cls: VisemeClass;
}

function mora(kana: string, romaji: string, onset: string, vowel: string): Mora {
  const entry = ONSETS[onset];
  if (!entry) throw new Error(`Unknown onset: ${onset}`);
  return { kana, romaji, onset, vowel: vowel as keyof typeof VOWELS, cls: entry.cls };
}

/** The gojūon rows the toy exposes. Enough to build real words from. */
export const MORAE: Mora[] = [
  mora('あ', 'a', '', 'a'), mora('い', 'i', '', 'i'), mora('う', 'u', '', 'u'),
  mora('え', 'e', '', 'e'), mora('お', 'o', '', 'o'),
  mora('か', 'ka', 'k', 'a'), mora('き', 'ki', 'k', 'i'), mora('く', 'ku', 'k', 'u'),
  mora('け', 'ke', 'k', 'e'), mora('こ', 'ko', 'k', 'o'),
  mora('さ', 'sa', 's', 'a'), mora('し', 'shi', 's', 'i'), mora('す', 'su', 's', 'u'),
  mora('せ', 'se', 's', 'e'), mora('そ', 'so', 's', 'o'),
  mora('た', 'ta', 't', 'a'), mora('ち', 'chi', 't', 'i'), mora('つ', 'tsu', 't', 'u'),
  mora('て', 'te', 't', 'e'), mora('と', 'to', 't', 'o'),
  mora('な', 'na', 'n', 'a'), mora('に', 'ni', 'n', 'i'), mora('ぬ', 'nu', 'n', 'u'),
  mora('ね', 'ne', 'n', 'e'), mora('の', 'no', 'n', 'o'),
  mora('は', 'ha', 'h', 'a'), mora('ひ', 'hi', 'h', 'i'), mora('ふ', 'fu', 'f', 'u'),
  mora('へ', 'he', 'h', 'e'), mora('ほ', 'ho', 'h', 'o'),
  mora('ま', 'ma', 'm', 'a'), mora('み', 'mi', 'm', 'i'), mora('む', 'mu', 'm', 'u'),
  mora('め', 'me', 'm', 'e'), mora('も', 'mo', 'm', 'o'),
  mora('や', 'ya', 'y', 'a'), mora('ゆ', 'yu', 'y', 'u'), mora('よ', 'yo', 'y', 'o'),
  mora('ら', 'ra', 'r', 'a'), mora('り', 'ri', 'r', 'i'), mora('る', 'ru', 'r', 'u'),
  mora('れ', 're', 'r', 'e'), mora('ろ', 'ro', 'r', 'o'),
  mora('わ', 'wa', 'w', 'a'),
  mora('ば', 'ba', 'b', 'a'), mora('び', 'bi', 'b', 'i'), mora('ぶ', 'bu', 'b', 'u'),
  mora('べ', 'be', 'b', 'e'), mora('ぼ', 'bo', 'b', 'o'),
  mora('ぱ', 'pa', 'p', 'a'), mora('ぴ', 'pi', 'p', 'i'), mora('ぷ', 'pu', 'p', 'u'),
  mora('ぺ', 'pe', 'p', 'e'), mora('ぽ', 'po', 'p', 'o'),
  mora('が', 'ga', 'g', 'a'), mora('ぎ', 'gi', 'g', 'i'), mora('ぐ', 'gu', 'g', 'u'),
  mora('げ', 'ge', 'g', 'e'), mora('ご', 'go', 'g', 'o'),
];

export const MORA_BY_KANA = new Map(MORAE.map((m) => [m.kana, m]));

/**
 * The two shapes a mora passes through: the consonant closure, then the vowel.
 * A mora with no onset goes straight to its vowel.
 */
export function moraShapes(m: Mora): { onset: MouthShape; vowel: MouthShape } {
  const vowel = VOWELS[m.vowel];
  if (!vowel) throw new Error(`Unknown vowel: ${m.vowel}`);
  const entry = ONSETS[m.onset];
  const onsetShape: MouthShape = { ...vowel, ...(entry ? entry.shape : {}) };
  return { onset: onsetShape, vowel };
}

export function lerpShape(a: MouthShape, b: MouthShape, t: number): MouthShape {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    aperture: a.aperture + (b.aperture - a.aperture) * k,
    spread: a.spread + (b.spread - a.spread) * k,
    rounding: a.rounding + (b.rounding - a.rounding) * k,
    jaw: a.jaw + (b.jaw - a.jaw) * k,
    teeth: a.teeth + (b.teeth - a.teeth) * k,
    tongue: a.tongue + (b.tongue - a.tongue) * k,
  };
}
