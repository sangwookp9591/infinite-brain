// SPDX-License-Identifier: Apache-2.0
/** Stable cluster phase; the force layout remains the source of x/y coordinates. */
export function clusterPhase(path: string): number {
  const folder = path.includes('/') ? path.split('/')[0] : 'Root';
  let hash = 2166136261;
  for (const char of folder) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296 * Math.PI * 2;
}

export function galaxyDepth(x: number, y: number, phase: number): number {
  const radius = Math.hypot(x, y);
  return Math.sin(Math.atan2(y, x) * 2 + radius / 700 + phase) * Math.min(140, radius * 0.18)
    + Math.sin(phase) * 65;
}

/** Missing/lazy tree metadata is neutral, never interpreted as a recent edit. */
export function recentBrightness(modified: number | undefined, now: number): number {
  if (!modified || !Number.isFinite(modified)) return 1;
  return 1 + 0.65 * Math.exp(-Math.max(0, now - modified) / (7 * 86400000));
}
