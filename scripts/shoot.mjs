/**
 * Dev-only: screenshot the built site so layout and the interactive modes can
 * be checked without a manual browser pass.
 *
 *   npm run build && node scripts/shoot.mjs
 */

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, '.preview');
const PORT = 4319;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '/').split('?')[0];
      const path = join(DIST, url === '/' ? 'index.html' : decodeURIComponent(url));
      try {
        const body = await readFile(path);
        res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!CHROME) throw new Error('No Chrome/Edge found');
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu'] });

  try {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await page.setViewport({ width: 1180, height: 900, deviceScaleFactor: 1.5 });
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
      await wait(400);

      await page.screenshot({ path: join(OUT, `site-${scheme}-top.png`) });

      // Each mode in turn.
      for (const mode of ['play', 'explore', 'fusion']) {
        await page.click(`#tab-${mode}`);
        await wait(mode === 'play' ? 1400 : 500);
        const panel = await page.$('.lab-shell');
        await panel.screenshot({ path: join(OUT, `mode-${mode}-${scheme}.png`) });
      }

      // Full page, for the bento sections.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await wait(700);
      await page.screenshot({ path: join(OUT, `site-${scheme}-full.png`), fullPage: true });
      await page.close();
      console.log(`[shoot] ${scheme} captured`);
    }

    // Narrow viewport check.
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 380, height: 820, deviceScaleFactor: 2 });
    await mobile.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
    await wait(500);
    await mobile.screenshot({ path: join(OUT, 'site-mobile.png') });
    console.log('[shoot] mobile captured');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
