import { describe, expect, it } from 'vitest';
import { needsCapacityReduction } from './sinkCapacity';

describe('needsCapacityReduction', () => {
  it('is true when the nomination cannot be fully delivered', () => {
    expect(
      needsCapacityReduction({ feasible_fraction: 0.62, nominal_q_m3s: 12.5 }),
    ).toBe(true);
  });

  it('is false when the fraction is 1', () => {
    expect(
      needsCapacityReduction({ feasible_fraction: 1, nominal_q_m3s: 4 }),
    ).toBe(false);
  });

  it('is false for an already shut-off sink even if fraction is 0', () => {
    expect(
      needsCapacityReduction({ feasible_fraction: 0, nominal_q_m3s: 0 }),
    ).toBe(false);
  });
});
