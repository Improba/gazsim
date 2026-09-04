import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';
import { resetStudyState } from 'src/utils/resetStudyState';
import {
  DEMO_JOUR_FILENAME,
  DEMO_JOUR_SCN_XML,
  DEMO_NETWORK_ID,
  DEMO_POINTE_FILENAME,
  DEMO_POINTE_SCN_XML,
} from 'src/utils/demoNominations';

export { DEMO_NETWORK_ID };

async function ensureImportedNomination(filename: string, xml: string): Promise<string> {
  const nominationStore = useNominationStore();
  await nominationStore.load(true);
  const stale = nominationStore.list.filter(
    (item) => item.filename === filename && item.source === 'imported',
  );
  for (const item of stale) {
    await nominationStore.removeImported(item.id);
  }
  const summary = await nominationStore.importFile(
    new File([xml], filename, { type: 'application/xml' }),
    { silent: true },
  );
  return summary.id;
}

/**
 * Charge GasLib-11, importe Jour / Pointe, sélectionne la pointe et lance Valider.
 * Si le calcul rate et qu'un `fallbackRunId` est fourni, hydrate ce run (`?run=`).
 */
export async function runNominationDemo(options?: { fallbackRunId?: string }): Promise<void> {
  const networkStore = useNetworkStore();
  const nominationStore = useNominationStore();
  const simulateStore = useSimulateStore();

  await networkStore.selectNetwork(DEMO_NETWORK_ID);
  resetStudyState();

  await ensureImportedNomination(DEMO_JOUR_FILENAME, DEMO_JOUR_SCN_XML);
  const pointeId = await ensureImportedNomination(DEMO_POINTE_FILENAME, DEMO_POINTE_SCN_XML);
  nominationStore.selectById(pointeId);

  try {
    await simulateStore.startValidation();
  } catch (err) {
    const fallback = options?.fallbackRunId?.trim();
    if (fallback) {
      await simulateStore.hydrateFromNovaRun(fallback);
      return;
    }
    throw err;
  }
}
