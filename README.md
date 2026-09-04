# rudy-ong.github.io

Source for [rudy-ong.github.io](https://rudy-ong.github.io) — an interactive lip-reading
lab and portfolio.

## The lab

Three modes, all driven by one mouth model built from six articulatory parameters
(aperture, lip spread, rounding, jaw, teeth, tongue). Shapes are *computed* from those
numbers rather than tweened between hand-drawn paths, so any blend of two shapes is a valid
mouth — that is what makes smooth articulation possible without an animation library.

- **Play** — the mouth silently says a word; you pick which one. Every round's four options
  share an identical vowel sequence, so the vowels give nothing away and the answer rests
  entirely on consonant visemes. Some of those are genuinely indistinguishable: /m/, /b/
  and /p/ are one visual event. That is the point being demonstrated, not a flaw in the
  puzzle.
- **Explore** — pick any mora and see which parameters produce it, plus which other sounds
  share the same visual shape.
- **Fusion** — drag the noise level and watch the audio-only curve collapse while the
  video-only curve sits flat. Where they cross is the argument for audio-visual fusion.

The fusion curves are an **illustrative model, not measured results**. They reproduce the
qualitative behaviour reported across the AVSR literature; they are not benchmark numbers
from any particular system, and the UI says so.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # tsc --noEmit && vite build
npm run preview    # serve the production build
node scripts/shoot.mjs   # screenshot every mode in light and dark (needs Chrome or Edge)
```

## Deploy

Pushing to `main` builds and publishes via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). Enable it once under
**Settings → Pages → Source → GitHub Actions**.

## Notes

- No framework and no tracking. ~8 kB of gzipped JavaScript.
- Light and dark follow the visitor's system setting; tokens live in
  [`src/styles/tokens.css`](src/styles/tokens.css) and mirror the palette used by the
  profile README's generated SVGs — change both together.
- Every mode is keyboard operable, and `prefers-reduced-motion` steps through articulation
  discretely instead of animating.
