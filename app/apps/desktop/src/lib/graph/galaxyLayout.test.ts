// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildGalaxyLayout, clusterCenter, GALAXY_RADIUS, recentBrightness } from './galaxyLayout';

const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, path: `Folder ${i % 4}/${i}.md`, title: `${i}`, linkCount: i % 20 === 0 ? 30 : 2 }));
const edges = nodes.slice(4).map((node, i) => ({ source: node.id, target: nodes[i % 4].id }));

describe('galaxy presentation', () => {
  it('produces identical geometry for shuffled input, inside the galaxy, one cluster per folder', () => {
    const layout = buildGalaxyLayout(nodes, edges);
    const shuffled = buildGalaxyLayout([...nodes].reverse(), [...edges].reverse());
    expect(layout.size).toBe(nodes.length);
    for (const [id, point] of layout) {
      expect(point).toEqual(shuffled.get(id));
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(GALAXY_RADIUS + 0.001);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(point.core ? 50 : 15);
      expect(point.arms).toBe(4);
    }
    expect([...layout.values()].filter((p) => p.core)).toHaveLength(30);
    expect(layout.get('n0')!.core).toBe(true);
  });
  it('gathers each folder round its own centre, with no spiral', () => {
    const layout = buildGalaxyLayout(nodes, edges);
    for (let arm = 0; arm < 4; arm++) {
      const points = [...layout.values()].filter((p) => !p.core && p.arm === arm);
      const c = clusterCenter(arm, 4);
      const mean = points.reduce((m, p) => ({ x: m.x + p.x / points.length, y: m.y + p.y / points.length }), { x: 0, y: 0 });
      // The cluster's middle sits near its centre, and its notes stay close to it.
      expect(Math.hypot(mean.x - c.x, mean.y - c.y)).toBeLessThan(140);
      expect(Math.max(...points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThan(700);
    }
    expect(buildGalaxyLayout([], [])).toEqual(new Map());
  });
  it('still forms a few clusters when every note is in the root folder', () => {
    const layout = buildGalaxyLayout(nodes.map((node) => ({ ...node, path: `${node.id}.md` })), edges);
    expect(new Set([...layout.values()].filter((point) => !point.core).map((point) => point.arm)).size).toBeGreaterThanOrEqual(2);
  });
  it('brightens recent edits without making missing timestamps look recent', () => {
    const now = 1800000000000;
    expect(recentBrightness(undefined, now)).toBe(1);
    expect(recentBrightness(NaN, now)).toBe(1);
    expect(recentBrightness(now, now)).toBe(1.65);
    expect(recentBrightness(now + 1000, now)).toBe(1.65);
    expect(recentBrightness(now - 30 * 86400000, now)).toBeLessThan(1.02);
  });
});
