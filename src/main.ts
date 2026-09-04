import './styles/tokens.css';
import './styles/main.css';

import { createExplore } from './modes/explore';
import { createPlay } from './modes/play';
import { createFusion } from './modes/fusion';

interface Mode {
  id: string;
  label: string;
  hint: string;
  create(): { el: HTMLElement; deactivate(): void };
}

const MODES: Mode[] = [
  { id: 'play', label: 'Play', hint: 'Guess the word from the lips alone', create: createPlay },
  { id: 'explore', label: 'Explore', hint: 'See how each sound reshapes the mouth', create: createExplore },
  { id: 'fusion', label: 'Fusion', hint: 'Why audio-visual beats either stream alone', create: createFusion },
];

function mountLab(): void {
  const tablist = document.querySelector<HTMLElement>('#lab-tabs');
  const panel = document.querySelector<HTMLElement>('#lab-panel');
  if (!tablist || !panel) return;

  let active: { el: HTMLElement; deactivate(): void } | null = null;
  // Built modes are cached so returning to one keeps its score and selection.
  const built = new Map<string, { el: HTMLElement; deactivate(): void }>();

  function activate(id: string): void {
    const mode = MODES.find((m) => m.id === id);
    if (!mode || !panel || !tablist) return;

    active?.deactivate();

    let instance = built.get(id);
    if (!instance) {
      instance = mode.create();
      built.set(id, instance);
    }

    panel.replaceChildren(instance.el);
    panel.setAttribute('aria-labelledby', `tab-${id}`);
    active = instance;

    for (const tab of tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const selected = tab.dataset.mode === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  MODES.forEach((mode) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    tab.id = `tab-${mode.id}`;
    tab.dataset.mode = mode.id;
    tab.className = 'tab';
    tab.innerHTML = `<span class="tab-label">${mode.label}</span><span class="tab-hint">${mode.hint}</span>`;
    tab.addEventListener('click', () => activate(mode.id));
    tablist.appendChild(tab);
  });

  // Roving focus: left/right move between tabs, as expected of a tablist.
  tablist.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    let nextIndex = current;
    if (event.key === 'ArrowLeft') nextIndex = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (current + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    const next = tabs[nextIndex];
    if (next?.dataset.mode) {
      activate(next.dataset.mode);
      next.focus();
    }
  });

  activate(MODES[0]!.id);
}

/** Reveal bento cards as they scroll in, without penalising reduced motion. */
function mountReveals(): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    cards.forEach((c) => c.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  cards.forEach((c, i) => {
    c.style.setProperty('--reveal-delay', `${Math.min(i, 6) * 55}ms`);
    observer.observe(c);
  });
}

function mountYear(): void {
  const el = document.querySelector('#year');
  if (el) el.textContent = String(new Date().getFullYear());
}

mountLab();
mountReveals();
mountYear();
