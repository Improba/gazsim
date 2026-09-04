import type { NovaCause, NovaSolverSignature } from 'src/services/api';

/** Libellé utilisateur pour le résidu Newton (workflow carte / NoVa). */
export const CONVERGENCE_GAP_LABEL = 'Écart de convergence';

/** Bannière : soutirages ou réglages équipements modifiés hors nomination. */
export const MODIFIED_WITHDRAWALS_EQUIPMENT_BANNER =
  'Soutirages ou réglages équipements modifiés. Relancez la simulation pour voir l\'effet.';

/** Réduction appliquée en session, pas encore écrite dans un .scn. */
export const SESSION_REDUCTION_BANNER =
  'Réduction en session. Pas encore la nomination enregistrée.';

export const STUDY_DOSSIER_LABEL = 'Dossier d\'étude';

/** Titre de section des états d'équipements après solve. */
export const EQUIPMENT_SETTINGS_SECTION_LABEL = 'Réglages équipements';

export function novaOutcomeBadgeLabel(feasible: boolean, cause: string | undefined): string {
  if (feasible) return 'Tenue pression OK';
  if (cause === 'NotSolvedLocal') return 'Verdict non établi';
  if (cause === 'ScaleNotAchieved') return 'Soutirages non couverts';
  if (cause === 'PressureExcess') return 'Dépassement borne haute';
  return 'Tenue pression non tenue';
}

export function solverSignatureBadgeLabel(
  sig: NovaSolverSignature | undefined,
  feasible?: boolean,
): string | null {
  if (!sig) return null;
  if (feasible === true) {
    const established: Record<NovaSolverSignature, string> = {
      NewtonPosthoc: 'Point établi',
      IpoptEscalation: 'Point établi (renforcé)',
      Unresolved: 'Solveur non résolu',
    };
    return established[sig] ?? null;
  }
  const evaluated: Record<NovaSolverSignature, string> = {
    NewtonPosthoc: 'Évalué post-hoc',
    IpoptEscalation: 'Évalué renforcé',
    Unresolved: 'Solveur non résolu',
  };
  return evaluated[sig] ?? null;
}

/** Masque les libellés solveur internes dans les messages affichés. */
export function userFacingSolverWarning(text: string): string {
  if (text === 'Point établi par IPOPT (modèle in-repo).') {
    return 'Point établi (renforcé).';
  }
  return text;
}

export function novaOutcomeBadgeColor(feasible: boolean, cause: NovaCause | string | undefined): string {
  if (feasible) return 'positive';
  if (cause === 'NotSolvedLocal') return 'warning';
  return 'negative';
}
