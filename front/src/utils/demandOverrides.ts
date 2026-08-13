/** Conversion Q max faisable → débit sink (convention solveur : soutirage ≤ 0). */
export function toSinkOverrideFlow(maxFeasibleQ: number): number {
  const magnitude = Math.abs(maxFeasibleQ);
  return magnitude === 0 ? 0 : -magnitude;
}

export function sliderFromOverride(q: number | undefined): number {
  return Math.max(0, -(q ?? 0));
}

/** Plafond du slider : borne réseau, sinon 20, et jamais sous l'override courant. */
export function sliderMaxWithdrawal(
  flowMinM3s: number | null | undefined,
  overrideQ: number | undefined,
  fallback = 20,
): number {
  const fromBounds =
    flowMinM3s != null && flowMinM3s < 0 ? Math.abs(flowMinM3s) : fallback;
  return Math.max(fromBounds, Math.abs(overrideQ ?? 0));
}

function isExplicitZero(value: number | undefined): boolean {
  return value === 0 || Object.is(value, -0);
}

/**
 * Construit le payload de soutirages depuis les sliders.
 * Un slider à 0 omet la clé (le scénario s'applique) sauf si le store
 * porte déjà un 0 explicite (réduction capacité à Q max = 0).
 */
export function buildDemandPayload(
  sliders: Record<string, number>,
  previous: Record<string, number> | undefined,
): Record<string, number> {
  const prior = previous ?? {};
  const payload: Record<string, number> = {};
  for (const [nodeId, withdrawal] of Object.entries(sliders)) {
    if (withdrawal > 0) {
      payload[nodeId] = -withdrawal;
    } else if (isExplicitZero(prior[nodeId])) {
      payload[nodeId] = 0;
    }
  }
  return payload;
}
