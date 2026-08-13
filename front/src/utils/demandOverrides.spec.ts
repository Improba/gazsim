import { describe, expect, it } from 'vitest';
import {
  buildDemandPayload,
  sliderFromOverride,
  sliderMaxWithdrawal,
  toSinkOverrideFlow,
} from './demandOverrides';

describe('demandOverrides', () => {
  it('maps a positive max feasible Q to a negative sink flow', () => {
    expect(toSinkOverrideFlow(3.2)).toBe(-3.2);
    expect(toSinkOverrideFlow(-3.2)).toBe(-3.2);
  });

  it('keeps an explicit zero instead of -0', () => {
    expect(toSinkOverrideFlow(0)).toBe(0);
    expect(Object.is(toSinkOverrideFlow(0), -0)).toBe(false);
  });

  it('converts overrides to slider withdrawals', () => {
    expect(sliderFromOverride(-4)).toBe(4);
    expect(sliderFromOverride(0)).toBe(0);
    expect(sliderFromOverride(undefined)).toBe(0);
  });

  it('raises the slider max so a capacity reduction above 20 is not clamped', () => {
    expect(sliderMaxWithdrawal(null, -40)).toBe(40);
    expect(sliderMaxWithdrawal(-10, -4)).toBe(10);
    expect(sliderMaxWithdrawal(undefined, 0)).toBe(20);
  });

  it('omits zero sliders unless the previous payload had an explicit shutoff', () => {
    expect(buildDemandPayload({ sink_88: 0, sink_125: 2 }, {})).toEqual({
      sink_125: -2,
    });
    expect(buildDemandPayload({ sink_88: 0, sink_125: 2 }, { sink_88: 0 })).toEqual({
      sink_88: 0,
      sink_125: -2,
    });
  });
});
