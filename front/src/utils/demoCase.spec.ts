import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const nominationApi = vi.hoisted(() => ({
  listNovaScenarios: vi.fn(async () => [] as Array<{ id: string; filename: string; source?: string }>),
  importNovaNomination: vi.fn(async (payload: { filename: string }) => ({
    id: `imported-${payload.filename}-1`,
    filename: payload.filename,
    relative_path: '',
    source: 'imported' as const,
  })),
  deleteNovaNomination: vi.fn(async () => {}),
}));

const networkMock = vi.hoisted(() => ({
  selectNetwork: vi.fn(async () => {}),
  activeNetwork: 'GasLib-11',
  nodes: [{ id: 'entry01' }],
}));

const simulateMock = vi.hoisted(() => ({
  startValidation: vi.fn(async () => {}),
  hydrateFromNovaRun: vi.fn(async () => {}),
  setRunScenarioSummary: vi.fn(),
}));

vi.mock('quasar', () => ({
  Notify: { create: vi.fn() },
}));

vi.mock('src/services/api', () => ({
  api: {
    listNovaScenarios: nominationApi.listNovaScenarios,
    importNovaNomination: nominationApi.importNovaNomination,
    saveReducedNovaNomination: vi.fn(),
    deleteNovaNomination: nominationApi.deleteNovaNomination,
  },
}));

vi.mock('src/stores/network', () => ({
  useNetworkStore: () => networkMock,
}));

vi.mock('src/stores/simulate', () => ({
  useSimulateStore: () => simulateMock,
}));

vi.mock('src/utils/resetStudyState', () => ({
  resetStudyState: vi.fn(),
}));

import { useNominationStore } from 'src/stores/nomination';
import { runNominationDemo } from './demoCase';
import { DEMO_JOUR_FILENAME, DEMO_POINTE_FILENAME } from './demoNominations';

describe('runNominationDemo', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    nominationApi.listNovaScenarios.mockReset();
    nominationApi.importNovaNomination.mockClear();
    nominationApi.deleteNovaNomination.mockClear();
    networkMock.selectNetwork.mockClear();
    simulateMock.startValidation.mockClear();
    simulateMock.hydrateFromNovaRun.mockClear();
    simulateMock.startValidation.mockResolvedValue(undefined);
    nominationApi.listNovaScenarios.mockResolvedValue([]);
  });

  it('imports jour and pointe then validates the pointe', async () => {
    await runNominationDemo();
    expect(networkMock.selectNetwork).toHaveBeenCalledWith('GasLib-11');
    expect(nominationApi.importNovaNomination).toHaveBeenCalledTimes(2);
    const names = nominationApi.importNovaNomination.mock.calls.map(
      (call) => call[0].filename,
    );
    expect(names).toEqual([DEMO_JOUR_FILENAME, DEMO_POINTE_FILENAME]);
    expect(useNominationStore().activeId).toBe(`imported-${DEMO_POINTE_FILENAME}-1`);
    expect(simulateMock.startValidation).toHaveBeenCalled();
  });

  it('reimports jour and pointe when older copies already exist', async () => {
    nominationApi.listNovaScenarios.mockResolvedValue([
      { id: 'jour-old', filename: DEMO_JOUR_FILENAME, source: 'imported' },
      { id: 'pointe-old', filename: DEMO_POINTE_FILENAME, source: 'imported' },
    ]);
    await runNominationDemo();
    expect(nominationApi.deleteNovaNomination).toHaveBeenCalled();
    expect(nominationApi.importNovaNomination).toHaveBeenCalledTimes(2);
    expect(useNominationStore().activeId).toBe(`imported-${DEMO_POINTE_FILENAME}-1`);
  });

  it('hydrates fallback run when validation fails', async () => {
    simulateMock.startValidation.mockRejectedValueOnce(new Error('timeout'));
    await runNominationDemo({ fallbackRunId: 'run-saved' });
    expect(simulateMock.hydrateFromNovaRun).toHaveBeenCalledWith('run-saved');
  });
});
