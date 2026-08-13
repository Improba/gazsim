import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  NOVA_WORKFLOW_STEPS,
  useNovaWorkflow,
  type NovaWorkflowStep,
} from './useNovaWorkflow';
import { useSimulateStore } from 'src/stores/simulate';

describe('useNovaWorkflow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const { currentStep } = useNovaWorkflow();
    currentStep.value = 'verdict';
    vi.restoreAllMocks();
  });

  it('exposes the four workflow steps in order', () => {
    const { steps } = useNovaWorkflow();

    expect(steps).toEqual(NOVA_WORKFLOW_STEPS);
    expect(steps).toEqual(['verdict', 'causes', 'capacity', 'export']);
  });

  it('is disabled without an active scenario or NoVa data', () => {
    const { enabled } = useNovaWorkflow();

    expect(enabled.value).toBe(false);
  });

  it('is enabled when a scenario is active and NoVa results exist', () => {
    const simulateStore = useSimulateStore();
    simulateStore.activeScenarioId = 'nomination_mild_618';
    simulateStore.novaVerdict = {
      feasible: true,
      deficit_sinks: [],
      cause: 'Feasible',
    };

    const { enabled } = useNovaWorkflow();

    expect(enabled.value).toBe(true);
  });

  it('is enabled via novaActive when pressure slips are present', () => {
    const simulateStore = useSimulateStore();
    simulateStore.activeScenarioId = 'nomination_mild_618';
    simulateStore.pressureSlips = [
      {
        node_id: 'sink_88',
        solved_pressure_bar: 24,
        lower_bar: 26,
        upper_bar: null,
        shortfall_bar: 2,
      },
    ];

    const { enabled } = useNovaWorkflow();

    expect(enabled.value).toBe(true);
  });

  it('goTo updates the current step and scrolls to the matching section', () => {
    const scrollIntoView = vi.fn();
    const querySelector = vi.fn().mockReturnValue({ scrollIntoView });
    vi.stubGlobal('document', { querySelector });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    const { goTo, currentStep } = useNovaWorkflow();
    goTo('export');

    expect(currentStep.value).toBe('export');
    expect(querySelector).toHaveBeenCalledWith('[data-section="export"]');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('goTo tolerates a missing section element', () => {
    const querySelector = vi.fn().mockReturnValue(null);
    vi.stubGlobal('document', { querySelector });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    const { goTo, currentStep } = useNovaWorkflow();

    expect(() => goTo('capacity' as NovaWorkflowStep)).not.toThrow();
    expect(currentStep.value).toBe('capacity');
  });

  it('marks verdict done only when NoVa results exist', () => {
    const simulateStore = useSimulateStore();
    const { isDone } = useNovaWorkflow();

    expect(isDone('verdict')).toBe(false);

    simulateStore.activeScenarioId = 'nomination_mild_618';
    simulateStore.result = {
      pressures: { sink_88: 24 },
      flows: {},
      iterations: 3,
      residual: 1e-6,
    };
    simulateStore.novaVerdict = {
      feasible: false,
      deficit_sinks: ['sink_88'],
      cause: 'PressureDeficit',
    };

    expect(isDone('verdict')).toBe(true);
    expect(isDone('capacity')).toBe(false);
    expect(isDone('export')).toBe(true);
  });

  it('marks export done when a NoVa result exists, even if not feasible', () => {
    const simulateStore = useSimulateStore();
    simulateStore.activeScenarioId = 'nomination_mild_618';
    simulateStore.result = {
      pressures: { sink_88: 24 },
      flows: {},
      iterations: 3,
      residual: 1e-6,
    };
    simulateStore.novaVerdict = {
      feasible: false,
      deficit_sinks: ['sink_88'],
      cause: 'PressureDeficit',
    };

    const { isDone } = useNovaWorkflow();
    expect(isDone('export')).toBe(true);
  });
});
