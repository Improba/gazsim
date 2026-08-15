export type SimulationStatus = 'idle' | 'running' | 'converged' | 'cancelled' | 'error';

const STATUS_LABELS: Record<SimulationStatus, string> = {
  idle: 'En attente',
  running: 'Calcul en cours',
  converged: 'Calcul terminé',
  cancelled: 'Annulé',
  error: 'Erreur',
};

export function simulationStatusLabel(status: SimulationStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export const SIMULATION_MODE_HELP = {
  free: 'Les soutirages du scénario sont appliqués sans contrainte de capacité.',
  check:
    'Respect des bornes min/max de débit des nœuds (mode capacité).',
  optimize:
    'Ajuste les soutirages pour respecter les bornes de débit des nœuds.',
} as const;
