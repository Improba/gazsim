<template>
  <q-page class="q-pa-md workspace-page">
    <header class="workspace-page__header q-mb-md">
      <div class="row items-center q-col-gutter-sm">
        <div class="col">
          <div class="text-h5 text-white">Espace d'analyse</div>
          <div class="text-caption text-grey-5">
            {{ networkStore.activeNetwork ?? 'Aucun réseau' }}
          </div>
        </div>
        <div v-if="selectedNode" class="col-auto">
          <q-chip dense color="primary" text-color="white" icon="place">
            Nœud sélectionné : {{ selectedNode }}
          </q-chip>
        </div>
      </div>
    </header>

    <q-btn-group
      v-if="hasNetwork"
      flat
      class="workspace-page__switcher q-mb-md"
      role="tablist"
      aria-label="Vues de l'espace d'analyse"
    >
      <q-btn
        v-for="view in workspaceViews"
        :key="view.id"
        :color="activeView === view.id ? 'primary' : undefined"
        :text-color="activeView === view.id ? undefined : 'grey-5'"
        :label="view.label"
        :aria-selected="activeView === view.id"
        role="tab"
        @click="activeView = view.id"
      />
    </q-btn-group>

    <q-banner
      v-if="!hasNetwork"
      dense
      rounded
      class="bg-blue-grey-10 text-blue-grey-2 q-mb-md"
    >
      <template #avatar>
        <q-icon name="cloud_off" color="blue-grey-4" />
      </template>
      Aucun réseau chargé
      <template #action>
        <q-btn
          flat
          color="white"
          label="Charger un réseau"
          @click="router.push({ name: 'import' })"
        />
        <q-btn
          flat
          color="secondary"
          label="Essayer la démo"
          :loading="isLoadingDemo"
          @click="launchDemo"
        />
      </template>
    </q-banner>

    <q-banner
      v-else-if="!hasResult"
      dense
      rounded
      class="bg-blue-grey-10 text-blue-grey-2 q-mb-md"
    >
      <template #avatar>
        <q-icon name="info" color="blue-grey-4" />
      </template>
      Aucun résultat — sélectionnez une nomination ci-dessous puis validez la tenue pression.
      <template #action>
        <q-btn
          flat
          color="white"
          label="Ouvrir la carte"
          @click="router.push({ name: 'map' })"
        />
      </template>
    </q-banner>

    <div v-if="hasNetwork" class="workspace-page__launch q-mb-md">
      <NominationPanel :disabled="simulateStore.loading" />
      <div class="row q-gutter-sm q-mt-sm">
        <q-btn
          unelevated
          color="primary"
          :label="launchLabel"
          icon="play_arrow"
          :loading="simulateStore.loading"
          :disable="simulateStore.loading || networkStore.switching"
          @click="onValidate"
        />
        <q-btn
          v-if="simulateStore.loading"
          color="negative"
          icon="stop"
          label="Arrêter"
          @click="simulateStore.cancelSimulation()"
        />
      </div>
      <q-banner
        v-if="simulateStore.inputDirty && hasResult"
        dense
        rounded
        class="bg-amber-10 text-amber-2 q-mt-sm"
      >
        <template #avatar>
          <q-icon name="info" />
        </template>
        <span v-if="simulateStore.scenarioDirty">Nomination modifiée — relancez pour re-valider la tenue pression.</span>
        <span v-else>Soutirages ou réglages modifiés — relancez pour voir l'effet.</span>
      </q-banner>
    </div>

    <NovaWorkflowStepper
      v-if="hasNetwork && hasResult && novaWorkflowEnabled"
      class="workspace-page__stepper q-mb-md"
    />

    <div v-if="hasNetwork" class="workspace-page__body">
      <div class="workspace-page__main">
        <SchematicView
          v-if="activeView === 'schematic'"
          :selected-node-id="selectedNode"
          @select-node="onSelectNode"
        />
        <PressureProfileView v-else-if="activeView === 'profile'" />
        <ResultsTableView v-else />
      </div>
      <aside class="workspace-page__rail">
        <ResultsRail
          :active-section="novaWorkflowEnabled ? novaCurrentStep : null"
          @focus-deficits="onFocusDeficits"
          @select-node="onSelectNode"
          @run-study="onRunStudy"
          @reduce="onReduce"
          @reduce-all="onReduceAll"
          @save-reduced="onSaveReduced"
        />
      </aside>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import SchematicView from 'src/components/workspace/SchematicView.vue';
