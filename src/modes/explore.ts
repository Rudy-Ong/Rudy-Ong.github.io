/**
 * Articulation mode: pick a mora, watch the mouth make it, and toggle voicing.
 *
 * The toggle is the point. Switching a devoicing candidate to devoiced leaves
 * the mouth shape completely unchanged and flattens the glottis trace below it
 * — which is exactly why devoicing cannot be read off the lips, and why it has
 * to be recovered from the signal instead.
 */

import { createArticulator } from '../articulate';
import {
  MORAE,
  MORA_BY_KANA,
  VISEME_CLASS_INFO,
  isDevoicingCandidate,
  moraShapes,
  type Mora,
} from '../data/visemes';

const PARAM_LABELS: Array<[keyof ReturnType<typeof moraShapes>['vowel'], string]> = [
  ['aperture', 'Aperture'],
  ['spread', 'Lip spread'],
  ['rounding', 'Rounding'],
  ['jaw', 'Jaw drop'],
  ['teeth', 'Teeth shown'],
  ['tongue', 'Tongue height'],
];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A glottis trace: a wave when the folds vibrate, a flat line when they don't. */
function createGlottis(): { el: SVGSVGElement; setVoiced(voiced: boolean): void } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 44');
  svg.setAttribute('class', 'glottis');
  svg.setAttribute('role', 'img');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', 'glottis-line');
  svg.appendChild(path);

  const voicedD = (() => {
    const pts: string[] = [];
    for (let x = 0; x <= 300; x += 2) {
      // Two stacked harmonics read as a glottal pulse rather than a pure tone.
      const y = 22 - Math.sin(x / 7.5) * 11 - Math.sin(x / 3.1) * 3;
      pts.push(`${pts.length === 0 ? 'M' : 'L'} ${x} ${y.toFixed(2)}`);
    }
    return pts.join(' ');
  })();
  const flatD = 'M 0 22 L 300 22';

  function setVoiced(voiced: boolean): void {
    path.setAttribute('d', voiced ? voicedD : flatD);
    svg.classList.toggle('is-voiceless', !voiced);
    svg.setAttribute('aria-label', voiced ? 'Vocal folds vibrating' : 'Vocal folds silent — devoiced');
  }

  setVoiced(true);
  return { el: svg, setVoiced };
}

export function createExplore(): { el: HTMLElement; deactivate(): void } {
  const root = document.createElement('div');
  root.className = 'mode mode-explore';

  const stage = document.createElement('div');
  stage.className = 'stage stage-stack';

  const art = createArticulator();
  const glottis = createGlottis();
  stage.append(art.mouth.svg, glottis.el);

  const panel = document.createElement('div');
  panel.className = 'panel';

  const heading = document.createElement('div');
  heading.className = 'panel-head';
  panel.appendChild(heading);

  const voicingRow = document.createElement('div');
  voicingRow.className = 'voicing-row';
  panel.appendChild(voicingRow);

  const bars = document.createElement('dl');
  bars.className = 'bars';
  panel.appendChild(bars);

  const note = document.createElement('p');
  note.className = 'panel-note';
  panel.appendChild(note);

  const picker = document.createElement('div');
  picker.className = 'picker';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Choose a Japanese mora');

  let selected: Mora = MORA_BY_KANA.get('す')!;
  let devoiced = false;

  function renderPanel(m: Mora): void {
    const { vowel } = moraShapes(m);
    const info = VISEME_CLASS_INFO[m.cls];
    const candidate = isDevoicingCandidate(m);

    heading.innerHTML = '';
    const kana = document.createElement('span');
    kana.className = 'panel-kana';
    kana.textContent = m.kana;
    const meta = document.createElement('span');
    meta.className = 'panel-meta';
    meta.innerHTML =
      `<strong>${m.romaji}</strong><span class="tag">${info.label}</span>` +
      (candidate ? '<span class="tag tag-devoice">devoicing candidate</span>' : '');
    heading.append(kana, meta);

    bars.innerHTML = '';
    for (const [key, label] of PARAM_LABELS) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${Math.round(vowel[key] * 100)}%`;
      track.appendChild(fill);
      dd.append(track);
      bars.append(dt, dd);
    }

    note.textContent = devoiced
      ? 'Same mouth, no voicing. Every articulatory parameter above is unchanged — the difference is entirely at the vocal folds, which is why it cannot be seen.'
      : info.note;
  }

  function renderVoicing(m: Mora): void {
    const candidate = isDevoicingCandidate(m);
    voicingRow.innerHTML = '';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn toggle';
    toggle.setAttribute('aria-pressed', String(devoiced));
    toggle.textContent = devoiced ? 'Devoiced' : 'Voiced';
    toggle.addEventListener('click', () => {
      devoiced = !devoiced;
      glottis.setVoiced(!devoiced);
      renderVoicing(selected);
      renderPanel(selected);
      void art.say([selected]);
    });

    const hint = document.createElement('span');
    hint.className = 'voicing-hint';
    hint.textContent = candidate
      ? 'This mora really does devoice between voiceless consonants.'
      : 'In real speech this one stays voiced — only /i/ and /u/ after a voiceless consonant devoice.';

    voicingRow.append(toggle, hint);
  }

  function select(m: Mora, { play = true } = {}): void {
    selected = m;
    for (const btn of picker.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.kana === m.kana));
    }
    renderVoicing(m);
    renderPanel(m);
    if (play) void art.say([m]);
    else art.mouth.apply(moraShapes(m).vowel);
  }

  for (const m of MORAE) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `kana-btn${isDevoicingCandidate(m) ? ' is-candidate' : ''}`;
    btn.textContent = m.kana;
    btn.dataset.kana = m.kana;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute(
      'aria-label',
      `${m.kana} (${m.romaji})${isDevoicingCandidate(m) ? ', devoicing candidate' : ''}`,
    );
    btn.addEventListener('click', () => select(m));
    picker.appendChild(btn);
  }

  const top = document.createElement('div');
  top.className = 'explore-top';
  top.append(stage, panel);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.innerHTML =
    'Pick any mora, then flip voicing on and off. Morae marked with a dot are the ones that genuinely devoice in Japanese — ' +
    '<strong>/i/</strong> and <strong>/u/</strong> after a voiceless consonant.';

  root.append(top, hint, picker);
  select(selected, { play: false });
  glottis.setVoiced(true);

  return {
    el: root,
    deactivate() {
      art.stop();
    },
  };
}
