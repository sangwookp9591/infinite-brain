// SPDX-License-Identifier: Apache-2.0
// Validate the actual imported artifacts: CSS errors otherwise surface only on scroll.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite'))('postcss');
const directory = new URL('../public/dashboard-templates/', import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith('.html'));
assert.equal(files.length, 26);
let styles = 0, scripts = 0;
for (const file of files) {
  const source = readFileSync(new URL(file, directory), 'utf8');
  const thumbnail = readFileSync(new URL(`../dashboard-thumbnails/${file.slice(0, -5)}.webp`, directory));
  assert.equal(thumbnail.toString('ascii', 8, 12), 'WEBP', `${file} needs a WebP card thumbnail`);
  assert(Buffer.byteLength(source) < 10 * 1024 * 1024, `${file} exceeds note size limit`);
  const dom = new JSDOM(source);
  const document = dom.window.document;
  assert.equal(document.querySelector('meta[name="baalda-template"]')?.content, file.slice(0, -5));
  assert(!document.querySelector('.baalda-template-credit'), `${file} contains a visible import banner`);
  assert(document.querySelector('meta[http-equiv="Content-Security-Policy"]'));
  for (const style of document.querySelectorAll('style')) { postcss.parse(style.textContent, { from:file }); styles++; }
  for (const script of document.querySelectorAll('script')) {
    if (script.type && !['text/javascript', 'application/javascript'].includes(script.type)) continue;
    new Script(script.textContent, { filename:file }); scripts++;
  }
  assert(!document.querySelector('script[src],link[rel="stylesheet"]'), `${file} has an unbundled dependency`);
  dom.window.close();
}
console.log(`Validated ${files.length} templates, ${styles} stylesheets and ${scripts} scripts.`);
