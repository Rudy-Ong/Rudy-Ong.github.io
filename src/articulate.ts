/**
 * Drives a mouth through a sequence of morae.
 *
 * Each mora is two targets — the consonant closure, then the vowel — and the
 * mouth eases between them. Coarticulation is approximated by never fully
 * settling: the next closure begins while the current vowel is still opening,
 * which is what makes the motion read as speech rather than a slideshow.
 */

import { createMouth, type MouthParts } from './mouth';
import { NEUTRAL, lerpShape, moraShapes, type Mora, type MouthShape } from './data/visemes';

/** Milliseconds. Roughly a relaxed speaking rate. */
const CLOSURE_MS = 110;
const RELEASE_MS = 105;
const HOLD_MS = 130;
const MORA_MS = CLOSURE_MS + RELEASE_MS + HOLD_MS;
const SETTLE_MS = 260;

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface Articulator {
  mouth: MouthParts;
  /** Play a sequence. Resolves when finished; a new call cancels the old one. */
  say(morae: Mora[]): Promise<void>;
  /** Jump straight to a shape and stay there. */
  hold(shape: MouthShape): void;
  stop(): void;
  /** Index of the mora currently being articulated, or -1. */
  currentIndex(): number;
}

export function createArticulator(): Articulator {
  const mouth = createMouth();
  let frame = 0;
  let cancel: (() => void) | null = null;
  let index = -1;

  mouth.apply(NEUTRAL);

  function stop(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (cancel) {
      const c = cancel;
      cancel = null;
      c();
    }
    index = -1;
  }

  function hold(shape: MouthShape): void {
    stop();
    mouth.apply(shape);
  }

  function say(morae: Mora[]): Promise<void> {
    stop();
    if (morae.length === 0) return Promise.resolve();

    // With reduced motion we step through the vowel targets discretely instead
    // of animating between them — the information is still conveyed.
    if (prefersReducedMotion()) {
      return new Promise((resolve) => {
        let i = 0;
        const tick = (): void => {
          const m = morae[i];
          if (!m) {
            index = -1;
            mouth.apply(NEUTRAL);
            resolve();
            return;
          }
          index = i;
          mouth.apply(moraShapes(m).vowel);
          i += 1;
          const id = window.setTimeout(tick, 520);
          cancel = () => {
            clearTimeout(id);
            resolve();
          };
        };
        tick();
        return;
      });
    }

    const total = morae.length * MORA_MS + SETTLE_MS;

    return new Promise((resolve) => {
      const start = performance.now();
      let settled = false;

      cancel = () => {
        settled = true;
        resolve();
      };

      const step = (now: number): void => {
        if (settled) return;
        const elapsed = now - start;

        if (elapsed >= total) {
          index = -1;
          mouth.apply(NEUTRAL);
          settled = true;
          cancel = null;
          resolve();
          return;
        }

        const i = Math.min(morae.length - 1, Math.floor(elapsed / MORA_MS));
        const local = elapsed - i * MORA_MS;
        const m = morae[i];

        if (!m) {
          frame = requestAnimationFrame(step);
          return;
        }

        index = i;
        const { onset, vowel } = moraShapes(m);
        const prev = i > 0 ? moraShapes(morae[i - 1]!).vowel : NEUTRAL;

        let shape: MouthShape;
        if (elapsed >= morae.length * MORA_MS) {
          // Trailing relax back to neutral.
          const k = (elapsed - morae.length * MORA_MS) / SETTLE_MS;
          shape = lerpShape(moraShapes(morae[morae.length - 1]!).vowel, NEUTRAL, easeInOut(k));
        } else if (local < CLOSURE_MS) {
          shape = lerpShape(prev, onset, easeInOut(local / CLOSURE_MS));
        } else if (local < CLOSURE_MS + RELEASE_MS) {
          shape = lerpShape(onset, vowel, easeInOut((local - CLOSURE_MS) / RELEASE_MS));
        } else {
          shape = vowel;
        }

        mouth.apply(shape);
        frame = requestAnimationFrame(step);
      };

      frame = requestAnimationFrame(step);
    });
  }

  return { mouth, say, hold, stop, currentIndex: () => index };
}
