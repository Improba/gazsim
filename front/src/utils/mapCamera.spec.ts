import { describe, expect, it } from 'vitest';
import {
  cameraRectangleForNodes,
  networkLonLatBounds,
  nodeLonLat,
  schematicKmPerUnit,
} from './mapCamera';

describe('nodeLonLat', () => {
  it('prefers GPS when both lon and lat are present', () => {
    expect(nodeLonLat({ lon: 8.2, lat: 49.1, x: 0, y: 0 })).toEqual({ lon: 8.2, lat: 49.1 });
  });

  it('projects x/y around 10E 50N when GPS is missing', () => {
    const pos = nodeLonLat({ lon: null, lat: null, x: 0, y: 0 });
    expect(pos.lon).toBeCloseTo(10, 6);
    expect(pos.lat).toBeCloseTo(50, 6);
  });
});

describe('schematicKmPerUnit', () => {
  it('keeps km-sized coordinates as-is', () => {
    expect(
      schematicKmPerUnit([
        { lon: null, lat: null, x: 0, y: 0 },
        { lon: null, lat: null, x: 20, y: 10 },
      ]),
    ).toBe(1);
  });

  it('scales GasLib-11 layout units down to a regional span', () => {
    const nodes = [
      { lon: null, lat: null, x: 0, y: 0 },
      { lon: null, lat: null, x: 1141, y: 300 },
    ];
    const k = schematicKmPerUnit(nodes);
    expect(k).toBeCloseTo(64 / 1141, 6);
    const bounds = networkLonLatBounds(nodes);
    expect(bounds).not.toBeNull();
    expect(bounds!.east - bounds!.west).toBeGreaterThan(0.3);
    expect(bounds!.east - bounds!.west).toBeLessThan(1.0);
  });
});

describe('cameraRectangleForNodes', () => {
  const compact = [
    { lon: 10.0, lat: 50.0, x: 0, y: 0 },
    { lon: 10.05, lat: 50.04, x: 0, y: 0 },
  ];

  it('returns null for an empty network', () => {
    expect(cameraRectangleForNodes([])).toBeNull();
    expect(networkLonLatBounds([])).toBeNull();
  });

  it('pads the full compact network even when a node is focused', () => {
    const withoutFocus = cameraRectangleForNodes(compact);
    const withFocus = cameraRectangleForNodes(compact, { lon: 10.0, lat: 50.0 });
    expect(withoutFocus).toEqual(withFocus);
    expect(withoutFocus).not.toBeNull();
    expect(withoutFocus!.west).toBeLessThan(10.0);
    expect(withoutFocus!.east).toBeGreaterThan(10.05);
  });

  it('zooms to the focused node on a wide network', () => {
    const wide = Array.from({ length: 81 }, (_, index) => ({
      lon: 2 + index * 0.2,
      lat: 48,
      x: 0,
      y: 0,
    }));
    const rect = cameraRectangleForNodes(wide, { lon: 2.0, lat: 48.0 });
    expect(rect).not.toBeNull();
    expect(rect!.east - rect!.west).toBeCloseTo(0.16, 6);
    expect(rect!.west).toBeCloseTo(1.92, 6);
    expect(rect!.east).toBeCloseTo(2.08, 6);
  });
});
