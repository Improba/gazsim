import { Dialog } from 'quasar';
import { useNetworkStore } from 'src/stores/network';
import { useSimulateStore } from 'src/stores/simulate';
import { useRecentNetworks } from 'src/composables/useRecentNetworks';
import { resetStudyState } from 'src/utils/resetStudyState';

/** Issue d'une demande de changement de réseau, pour que l'appelant décide de la navigation. */
export type NetworkSwitchOutcome =
  | 'switched'
  | 'already-active'
  | 'cancelled'
  | 'busy'
  | 'failed';

/**
 * Geste unique « changer de réseau » : confirmation si un verdict est à l'écran,
 * inscription dans les réseaux récents, bascule backend puis remise à zéro de l'étude.
 *
 * Changer de réseau change le périmètre de l'étude : le verdict de tenue pression et les
 * ajustements de session ne s'appliquent plus au nouveau réseau, `resetStudyState` les efface.
 */
export function useNetworkSwitch() {
  const networkStore = useNetworkStore();
  const simulateStore = useSimulateStore();
  const { addRecent } = useRecentNetworks();

  function confirmDiscardStudy(): Promise<boolean> {
    return new Promise((resolve) => {
      Dialog.create({
        title: 'Changer de réseau ?',
        message:
          'Le verdict de tenue pression et les ajustements de cette session seront effacés.',
        cancel: { label: 'Annuler', flat: true, color: 'grey-4' },
        ok: { label: 'Changer de réseau', color: 'primary', unelevated: true },
        dark: true,
      })
        .onOk(() => resolve(true))
        .onCancel(() => resolve(false))
        .onDismiss(() => resolve(false));
    });
  }

  async function switchNetwork(networkId: string): Promise<NetworkSwitchOutcome> {
    const target = networkId.trim();
    if (!target) {
      return 'failed';
    }
    if (networkStore.switching) {
      return 'busy';
    }
    if (target === networkStore.activeNetwork) {
      return 'already-active';
    }
    if (simulateStore.result !== null && !(await confirmDiscardStudy())) {
      return 'cancelled';
    }
    addRecent(target);
    try {
      await networkStore.selectNetwork(target);
      resetStudyState();
      return 'switched';
    } catch {
      // `networkStore.error` porte déjà le message : l'appelant reste sur place.
      return 'failed';
    }
  }

  return { switchNetwork };
}
