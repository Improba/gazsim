import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, useGlobalStatus } from './useGlobalStatus';
import { useContingencyStore } from 'src/stores/contingency';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';

describe('useGlobalStatus', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('exports french run status labels and tones', () => {
    expect(RUN_STATUS_LABEL).toEqual({
      idle: 'Pas encore évaluée',
      running: 'Calcul en cours',
      converged: 'Calcul terminé',
      cancelled: 'Annulé',
      error: 'Échec',
    });
    expect(RUN_STATUS_TONE).toEqual({
      idle: 'neutral',
      running: 'warning',
      converged: 'success',
      cancelled: 'warning',
      error: 'danger',
    });
  });

  it('returns the expected status object shape', () => {
    const networkStore = useNetworkStore();
    const nominationStore = useNominationStore();
    const simulateStore = useSimulateStore();
    const contingencyStore = useContingencyStore();

    networkStore.activeNetwork = 'GasLib-11';
    nominationStore.list = [
      { id: 'nomination_1', filename: 'hiver.scn', relative_path: 'nova/hiver.scn' },
    ];
    nominationStore.selectById('nomination_1');
    simulateStore.status = 'converged';
    contingencyStore.report = {
      results: [
        {
          case: { element_id: 'P1', element_type: 'pipe', action: 'remove_pipe' },
          converged: true,
          min_pressure_bar: 36,
          violations: [],
        },
      ],
      red_cases: [],
      green_cases: [{ element_id: 'P1', element_type: 'pipe', action: 'remove_pipe' }],
    };
    contingencyStore.status = 'finished';

    const status = useGlobalStatus();

    expect(status.network.value).toBe('GasLib-11');
    expect(status.nomination.value).toEqual({
      id: 'nomination_1',
      label: 'hiver.scn',
    });
    expect(status.runStatus.value).toEqual({
      status: 'converged',
      label: 'Calcul terminé',
      tone: 'success',
    });
    expect(status.n1Status.value).toEqual({
      status: 'finished',
      label: 'N-1 conforme (1/1)',
      tone: 'success',
      passed: 1,
      total: 1,
    });
  });

  it('reads a contingency report whose cases omit the empty violations field', () => {
    const contingencyStore = useContingencyStore();
    // Charge utile réelle du backend : le champ violations est absent des cas sans violation.
    contingencyStore.report = {
      results: [
        {
          case: { element_id: 'CS01', element_type: 'compressor', action: 'remove_pipe' },
          converged: false,
          min_pressure_bar: 0,
        },
        {
          case: { element_id: 'V01', element_type: 'pipe', action: 'close_valve' },
          converged: true,
          min_pressure_bar: 40,
        },
      ],
      red_cases: [{ element_id: 'CS01', element_type: 'compressor', action: 'remove_pipe' }],
      green_cases: [{ element_id: 'V01', element_type: 'pipe', action: 'close_valve' }],
    };
    contingencyStore.status = 'finished';

    const status = useGlobalStatus();

    expect(status.n1Status.value).toEqual({
      status: 'finished',
      label: 'N-1 non conforme (1/2)',
      tone: 'danger',
      passed: 1,
      total: 2,
    });
  });

  it('surfaces the NoVa verdict instead of Calcul terminé when a nomination is active', () => {
    const simulateStore = useSimulateStore();
    simulateStore.status = 'converged';
    simulateStore.novaVerdict = {
      feasible: false,
      deficit_sinks: ['sink_88'],
      cause: 'PressureDeficit',
    };

    const status = useGlobalStatus();
    expect(status.runStatus.value).toEqual({
      status: 'converged',
      label: 'Tenue pression non tenue',
      tone: 'danger',
    });
  });

  it('labels demo nomination files in the status bar', () => {
    const nominationStore = useNominationStore();
    nominationStore.list = [
      {
        id: 'pointe-1',
        filename: 'nomination-pointe.scn',
        relative_path: 'nova/nomination-pointe.scn',
      },
    ];
    nominationStore.selectById('pointe-1');

    const status = useGlobalStatus();
    expect(status.nomination.value).toEqual({
      id: 'pointe-1',
      label: 'Nomination de pointe',
    });
  });

  it('marks missing N-1 runs as not available', () => {
    const status = useGlobalStatus();

    expect(status.n1Status.value).toEqual({
      status: 'n/a',
      label: 'N-1 non lancé',
      tone: 'neutral',
      passed: 0,
      total: 0,
    });
  });

  it('states the study question and holding before any validation', () => {
    const networkStore = useNetworkStore();
    const nominationStore = useNominationStore();
    networkStore.activeNetwork = 'GasLib-11';
    nominationStore.list = [
      {
        id: 'pointe-1',
        filename: 'nomination-pointe.scn',
        relative_path: 'nova/nomination-pointe.scn',
      },
    ];
    nominationStore.selectById('pointe-1');

    const status = useGlobalStatus();
    expect(status.holding.value).toEqual({
      label: 'Pas encore évaluée',
      tone: 'neutral',
    });
    expect(status.studyQuestion.value).toBe(
      'Cette nomination tient-elle les bornes de chaque point de livraison ?',
    );
  });

  it('names the deficit sink in the holding line when the contract does not hold', () => {
    const networkStore = useNetworkStore();
    const simulateStore = useSimulateStore();
    networkStore.activeNetwork = 'GasLib-11';
    simulateStore.status = 'converged';
    simulateStore.novaVerdict = {
      feasible: false,
      deficit_sinks: ['exit01'],
      cause: 'PressureDeficit',
    };

    const status = useGlobalStatus();
    expect(status.holding.value).toEqual({
      label: 'Tenue pression non tenue (exit01)',
      tone: 'danger',
    });
    expect(status.studyQuestion.value).toBe('Les bornes de livraison ne sont pas tenues.');
  });

  it('does not keep the previous verdict after switching nomination', () => {
    const networkStore = useNetworkStore();
    const nominationStore = useNominationStore();
    const simulateStore = useSimulateStore();
    networkStore.activeNetwork = 'GasLib-11';
    nominationStore.list = [
      { id: 'pointe', filename: 'nomination-pointe.scn', relative_path: '' },
      { id: 'jour', filename: 'nomination-jour.scn', relative_path: '' },
    ];
    nominationStore.selectById('pointe');
    simulateStore.status = 'converged';
    simulateStore.lastRunScenarioId = 'pointe';
    simulateStore.novaVerdict = {
      feasible: false,
      deficit_sinks: ['exit01'],
      cause: 'PressureDeficit',
    };
    nominationStore.selectById('jour');

    const status = useGlobalStatus();
    expect(status.holding.value).toEqual({
      label: 'À re-valider',
      tone: 'warning',
    });
    expect(status.studyQuestion.value).toBe('Validez pour évaluer cette nomination.');
  });
});
