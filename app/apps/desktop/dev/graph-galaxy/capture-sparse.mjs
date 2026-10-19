// SPDX-License-Identifier: Apache-2.0
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.GALAXY_URL || 'http://127.0.0.1:1435';
const output = process.env.GALAXY_OUTPUT_DIR || '/private/tmp/galaxy-sparse';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--enable-unsafe-webgpu'],
});
for (const count of [5, 20, 40, 500]) {
  for (const renderer of ['', 'webgl', '2d']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const suffix = renderer || 'webgpu';
    await page.goto(`${base}/dev/graph-galaxy/?count=${count}&platform=macos&theme=dark&renderer=${renderer}`);
    if (renderer === '2d') {
      await page.waitForFunction(() => Boolean(window.galaxyLab), { timeout: 120000 });
      await page.waitForSelector('.graph-canvas', { timeout: 120000 });
    } else {
      await page.waitForFunction((expected) =>
        document.querySelector('.graph-galaxy-canvas')?.dataset.nodes === String(expected),
      count, { timeout: 120000 });
    }
    await page.waitForTimeout(1800);
    const file = path.join(output, `galaxy-${count}-${suffix}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
}
await browser.close();
process.exit(0);
