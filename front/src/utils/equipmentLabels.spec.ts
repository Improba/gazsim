import { describe, expect, it } from 'vitest';
import {
  equipmentKindLabel,
  equipmentLegendItems,
  equipmentMarkerColor,
  isEquipmentKind,
  regulatorModeLabel,
} from './equipmentLabels';

describe('equipmentLabels', () => {
  it('labels regulator kinds in French', () => {
    expect(equipmentKindLabel('pressureRegulator')).toContain('Détendeur');
    expect(regulatorModeLabel('active')).toContain('Actif');
    expect(regulatorModeLabel('bypass')).toContain('Bypass');
  });

  it('detects equipment pipe kinds', () => {
    expect(isEquipmentKind('pressureRegulator')).toBe(true);
    expect(isEquipmentKind('pipe')).toBe(false);
  });

  it('returns marker colors', () => {
    expect(equipmentMarkerColor('pressureRegulator')).toMatch(/^#/);
  });

  it('keeps equipment colors out of the result, selection and N-1 palettes', () => {
    // Rouge/orange/vert : échelles écart à la borne (contractMarginColor) et débit
    // (Legend.vue). Ambre : nœud/conduite sélectionné. #FF5252 : ouvrage retiré en N-1
    // (CONTINGENCY_NODE_COLOR dans CesiumViewer.vue).
    const reserved = [
      '#ff1744',
      '#fb8c00',
      '#43a047',
      '#00c853',
      '#ffe082',
      '#d50000',
      '#ffd54f',
      '#ff5252',
    ];
    const kinds = [
      'pressureRegulator',
      'deliveryStation',
      'controlValve',
      'valve',
      'compressorStation',
    ];
    const colors = kinds.map((kind) => equipmentMarkerColor(kind).toLowerCase());

    for (const color of colors) {
      expect(reserved).not.toContain(color);
    }
    expect(new Set(colors).size).toBe(kinds.length);
  });

  it('gives the valve a neutral marker instead of an alarm red', () => {
    expect(equipmentMarkerColor('valve')).toBe('#B0BEC5');
  });

  it('lists only the equipment kinds present in the network, in a stable order', () => {
    const items = equipmentLegendItems([
      { kind: 'pipe' },
      { kind: 'valve' },
      { kind: 'compressorStation' },
      { kind: 'compressorStation' },
      { kind: null },
      {},
    ]);

    expect(items).toEqual([
      { kind: 'compressorStation', label: 'Compresseur', color: '#40C4FF' },
      { kind: 'valve', label: 'Vanne', color: '#B0BEC5' },
    ]);
  });

  it('lists nothing for a network without equipment', () => {
    expect(equipmentLegendItems([{ kind: 'pipe' }, { kind: 'pipe' }])).toEqual([]);
  });
});
