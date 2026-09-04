/**
 * Fusion mode: why audio-visual beats either stream alone.
 *
 * Drag the noise slider and watch the audio-only curve collapse while the
 * video-only curve sits flat — acoustic noise does not touch the lips. Where
 * they cross is the whole argument for fusion.
 *
 * The curves are an ILLUSTRATIVE MODEL, not measured results. They reproduce
 * the qualitative behaviour reported across the AVSR literature; they are not
 * benchmark numbers from any particular system, and the UI says so.
 */

const SNR_MIN = -15;
const SNR_MAX = 20;

const W = 560;
const H = 280;
const M = { top: 18, right: 18, bottom: 40, left: 46 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Word accuracy from audio alone: a sigmoid in SNR. */
function audioAcc(snr: number): number {
  return 0.06 + 0.92 / (1 + Math.exp(-(snr + 2) / 3.2));
}

/** Lip reading is unaffected by acoustic noise — and capped well below audio. */
function videoAcc(): number {
  return 0.42;
}

/** Complementary combination: each stream covers what the other misses. */
function fusionAcc(snr: number): number {
  const a = audioAcc(snr);
  const v = videoAcc();
  return Math.min(0.985, 1 - (1 - a) * (1 - v * 0.85));
}

const x = (snr: number): number => M.left + ((snr - SNR_MIN) / (SNR_MAX - SNR_MIN)) * PLOT_W;
const y = (acc: number): number => M.top + (1 - acc) * PLOT_H;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function linePath(fn: (snr: number) => number): string {
  const pts: string[] = [];
  for (let snr = SNR_MIN; snr <= SNR_MAX; snr += 0.5) {
    pts.push(`${pts.length === 0 ? 'M' : 'L'} ${x(snr).toFixed(2)} ${y(fn(snr)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const CHANNELS = [
  {
    id: 'audio',
    label: 'Audio only',
    fn: audioAcc,
    blurb: 'Waveform in, no video. Excellent when the room is quiet; falls apart when it is not.',
  },
  {
    id: 'video',
    label: 'Video only',
    fn: videoAcc,
    blurb: 'Lips only, no sound. Immune to acoustic noise, but limited by visemes that look alike.',
  },
  {
    id: 'fusion',
    label: 'Audio-visual',
    fn: fusionAcc,
    blurb: 'Both streams fused. Tracks audio when audio is good, falls back on the lips when it is not.',
  },
] as const;

export function createFusion(): { el: HTMLElement; deactivate(): void } {
  const root = document.createElement('div');
  root.className = 'mode mode-fusion';

  const intro = document.createElement('p');
  intro.className = 'hint';
  intro.textContent =
    'Drag the noise level. The audio curve collapses as the room gets louder; the lips do not care. Where the lines cross is where watching the mouth becomes the better bet.';

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    role: 'img',
    'aria-label':
      'Chart of word accuracy against signal-to-noise ratio for audio-only, video-only and audio-visual input',
  });

  // Grid and axes
  for (let acc = 0; acc <= 1.0001; acc += 0.25) {
    svg.appendChild(
      el('line', {
        x1: String(M.left), x2: String(M.left + PLOT_W),
        y1: y(acc).toFixed(2), y2: y(acc).toFixed(2),
        class: 'grid-line',
      }),
    );
    const label = el('text', { x: String(M.left - 8), y: (y(acc) + 4).toFixed(2), class: 'axis-label', 'text-anchor': 'end' });
    label.textContent = `${Math.round(acc * 100)}%`;
    svg.appendChild(label);
  }

  for (let snr = SNR_MIN; snr <= SNR_MAX; snr += 5) {
    const label = el('text', { x: x(snr).toFixed(2), y: String(M.top + PLOT_H + 20), class: 'axis-label', 'text-anchor': 'middle' });
    label.textContent = `${snr}`;
    svg.appendChild(label);
  }
  const xTitle = el('text', { x: String(M.left + PLOT_W / 2), y: String(H - 6), class: 'axis-title', 'text-anchor': 'middle' });
  xTitle.textContent = 'Signal-to-noise ratio (dB) — louder room to the left';
  svg.appendChild(xTitle);

  for (const ch of CHANNELS) {
    svg.appendChild(el('path', { d: linePath(ch.fn), class: `line line-${ch.id}`, fill: 'none' }));
  }

  const marker = el('line', { class: 'marker', y1: String(M.top), y2: String(M.top + PLOT_H), x1: '0', x2: '0' });
  svg.appendChild(marker);

  const dots = CHANNELS.map((ch) => {
    const dot = el('circle', { r: '5', class: `dot dot-${ch.id}`, cx: '0', cy: '0' });
    svg.appendChild(dot);
    return { ch, dot };
  });

  // Controls
  const controls = document.createElement('div');
  controls.className = 'slider-row';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(SNR_MIN);
  slider.max = String(SNR_MAX);
  slider.step = '1';
  slider.value = '4';
  slider.id = 'snr';
  slider.setAttribute('aria-describedby', 'snr-readout');
  const sliderLabel = document.createElement('label');
  sliderLabel.htmlFor = 'snr';
  sliderLabel.textContent = 'Noise level';
  const readout = document.createElement('output');
  readout.id = 'snr-readout';
  readout.htmlFor = 'snr';
  controls.append(sliderLabel, slider, readout);

  const cards = document.createElement('div');
  cards.className = 'channels';
  const cardEls = CHANNELS.map((ch) => {
    const card = document.createElement('div');
    card.className = `channel channel-${ch.id}`;
    const label = document.createElement('h4');
    label.textContent = ch.label;
    const value = document.createElement('div');
    value.className = 'channel-value';
    const blurb = document.createElement('p');
    blurb.textContent = ch.blurb;
    card.append(label, value, blurb);
    cards.appendChild(card);
    return { ch, value };
  });

  const caveat = document.createElement('p');
  caveat.className = 'caveat';
  caveat.textContent =
    'Illustrative model, not measured results — it reproduces the shape of the effect reported across the AVSR literature, not numbers from any specific system.';

  function update(): void {
    const snr = Number(slider.value);
    const px = x(snr);
    marker.setAttribute('x1', px.toFixed(2));
    marker.setAttribute('x2', px.toFixed(2));

    for (const { ch, dot } of dots) {
      dot.setAttribute('cx', px.toFixed(2));
      dot.setAttribute('cy', y(ch.fn(snr)).toFixed(2));
    }
    for (const { ch, value } of cardEls) {
      value.textContent = `${Math.round(ch.fn(snr) * 100)}%`;
    }

    const descriptor = snr <= -8 ? 'very noisy' : snr <= 0 ? 'noisy' : snr <= 8 ? 'moderate' : 'quiet';
    readout.textContent = `${snr} dB — ${descriptor}`;
  }

  slider.addEventListener('input', update);
  update();

  root.append(intro, svg, controls, cards, caveat);

  return { el: root, deactivate() {} };
}
