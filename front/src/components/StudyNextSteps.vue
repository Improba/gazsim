<template>
  <div v-if="steps.length > 0" class="study-next-steps q-mb-sm">
    <div class="text-caption text-bold text-grey-3 q-mb-xs">Prochaine étape</div>
    <div class="study-next-steps__list">
      <q-btn
        v-for="step in steps"
        :key="step.id"
        no-caps
        outline
        align="left"
        color="primary"
        class="full-width study-next-steps__btn"
        :disable="simulateStore.loading"
        :to="step.id === 'n1' ? contingencyNominationLink : undefined"
        @click="step.id === 'n1' ? undefined : onStep(step)"
      >
        <div class="study-next-steps__label">
          <span class="text-body2">{{ step.label }}</span>
          <span class="text-caption text-grey-5">{{ step.hint }}</span>
        </div>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNominationStore } from 'src/stores/nomination';
import { useSimulateStore } from 'src/stores/simulate';
import { useContingencyNominationCta } from 'src/composables/useContingencyNominationCta';
import { useGlobalStatus } from 'src/composables/useGlobalStatus';
import { studyNextSteps, type StudyNextStep } from 'src/utils/studyNextSteps';

const emit = defineEmits<{ (event: 'open-dossier'): void }>();

const simulateStore = useSimulateStore();
const nominationStore = useNominationStore();
const status = useGlobalStatus();

const scenarioStale = computed(() => simulateStore.scenarioStale);
const { contingencyNominationLink, disabled: contingencyDisabled } =
  useContingencyNominationCta(scenarioStale);

const hasCurrentVerdict = computed(
  () =>
    simulateStore.result !== null &&
    simulateStore.novaActive &&
    !simulateStore.nominationChangedSinceLastRun &&
    !simulateStore.loading,
);

const steps = computed(() =>
  studyNextSteps({
    hasCurrentVerdict: hasCurrentVerdict.value,
    activeNominationId: nominationStore.activeId,
    nominations: nominationStore.studyList.map((item) => ({
      id: item.id,
      filename: item.filename,
    })),
    sessionVerdicts: simulateStore.sessionVerdicts,
    n1Available: !contingencyDisabled.value,
    n1Label: status.n1Status.value.label,
  }),
);

async function onStep(step: StudyNextStep): Promise<void> {
  if (step.id === 'dossier') {
    emit('open-dossier');
    return;
  }
  if (step.id === 'other-nomination' && step.nominationId) {
    await simulateStore.validateNomination(step.nominationId);
  }
}
</script>

<style scoped>
.study-next-steps__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.study-next-steps__btn {
  padding: 6px 10px;
}

.study-next-steps__label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.25;
  text-align: left;
}
</style>
