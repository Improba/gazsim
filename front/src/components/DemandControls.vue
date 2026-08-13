<template>
  <q-expansion-item
    dense
    dense-toggle
    icon="tune"
    label="Soutirages personnalisés"
    class="q-mb-sm"
  >
    <q-card flat bordered class="q-pa-sm bg-grey-10">
      <template v-if="adjustableNodes.length > 0">
        <div
          v-for="node in adjustableNodes"
          :key="node.id"
          class="q-mb-md"
        >
          <div class="row items-center justify-between text-caption q-mb-none">
            <span>{{ node.id }}</span>
            <span>-{{ (sliderValues[node.id] ?? 0).toFixed(1) }} Nm³/s</span>
          </div>
          <q-slider
            :model-value="sliderValues[node.id] ?? 0"
            :min="0"
            :max="getMaxWithdrawal(node)"
            :step="0.5"
            color="amber-5"
            label
            :label-value="`${(sliderValues[node.id] ?? 0).toFixed(1)}`"
            @update:model-value="(v) => onSliderChange(node.id, Number(v))"
          />
        </div>

        <div class="row justify-end">
          <q-btn
            flat
            dense
            color="grey-4"
            label="Réinitialiser"
            icon="restart_alt"
            @click="resetAll"
          />
        </div>
      </template>
      <div v-else class="text-caption text-grey-5">
        Aucun nœud ajustable trouvé.
      </div>
    </q-card>
  </q-expansion-item>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useNetworkStore, type NodeDto } from 'src/stores/network';
import { buildDemandPayload, sliderFromOverride, sliderMaxWithdrawal } from 'src/utils/demandOverrides';

const props = withDefaults(
  defineProps<{
    modelValue?: Record<string, number>;
  }>(),
  {
    modelValue: () => ({}),
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, number>): void;
}>();

const networkStore = useNetworkStore();
const sliderValues = reactive<Record<string, number>>({});
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let syncingFromModel = false;

const adjustableNodes = computed(() =>
  networkStore.nodes.filter((node) => node.pressure_fixed_bar == null),
);

function getMaxWithdrawal(node: NodeDto): number {
  return sliderMaxWithdrawal(node.flow_min_m3s, props.modelValue?.[node.id]);
}

function syncSlidersFromModel(): void {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  syncingFromModel = true;
  const model = props.modelValue ?? {};
  const validIds = new Set(adjustableNodes.value.map((node) => node.id));
  for (const node of adjustableNodes.value) {
    sliderValues[node.id] = sliderFromOverride(model[node.id]);
  }
  for (const key of Object.keys(sliderValues)) {
    if (!validIds.has(key)) {
      delete sliderValues[key];
    }
  }
  syncingFromModel = false;
}

watch(
  [adjustableNodes, () => props.modelValue],
  () => {
    syncSlidersFromModel();
  },
  { immediate: true, deep: true },
);

function publish(): void {
  emit('update:modelValue', buildDemandPayload(sliderValues, props.modelValue));
}

function onSliderChange(nodeId: string, value: number) {
  if (syncingFromModel) {
    return;
  }
  sliderValues[nodeId] = value;
  publishDebounced();
}

function resetAll() {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  for (const key of Object.keys(sliderValues)) {
    sliderValues[key] = 0;
  }
  emit('update:modelValue', {});
}

function publishDebounced() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    publish();
  }, 120);
}
</script>
