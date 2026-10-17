// SPDX-License-Identifier: Apache-2.0
import type { GraphEdge, GraphNode } from './buildGraph';

export const FAST_GALAXY_THRESHOLD = 3000;
export const GALAXY_RADIUS = 1400;
export const GALAXY_FULL_SCALE_COUNT = 3000;
export function galaxyRadiusForCount(count: number): number {
  if (count <= 0) return GALAXY_RADIUS;
  return Math.min(GALAXY_RADIUS, Math.max(220, GALAXY_RADIUS * Math.sqrt(count / GALAXY_FULL_SCALE_COUNT)));
}
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

export function spiralAngle(radius: number, arm: number, arms: number): number {
  return arm * Math.PI * 2 / arms + 0.35 + Math.log1p(radius / 150) * 1.85;
}

/** O(N log N + E), independent of input order and wall-clock time. */
export function buildGalaxyLayout(
  nodes: ReadonlyArray<GraphNode & { modified?: number }>, edges: readonly GraphEdge[],
): Map<string, GalaxyPosition> {
  const folders = [...new Set(nodes.map((node) => folderOf(node.path)))].sort();
  const radius = galaxyRadiusForCount(nodes.length);
  const radiusScale = radius / GALAXY_RADIUS;
  const arms = Math.max(2, Math.min(4, folders.length));
  const folderArm = new Map(folders.map((folder, i) => [folder, i % arms]));
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
  const result = new Map<string, GalaxyPosition>();
  for (const node of nodes) {
    const hubId = anchor.get(node.id)!.id;
    const arm = folders.length === 1
      ? Math.floor(starRandom((core.has(hubId) ? node.id : hubId) + ':arm') * arms)
      : folderArm.get(folderOf(node.path))!;
    const isCore = core.has(node.id);
    const seed = node.id;
    const u = starRandom(seed + ':r');
    const local = starRandom(anchor.get(node.id)!.id + ':r');
    const baseRadius = isCore ? 230 * Math.pow(u, 1.4)
      : Math.max(100, Math.min(GALAXY_RADIUS, 100 + 1200 * Math.pow(local, 1.65) + (u - 0.5) * 170));
    const nodeRadius = baseRadius * radiusScale;
    const angle = isCore ? starRandom(seed + ':a') * Math.PI * 2
      : spiralAngle(nodeRadius, arm, arms) + (starRandom(seed + ':a') - 0.5) * (0.17 + 40 / nodeRadius)
          + (starRandom(seed + ':field') < 0.07 ? (starRandom(seed + ':drift') - 0.5) * 1.2 : 0);
    const thickness = isCore ? 100 * (1 - baseRadius / 280) : 18 + 12 * (1 - baseRadius / GALAXY_RADIUS);
    result.set(node.id, {
      x: Math.cos(angle) * nodeRadius, y: Math.sin(angle) * nodeRadius,
      z: (starRandom(seed + ':z') - 0.5) * thickness,
      core: isCore, arm, arms,
    });
  }
  return result;
}

/** Missing/lazy tree metadata is neutral, never interpreted as a recent edit. */
export function recentBrightness(modified: number | undefined, now: number): number {
  if (!modified || !Number.isFinite(modified)) return 1;
  return 1 + 0.65 * Math.exp(-Math.max(0, now - modified) / (7 * 86400000));
}
