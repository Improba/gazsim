<template>
  <div>
    <NominationPanel :disabled="simulateStore.loading" />

    <q-banner
      v-if="simulateStore.inputDirty || simulateStore.hasSessionDemandOverrides"
      dense
      rounded
      class="bg-amber-10 text-amber-2 q-mb-sm"
    >
      <template #avatar>
        <q-icon name="info" />
      </template>
      <span v-if="simulateStore.nominationChangedSinceLastRun">Cette nomination n'est pas encore évaluée. Validez pour comparer.</span>
      <span v-else-if="simulateStore.scenarioDirty">Nomination modifiée. Relancez pour re-valider la tenue pression.</span>
      <span v-else-if="simulateStore.hasSessionDemandOverrides">{{ SESSION_REDUCTION_BANNER }}</span>
      <span v-else>{{ MODIFIED_WITHDRAWALS_EQUIPMENT_BANNER }}</span>
    </q-banner>

    <q-banner
      v-if="simulateStore.continuationLabel"
      dense
      rounded
      class="bg-blue-grey-10 text-blue-grey-2 q-mb-sm"
    >
      {{ simulateStore.continuationLabel }}
    </q-banner>

    <div class="row q-col-gutter-sm q-mb-md">
      <div v-if="showDemoLaunch" class="col">
        <q-btn
          no-caps
          label="Démo nomination"
          color="primary"
          icon="verified"
          class="full-width"
          :loading="isLoadingDemo"
          :disable="isLoadingDemo || networkStore.switching"
          @click="onLaunchNominationDemo"
        />
      </div>
      <div v-else class="col">
        <q-btn
          no-caps
          :label="validateLabel"
          :outline="hasCurrentVerdict"
          :unelevated="!hasCurrentVerdict"
          :color="hasCurrentVerdict ? 'grey-5' : 'primary'"
          icon="play_arrow"
          class="full-width"
          :loading="simulateStore.loading"
          :disable="networkStore.nodes.length === 0 || !novaScenarioId"
          @click="simulateStore.startValidation()"
        >
          <q-tooltip v-if="!novaScenarioId">Choisissez une nomination, puis validez.</q-tooltip>
        </q-btn>
      </div>
      <div v-if="simulateStore.loading" class="col">
        <q-btn
          label="Arrêter"
          color="negative"
          icon="stop"
          class="full-width"
          @click="simulateStore.cancelSimulation()"
        />
      </div>
    </div>

    <p
      v-if="novaScenarioId && !hasCurrentVerdict && !simulateStore.loading && !showDemoLaunch"
      class="text-caption text-grey-5 q-mb-sm"
    >
      Validez pour savoir si le contrat tient. Le réseau se colorera selon l'écart à la borne.
    </p>

    <ProgressBar />

    <q-banner
      v-if="simulateStore.errorMessage"
      dense
      rounded
      class="bg-red-10 text-red-2 q-mb-md"
    >
      {{ simulateStore.errorMessage }}
      <template #action>
        <q-btn
          v-if="simulateStore.status === 'cancelled'"
          flat
          dense
          color="white"
          label="Convergence renforcée"
          :disable="simulateStore.loading || !simulateStore.hasLastRun || networkStore.nodes.length === 0"
          @click="simulateStore.rerunWithRobustMode()"
        />
        <q-btn
          flat
          dense
          color="white"
          label="Relancer"
          :disable="simulateStore.loading || networkStore.nodes.length === 0 || !novaScenarioId"
          @click="simulateStore.startValidation()"
        />
      </template>
    </q-banner>

    <template v-if="hasCurrentVerdict">
      <SimulationResultsBlock
        :show-scenario-dirty="false"
        :show-solver-details="false"
        compact-first-fold
        @focus-deficits="focusFirstDeficit"
        @select-node="onSelectSink"
        @run-study="runCapacityStudy"
        @reduce="onReduceSink"
        @reduce-session="onReduceSession"
        @reduce-all="onReduceAll"
        @save-reduced="onSaveReduced"
      />
    </template>

    <q-separator dark class="q-my-sm" />

    <q-expansion-item
      v-model="settingsOpen"
      dense
      dark
      icon="tune"
      label="Avancé"
      class="q-mb-sm bg-grey-10 rounded-borders"
    >
      <div class="q-pa-sm">
        <q-expansion-item
          dense
          dark
          icon="science"
          label="Composition gaz"
          class="q-mb-md bg-grey-10 rounded-borders"
        >
          <div class="q-pa-sm text-caption text-grey-4">
            <span>
              PCS {{ formatGas(networkStore.gas.pcs_mj_per_nm3) }} MJ/Nm³
              <q-icon name="help_outline" size="14px" class="q-ml-xs cursor-pointer">
                <q-tooltip>Pouvoir calorifique supérieur du mélange (ISO 6976)</q-tooltip>
              </q-icon>
            </span>
            —
            <span>
              PCI {{ formatGas(networkStore.gas.pci_mj_per_nm3) }} MJ/Nm³
              <q-icon name="help_outline" size="14px" class="q-ml-xs cursor-pointer">
                <q-tooltip>Pouvoir calorifique inférieur du mélange (ISO 6976)</q-tooltip>
              </q-icon>
            </span>
            —
            <span>
              Wobbe {{ formatGas(networkStore.gas.wobbe_mj_per_nm3) }} MJ/Nm³
              <q-icon name="help_outline" size="14px" class="q-ml-xs cursor-pointer">
                <q-tooltip>Indice de Wobbe : interchangeabilité des gaz (EN 437)</q-tooltip>
              </q-icon>
            </span>
          </div>
          <q-banner
            v-if="networkStore.gas.warnings?.length"
            dense
            rounded
            class="bg-orange-10 text-orange-2 q-mx-sm q-mb-sm"
          >
            <template #avatar>
              <q-icon name="warning" />
            </template>
            <div v-for="(msg, idx) in networkStore.gas.warnings" :key="idx">{{ msg }}</div>
          </q-banner>
          <div class="row q-col-gutter-xs q-px-sm q-pb-sm">
            <div v-for="field in gasFields" :key="field.key" class="col-6">
              <q-input
                v-model.number="gasDraft[field.key]"
                :label="field.label"
                dense
                outlined
                dark
                type="number"
                step="0.001"
                min="0"
                max="1"
              />
            </div>
          </div>
          <div class="row q-gutter-sm q-px-sm q-pb-sm">
            <q-btn dense outline label="G20" color="secondary" @click="applyPreset('g20')" />
            <q-btn dense outline label="CH₄ pur" color="secondary" @click="applyPreset('ch4')" />
            <q-btn
              dense
              label="Appliquer"
              color="primary"
              :loading="gasApplying"
              :disable="gasApplying || simulateStore.loading"
              @click="applyGasComposition"
            />
          </div>
        </q-expansion-item>

        <DemandControls v-model="simulateStore.demandOverrides" />

        <ScenarioPanel
          @demands-resolved="onScenarioDemands"
          @timeseries-finished="onTimeseriesFinished"
        />

        <ComparePanel :model-value="comparePanelOpen" />

        <CompareNominationsPanel />

        <EquipmentControls v-model="simulateStore.equipmentOverrides" />

        <div class="row items-center q-mb-xs">
          <span class="text-caption text-grey-4">Mode de calcul</span>
          <q-icon name="help_outline" size="16px" class="q-ml-xs cursor-pointer text-grey-5">
            <q-tooltip max-width="280px">
              <div class="q-mb-xs"><b>Standard</b> : {{ SIMULATION_MODE_HELP.free }}</div>
              <div class="q-mb-xs"><b>Vérifier</b> : {{ SIMULATION_MODE_HELP.check }}</div>
              <div><b>Optimiser capacités</b> : {{ SIMULATION_MODE_HELP.optimize }}</div>
            </q-tooltip>
          </q-icon>
        </div>
        <q-btn-toggle
          v-model="simulateStore.simulationMode"
          :options="[
            { label: 'Standard', value: 'free' },
            { label: 'Vérifier', value: 'check' },
            { label: 'Optimiser capacités', value: 'optimize' },
          ]"
          dense
          no-caps
          toggle-color="primary"
          class="q-mb-sm full-width"
        />

        <q-toggle
          v-model="simulateStore.robustMode"
          label="Convergence renforcée"
          color="secondary"
          dark
          class="q-mb-sm"
          :disable="simulateStore.loading"
        >
          <q-tooltip max-width="300px">
            Enchaîne des paliers de soutirage (10 % → 30 % → 100 %) pour faciliter la convergence
            sur les grands réseaux transport.
          </q-tooltip>
        </q-toggle>

        <q-expansion-item
          dense
          dark
          icon="article"
          label="Journal de calcul"
          class="bg-grey-10 rounded-borders"
        >
          <LogPanel />
        </q-expansion-item>
      </div>
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Notify } from 'quasar';
import ComparePanel from 'src/components/ComparePanel.vue';
import CompareNominationsPanel from 'src/components/CompareNominationsPanel.vue';
import DemandControls from 'src/components/DemandControls.vue';
import EquipmentControls from 'src/components/EquipmentControls.vue';
import NominationPanel from 'src/components/NominationPanel.vue';
import ScenarioPanel from 'src/components/ScenarioPanel.vue';
import SimulationResultsBlock from 'src/components/SimulationResultsBlock.vue';
import LogPanel from 'src/components/LogPanel.vue';
import ProgressBar from 'src/components/ProgressBar.vue';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';
import { useEditorStore } from 'src/stores/editor';
import { useTimeseriesStore } from 'src/stores/timeseries';
import { G20_NOMINAL, PURE_CH4, type GasCompositionDto } from 'src/services/api';
import { SIMULATION_MODE_HELP } from 'src/utils/simulationStatus';
import {
  MODIFIED_WITHDRAWALS_EQUIPMENT_BANNER,
  SESSION_REDUCTION_BANNER,
} from 'src/utils/novaLabels';
import { deficitSinkIds } from 'src/utils/novaDeficitSinks';
import { useDemo } from 'src/composables/useDemo';

