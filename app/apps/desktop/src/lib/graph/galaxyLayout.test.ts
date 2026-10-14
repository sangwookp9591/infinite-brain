// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { clusterPhase, galaxyDepth, recentBrightness } from './galaxyLayout';

describe('galaxy presentation', () => {
  it('keeps a folder in the same depth cluster across note renames', () => {
    expect(clusterPhase('Research/One.md')).toBe(clusterPhase('Research/Two.md'));
    expect(clusterPhase('Research/One.md')).not.toBe(clusterPhase('Journal/One.md'));
    for (const x of [0, 10, 10000]) expect(Math.abs(galaxyDepth(x, -x, clusterPhase('Research/One.md')))).toBeLessThanOrEqual(205);
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
