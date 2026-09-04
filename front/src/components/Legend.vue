<template>
  <q-card dark flat bordered class="legend-card">
    <q-card-section class="q-pa-sm">
      <div class="text-subtitle2 q-mb-xs">Légende</div>

      <template v-if="hasSimulationData">
        <div class="text-caption text-grey-4">Débit (Nm³/s)</div>
        <div class="legend-gradient flow-gradient q-mb-xs" />
        <div class="row justify-between text-caption q-mb-sm">
          <span>0</span>
          <span>{{ maxAbsFlow.toFixed(2) }}</span>
        </div>

        <template v-if="novaMarginLegend">
          <div class="text-caption text-grey-4">Écart à la borne (bar)</div>
          <div class="legend-gradient contract-margin-gradient q-mb-xs" />
          <div class="row justify-between text-caption">
            <span>Déficit</span>
            <span>À l'aise</span>
          </div>
        </template>
        <template v-else>
          <div class="text-caption text-grey-4">Pression (bar)</div>
          <div class="legend-gradient pressure-gradient q-mb-xs" />
          <div class="row justify-between text-caption">
            <span>{{ minPressure.toFixed(1) }}</span>
            <span>{{ maxPressure.toFixed(1) }}</span>
          </div>
        </template>
      </template>
      <div v-else class="text-caption text-grey-5">
        Validez pour colorer le réseau selon l'écart à la borne.
      </div>

      <template v-if="equipmentItems.length > 0">
        <q-separator dark class="q-my-sm" />
        <div class="text-caption text-grey-4 q-mb-xs">Organes (type, pas un état)</div>
        <div
          v-for="item in equipmentItems"
          :key="item.kind"
          class="row items-center no-wrap equipment-row"
        >
          <span class="equipment-dot" :style="{ backgroundColor: item.color }" />
          <span class="text-caption text-grey-3">{{ item.label }}</span>
        </div>
      </template>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNetworkStore } from 'src/stores/network';
import { useSimulateStore } from 'src/stores/simulate';
import { useTimeseriesStore } from 'src/stores/timeseries';
import { hasContractMarginScale } from 'src/utils/contractMarginColor';
import { equipmentLegendItems } from 'src/utils/equipmentLabels';

const simulateStore = useSimulateStore();
const timeseriesStore = useTimeseriesStore();
const networkStore = useNetworkStore();

const equipmentItems = computed(() => equipmentLegendItems(networkStore.pipes));

// Même priorité d'affichage que CesiumViewer.updateColors() : pas horaire sélectionné,
// puis données live, puis dernier résultat convergé.
const pressures = computed<Record<string, number>>(() => {
  const step = timeseriesStore.selectedStep;
  if (step?.pressures) return step.pressures;
  if (Object.keys(simulateStore.livePressures).length > 0) return simulateStore.livePressures;
  return simulateStore.result?.pressures ?? {};
});

const flows = computed<Record<string, number>>(() => {
  const step = timeseriesStore.selectedStep;
  if (step?.flows) return step.flows;
  if (Object.keys(simulateStore.liveFlows).length > 0) return simulateStore.liveFlows;
  return simulateStore.result?.flows ?? {};
});

const flowValues = computed(() => Object.values(flows.value));
const pressureValues = computed(() => Object.values(pressures.value));

const hasSimulationData = computed(
  () =>
    !simulateStore.nominationChangedSinceLastRun &&
    (flowValues.value.length > 0 || pressureValues.value.length > 0),
);

const novaMarginLegend = computed(
  () =>
    simulateStore.novaActive &&
    !simulateStore.nominationChangedSinceLastRun &&
    hasContractMarginScale(simulateStore.pressureMargins, simulateStore.pressureSlips),
);

const maxAbsFlow = computed(() => {
  if (flowValues.value.length === 0) return 1;
  return Math.max(...flowValues.value.map((v) => Math.abs(v)), 1);
});

const minPressure = computed(() => {
  if (pressureValues.value.length === 0) return 0;
  return Math.min(...pressureValues.value);
});

const maxPressure = computed(() => {
  if (pressureValues.value.length === 0) return 0;
  return Math.max(...pressureValues.value);
});
</script>

<style scoped>
.legend-card {
  box-sizing: border-box;
  background: rgba(26, 32, 42, 0.88);
  backdrop-filter: blur(8px);
}

.legend-gradient {
  height: 10px;
  border-radius: 999px;
}

.flow-gradient {
  background: linear-gradient(90deg, #00c853 0%, #ffe082 50%, #d50000 100%);
}

.pressure-gradient {
  background: linear-gradient(90deg, #1e88e5 0%, #43a047 50%, #fbc02d 100%);
}

.contract-margin-gradient {
  background: linear-gradient(90deg, #ff1744 0%, #fb8c00 50%, #43a047 100%);
}

.equipment-row {
  gap: 6px;
  line-height: 1.4;
}

.equipment-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.8);
  flex: 0 0 auto;
}
</style>
