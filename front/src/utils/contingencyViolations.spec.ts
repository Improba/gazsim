import { describe, expect, it } from 'vitest';
import { isGreenCase, isRedCase, violationsOf } from './contingencyViolations';

const violation = {
  node_id: 'exit01',
  pressure_bar: 40,
  threshold_bar: 68,
  deficit_bar: 28,
};

describe('contingencyViolations', () => {
  it('treats a missing violations field as an empty list', () => {
    expect(violationsOf({ converged: true })).toEqual([]);
    expect(violationsOf({ converged: false })).toEqual([]);
  });

  it('returns the violations when present', () => {
    expect(violationsOf({ converged: true, violations: [violation] })).toEqual([violation]);
  });

  it('reads a converged case without violations as green', () => {
    expect(isGreenCase({ converged: true })).toBe(true);
    expect(isRedCase({ converged: true, violations: [] })).toBe(false);
  });

  it('reads a non-converged case as red even without violations', () => {
    // Cas réel du backend : retrait de compresseur, non convergé, aucun champ violations.
    expect(isRedCase({ converged: false })).toBe(true);
    expect(isGreenCase({ converged: false })).toBe(false);
  });

  it('reads a converged case under its bound as red', () => {
    expect(isRedCase({ converged: true, violations: [violation] })).toBe(true);
  });
});
