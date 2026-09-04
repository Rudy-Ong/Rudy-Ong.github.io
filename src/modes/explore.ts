/**
 * Explore mode: pick a mora, watch the mouth make it, read what the shape is
 * actually doing.
 */

import { createArticulator } from '../articulate';
import { MORAE, MORA_BY_KANA, VISEME_CLASS_INFO, moraShapes, type Mora } from '../data/visemes';

const PARAM_LABELS: Array<[keyof ReturnType<typeof moraShapes>['vowel'], string]> = [
  ['aperture', 'Aperture'],
  ['spread', 'Lip spread'],
  ['rounding', 'Rounding'],
  ['jaw', 'Jaw drop'],
  ['teeth', 'Teeth shown'],
  ['tongue', 'Tongue height'],
];

export function createExplore(): { el: HTMLElement; deactivate(): void } {
  const root = document.createElement('div');
  root.className = 'mode mode-explore';

  const stage = document.createElement('div');
  stage.className = 'stage';

  const art = createArticulator();
  stage.appendChild(art.mouth.svg);

  const panel = document.createElement('div');
  panel.className = 'panel';

  const heading = document.createElement('div');
  heading.className = 'panel-head';
  panel.appendChild(heading);

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

  let selected: Mora = MORA_BY_KANA.get('あ')!;

  function renderPanel(m: Mora): void {
    const { vowel } = moraShapes(m);
    const info = VISEME_CLASS_INFO[m.cls];

    heading.innerHTML = '';
    const kana = document.createElement('span');
    kana.className = 'panel-kana';
    kana.textContent = m.kana;
    const meta = document.createElement('span');
    meta.className = 'panel-meta';
    meta.innerHTML = `<strong>${m.romaji}</strong><span class="tag">${info.label}</span>`;
    heading.append(kana, meta);

    bars.innerHTML = '';
    for (const [key, label] of PARAM_LABELS) {
      const value = vowel[key];
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${Math.round(value * 100)}%`;
      track.appendChild(fill);
      dd.append(track);
      bars.append(dt, dd);
    }

    note.textContent = info.note;
  }

  function select(m: Mora, { play = true } = {}): void {
    selected = m;
    for (const btn of picker.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.kana === m.kana));
    }
    renderPanel(m);
    if (play) void art.say([m]);
    else art.mouth.apply(moraShapes(m).vowel);
  }

  for (const m of MORAE) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kana-btn';
    btn.textContent = m.kana;
    btn.dataset.kana = m.kana;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${m.kana} (${m.romaji})`);
    btn.addEventListener('click', () => select(m));
    picker.appendChild(btn);
  }

  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'btn';
  replay.textContent = 'Replay';
  replay.addEventListener('click', () => void art.say([selected]));
  panel.appendChild(replay);

  const top = document.createElement('div');
  top.className = 'explore-top';
  top.append(stage, panel);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Pick any mora. Notice how much of the row shares one shape — that overlap is exactly what makes lip reading hard.';

  root.append(top, hint, picker);
  select(selected, { play: false });

  return {
    el: root,
    deactivate() {
      art.stop();
    },
  };
}
