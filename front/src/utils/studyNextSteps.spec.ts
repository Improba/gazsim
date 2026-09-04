import { describe, expect, it } from 'vitest';
import { nominationSentenceLabel, studyNextSteps } from './studyNextSteps';

const JOUR = { id: 'jour-1', filename: 'nomination-jour.scn' };
const POINTE = { id: 'pointe-1', filename: 'nomination-pointe.scn' };

function base(overrides: Partial<Parameters<typeof studyNextSteps>[0]> = {}) {
  return {
    hasCurrentVerdict: true,
    activeNominationId: JOUR.id,
    nominations: [JOUR, POINTE],
    sessionVerdicts: {},
    n1Available: true,
    n1Label: 'N-1 non lancé',
    ...overrides,
  };
}

describe('studyNextSteps', () => {
  it('proposes nothing without a current verdict', () => {
    expect(studyNextSteps(base({ hasCurrentVerdict: false }))).toEqual([]);
  });

  it('points to the peak nomination when the day one holds', () => {
    const steps = studyNextSteps(base());

    expect(steps.map((s) => s.id)).toEqual(['other-nomination', 'n1', 'dossier']);
    expect(steps[0]).toEqual({
      id: 'other-nomination',
      label: 'Valider la nomination de pointe',
      hint: 'Pas encore évaluée dans cette session.',
      nominationId: POINTE.id,
    });
  });

  it('points back to the day nomination from the peak one', () => {
    const steps = studyNextSteps(base({ activeNominationId: POINTE.id }));

    expect(steps[0]?.label).toBe('Valider la nomination du jour');
    expect(steps[0]?.nominationId).toBe(JOUR.id);
  });

  it('states the known verdict of the other nomination', () => {
    const held = studyNextSteps(
      base({ sessionVerdicts: { [POINTE.id]: { feasible: true } } }),
    );
    expect(held[0]?.hint).toBe('Déjà évaluée : les bornes sont tenues.');

    const missed = studyNextSteps(
      base({ sessionVerdicts: { [POINTE.id]: { feasible: false } } }),
    );
    expect(missed[0]?.hint).toBe('Déjà évaluée : les bornes ne sont pas tenues.');
  });

  it('carries the N-1 status as the hint and drops the step when unavailable', () => {
    expect(studyNextSteps(base({ n1Label: 'N-1 conforme (12/12)' }))[1]?.hint).toBe(
      'N-1 conforme (12/12)',
    );

    const withoutN1 = studyNextSteps(base({ n1Available: false }));
    expect(withoutN1.map((s) => s.id)).toEqual(['other-nomination', 'dossier']);
  });

  it('falls back to a sentence label for a business nomination', () => {
    const other = { id: 'hiver-1', filename: 'hiver-2026.scn' };
    const steps = studyNextSteps(
      base({ activeNominationId: 'autre', nominations: [other], n1Available: false }),
    );

    expect(steps[0]?.label).toBe('Valider « hiver-2026.scn »');
    expect(nominationSentenceLabel('hiver-2026.scn')).toBe('« hiver-2026.scn »');
  });

  it('omits the nomination step when the study holds a single nomination', () => {
    const steps = studyNextSteps(base({ nominations: [JOUR] }));
    expect(steps.map((s) => s.id)).toEqual(['n1', 'dossier']);
  });

  it('always offers the study dossier once a verdict exists', () => {
    const steps = studyNextSteps(base({ nominations: [], n1Available: false }));
    expect(steps.map((s) => s.id)).toEqual(['dossier']);
  });
});
