# aubiojs

- **Upstream**: https://github.com/qiuxiang/aubiojs (npm `aubiojs`)
- **Version**: 0.2.1, published 2022-11-08
- **File**: `aubio.js` is the package's `build/aubio.js`, unmodified. It is an
  Emscripten `SINGLE_FILE` build, so the WebAssembly binary is embedded as
  base64 and no separate `.wasm` fetch is needed.
- **SHA-256** of `aubio.js`:
  `f1698e090925d019df620ff821322f8ede407bfb8287f255f40af3dd40a8efd4`
- **SHA-256** of the npm tarball `aubiojs-0.2.1.tgz`:
  `7f0a11898bf1697a6bdf66daeccd9741c51a95426ddedc2c9b55739b746e3c17`

Re-fetch with `npm pack aubiojs@0.2.1` and compare both hashes.

## Licence: read this before distributing

There are two licences here.

- The JavaScript binding is MIT; see `LICENSE-aubiojs`.
- The compiled code inside the WebAssembly is
  [aubio](https://aubio.org/), which is **GPL-3.0-or-later**; see
  `COPYING-aubio`.

Shipping this file to browsers is distributing GPL code. The aubio source
is public at https://github.com/aubio/aubio, which helps meet the
source-offer obligation. Whether the rest of onchou can be distributed
alongside it is a decision for the project owner: onchou has no declared
licence of its own. If GPL is a problem, delete this folder. `js/live-pitch.js`
then falls back to onchou's own autocorrelation estimator with no other change.

## Why aubio, and which method

The karaoke mode needs a pitch estimate on every hop of live microphone
audio. aubio's `yinfast` method was chosen after measuring the methods this
build exposes on synthetic voiced tones (48 kHz, 2048-sample window,
1024-sample hop):

| Method | 110 Hz | 220 Hz | Noise confidence | Notes |
|---|---|---|---|---|
| yin | 110.0 / 1.00 | 220.0 / 1.00 | 0.09 | exact, O(n²) |
| **yinfast** | 110.0 / 1.00 | 220.0 / 1.00 | 0.11 | exact, FFT-based |
| yinfft | 112.4 / 0.00 | 221.1 / 0.00 | 0.00 | confidence always 0 in this build |
| specacf | 187.9 / 0.85 | 363.8 / 0.85 | 0.85 | wrong pitch |
| mcomb | 110.0 / 0.00 | 220.0 / 0.00 | 0.00 | no usable confidence |

`yinfft` is aubio's default, but this build reports 0 confidence for it on
every input. Without confidence, voiced and unvoiced frames can't be told
apart, so the default is unusable here.
