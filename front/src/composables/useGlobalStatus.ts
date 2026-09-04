import { computed, type ComputedRef } from 'vue';
import { useContingencyStore } from 'src/stores/contingency';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';
import { isGreenCase } from 'src/utils/contingencyViolations';
import { novaOutcomeBadgeLabel } from 'src/utils/novaLabels';
import { nominationPickerLabel } from 'src/utils/nominationPicker';

export type RunStatusKey = 'idle' | 'running' | 'converged' | 'cancelled' | 'error';
export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export const RUN_STATUS_LABEL: Record<RunStatusKey, string> = {
  idle: 'Pas encore évaluée',
  running: 'Calcul en cours',
  converged: 'Calcul terminé',
  cancelled: 'Annulé',
  error: 'Échec',
};

export const RUN_STATUS_TONE: Record<RunStatusKey, StatusTone> = {
  idle: 'neutral',
  running: 'warning',
  converged: 'success',
  cancelled: 'warning',
  error: 'danger',
};

type NominationStatus = {
  id: string | null;
  label: string;
};

type RunStatus = {
  status: RunStatusKey;
  label: string;
  tone: StatusTone;
};

type N1Status = {
  status: 'n/a' | 'idle' | 'running' | 'finished' | 'error';
  label: string;
  tone: StatusTone;
  passed: number;
  total: number;
};

type StudyHolding = {
  label: string;
  tone: StatusTone;
};

export type GlobalStatus = {
  network: ComputedRef<string | null>;
  nomination: ComputedRef<NominationStatus>;
  runStatus: ComputedRef<RunStatus>;
  n1Status: ComputedRef<N1Status>;
  holding: ComputedRef<StudyHolding>;
  studyQuestion: ComputedRef<string>;
};

function n1Label(status: N1Status['status'], passed: number, total: number): string {
  if (status === 'running') {
    return total > 0 ? `Analyse N-1 en cours (${passed}/${total})` : 'Analyse N-1 en cours';
  }
  if (status === 'error') {
    return 'Analyse N-1 en échec';
  }
  if (status === 'n/a' || total === 0) {
    return 'N-1 non lancé';
  }
  return passed === total ? `N-1 conforme (${passed}/${total})` : `N-1 non conforme (${passed}/${total})`;
}

export function useGlobalStatus(): GlobalStatus {
  const networkStore = useNetworkStore();
  const nominationStore = useNominationStore();
  const simulateStore = useSimulateStore();
  const contingencyStore = useContingencyStore();

  const network = computed(() => networkStore.activeNetwork);

  const nomination = computed<NominationStatus>(() => {
    const id = nominationStore.activeId;
    const filename = nominationStore.activeFilename;
    return {
      id,
      label: (filename ? nominationPickerLabel(filename) : null) ?? id ?? 'Aucune nomination',
    };
  });

  const runStatus = computed<RunStatus>(() => {
    const status = simulateStore.status;
    if (status === 'converged' && simulateStore.novaActive && simulateStore.novaVerdict) {
      const verdict = simulateStore.novaVerdict;
      const tone: StatusTone = verdict.feasible
        ? 'success'
        : verdict.cause === 'NotSolvedLocal'
          ? 'warning'
          : 'danger';
      return {
        status,
        label: novaOutcomeBadgeLabel(verdict.feasible, verdict.cause),
        tone,
      };
    }
    return {
      status,
      label: RUN_STATUS_LABEL[status],
      tone: RUN_STATUS_TONE[status],
    };
  });

  const holding = computed<StudyHolding>(() => {
    if (simulateStore.status === 'running') {
      return { label: 'Calcul en cours', tone: 'warning' };
    }
    if (simulateStore.nominationChangedSinceLastRun) {
      return { label: 'À re-valider', tone: 'warning' };
    }
    const run = runStatus.value;
    const deficit = simulateStore.novaVerdict?.deficit_sinks[0];
    if (run.status === 'idle') {
      return {
        label: nominationStore.activeId ? 'Pas encore évaluée' : 'Non évaluée',
        tone: 'neutral',
      };
    }
    if (run.status === 'converged' && run.tone === 'danger' && deficit) {
      return { label: `${run.label} (${deficit})`, tone: run.tone };
    }
    return { label: run.label, tone: run.tone };
  });

  const studyQuestion = computed(() => {
    if (!networkStore.activeNetwork) {
      return 'Chargez un réseau ou lancez la démo pour ouvrir une étude.';
    }
    if (simulateStore.status === 'running') {
      return 'Calcul de la tenue pression en cours.';
    }
    if (simulateStore.nominationChangedSinceLastRun) {
      return 'Validez pour évaluer cette nomination.';
    }
    if (simulateStore.novaActive && simulateStore.novaVerdict) {
      if (simulateStore.novaVerdict.feasible) {
        return 'Les bornes de livraison sont tenues.';
      }
      if (simulateStore.novaVerdict.cause === 'NotSolvedLocal') {
        return "Le verdict n'a pas pu être établi sur ce calcul.";
      }
      return 'Les bornes de livraison ne sont pas tenues.';
    }
    if (!nominationStore.activeId) {
      return 'Choisissez une nomination, puis validez la tenue pression.';
    }
    return 'Cette nomination tient-elle les bornes de chaque point de livraison ?';
  });

  const n1Status = computed<N1Status>(() => {
    const results = contingencyStore.results;
    const total = contingencyStore.totalCases || results.length;
    const passed = results.filter(isGreenCase).length;
    const rawStatus = contingencyStore.status;
    const status: N1Status['status'] = rawStatus === 'idle' && total === 0 ? 'n/a' : rawStatus;
    const tone: StatusTone =
      status === 'error'
        ? 'danger'
        : status === 'running'
          ? 'warning'
          : status === 'finished' && total > 0 && passed === total
            ? 'success'
            : status === 'finished' && total > 0
              ? 'danger'
              : 'neutral';

    return {
      status,
      label: n1Label(status, passed, total),
      tone,
      passed,
      total,
    };
  });

  return {
    network,
    nomination,
    runStatus,
    n1Status,
    holding,
    studyQuestion,
  };
}
