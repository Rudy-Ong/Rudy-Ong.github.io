# rudy-ong.github.io

Source for [rudy-ong.github.io](https://rudy-ong.github.io) — Japanese vowel devoicing:
a live detector, and an interactive look at why it is hard to see.

## The trainer

The page embeds onchou, a Japanese pitch-accent and vowel-devoicing trainer
(original project: [bagustris/onchou](https://github.com/bagustris/onchou)).
The trainer is served from this site at `/onchou/`, so the frame is
same-origin. Everything runs in the browser: there is no Hugging Face Space
and no server.

`public/onchou/` is generated, so don't edit it by hand. It holds only the
app's runtime files. Its source repository is private. To refresh it from an
onchou checkout:

```bash
python tools/publish-static.py ../Rudy-Ong.github.io/public/onchou
```

Vite copies `public/` into the build unchanged.

The natural model voices are VOICEVOX Nemo recordings. onchou's
`tools/build-references.py` generates them once with the Nemo Docker engine.
Pitch tracking (aubio, GPL-3.0, with its licence texts shipped in
`public/onchou/third-party/aubiojs/`) and scoring run on the visitor's
device.

The frame needs `allow="microphone"` to record. A placeholder shows until the
frame reports `load`.

## The articulation demos

Two modes, both driven by one mouth built from six articulatory parameters (aperture, lip
spread, rounding, jaw, teeth, tongue). Shapes are *computed* from those numbers rather than
tweened between hand-drawn paths, so any blend of two shapes is a valid mouth.

- **Articulation** — pick a mora and toggle voicing. This is the point of the whole section:
  switching a devoicing candidate to devoiced leaves every articulatory parameter
  identical and only flattens the glottis trace. Devoicing cannot be seen, which is why it
  has to be recovered from the signal. Morae that genuinely devoice in Japanese — /i/ and
  /u/ after a voiceless consonant — are marked with a dot.
- **Read the mouth** — a word is articulated silently and you pick which one it was. Each
  round's four options share an identical vowel sequence, so the answer rests entirely on
  consonant visemes, some of which are indistinguishable. It shows how much articulation
  alone underdetermines speech.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # tsc --noEmit && vite build
npm run preview    # serve the production build
npm run shoot      # screenshot both modes in light and dark (needs Chrome or Edge)
```

## Deploy

Pushing to `main` builds and publishes via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). Pages source is set to
**GitHub Actions**.

## Notes

- No framework and no tracking. ~7 kB of gzipped JavaScript.
- Light and dark follow the visitor's system setting; tokens live in
  [`src/styles/tokens.css`](src/styles/tokens.css) and mirror the palette used by the
  profile README's generated SVGs — change both together.
- Keyboard operable throughout, and `prefers-reduced-motion` steps through articulation
  discretely instead of animating.
