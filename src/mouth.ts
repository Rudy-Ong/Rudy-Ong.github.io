/**
 * Draws a mouth from a MouthShape.
 *
 * The geometry is computed, not tweened between hand-drawn paths: every curve
 * is derived from the six shape parameters, so any blend of two shapes is a
 * valid mouth. That is what makes smooth articulation possible without a
 * library or a pile of keyframed art.
 */

import type { MouthShape } from './data/visemes';

const VIEW_W = 320;
const VIEW_H = 240;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2 + 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

function n(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

export interface MouthParts {
  svg: SVGSVGElement;
  apply(shape: MouthShape): void;
}

/** Geometry for one shape, in view units. */
function geometry(s: MouthShape) {
  // Rounding pulls the corners inward and pushes the lips forward.
  const halfW = (36 + s.spread * 52) * (1 - s.rounding * 0.42);
  const openH = 2 + s.aperture * 52;
  const jawDrop = s.jaw * 12;

  // Lips thicken slightly as they purse.
  const lipTop = 9 + s.rounding * 5;
  const lipBottom = 11 + s.rounding * 6;

  // The upper lip has a cupid's bow; the lower is a simpler arc.
  const upperY = CY - openH / 2;
  const lowerY = CY + openH / 2 + jawDrop * 0.35;

  return { halfW, openH, upperY, lowerY, lipTop, lipBottom, jawDrop };
}

/** The dark opening between the lips. */
function aperturePath(s: MouthShape): string {
  const g = geometry(s);
  const { halfW, upperY, lowerY } = g;
  const left = CX - halfW;
  const right = CX + halfW;

  // A slight double-arc on top reads as a cupid's bow rather than a lens.
  const bow = Math.min(6, g.openH * 0.22);
  return [
    `M ${n(left)} ${n(CY)}`,
    `C ${n(left + halfW * 0.28)} ${n(upperY + bow)} ${n(CX - halfW * 0.22)} ${n(upperY)} ${n(CX)} ${n(upperY + bow * 0.5)}`,
    `C ${n(CX + halfW * 0.22)} ${n(upperY)} ${n(right - halfW * 0.28)} ${n(upperY + bow)} ${n(right)} ${n(CY)}`,
    `C ${n(right - halfW * 0.3)} ${n(lowerY)} ${n(CX + halfW * 0.3)} ${n(lowerY)} ${n(CX)} ${n(lowerY)}`,
    `C ${n(CX - halfW * 0.3)} ${n(lowerY)} ${n(left + halfW * 0.3)} ${n(lowerY)} ${n(left)} ${n(CY)}`,
    'Z',
  ].join(' ');
}

/** The outer lip outline, an offset of the aperture. */
function lipPath(s: MouthShape): string {
  const g = geometry(s);
  const halfW = g.halfW + 7 + s.rounding * 5;
  const top = g.upperY - g.lipTop;
  const bottom = g.lowerY + g.lipBottom;
  const left = CX - halfW;
  const right = CX + halfW;

  return [
    `M ${n(left)} ${n(CY)}`,
    `C ${n(left + halfW * 0.24)} ${n(top)} ${n(CX - halfW * 0.26)} ${n(top - 3)} ${n(CX)} ${n(top + 2)}`,
    `C ${n(CX + halfW * 0.26)} ${n(top - 3)} ${n(right - halfW * 0.24)} ${n(top)} ${n(right)} ${n(CY)}`,
    `C ${n(right - halfW * 0.26)} ${n(bottom)} ${n(CX + halfW * 0.26)} ${n(bottom + 3)} ${n(CX)} ${n(bottom + 3)}`,
    `C ${n(CX - halfW * 0.26)} ${n(bottom + 3)} ${n(left + halfW * 0.26)} ${n(bottom)} ${n(left)} ${n(CY)}`,
    'Z',
  ].join(' ');
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Build the mouth once and return an `apply` that mutates it.
 * Rebuilding the DOM on every frame would be wasteful and would break
 * transitions; only path data and a few attributes change.
 */
export function createMouth(): MouthParts {
  const svg = el('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    class: 'mouth',
    role: 'img',
    'aria-label': 'An animated mouth articulating Japanese speech sounds',
  });

  const defs = el('defs', {});
  const clip = el('clipPath', { id: 'aperture-clip' });
  const clipPath = el('path', { d: '' });
  clip.appendChild(clipPath);
  defs.appendChild(clip);
  svg.appendChild(defs);

  const lips = el('path', { class: 'mouth-lips', d: '' });
  const cavity = el('path', { class: 'mouth-cavity', d: '' });

  // Teeth and tongue live inside the opening, so they are clipped to it.
  const inner = el('g', { 'clip-path': 'url(#aperture-clip)' });
  const teeth = el('rect', { class: 'mouth-teeth', x: '0', y: '0', width: '0', height: '0', rx: '3' });
  const tongue = el('ellipse', { class: 'mouth-tongue', cx: '0', cy: '0', rx: '0', ry: '0' });
  inner.append(tongue, teeth);

  svg.append(lips, cavity, inner);

  function apply(shape: MouthShape): void {
    const d = aperturePath(shape);
    lips.setAttribute('d', lipPath(shape));
    cavity.setAttribute('d', d);
    clipPath.setAttribute('d', d);

    const g = geometry(shape);

    // Upper teeth hang from the top of the opening.
    const teethH = 6 + shape.teeth * 16;
    teeth.setAttribute('x', n(CX - g.halfW));
    teeth.setAttribute('y', n(g.upperY - 1));
    teeth.setAttribute('width', n(g.halfW * 2));
    teeth.setAttribute('height', n(teethH));
    teeth.setAttribute('opacity', n(Math.min(1, shape.teeth * 1.2) * (shape.aperture > 0.08 ? 1 : 0)));

    // Tongue rises from the floor of the opening.
    const tongueVisible = shape.tongue * (shape.aperture > 0.12 ? 1 : 0);
    tongue.setAttribute('cx', n(CX));
    tongue.setAttribute('cy', n(g.lowerY - g.openH * shape.tongue * 0.3));
    tongue.setAttribute('rx', n(g.halfW * 0.72));
    tongue.setAttribute('ry', n(6 + shape.tongue * 14));
    tongue.setAttribute('opacity', n(tongueVisible * 0.95));
  }

  return { svg, apply };
}
