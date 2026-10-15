// SPDX-License-Identifier: Apache-2.0
// Development-only: real GraphView + galaxy layout, synthetic notes, no Tauri/server.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { registerDevTools } from '../webmcp';
import '../../src/styles/tokens.css';
import '../../src/App.css';
const params = new URLSearchParams(location.search);
const count = [200, 2000, 20000].includes(Number(params.get('count'))) ? Number(params.get('count')) : 200;
const platform = params.get('platform') === 'windows' ? 'windows' : 'macos';
document.documentElement.dataset.platform = platform;
document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
const folders = ['Research', 'Projects', 'Journal', 'Inspiration', 'Reading', 'People'];
const names = ['A new perspective', 'The shape of a thought', 'Patterns in the noise', 'Connecting the dots', 'Tomorrow starts here', 'A little curiosity'];
const titles = Array.from({ length: count }, (_, i) => ({ id: `star-${i}`, title: `${names[i % names.length]} ${i + 1}`, path: `${folders[i % 6]}/Note ${i + 1}.md` }));
const edges = titles.flatMap((note, i) => [
  { source: note.id, target: titles[(i + 6) % count].id },
  { source: note.id, target: titles[(Math.floor(i / 60) * 60 + i % 6) % count].id },
]);
mockWindows('main');
mockIPC((cmd) => {
  if (cmd === 'list_note_titles') return titles;
  if (cmd === 'graph_edges') return edges;
  if (cmd === 'plugin:event|listen') return 1;
  if (cmd === 'plugin:event|unlisten') return null;
  throw new Error(`Unexpected harness IPC: ${cmd}`);
});
if (params.get('renderer') === '2d') {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
    if (type !== '2d') return null;
    return Reflect.apply(getContext, this, [type, ...args]);
  } as typeof getContext;
}
localStorage.setItem('context.graph.settings.v5', JSON.stringify({ colorMode: 'folder', hideOrphans: false, minDegree: 0 }));
localStorage.setItem('cbk-theme', params.get('theme') ?? 'dark');
const { useStore } = await import('../../src/store');
useStore.setState({
  titles,
  tree: { name: 'Synthetic universe', path: '', isDir: true, children: titles.map((n, i) => ({ name: n.title, path: n.path, isDir: false, modified: Date.now() - (i % 90) * 86400000 })) },
  openNoteByPath: async (path: string) => { document.body.dataset.openedNote = path; },
});
const { GraphView } = await import('../../src/components/GraphView');
document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
createRoot(document.getElementById('root')!).render(<StrictMode><GraphView onClose={() => { document.body.dataset.closed = 'true'; }} /></StrictMode>);
requestAnimationFrame(() => registerDevTools([
  {
    name: 'galaxy_state',
    description: 'Read the graph preview state.',
    execute: () => ({
      count,
      backend: document.querySelector<HTMLCanvasElement>('.graph-galaxy-canvas')?.dataset.backend ?? '2d',
      layout: document.querySelector<HTMLElement>('.graph-galaxy-host')?.dataset.layout ?? 'settled',
      openedNote: document.body.dataset.openedNote ?? null,
      closed: document.body.dataset.closed === 'true',
    }),
  },
  {
    name: 'filter_graph',
    description: 'Filter graph notes by title.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    execute: async (input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'input must be an object' };
      const query = (input as { query?: unknown } | null)?.query;
      if (typeof query !== 'string') return { error: 'query must be a string' };
      const settings = document.querySelector<HTMLButtonElement>('[aria-label="Graph settings"]');
      if (!settings) return { error: 'Graph settings button is unavailable' };
      if (settings.getAttribute('aria-pressed') !== 'true') settings.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const field = document.querySelector<HTMLInputElement>('input[placeholder="Filter by title…"]');
      if (!field) return { error: 'Graph title filter is unavailable' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(field, query);
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: query }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      // The graph dims non-matches rather than hiding them; count with GraphView's own title rule.
      const needle = query.trim().toLowerCase();
      return { query: field.value, matchCount: needle ? titles.filter((note) => note.title.toLowerCase().includes(needle)).length : count };
    },
  },
  {
    name: 'open_note',
    description: 'Open a synthetic graph note by path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    execute: async (input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'input must be an object' };
      const path = (input as { path?: unknown } | null)?.path;
      if (typeof path !== 'string') return { error: 'path must be a string' };
      await useStore.getState().openNoteByPath(path);
      return { openedNote: document.body.dataset.openedNote ?? null };
    },
  },
  {
    name: 'measure_fps',
    description: 'Measure submitted graph render frames per second.',
    inputSchema: { type: 'object', properties: { ms: { type: 'number' } }, additionalProperties: false },
    execute: (input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'input must be an object' };
      const ms = (input as { ms?: unknown } | null)?.ms;
      if (ms !== undefined && (typeof ms !== 'number' || !Number.isFinite(ms))) return { error: 'ms must be a finite number' };
      return (window as Window & { galaxyLab: { measure: (duration: number) => Promise<unknown> } }).galaxyLab.measure(Math.max(500, Math.min(10000, ms ?? 3000)));
    },
  },
]));
// Counts actual render submissions, separate from display rAF rate; orbit during measurement.
Object.assign(window, {
  galaxyLab: {
    count,
    async measure(duration = 5000) {
      const samples: number[] = [];
      let previousFrame = '', previousTime = performance.now();
      const start = previousTime;
      return new Promise((resolve) => {
        const sample = () => {
          const now = performance.now();
          const frame = document.querySelector<HTMLCanvasElement>('.graph-galaxy-canvas')?.dataset.frame ?? '';
          if (frame && frame !== previousFrame) { samples.push(now - previousTime); previousTime = now; previousFrame = frame; }
          if (now - start < duration) requestAnimationFrame(sample);
          else {
            const sorted = samples.slice(1).sort((a, b) => a - b);
            resolve({ count, backend: document.querySelector<HTMLCanvasElement>('.graph-galaxy-canvas')?.dataset.backend ?? '2d', frames: samples.length, seconds: (now - start) / 1000, fps: samples.length * 1000 / (now - start), p95ms: sorted[Math.floor(sorted.length * 0.95)] ?? null });
          }
        };
        requestAnimationFrame(sample);
      });
    },
  },
});
