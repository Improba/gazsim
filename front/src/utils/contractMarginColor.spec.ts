import { describe, expect, it } from 'vitest';
import {
  UNCONSTRAINED_NODE_CSS,
  contractMarginForNode,
  contractMarginToCss,
  hasContractMarginScale,
} from './contractMarginColor';

describe('contractMarginToCss', () => {
  it('maps a deficit to red, a tight bound to orange, a comfortable margin to green', () => {
    expect(contractMarginToCss(-10)).toBe('rgb(255, 23, 68)');
    expect(contractMarginToCss(0)).toBe('rgb(251, 140, 0)');
    expect(contractMarginToCss(10)).toBe('rgb(67, 160, 71)');
  });

  it('clamps beyond the display scale', () => {
    expect(contractMarginToCss(-40)).toBe(contractMarginToCss(-10));
    expect(contractMarginToCss(40)).toBe(contractMarginToCss(10));
  });
});

describe('contractMarginForNode', () => {
  const margins = [
    {
      node_id: 'exit02',
      solved_pressure_bar: 50,
      lower_bar: 20,
      upper_bar: 70,
      margin_lower_bar: 30,
      margin_upper_bar: 20,
      from_scenario_envelope: true,
    },
  ];
  const slips = [
    {
      node_id: 'exit01',
      solved_pressure_bar: 42,
      lower_bar: 68,
      upper_bar: 72,
      shortfall_bar: 26,
      excess_bar: 0,
      from_scenario_envelope: true,
    },
  ];

  it('uses minus shortfall for a deficit sink', () => {
    expect(contractMarginForNode('exit01', margins, slips)).toBe(-26);
  });

  it('uses the contractual lower margin otherwise', () => {
    expect(contractMarginForNode('exit02', margins, slips)).toBe(30);
  });

  it('returns null when the node has no envelope', () => {
    expect(contractMarginForNode('junction', margins, slips)).toBeNull();
  });
});

describe('hasContractMarginScale', () => {
  it('is true when a slip or a lower margin exists', () => {
    expect(hasContractMarginScale([], [])).toBe(false);
    expect(
      hasContractMarginScale(
        [],
        [
          {
            node_id: 'exit01',
            solved_pressure_bar: 40,
            lower_bar: 68,
            upper_bar: 72,
            shortfall_bar: 1,
            excess_bar: 0,
            from_scenario_envelope: true,
          },
        ],
      ),
    ).toBe(true);
    expect(UNCONSTRAINED_NODE_CSS).toMatch(/^#/);
  });
});
