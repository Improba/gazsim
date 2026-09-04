<template>
  <q-card
    v-if="visible"
    flat
    bordered
    dark
    class="map-cause-card bg-grey-10"
  >
    <q-card-section class="q-py-sm">
      <div class="row items-start no-wrap">
        <div class="col">
          <div class="text-caption text-bold text-grey-3 q-mb-xs">
            Point de livraison {{ heading }}
          </div>
          <div class="text-body2">{{ body }}</div>
        </div>
        <q-btn flat dense round icon="close" size="sm" @click="editorStore.clearSelection()" />
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from 'src/stores/editor';
import { useSimulateStore } from 'src/stores/simulate';
import { contractMarginForNode } from 'src/utils/contractMarginColor';
import { deficitSinkIds } from 'src/utils/novaDeficitSinks';

const editorStore = useEditorStore();
const simulateStore = useSimulateStore();

const selectedNodeId = computed(() =>
  editorStore.selectedKind === 'node' ? editorStore.selectedId : null,
);

const diagnostic = computed(() => {
  const id = selectedNodeId.value;
  if (!id) return null;
  return simulateStore.sinkDiagnostics.find((item) => item.node_id === id) ?? null;
});

const marginBar = computed(() => {
  const id = selectedNodeId.value;
  if (!id) return null;
  return contractMarginForNode(id, simulateStore.pressureMargins, simulateStore.pressureSlips);
});

const heading = computed(() => selectedNodeId.value ?? '');

const primaryDeficitId = computed(
  () => deficitSinkIds(simulateStore.sinkDiagnostics, simulateStore.novaVerdict)[0] ?? null,
);

const visible = computed(
  () =>
    !editorStore.editMode &&
    simulateStore.novaActive &&
    !simulateStore.nominationChangedSinceLastRun &&
    selectedNodeId.value != null &&
    selectedNodeId.value !== primaryDeficitId.value &&
    (diagnostic.value != null || marginBar.value != null),
);

const body = computed(() => {
  const id = selectedNodeId.value;
  if (!id) return '';
  const diag = diagnostic.value;
  if (diag) {
    const need =
      diag.required_lower_bar != null && Number.isFinite(diag.required_lower_bar)
        ? diag.required_lower_bar.toFixed(2)
        : 'n/d';
    return `Besoin ≥ ${need} bar, pression ${diag.max_upstream_pressure_bar.toFixed(2)} bar.`;
  }
  const margin = marginBar.value;
  if (margin == null) return '';
  if (margin < 0) {
    return `Déficit ${Math.abs(margin).toFixed(2)} bar sous la borne contractuelle.`;
  }
  return `Marge à la borne : +${margin.toFixed(2)} bar.`;
});
</script>

<style scoped>
.map-cause-card {
  position: absolute;
  left: calc(var(--map-sidebar-inset) + var(--map-sidebar-width) + 12px);
  bottom: var(--map-sidebar-inset);
  width: 340px;
  max-width: min(340px, calc(100% - var(--map-sidebar-width) - var(--map-legend-width) - 48px));
  z-index: calc(var(--map-overlay-z) + 3);
  pointer-events: auto;
}

@media (max-width: 640px) {
  .map-cause-card {
    left: var(--map-sidebar-inset);
    right: var(--map-sidebar-inset);
    width: auto;
    bottom: calc(var(--map-sidebar-inset) + 96px);
  }
}
</style>
