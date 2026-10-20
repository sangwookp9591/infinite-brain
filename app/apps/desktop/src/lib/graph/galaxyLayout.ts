// SPDX-License-Identifier: Apache-2.0
import type { GraphEdge, GraphNode } from './buildGraph';

export const FAST_GALAXY_THRESHOLD = 3000;
export const GALAXY_RADIUS = 1400;
export interface GalaxyPosition { x: number; y: number; z: number; core: boolean; arm: number; arms: number }

export function starRandom(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}
const folderOf = (path: string) => path.includes('/') ? path.split('/')[0] : 'Root';

/** Where cluster `arm` of `arms` sits: golden-angle steps outward from the
 *  core, so neighbouring folders never line up into a spiral or a ring. */
export function clusterCenter(arm: number, arms: number): { x: number; y: number } {
  if (arms <= 1) return { x: 0, y: 0 };
  const angle = arm * 2.399963 + 0.6;
  const distance = Math.min(GALAXY_RADIUS - 260, 520 + 210 * Math.sqrt(arm));
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

/** A deterministic normal sample (Box–Muller) from two hash draws. */
function gaussian(key: string): { x: number; y: number } {
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, starRandom(key + ':g1'))));
  const a = starRandom(key + ':g2') * Math.PI * 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** O(N log N + E), independent of input order and wall-clock time. */
export function buildGalaxyLayout(
  nodes: ReadonlyArray<GraphNode & { modified?: number }>, edges: readonly GraphEdge[],
): Map<string, GalaxyPosition> {
  // One star cluster per top-level folder; a vault with every note in one
  // folder still gets a few clusters, grouped by link hub, so it is not a blob.
  const folders = [...new Set(nodes.map((node) => folderOf(node.path)))].sort();
  const arms = folders.length === 1 ? Math.max(2, Math.min(4, Math.round(Math.sqrt(nodes.length / 12)))) : Math.min(folders.length, 24);
  const folderArm = new Map(folders.map((folder, i) => [folder, i % arms]));
  const clusterSize = new Map<number, number>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const anchor = new Map(nodes.map((node) => [node.id, node]));
  // Shared local hubs place linked notes in the same stretch of their spiral arm.
  for (const edge of edges) {
    const a = byId.get(edge.source), b = byId.get(edge.target);
    if (!a || !b || folderOf(a.path) !== folderOf(b.path)) continue;
    for (const [node, neighbor] of [[a, b], [b, a]]) {
      const best = anchor.get(node.id)!;
      if (neighbor.linkCount > best.linkCount || (neighbor.linkCount === best.linkCount && neighbor.id < best.id)) anchor.set(node.id, neighbor);
    }
  }
  const newest = nodes.reduce((latest, node) => Math.max(latest, node.modified ?? 0), 0);
  const maxDegree = nodes.reduce((max, node) => Math.max(max, node.linkCount), 1);
  const rank = (node: typeof nodes[number]) => node.linkCount / maxDegree +
    (node.modified ? 0.35 * Math.exp(-(newest - node.modified) / (7 * 86400000)) : 0);
  const core = new Set([...nodes].sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.ceil(nodes.length * 0.15)).map((node) => node.id));
  const armOf = (node: typeof nodes[number]) => {
    const hubId = anchor.get(node.id)!.id;
    return folders.length === 1
      ? Math.floor(starRandom((core.has(hubId) ? node.id : hubId) + ':arm') * arms)
      : folderArm.get(folderOf(node.path))!;
  };
  for (const node of nodes) if (!core.has(node.id)) clusterSize.set(armOf(node), (clusterSize.get(armOf(node)) ?? 0) + 1);
  const result = new Map<string, GalaxyPosition>();
  for (const node of nodes) {
    const arm = armOf(node);
    const isCore = core.has(node.id);
    const seed = node.id;
    let x: number, y: number, z: number;
    if (isCore) {
      // The bright centre: the most-linked and most recently edited notes.
      const radius = 230 * Math.pow(starRandom(seed + ':r'), 1.4);
      const angle = starRandom(seed + ':a') * Math.PI * 2;
      x = Math.cos(angle) * radius; y = Math.sin(angle) * radius;
      z = (starRandom(seed + ':z') - 0.5) * 100 * (1 - radius / 280);
    } else {
      // A round cluster per folder. Linked notes share most of their offset
      // (their hub's), so a thread of notes sits together inside the cluster.
      const center = clusterCenter(arm, arms);
      // Grows with the cluster but stays a cluster: past a few hundred notes it
      // packs denser instead of spreading into its neighbours.
      const spread = Math.min(260, 70 + 16 * Math.sqrt(clusterSize.get(arm) ?? 1));
      const hub = gaussian(anchor.get(node.id)!.id), own = gaussian(seed);
      x = center.x + (hub.x * 0.65 + own.x * 0.45) * spread;
      y = center.y + (hub.y * 0.65 + own.y * 0.45) * spread;
      // Ease anything far out back inside the galaxy (tanh), instead of
      // clamping, which drew stray stars as a dotted ring on the edge.
      const r = Math.hypot(x, y);
      if (r > 0) { const eased = GALAXY_RADIUS * Math.tanh(r / GALAXY_RADIUS); x *= eased / r; y *= eased / r; }
      z = (starRandom(seed + ':z') - 0.5) * 30;
    }
    result.set(node.id, { x, y, z, core: isCore, arm, arms });
  }
  return result;
}

/** Missing/lazy tree metadata is neutral, never interpreted as a recent edit. */
export function recentBrightness(modified: number | undefined, now: number): number {
  if (!modified || !Number.isFinite(modified)) return 1;
  return 1 + 0.65 * Math.exp(-Math.max(0, now - modified) / (7 * 86400000));
}
