<template>
  <div v-if="visible" class="nova-verdict q-mb-sm">
    <q-banner
      dense
      rounded
      :class="bannerClass"
    >
      <template #avatar>
        <q-icon :name="bannerIcon" />
      </template>
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="text-bold">{{ title }}</div>
          <div class="text-caption">
            {{ subtitle }}
          </div>
        </div>
      </div>
      <template #action v-if="showFocusAction && !verdict?.feasible && deficitSinks.length > 0">
        <q-btn
          flat
          dense
          color="white"
          no-caps
          :label="`Voir ${deficitSinks.length} point(s) déficitaire(s)`"
          @click="$emit('focus-deficits')"
        />
      </template>
    </q-banner>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';
import { nominationDisplayLabel } from 'src/utils/demoNominations';

const simulateStore = useSimulateStore();
const nominationStore = useNominationStore();

withDefaults(
  defineProps<{
    showFocusAction?: boolean;
  }>(),
  { showFocusAction: true },
);

defineEmits<{ (e: 'focus-deficits'): void }>();

const verdict = computed(() => simulateStore.novaVerdict);
const deficitSinks = computed(() => verdict.value?.deficit_sinks ?? []);

const visible = computed(
  () =>
    simulateStore.activeScenarioId !== null &&
    verdict.value !== null &&
    !simulateStore.nominationChangedSinceLastRun,
);

const bannerClass = computed(() => {
  if (verdict.value?.feasible) return 'bg-green-9 text-green-2';
  if (verdict.value?.cause === 'NotSolvedLocal') return 'bg-orange-9 text-orange-1';
  return 'bg-red-10 text-red-2';
});

const bannerIcon = computed(() => {
  if (verdict.value?.feasible) return 'check_circle';
  if (verdict.value?.cause === 'NotSolvedLocal') return 'help';
  return 'error';
});

const nominationLabel = computed(() => {
  const filename = nominationStore.activeFilename;
  const labeled = nominationDisplayLabel(filename);
  return labeled || simulateStore.activeScenarioId || 'nomination';
});

const title = computed(() => {
  if (verdict.value?.feasible) return 'Tenue pression OK';
  if (verdict.value?.cause === 'NotSolvedLocal') return 'Verdict non établi';
  if (verdict.value?.cause === 'ScaleNotAchieved') return 'Soutirages non couverts';
  if (verdict.value?.cause === 'PressureExcess') return 'Dépassement borne haute';
  return 'Tenue pression non tenue';
});

const subtitle = computed(() => {
  if (!verdict.value) return '';
  if (verdict.value.feasible) {
    return `Aucun point de livraison sous sa borne contractuelle (${nominationLabel.value}).`;
  }
  if (verdict.value.cause === 'NotSolvedLocal') {
    return "Le point de fonctionnement n'a pas pu être établi.";
  }
  if (verdict.value.cause === 'ScaleNotAchieved') {
    const scale = verdict.value.demand_scale_achieved;
    const pct = scale != null ? Math.round(scale * 100) : '?';
    return `Les soutirages nominaux n'ont pas été couverts (palier ${pct} %).`;
  }
  if (verdict.value.cause === 'PressureExcess') {
    return 'Un ou plusieurs nœuds dépassent leur borne haute. Voir les marges par contrainte.';
  }
  const cause =
    verdict.value.cause === 'PressureReachability'
      ? "la pression amont n'atteint pas le besoin du point de livraison"
      : 'un ou plusieurs points de livraison sont sous leur borne contractuelle';
  return `${deficitSinks.value.length} point(s) en déficit : ${cause}.`;
});
</script>
