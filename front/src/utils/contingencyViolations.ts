import type { PressureViolation } from 'src/services/api';

/** Vue minimale d'un cas N-1 : suffisant pour trancher vert / rouge. */
export interface ContingencyOutcomeLike {
  converged: boolean;
  violations?: PressureViolation[];
}

/**
 * Violations d'un cas N-1, liste vide comprise.
 *
 * Le champ peut être absent du JSON (le backend a longtemps omis les vecteurs vides, et
 * les rapports déjà exportés le sont sans). Un déréférencement direct levait une
 * `TypeError` dans un `computed` du bandeau d'étude, ce qui avortait la mise à jour de
 * toute la page : l'analyse restait indéfiniment « en cours » à l'écran.
 */
export function violationsOf(result: ContingencyOutcomeLike): PressureViolation[] {
  return result.violations ?? [];
}

/** Cas rouge : non convergé, ou au moins un point de livraison sous sa borne. */
export function isRedCase(result: ContingencyOutcomeLike): boolean {
  return !result.converged || violationsOf(result).length > 0;
}

/** Cas vert : régime convergé et toutes les bornes tenues. */
export function isGreenCase(result: ContingencyOutcomeLike): boolean {
  return !isRedCase(result);
}
