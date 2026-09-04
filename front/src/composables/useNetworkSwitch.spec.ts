import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const dialogSpy = vi.hoisted(() => vi.fn());
const resetStudySpy = vi.hoisted(() => vi.fn());
const apiSpies = vi.hoisted(() => ({
  getNetwork: vi.fn(),
  getNetworks: vi.fn(),
  selectNetwork: vi.fn(),
  importNetwork: vi.fn(),
  updateGasComposition: vi.fn(),
}));

vi.mock('quasar', () => ({
  Dialog: { create: dialogSpy },
  Notify: { create: vi.fn() },
}));

vi.mock('src/utils/resetStudyState', () => ({
  resetStudyState: resetStudySpy,
}));

vi.mock('src/services/api', () => ({
  G20_NOMINAL: { ch4: 0.78, c2h6: 0.115, co2: 0.025, n2: 0.08, h2: 0 },
  PURE_CH4: { ch4: 1, c2h6: 0, co2: 0, n2: 0, h2: 0 },
  validateGasComposition: () => null,
  api: {
    getNetwork: apiSpies.getNetwork,
    getNetworks: apiSpies.getNetworks,
    selectNetwork: apiSpies.selectNetwork,
    importNetwork: apiSpies.importNetwork,
    updateGasComposition: apiSpies.updateGasComposition,
  },
}));

import { useNetworkSwitch } from './useNetworkSwitch';
// Même spécificateur que dans le composable : `src/...` et `./...` instancieraient
// deux fois le module (et donc deux listes de récents distinctes).
import { useRecentNetworks } from 'src/composables/useRecentNetworks';
import { useNetworkStore } from 'src/stores/network';
import { useSimulateStore } from 'src/stores/simulate';

/** Simule le retour chaînable de `Dialog.create` : ok, annulation ou fermeture. */
function dialogAnswering(answer: 'ok' | 'cancel'): void {
  dialogSpy.mockImplementation(() => {
    const chain = {
      onOk(cb: () => void) {
        if (answer === 'ok') cb();
        return chain;
      },
      onCancel(cb: () => void) {
        if (answer === 'cancel') cb();
        return chain;
      },
      onDismiss(cb: () => void) {
        cb();
        return chain;
      },
    };
    return chain;
  });
}

const networkPayload = {
  node_count: 0,
  edge_count: 0,
  gas: {
    composition: { ch4: 0.78, c2h6: 0.115, co2: 0.025, n2: 0.08, h2: 0 },
    pcs_mj_per_nm3: 39.5,
    pci_mj_per_nm3: 35.5,
    wobbe_mj_per_nm3: 46,
  },
  nodes: [],
  pipes: [],
};

describe('useNetworkSwitch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    dialogSpy.mockReset();
    resetStudySpy.mockReset();
    apiSpies.selectNetwork.mockReset();
    apiSpies.getNetwork.mockReset();
    apiSpies.selectNetwork.mockResolvedValue({ active: 'GasLib-24' });
    apiSpies.getNetwork.mockResolvedValue(networkPayload);
  });

  it('does not call the backend when the network is already active', async () => {
    const networkStore = useNetworkStore();
    networkStore.activeNetwork = 'GasLib-11';

    const { switchNetwork } = useNetworkSwitch();
    await expect(switchNetwork('GasLib-11')).resolves.toBe('already-active');
    expect(apiSpies.selectNetwork).not.toHaveBeenCalled();
    expect(resetStudySpy).not.toHaveBeenCalled();
  });

  it('refuses a second switch while one is in flight', async () => {
    const networkStore = useNetworkStore();
    networkStore.activeNetwork = 'GasLib-11';
    networkStore.switching = true;

    const { switchNetwork } = useNetworkSwitch();
    await expect(switchNetwork('GasLib-24')).resolves.toBe('busy');
    expect(apiSpies.selectNetwork).not.toHaveBeenCalled();
  });

  it('switches without confirmation and records the network as recent when no verdict is shown', async () => {
    const networkStore = useNetworkStore();
    networkStore.activeNetwork = 'GasLib-11';

    const { switchNetwork } = useNetworkSwitch();
    await expect(switchNetwork('GasLib-24')).resolves.toBe('switched');

    expect(dialogSpy).not.toHaveBeenCalled();
    expect(apiSpies.selectNetwork).toHaveBeenCalledWith('GasLib-24');
    expect(resetStudySpy).toHaveBeenCalledTimes(1);
    expect(useRecentNetworks().recentNetworks.value[0]).toBe('GasLib-24');
  });

  it('asks for confirmation before discarding a verdict and keeps the network on refusal', async () => {
    const networkStore = useNetworkStore();
    const simulateStore = useSimulateStore();
    networkStore.activeNetwork = 'GasLib-11';
    simulateStore.result = { converged: true } as never;
    dialogAnswering('cancel');

    const { switchNetwork } = useNetworkSwitch();
    await expect(switchNetwork('GasLib-24')).resolves.toBe('cancelled');

    expect(dialogSpy).toHaveBeenCalledTimes(1);
    expect(apiSpies.selectNetwork).not.toHaveBeenCalled();
    expect(resetStudySpy).not.toHaveBeenCalled();
    expect(networkStore.activeNetwork).toBe('GasLib-11');
  });

  it('switches once the verdict loss is confirmed', async () => {
    const networkStore = useNetworkStore();
    const simulateStore = useSimulateStore();
    networkStore.activeNetwork = 'GasLib-11';
    simulateStore.result = { converged: true } as never;
    dialogAnswering('ok');

    const { switchNetwork } = useNetworkSwitch();
    await expect(switchNetwork('GasLib-24')).resolves.toBe('switched');

    expect(apiSpies.selectNetwork).toHaveBeenCalledWith('GasLib-24');
    expect(resetStudySpy).toHaveBeenCalledTimes(1);
  });

  it('reports a failure and leaves the study untouched when the backend refuses', async () => {
    const networkStore = useNetworkStore();
    networkStore.activeNetwork = 'GasLib-11';
    apiSpies.selectNetwork.mockRejectedValue(new Error('dataset introuvable'));

    const { switchNetwork } = useNetworkSwitch();
    await expect(switchNetwork('GasLib-24')).resolves.toBe('failed');

    expect(resetStudySpy).not.toHaveBeenCalled();
  });

  it('ignores an empty network id', async () => {
    const { switchNetwork } = useNetworkSwitch();
    await expect(switchNetwork('   ')).resolves.toBe('failed');
    expect(apiSpies.selectNetwork).not.toHaveBeenCalled();
  });
});
