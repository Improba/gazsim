import { computed, ref } from 'vue';
import { useSimulateStore } from 'src/stores/simulate';

export type NovaWorkflowStep = 'verdict' | 'causes' | 'capacity' | 'export';

export const NOVA_WORKFLOW_STEPS: NovaWorkflowStep[] = [
  'verdict',
  'causes',
  'capacity',
  'export',
];

export const NOVA_WORKFLOW_STEP_LABELS: Record<NovaWorkflowStep, string> = {
  verdict: 'Verdict',
  causes: 'Causes',
  capacity: 'Capacité',
  export: 'Export',
};

const currentStep = ref<NovaWorkflowStep>('verdict');

export function useNovaWorkflow() {
  const simulateStore = useSimulateStore();

  const enabled = computed(
    () => simulateStore.activeScenarioId !== null && simulateStore.novaActive,
  );

  function isDone(step: NovaWorkflowStep): boolean {
    switch (step) {
      case 'verdict':
        return simulateStore.result !== null && simulateStore.novaActive;
      case 'causes':
        return (
          simulateStore.sinkDiagnostics.length > 0 ||
          simulateStore.pressureMargins.length > 0 ||
          simulateStore.boundarySupply.length > 0
        );
      case 'capacity':
        return simulateStore.sinkCapacity.length > 0;
      case 'export':
        return simulateStore.result !== null && simulateStore.novaActive;
      default:
        return false;
    }
  }

  function goTo(step: NovaWorkflowStep): void {
    currentStep.value = step;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-section="${step}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  return {
    currentStep,
    enabled,
    goTo,
    isDone,
    steps: NOVA_WORKFLOW_STEPS,
  };
}
