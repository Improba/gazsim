<template>
  <q-page
    class="map-page"
    :class="{
      'map-page--timeseries': timeseriesStore.hasResult,
      'map-page--edit-mode': editorStore.editMode,
    }"
  >
    <EditorToolbar v-if="hasNetwork" class="editor-toolbar-slot" />
    <div class="canvas-wrapper">
      <CesiumViewer :contingency-violation-node-ids="contingencyStore.selectedCaseViolationNodeIds" />
      <MapCauseCard v-if="hasNetwork" />
      <div v-if="networkStore.error" class="state-overlay state-overlay--error">
        <q-icon name="error_outline" size="40px" color="negative" class="q-mb-sm" />
        <div class="text-subtitle1 q-mb-xs">Échec du chargement du réseau</div>
        <p class="text-body2 text-grey-4 state-overlay__hint">{{ networkStore.error }}</p>
        <q-btn
          flat
          color="primary"
          label="Réessayer"
          :loading="networkStore.loading"
          @click="networkStore.fetchNetwork()"
        />
      </div>
      <div v-else-if="networkStore.loading && networkStore.nodes.length === 0" class="state-overlay">
        <q-spinner-dots size="40px" color="primary" class="q-mb-md" />
        <div class="text-body2 text-grey-4">Chargement du réseau…</div>
      </div>
      <div v-else-if="showEmptyState" class="map-empty state-overlay">
        <q-icon name="map" size="48px" color="primary" class="q-mb-sm" />
        <div class="text-h6 text-white q-mb-xs">Aucun réseau sur la carte</div>
        <p class="text-body2 text-grey-4 map-empty__hint q-mb-md">
          Chargez un réseau ou lancez la démo nomination pour ouvrir l'étude de tenue pression.
        </p>
        <div class="row q-gutter-sm justify-center">
          <q-btn
            color="primary"
            unelevated
            icon="dashboard"
            label="Aller au tableau de bord"
            :to="{ name: 'dashboard' }"
          />
          <q-btn
            outline
            color="primary"
            icon="upload_file"
            label="Importer un réseau"
            :to="{ name: 'import' }"
          />
          <q-btn
            flat
            color="secondary"
            icon="play_arrow"
            label="Démo nomination"
            :loading="isLoadingDemo"
            :disable="networkStore.switching"
            @click="onMapNominationDemo"
          />
        </div>
      </div>
      <div v-else-if="showAwaitingValidation" class="map-awaiting">
        <div class="text-subtitle2 text-white">Pas encore évaluée</div>
        <p class="text-caption text-grey-4 q-mb-none">{{ awaitingHint }}</p>
      </div>
    </div>
    <SimulationPanel v-if="hasNetwork" class="sidebar-panel" />
    <PropertyPanel v-if="hasNetwork && editorStore.editMode" class="property-panel-slot" />
    <Legend v-if="hasNetwork" class="legend-panel" />
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import CesiumViewer from 'src/components/CesiumViewer.vue';
import EditorToolbar from 'src/components/EditorToolbar.vue';
import Legend from 'src/components/Legend.vue';
import MapCauseCard from 'src/components/MapCauseCard.vue';
import PropertyPanel from 'src/components/PropertyPanel.vue';
import SimulationPanel from 'src/components/SimulationPanel.vue';
import { useContingencyStore } from 'src/stores/contingency';
import { useEditorStore } from 'src/stores/editor';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';
import { useTimeseriesStore } from 'src/stores/timeseries';
import { useDemo } from 'src/composables/useDemo';
import { findDemoPair } from 'src/utils/nominationPicker';

const networkStore = useNetworkStore();
const editorStore = useEditorStore();
const contingencyStore = useContingencyStore();
const timeseriesStore = useTimeseriesStore();
const simulateStore = useSimulateStore();
const nominationStore = useNominationStore();

const { isLoadingDemo, launchDemo } = useDemo();
const route = useRoute();

const showEmptyState = computed(
  () => !networkStore.loading && networkStore.nodes.length === 0,
);

const hasNetwork = computed(() => networkStore.nodes.length > 0);
const showAwaitingValidation = computed(
  () =>
    hasNetwork.value &&
    !networkStore.loading &&
    !networkStore.error &&
    !simulateStore.loading &&
    !editorStore.editMode &&
    (simulateStore.result === null || simulateStore.nominationChangedSinceLastRun),
);
const awaitingHint = computed(() => {
  if (simulateStore.nominationChangedSinceLastRun) {
    return 'Les couleurs de l\'autre nomination sont masquées. Validez pour comparer.';
  }
  const pair = findDemoPair(nominationStore.studyList);
  if (pair.jour && pair.pointe) {
    return 'Choisissez Jour ou Pointe à gauche, puis validez. Le réseau se colorera selon l\'écart à la borne contractuelle.';
  }
  return 'Choisissez une nomination à gauche, puis validez. Le réseau se colorera selon l\'écart à la borne contractuelle.';
});

async function onMapNominationDemo(): Promise<void> {
  const raw = route.query.run;
  const fallbackRunId = typeof raw === 'string' ? raw : undefined;
  try {
    await launchDemo(fallbackRunId);
  } catch {
    // Erreur déjà notifiée.
  }
}
</script>

<style scoped>
.map-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.map-page:not(.map-page--edit-mode) {
  --map-editor-toolbar-height: 0px;
}

.editor-toolbar-slot {
  flex: 0 0 auto;
  z-index: calc(var(--map-overlay-z) + 5);
  min-height: var(--map-editor-toolbar-height);
}

.map-page:not(.map-page--edit-mode) .editor-toolbar-slot {
  position: absolute;
  top: var(--map-sidebar-inset);
  right: var(--map-sidebar-inset);
  min-height: 0;
  pointer-events: none;
}

.map-page:not(.map-page--edit-mode) .editor-toolbar-slot :deep(.editor-toolbar-edit-btn) {
  pointer-events: auto;
}

.canvas-wrapper {
  flex: 1;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.state-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  background: rgba(11, 16, 22, 0.72);
  backdrop-filter: blur(4px);
  pointer-events: auto;
}

.state-overlay--error {
  background: rgba(40, 12, 12, 0.78);
}

.state-overlay__hint {
  max-width: 420px;
  margin: 0;
}

.map-empty__hint {
  max-width: 520px;
  margin: 0;
}

.map-awaiting {
  position: absolute;
  top: var(--map-sidebar-inset);
  left: calc(var(--map-sidebar-width) + var(--map-sidebar-inset) * 2);
  z-index: calc(var(--map-overlay-z) + 2);
  max-width: min(420px, calc(100% - var(--map-sidebar-width) - 220px));
  padding: 10px 12px;
  background: rgba(14, 28, 38, 0.92);
  border: 1px solid var(--scada-border);
  border-radius: 8px;
  pointer-events: none;
}
</style>
