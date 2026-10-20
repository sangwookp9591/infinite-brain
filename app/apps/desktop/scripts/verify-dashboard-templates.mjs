// SPDX-License-Identifier: Apache-2.0
// Validate the original dashboard set and its checked-in WebP cards.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite'))('postcss');
const templates = [
  ['ib-daily', 'Daily'], ['ib-team-hub', 'Team Hub'], ['ib-projects', 'Projects'],
  ['ib-research', 'Research'], ['ib-knowledge-map', 'Knowledge Map'],
  ['ib-weekly-review', 'Weekly Review'], ['ib-meetings', 'Meetings'], ['ib-blank', 'Blank'],
];
const ids = templates.map(([id]) => id);
const htmlDir = new URL('../public/dashboard-templates/', import.meta.url);
const thumbnailDir = new URL('../public/dashboard-thumbnails/', import.meta.url);
assert.deepEqual(readdirSync(htmlDir).sort(), ids.map((id) => `${id}.html`).sort());
assert.deepEqual(readdirSync(thumbnailDir).sort(), ids.map((id) => `${id}.webp`).sort());
let styles = 0, scripts = 0;
for (const [id, name] of templates) {
  const file = `${id}.html`;
  const source = readFileSync(new URL(file, htmlDir), 'utf8');
  const thumbnail = readFileSync(new URL(`${id}.webp`, thumbnailDir));
  assert.equal(thumbnail.toString('ascii', 8, 12), 'WEBP', `${file} needs a WebP thumbnail`);
  assert(Buffer.byteLength(source) < 60 * 1024, `${file} exceeds 60 KB`);
  assert(source.startsWith('<!doctype html>'), `${file} must begin with a doctype`);
  assert(source.includes('Infinite Brain original template'), `${file} needs its originality marker`);
  assert(source.includes('SPDX-License-Identifier: Apache-2.0'), `${file} needs its license marker`);
  const dom = new JSDOM(source);
  const document = dom.window.document;
  assert(source.includes(name), `${file} needs its template name in the originality comment`);
  assert(!document.querySelector('script[src]:not([src="/__infinitebrain/sdk.js"])'), `${file} has an unapproved external script`);
  assert(!document.querySelector('link[rel="stylesheet"]'), `${file} has an external stylesheet`);
  for (const style of document.querySelectorAll('style')) { postcss.parse(style.textContent, { from: file }); styles++; }
  for (const script of document.querySelectorAll('script:not([src])')) { new Script(script.textContent, { filename: file }); scripts++; }
  dom.window.close();
}
console.log(`Validated ${ids.length} templates, ${styles} stylesheets and ${scripts} inline scripts.`);