const networkStore = useNetworkStore();
const simulateStore = useSimulateStore();
const editorStore = useEditorStore();
const timeseriesStore = useTimeseriesStore();
const nominationStore = useNominationStore();

const route = useRoute();
const comparePanelOpen = computed(() => route.query.compare === '1');
const settingsOpen = ref(false);
watch(
  comparePanelOpen,
  (open) => {
    if (open) {
      settingsOpen.value = true;
    }
  },
  { immediate: true },
);
const novaScenarioId = computed(() => nominationStore.activeId);
const { isLoadingDemo, launchDemo } = useDemo();
const hasCurrentVerdict = computed(
  () =>
    simulateStore.result !== null &&
    !simulateStore.nominationChangedSinceLastRun &&
    !simulateStore.loading,
);
const validateLabel = computed(() => (hasCurrentVerdict.value ? 'Re-valider' : 'Valider'));
const showDemoLaunch = computed(
  () =>
    isLoadingDemo.value ||
    (!simulateStore.result && !simulateStore.loading && !novaScenarioId.value),
);
const gasDraft = ref<GasCompositionDto>({ ...G20_NOMINAL });
const gasApplying = ref(false);

const gasFields = [
  { key: 'ch4' as const, label: 'CH₄' },
  { key: 'c2h6' as const, label: 'C₂H₆' },
  { key: 'co2' as const, label: 'CO₂' },
  { key: 'n2' as const, label: 'N₂' },
  { key: 'h2' as const, label: 'H₂' },
];