import PressureProfileView from 'src/components/workspace/PressureProfileView.vue';
import ResultsTableView from 'src/components/workspace/ResultsTableView.vue';
import NovaWorkflowStepper from 'src/components/workspace/NovaWorkflowStepper.vue';
import ResultsRail from 'src/components/workspace/ResultsRail.vue';
import NominationPanel from 'src/components/NominationPanel.vue';
import { useDemo } from 'src/composables/useDemo';
import { useNovaWorkflow } from 'src/composables/useNovaWorkflow';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';
import { deficitSinkIds } from 'src/utils/novaDeficitSinks';

type WorkspaceView = 'schematic' | 'profile' | 'table';

const workspaceViews: Array<{ id: WorkspaceView; label: string }> = [
  { id: 'schematic', label: 'Schéma' },
  { id: 'profile', label: 'Profil de pression' },
  { id: 'table', label: 'Tableau' },
];

const router = useRouter();
const $q = useQuasar();
const networkStore = useNetworkStore();
const nominationStore = useNominationStore();
const simulateStore = useSimulateStore();
const { isLoadingDemo, launchDemo } = useDemo();
const { enabled: novaWorkflowEnabled, currentStep: novaCurrentStep } = useNovaWorkflow();

const activeView = ref<WorkspaceView>('schematic');
const selectedNode = ref<string | null>(null);

const hasNetwork = computed(() => networkStore.nodes.length > 0);
const hasResult = computed(() => simulateStore.result !== null);
const launchLabel = computed(() =>
  nominationStore.activeId ? 'Valider la nomination' : 'Lancer',
);

function onValidate(): void {
  void simulateStore.startValidation();
}

function onRunStudy(): void {
  void simulateStore.runSinkCapacity(
    deficitSinkIds(simulateStore.sinkDiagnostics, simulateStore.novaVerdict),
  );
}

function onSelectNode(nodeId: string): void {
  selectedNode.value = nodeId;
  $q.notify({
    message: `Nœud ${nodeId} sélectionné`,
    timeout: 1500,
  });
}

function onFocusDeficits(): void {
  const ids = deficitSinkIds(simulateStore.sinkDiagnostics, simulateStore.novaVerdict);
  if (ids.length > 0) {
    selectedNode.value = ids[0];
    $q.notify({
      message: `Nœud ${ids[0]} sélectionné`,
      timeout: 1500,
    });
    return;
  }
  $q.notify({
    type: 'info',
    message: 'Aucun point déficitaire identifié sur ce run.',
    timeout: 2000,
  });
}

function onReduce(sinkId: string, maxFeasibleQ: number): void {
  void simulateStore.applySinkReduction(sinkId, maxFeasibleQ);
}

function onReduceAll(): void {
  void simulateStore.applyAllCapacityReductions();
}

async function onSaveReduced(demands: Record<string, number>): Promise<void> {
  const baseId = simulateStore.activeScenarioId ?? nominationStore.activeId;
  if (!baseId) {
    $q.notify({
      type: 'warning',
      message: 'Sélectionnez une nomination avant d\'enregistrer la version réduite.',
    });
    return;
  }
  try {
    await nominationStore.saveReduced(baseId, demands);
  } catch {
    // Le store affiche déjà une notification négative.
  }
}
</script>

<style scoped>
.workspace-page {
  color: var(--scada-text);
  min-height: inherit;
}

.workspace-page__switcher {
  border: 1px solid var(--scada-border);
  border-radius: 4px;
}

.workspace-page__launch {
  max-width: 520px;
}

.workspace-page__stepper {
  max-width: 100%;
}

.workspace-page__body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.workspace-page__main {
  flex: 1 1 0;
  min-width: 0;
}

.workspace-page__rail {
  flex: 0 0 380px;
  width: 380px;
}

@media (max-width: 1023px) {
  .workspace-page__body {
    flex-direction: column;
  }

  .workspace-page__rail {
    flex: 1 1 auto;
    width: 100%;
  }
}
</style>
