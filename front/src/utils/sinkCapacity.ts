/** Un sink à Q nominal nul n'est pas « à réduire » : il est déjà coupé. */
const NOMINAL_Q_EPS_M3S = 1e-12;

export function needsCapacityReduction(report: {
  feasible_fraction: number;
  nominal_q_m3s: number;
}): boolean {
  if (!(report.nominal_q_m3s > NOMINAL_Q_EPS_M3S)) {
    return false;
  }
  return report.feasible_fraction < 1;
}
