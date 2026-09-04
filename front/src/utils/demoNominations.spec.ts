import { describe, expect, it } from 'vitest';
import {
  DEMO_JOUR_FILENAME,
  DEMO_JOUR_LABEL,
  DEMO_JOUR_SCN_XML,
  DEMO_POINTE_FILENAME,
  DEMO_POINTE_LABEL,
  DEMO_POINTE_SCN_XML,
  nominationDisplayLabel,
} from './demoNominations';

describe('demoNominations', () => {
  it('maps demo filenames to métier labels', () => {
    expect(nominationDisplayLabel(DEMO_JOUR_FILENAME)).toBe(DEMO_JOUR_LABEL);
    expect(nominationDisplayLabel(DEMO_POINTE_FILENAME)).toBe(DEMO_POINTE_LABEL);
    expect(nominationDisplayLabel('custom.scn')).toBe('custom.scn');
    expect(nominationDisplayLabel(null)).toBe('');
  });

  it('ships two distinct .scn payloads with dual pressure envelopes on exit01', () => {
    expect(DEMO_JOUR_SCN_XML).toContain('id="nomination_jour"');
    expect(DEMO_POINTE_SCN_XML).toContain('id="nomination_pointe"');
    expect(DEMO_JOUR_SCN_XML).toContain('bound="lower" value="20.0"');
    expect(DEMO_POINTE_SCN_XML).toContain('bound="lower" value="68.0"');
    expect(DEMO_JOUR_SCN_XML).not.toBe(DEMO_POINTE_SCN_XML);
    expect(DEMO_JOUR_SCN_XML).toContain('bound="upper" value="70.0"');
    expect(DEMO_POINTE_SCN_XML).toContain('bound="upper" value="72.0"');
  });
});
