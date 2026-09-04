import { describe, expect, it } from 'vitest';
import {
  networkTierLabel,
  presetForNodeCount,
  presetRobust,
  tierForNodeCount,
} from './solverPresets';

describe('solverPresets', () => {
  it('classifies GasLib-11 as demo', () => {
    expect(tierForNodeCount(11)).toBe('demo');
    expect(presetForNodeCount(11).continuation_scales).toEqual([1.0]);
  });

  it('uses continuation for large networks', () => {
    const p = presetForNodeCount(582);
    expect(p.continuation_scales).toEqual([0.05, 0.1, 0.2, 0.4, 0.7, 1.0]);
    expect(p.timeout_ms).toBe(180_000);
    expect(p.robust_mode).toBe(true);
  });

  it('robust mode upgrades small networks', () => {
    const p = presetRobust(20);
    expect(p.robust_mode).toBe(true);
    expect(p.continuation_scales?.length).toBeGreaterThan(1);
  });

  // Les paliers viennent de l'API en snake_case (`NetworkTier` sérialisé par serde) :
  // une valeur non couverte renverrait `undefined` dans l'UI.
  it('labels every tier sent by the backend', () => {
    expect(networkTierLabel('demo')).toBe('Démo');
    expect(networkTierLabel('standard')).toBe('Standard');
    expect(networkTierLabel('large')).toBe('Transport');
    expect(networkTierLabel('x_large')).toBe('Très grand');
    expect(networkTierLabel(tierForNodeCount(4197))).toBe('Très grand');
  });
});
