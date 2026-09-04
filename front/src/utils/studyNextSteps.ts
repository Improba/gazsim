import {
  DEMO_JOUR_FILENAME,
  DEMO_POINTE_FILENAME,
  nominationDisplayLabel,
} from './demoNominations';

export type StudyNextStepId = 'other-nomination' | 'n1' | 'dossier';

export interface StudyNextStep {
  id: StudyNextStepId;
  label: string;
  /** Fait connu sur l'état de l'étude, pas une injonction. */
  hint: string;
  /** Renseigné pour `other-nomination` : nomination à valider. */
  nominationId?: string;
}

export interface StudyNextStepsNomination {
  id: string;
  filename: string;
}

export interface StudyNextStepsInput {
  /** Un verdict courant est affiché (sinon il n'y a pas de « suite »). */
  hasCurrentVerdict: boolean;
  activeNominationId: string | null;
  nominations: StudyNextStepsNomination[];
  /** Verdicts déjà obtenus dans la session, par identifiant de nomination. */
  sessionVerdicts: Record<string, { feasible: boolean }>;
  /** L'analyse N-1 est lançable sur la nomination active. */
  n1Available: boolean;
  /** Libellé d'état N-1 (ex. « N-1 non lancé », « N-1 conforme (12/12) »). */
  n1Label?: string | null;
}

/** « la nomination de pointe », « la nomination du jour », sinon le nom de fichier. */
export function nominationSentenceLabel(filename: string): string {
  if (filename === DEMO_JOUR_FILENAME || filename === DEMO_POINTE_FILENAME) {
    const label = nominationDisplayLabel(filename);
    return `la ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  }
  return `« ${filename} »`;
}

/**
 * Choisit la nomination à proposer ensuite : le pendant de la paire démo si l'active en
 * fait partie, sinon la première autre nomination de l'étude.
 */
function otherNomination(
  nominations: StudyNextStepsNomination[],
  activeNominationId: string | null,
): StudyNextStepsNomination | null {
  const active = nominations.find((item) => item.id === activeNominationId);
  if (active?.filename === DEMO_JOUR_FILENAME || active?.filename === DEMO_POINTE_FILENAME) {
    const counterpart =
      active.filename === DEMO_JOUR_FILENAME ? DEMO_POINTE_FILENAME : DEMO_JOUR_FILENAME;
    const found = nominations.find((item) => item.filename === counterpart);
    if (found) {
      return found;
    }
  }
  return nominations.find((item) => item.id !== activeNominationId) ?? null;
}

/**
 * Suites possibles après un verdict, sans hiérarchie : chaque étape porte un fait d'état
 * (déjà évaluée ou non, N-1 lancé ou non) et l'appelant les présente à poids égal.
 */
export function studyNextSteps(input: StudyNextStepsInput): StudyNextStep[] {
  if (!input.hasCurrentVerdict) {
    return [];
  }

  const steps: StudyNextStep[] = [];

  const other = otherNomination(input.nominations, input.activeNominationId);
  if (other) {
    const known = input.sessionVerdicts[other.id];
    const hint =
      known === undefined
        ? 'Pas encore évaluée dans cette session.'
        : known.feasible
          ? 'Déjà évaluée : les bornes sont tenues.'
          : 'Déjà évaluée : les bornes ne sont pas tenues.';
    steps.push({
      id: 'other-nomination',
      label: `Valider ${nominationSentenceLabel(other.filename)}`,
      hint,
      nominationId: other.id,
    });
  }

  if (input.n1Available) {
    steps.push({
      id: 'n1',
      label: 'Analyser N-1 sur cette nomination',
      hint: input.n1Label?.trim()
        ? input.n1Label.trim()
        : 'Retrait d\'un ouvrage à la fois, sur les demandes de cette nomination.',
    });
  }

  steps.push({
    id: 'dossier',
    label: 'Dossier d\'étude',
    hint: 'Verdict, points déficitaires et capacité, en PDF ou JSON.',
  });

  return steps;
}
