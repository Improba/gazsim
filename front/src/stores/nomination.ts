import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { Notify } from 'quasar';
import { api, type NovaScenarioSummary } from 'src/services/api';
import { useNetworkStore } from 'src/stores/network';
import { formatApiError } from 'src/utils/importError';
import { nominationsForStudyPicker } from 'src/utils/nominationPicker';

/**
 * Objet « Nomination » first-class (Phase WS4-fin). Porte la nomination NoVa active
 * (scénario `.scn`) au-delà d'un simple identifiant : on conserve le résumé (filename,
 * chemin relatif) pour l'afficher dans l'UI métier (Camille manipule une nomination,
 * pas un `scenario_id`).
 */
export const useNominationStore = defineStore('nomination', () => {
  const list = ref<NovaScenarioSummary[]>([]);
  const selected = ref<NovaScenarioSummary | null>(null);
  const loading = ref(false);

  const activeId = computed(() => selected.value?.id ?? null);
  const activeFilename = computed(() => selected.value?.filename ?? null);
  const studyList = computed(() => {
    const networkStore = useNetworkStore();
    return nominationsForStudyPicker(list.value, networkStore.activeNetwork);
  });

  let loadedForNetwork: string | null = null;
  let loadGeneration = 0;

  async function load(force = false) {
    const networkStore = useNetworkStore();
    const networkId = networkStore.activeNetwork ?? null;
    if (!force && loadedForNetwork === networkId) {
      return;
    }
    const generation = ++loadGeneration;
    loading.value = true;
    try {
      const next = await api.listNovaScenarios(networkId ?? undefined);
      if (generation !== loadGeneration) {
        return;
      }
      list.value = next;
      loadedForNetwork = networkId;
      if (
        selected.value &&
        (!list.value.some((s) => s.id === selected.value!.id) ||
          !studyList.value.some((s) => s.id === selected.value!.id))
      ) {
        selected.value = null;
      }
    } catch (err) {
      if (generation !== loadGeneration) {
        return;
      }
      list.value = [];
      Notify.create({
        type: 'negative',
        message: err instanceof Error ? err.message : 'Impossible de charger les nominations',
      });
    } finally {
      if (generation === loadGeneration) {
        loading.value = false;
      }
    }
  }

  async function importFile(file: File, options?: { silent?: boolean }) {
    if (!file.name.endsWith('.scn')) {
      Notify.create({ type: 'negative', message: 'Le fichier doit avoir l\'extension .scn' });
      throw new Error('invalid extension');
    }
    const xml = await file.text();
    const summary = await api.importNovaNomination({ filename: file.name, xml });
    await load(true);
    selectById(summary.id);
    if (!options?.silent) {
      Notify.create({ type: 'positive', message: `Nomination ${file.name} importée` });
    }
    return summary;
  }

  async function removeImported(id: string) {
    await api.deleteNovaNomination(id);
    if (selected.value?.id === id) {
      selected.value = null;
    }
    await load(true);
  }

  async function saveReduced(baseScenarioId: string, demands: Record<string, number>) {
    try {
      const summary = await api.saveReducedNovaNomination({
        base_scenario_id: baseScenarioId,
        reduced_demands: demands,
      });
      await load(true);
      selectById(summary.id);
      Notify.create({
        type: 'positive',
        message: `Nomination réduite enregistrée (${summary.filename})`,
      });
      return summary;
    } catch (err) {
      Notify.create({
        type: 'negative',
        message: formatApiError(err),
      });
      throw err;
    }
  }

  function selectById(id: string | null) {
    if (id == null) {
      selected.value = null;
      return;
    }
    selected.value = list.value.find((s) => s.id === id) ?? { id, filename: id, relative_path: id };
  }

  function clear() {
    selected.value = null;
  }

  function reset() {
    selected.value = null;
    list.value = [];
    loadedForNetwork = null;
  }

  return {
    list,
    studyList,
    selected,
    loading,
    activeId,
    activeFilename,
    load,
    importFile,
    removeImported,
    saveReduced,
    selectById,
    clear,
    reset,
  };
});
