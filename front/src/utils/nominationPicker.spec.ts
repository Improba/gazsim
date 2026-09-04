import { describe, expect, it } from 'vitest';
import {
  DEMO_JOUR_FILENAME,
  DEMO_POINTE_FILENAME,
} from './demoNominations';
import {
  isCatalogNetworkScn,
  nominationBelongsToDataset,
  nominationPickerLabel,
  nominationsForStudyPicker,
} from './nominationPicker';

describe('nominationPicker', () => {
  it('detects GasLib catalogue scenarios including versioned copies', () => {
    expect(isCatalogNetworkScn('GasLib-11.scn')).toBe(true);
    expect(isCatalogNetworkScn('GasLib-11-v1-20211130.scn')).toBe(true);
    expect(isCatalogNetworkScn('GasLib-582.scn')).toBe(true);
    expect(isCatalogNetworkScn(DEMO_POINTE_FILENAME)).toBe(false);
    expect(isCatalogNetworkScn('nomination_mild_618.scn')).toBe(false);
  });

  it('keeps demo and imported nominations on GasLib-11 and hides other networks', () => {
    const list = [
      { id: 'g582', filename: 'GasLib-582.scn', relative_path: 'GasLib-582.scn' },
      { id: 'g11', filename: 'GasLib-11.scn', relative_path: 'GasLib-11.scn' },
      { id: 'g135', filename: 'GasLib-135.scn', relative_path: 'GasLib-135.scn' },
      {
        id: 'jour',
        filename: DEMO_JOUR_FILENAME,
        relative_path: '',
        source: 'imported' as const,
      },
      {
        id: 'pointe',
        filename: DEMO_POINTE_FILENAME,
        relative_path: '',
        source: 'imported' as const,
      },
    ];

    const picked = nominationsForStudyPicker(list, 'GasLib-11');
    expect(picked.map((item) => item.filename)).toEqual([
      DEMO_JOUR_FILENAME,
      DEMO_POINTE_FILENAME,
    ]);
  });

  it('does not treat GasLib-4197 as belonging to GasLib-11', () => {
    expect(
      nominationBelongsToDataset(
        { filename: 'GasLib-4197.scn', relative_path: 'GasLib-4197.scn' },
        'GasLib-11',
      ),
    ).toBe(false);
    expect(
      nominationBelongsToDataset(
        { filename: 'GasLib-11-v1-20211130.scn', relative_path: 'GasLib-11-v1-20211130.scn' },
        'GasLib-11',
      ),
    ).toBe(true);
  });

  it('keeps mild_618 on GasLib-582 and hides other GasLib catalogue files', () => {
    const list = [
      { filename: 'GasLib-582.scn', relative_path: 'GasLib-582.scn' },
      { filename: 'GasLib-11.scn', relative_path: 'GasLib-11.scn' },
      {
        filename: 'nomination_mild_618.scn',
        relative_path: 'Nominations-582/nomination_mild_618.scn',
      },
    ];
    const picked = nominationsForStudyPicker(list, 'GasLib-582');
    expect(picked.map((item) => item.filename)).toEqual(['nomination_mild_618.scn']);
  });

  it('falls back to the catalogue file when the dataset has no métier nomination', () => {
    const list = [
      { filename: 'GasLib-11.scn', relative_path: 'GasLib-11.scn' },
      { filename: 'GasLib-582.scn', relative_path: 'GasLib-582.scn' },
    ];
    const picked = nominationsForStudyPicker(list, 'GasLib-11');
    expect(picked.map((item) => item.filename)).toEqual(['GasLib-11.scn']);
  });

  it('humanizes demo and catalogue labels', () => {
    expect(nominationPickerLabel(DEMO_JOUR_FILENAME)).toBe('Nomination du jour');
    expect(nominationPickerLabel(DEMO_POINTE_FILENAME)).toBe('Nomination de pointe');
    expect(nominationPickerLabel('GasLib-11.scn')).toBe('Nomination catalogue');
    expect(nominationPickerLabel('custom.scn')).toBe('custom.scn');
  });
});