function formatGas(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/d';
  }
  return value.toFixed(2);
}

watch(
  () => networkStore.gas.composition,
  (composition) => {
    gasDraft.value = { ...composition };
  },
  { immediate: true, deep: true },
);

function applyPreset(preset: 'g20' | 'ch4') {
  gasDraft.value = { ...(preset === 'g20' ? G20_NOMINAL : PURE_CH4) };
}

async function applyGasComposition() {
  gasApplying.value = true;
  try {
    await networkStore.updateGasComposition({ ...gasDraft.value });
    Notify.create({ type: 'positive', message: 'Composition gaz mise à jour' });
  } catch (err) {
    Notify.create({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Échec mise à jour composition',
    });
  } finally {
    gasApplying.value = false;
  }
}

function onScenarioDemands(demands: Record<string, number>) {
  simulateStore.demandOverrides = { ...demands };
}

function onTimeseriesFinished() {
  if (timeseriesStore.hasResult) {
    timeseriesStore.setSelectedStepIndex(Number.POSITIVE_INFINITY);
  }
}

function onSelectSink(nodeId: string) {
  editorStore.selectNode(nodeId);
}

async function onLaunchNominationDemo(): Promise<void> {
  const raw = route.query.run;
  const fallbackRunId = typeof raw === 'string' ? raw : undefined;
  try {
    await launchDemo(fallbackRunId);
  } catch {
    // Erreur déjà notifiée par useDemo.
  }
}

function focusFirstDeficit() {
  const first =
    simulateStore.sinkDiagnostics[0]?.node_id ?? simulateStore.novaVerdict?.deficit_sinks[0];
  if (first) {
    editorStore.selectNode(first);
  }
}

watch(
  () => simulateStore.status,
  (status) => {
    if (status !== 'converged' || !simulateStore.novaActive) {
      return;
    }
    if (simulateStore.novaVerdict?.feasible) {
      return;
    }
    focusFirstDeficit();
  },
  { immediate: true },
);

function runCapacityStudy() {
  const fromTable = simulateStore.sinkCapacity.map((r) => r.sink_id);
  const ids =
    fromTable.length > 0
      ? fromTable
      : deficitSinkIds(simulateStore.sinkDiagnostics, simulateStore.novaVerdict);
  void simulateStore.runSinkCapacity(ids.length > 0 ? ids : undefined);
}

function onReduceSink(sinkId: string, maxFeasibleQ: number) {
  void simulateStore.applySinkReduction(sinkId, maxFeasibleQ);
}

function onReduceSession(sinkId: string) {
  void simulateStore.applySessionSinkReduction(sinkId);
}

function onReduceAll() {
  void simulateStore.applyAllCapacityReductions();
}

async function onSaveReduced(demands: Record<string, number>): Promise<void> {
  const baseId = simulateStore.activeScenarioId ?? nominationStore.activeId;
  if (!baseId) {
    Notify.create({
      type: 'warning',
      message: 'Sélectionnez une nomination avant d\'enregistrer la version réduite.',
    });
    return;
  }
  try {
    await nominationStore.saveReduced(baseId, demands);
    simulateStore.clearDemandOverrides();
  } catch {
    // Le store affiche déjà une notification négative.
  }
}
</script>
