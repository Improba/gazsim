import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Notify } from 'quasar';
import { api, type SimulationResult, type CapacityViolation, type EquipmentState, type PipeEquipmentDto, type ScenarioPressureSlip, type ScenarioPressureMargin, type BoundaryPressureSupplyReport, type SinkDiagnostic, type NovaVerdict, type SinkCapacityReport, type CompressorMapMode, type CompressorOperatingPoint, type NovaRunState } from 'src/services/api';
import {
  SimulationWsClient,
  mergeConvergedMessage,
  type WsServerMessage,
  type WsStartOptions,
  type WsCapacityOptions,
} from 'src/services/ws';
import { deficitSinkIds } from 'src/utils/novaDeficitSinks';
import { toSinkOverrideFlow } from 'src/utils/demandOverrides';
import { needsCapacityReduction } from 'src/utils/sinkCapacity';
import { presetForNodeCount, presetRobust } from 'src/utils/solverPresets';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { nominationDisplayLabel } from 'src/utils/demoNominations';

type SimulationStatus = 'idle' | 'running' | 'converged' | 'cancelled' | 'error';

export type SimulationMode = 'free' | 'check' | 'optimize';

export type RunScenarioSummary = {
  description?: string;
  tExtC?: number;
  hour?: number;
  dayType?: 'weekday' | 'weekend';
};

/** Trace d'un verdict obtenu pendant la session, attaché à une nomination. */
export interface SessionVerdict {
  feasible: boolean;
  deficitSinks: string[];
  runId: string | null;
  at: number;
}

type LastRunParams = {
  demands?: Record<string, number>;
  equipmentOverrides?: Record<string, PipeEquipmentDto>;
  options?: WsStartOptions & WsCapacityOptions;
};

function sortedRecordKey(record: Record<string, unknown> | undefined): string {
  return JSON.stringify(
    Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export const useSimulateStore = defineStore('simulate', () => {
  const result = ref<SimulationResult | null>(null);
  const loading = ref(false);
  const status = ref<SimulationStatus>('idle');
  const errorMessage = ref<string | null>(null);
  const currentRunId = ref<string | null>(null);

  const iteration = ref(0);
  const residual = ref<number | null>(null);
  const elapsedMs = ref<number | null>(null);
  const logs = ref<string[]>([]);
  const exporting = ref(false);

  const livePressures = ref<Record<string, number>>({});
  const liveFlows = ref<Record<string, number>>({});

  const capacityViolations = ref<CapacityViolation[]>([]);
  const adjustedDemands = ref<Record<string, number>>({});
  const activeBounds = ref<string[]>([]);
  const equipmentStates = ref<EquipmentState[]>([]);
  const warnings = ref<string[]>([]);
  const runScenarioSummary = ref<RunScenarioSummary | null>(null);
  const robustMode = ref(false);
  const continuationLabel = ref<string | null>(null);

  // Aperçu temporel transitoire : pressures/flows d'un pas sélectionné, prioritaire sur
  // la carte pour synchroniser CesiumViewer avec le lecteur transitoire.
  const previewStep = ref<{ pressures: Record<string, number>; flows: Record<string, number> } | null>(null);

  // NoVa : diagnostics pression (présents si un scenario_id a été fourni au démarrage).
  const pressureSlips = ref<ScenarioPressureSlip[]>([]);
  const pressureMargins = ref<ScenarioPressureMargin[]>([]);
  const boundarySupply = ref<BoundaryPressureSupplyReport[]>([]);
  const sinkDiagnostics = ref<SinkDiagnostic[]>([]);
  const novaVerdict = ref<NovaVerdict | null>(null);
  const activeScenarioId = ref<string | null>(null);

  // NoVa actif si un scénario a été fourni et que le backend a renvoyé un verdict.
  const novaActive = computed(
    () => novaVerdict.value !== null || pressureSlips.value.length > 0,
  );

  // Étude capacité par sink (endpoint dédié /api/nova/capacity — coûteuse, opt-in).
  const sinkCapacity = ref<SinkCapacityReport[]>([]);
  const capacityLoading = ref(false);
  const capacityError = ref<string | null>(null);

  const compressorMapMode = ref<CompressorMapMode | null>(null);
  const compressorOperatingPoints = ref<CompressorOperatingPoint[]>([]);

  let wsClient: SimulationWsClient | null = null;
  let lastSnapshotAt = 0;
  let pendingSnapshot: Extract<WsServerMessage, { type: 'snapshot' }> | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  const lastRunParams = ref<LastRunParams | null>(null);
  const lastRunScenarioId = ref<string | null>(null);

  /** Surcharges de soutirage partagées carte / espace d'analyse (source unique). */
  const demandOverrides = ref<Record<string, number>>({});
  const equipmentOverrides = ref<Record<string, PipeEquipmentDto>>({});
  const simulationMode = ref<SimulationMode>('free');

  const scenarioStale = computed(() => {
    if (status.value === 'running') {
      return false;
    }
    const nominationStore = useNominationStore();
    return nominationStore.activeId !== lastRunScenarioId.value;
  });

  const scenarioDirty = computed(() => {
    // Pas de bannière avant le premier run : sélectionner une nomination n'est pas une modification.
    if (lastRunParams.value === null) {
      return false;
    }
    return scenarioStale.value;
  });

  const demandsDirty = computed(() => {
    if (status.value === 'running') {
      return false;
    }
    return sortedRecordKey(demandOverrides.value) !== sortedRecordKey(lastRunParams.value?.demands);
  });

  const equipmentDirty = computed(() => {
    if (status.value === 'running') {
      return false;
    }
    return (
      sortedRecordKey(equipmentOverrides.value) !==
      sortedRecordKey(lastRunParams.value?.equipmentOverrides)
    );
  });

  const inputDirty = computed(
    () => demandsDirty.value || equipmentDirty.value || scenarioDirty.value,
  );

  /** La nomination affichée n'est plus celle du dernier verdict. */
  const nominationChangedSinceLastRun = computed(() => {
    const nominationStore = useNominationStore();
    return lastRunScenarioId.value != null && nominationStore.activeId !== lastRunScenarioId.value;
  });

  /**
   * Verdicts obtenus dans la session, par nomination. Permet de dire quelle nomination
   * reste à évaluer sans relancer un calcul, et disparaît au changement de réseau
   * (`resetSimulation`) puisque les verdicts ne s'appliquent plus au nouveau périmètre.
   */
  const sessionVerdicts = ref<Record<string, SessionVerdict>>({});

  function recordSessionVerdict(): void {
    const scenarioId = lastRunScenarioId.value;
    const verdict = novaVerdict.value;
    if (!scenarioId || !verdict) {
      return;
    }
    sessionVerdicts.value = {
      ...sessionVerdicts.value,
      [scenarioId]: {
        feasible: verdict.feasible,
        deficitSinks: [...(verdict.deficit_sinks ?? [])],
        runId: currentRunId.value,
        at: Date.now(),
      },
    };
  }

  function sessionVerdictFor(scenarioId: string | null | undefined): SessionVerdict | null {
    if (!scenarioId) {
      return null;
    }
    return sessionVerdicts.value[scenarioId] ?? null;
  }

  async function ensureConnectedWs() {
    if (!wsClient) {
      wsClient = new SimulationWsClient({
        onMessage: handleWsMessage,
        onClosed: () => {
          if (loading.value) {
            status.value = 'error';
            errorMessage.value = 'connexion websocket fermée';
            loading.value = false;
            clearSnapshotQueue();
          }
        },
        onError: (message: string) => {
          errorMessage.value = message;
          if (loading.value) {
            status.value = 'error';
            loading.value = false;
            clearSnapshotQueue();
          }
        },
      });
    }
    await wsClient.connect();
  }

  function buildSolverOptions(
    warmStartPressures: Record<string, number> | undefined,
    overrides?: WsStartOptions & WsCapacityOptions,
  ): WsStartOptions & WsCapacityOptions {
    const networkStore = useNetworkStore();
    const nodeCount = Math.max(networkStore.nodes.length, 1);
    const basePreset = presetForNodeCount(nodeCount);
    const useRobust = robustMode.value || Boolean(basePreset.robust_mode);
    const preset = useRobust ? presetRobust(nodeCount) : basePreset;
    const { capacity_bounds, mode, ...solverOpts } = overrides ?? {};
    return {
      ...preset,
      initial_pressures: warmStartPressures,
      ...solverOpts,
      capacity_bounds,
      mode,
      robust_mode: useRobust,
      continuation_scales: solverOpts.continuation_scales ?? preset.continuation_scales,
    };
  }

  async function runSimulation(
    demands?: Record<string, number>,
    options?: WsStartOptions & WsCapacityOptions,
    equipmentOverrides?: Record<string, PipeEquipmentDto>,
  ) {
    if (loading.value) {
      return;
    }
    loading.value = true;
    try {
      await ensureConnectedWs();
      const warmStartPressures =
        result.value?.pressures ??
        (Object.keys(livePressures.value).length > 0 ? { ...livePressures.value } : undefined);
      const previousScenarioId = lastRunScenarioId.value;
      clearSnapshotQueue();
      resetRuntimeState();
      currentRunId.value = `run-${Date.now()}`;
      status.value = 'running';
      activeScenarioId.value = options?.scenario_id ?? null;
      lastRunScenarioId.value = options?.scenario_id ?? null;
      if (lastRunScenarioId.value !== previousScenarioId) {
        sinkCapacity.value = [];
        capacityError.value = null;
      }

      const { capacity_bounds, mode, ...solverOpts } = options ?? {};
      const mergedEquipment = equipmentOverrides;
      const runOptions = buildSolverOptions(warmStartPressures, {
        ...solverOpts,
        capacity_bounds,
        mode,
      });

      lastRunParams.value = {
        demands: demands !== undefined ? { ...demands } : undefined,
        equipmentOverrides: mergedEquipment ? { ...mergedEquipment } : undefined,
        options: { ...runOptions },
      };

      wsClient!.startSimulation({
        runId: currentRunId.value,
        demands,
        options: runOptions,
        capacityBounds: capacity_bounds,
        mode,
        equipmentOverrides: mergedEquipment,
      });
    } catch (err) {
      loading.value = false;
      status.value = 'error';
      errorMessage.value = err instanceof Error ? err.message : 'échec lancement simulation';
      throw err;
    }
  }

  async function rerunWithRobustMode() {
    robustMode.value = true;
    await rerunLastSimulation();
  }

  const hasLastRun = computed(() => lastRunParams.value !== null);

  async function rerunLastSimulation() {
    if (!lastRunParams.value) {
      await runSimulation();
      return;
    }
    await runSimulation(
      lastRunParams.value.demands,
      lastRunParams.value.options,
      lastRunParams.value.equipmentOverrides,
    );
  }

  function lastInputDemands(): Record<string, number> | undefined {
    const demands = lastRunParams.value?.demands;
    if (demands === undefined) {
      return undefined;
    }
    return { ...demands };
  }

  function lastRunEquipmentOverrides(): Record<string, PipeEquipmentDto> | undefined {
    return lastRunParams.value?.equipmentOverrides
      ? { ...lastRunParams.value.equipmentOverrides }
      : undefined;
  }

  function lastRunOptions(): (WsStartOptions & WsCapacityOptions) | undefined {
    return lastRunParams.value?.options ? { ...lastRunParams.value.options } : undefined;
  }

  function clearDemandOverrides() {
    demandOverrides.value = {};
  }

  function clearInputOverrides() {
    clearDemandOverrides();
    equipmentOverrides.value = {};
  }

  function buildCapacityBounds(): Record<string, { min: number; max: number }> {
    const networkStore = useNetworkStore();
    const bounds: Record<string, { min: number; max: number }> = {};
    for (const node of networkStore.nodes) {
      if (node.flow_min_m3s != null && node.flow_max_m3s != null) {
        bounds[node.id] = { min: node.flow_min_m3s, max: node.flow_max_m3s };
      }
    }
    return bounds;
  }

  const hasSessionDemandOverrides = computed(
    () => Object.keys(demandOverrides.value).length > 0,
  );

  /** Lance une validation avec la nomination active et les overrides partagés. */
  async function startValidation() {
    if (loading.value) {
      return;
    }
    const nominationStore = useNominationStore();
    if (!nominationStore.activeId) {
      Notify.create({
        type: 'warning',
        message: 'Sélectionnez une nomination à valider.',
      });
      return;
    }
    const networkStore = useNetworkStore();
    const demands =
      Object.keys(demandOverrides.value).length > 0 ? { ...demandOverrides.value } : undefined;
    const opts: WsStartOptions = {};
    const composition = networkStore.gas?.composition;
    if (composition) {
      opts.gas_composition = { ...composition };
    }
    opts.scenario_id = nominationStore.activeId;
    if (simulationMode.value !== 'free') {
      opts.mode = simulationMode.value;
      opts.capacity_bounds = buildCapacityBounds();
    }
    const filename = nominationStore.activeFilename;
    setRunScenarioSummary({
      description: filename ? nominationDisplayLabel(filename) : 'Nomination',
    });
    const equipment =
      Object.keys(equipmentOverrides.value).length > 0
        ? { ...equipmentOverrides.value }
        : undefined;
    await runSimulation(demands, opts, equipment);
  }

  /**
   * Bascule vers une autre nomination puis la valide en un geste. Les réductions de
   * session portaient sur la nomination précédente : elles sont écartées pour ne pas
   * fausser le verdict de la nouvelle.
   */
  async function validateNomination(scenarioId: string) {
    const trimmed = scenarioId.trim();
    if (!trimmed || loading.value) {
      return;
    }
    const nominationStore = useNominationStore();
    if (trimmed !== nominationStore.activeId) {
      clearDemandOverrides();
    }
    nominationStore.selectById(trimmed);
    await startValidation();
  }

  /** Réduit un sink au Q max faisable puis re-valide (carte et espace d'analyse). */
  async function applySinkReduction(sinkId: string, maxFeasibleQ: number) {
    if (loading.value) {
      return;
    }
    demandOverrides.value = {
      ...(lastInputDemands() ?? {}),
      ...demandOverrides.value,
      [sinkId]: toSinkOverrideFlow(maxFeasibleQ),
    };
    await startValidation();
  }

  /** Applique le Q max faisable sur tous les sinks déficitaires puis re-valide. */
  async function applyAllCapacityReductions() {
    if (loading.value) {
      return;
    }
    const next: Record<string, number> = {
      ...(lastInputDemands() ?? {}),
      ...demandOverrides.value,
    };
    let reduced = 0;
    for (const report of sinkCapacity.value) {
      if (needsCapacityReduction(report)) {
        next[report.sink_id] = toSinkOverrideFlow(report.max_feasible_q_m3s);
        reduced += 1;
      }
    }
    if (reduced === 0) {
      return;
    }
    demandOverrides.value = next;
    await startValidation();
  }

  /** Réduit un sink en session (moitié du Q connu, sinon coupure) puis re-valide. */
  async function applySessionSinkReduction(sinkId: string) {
    if (loading.value) {
      return;
    }
    const previous =
      demandOverrides.value[sinkId] ??
      lastInputDemands()?.[sinkId] ??
      adjustedDemands.value[sinkId];
    const nextMagnitude =
      previous !== undefined && Number.isFinite(previous) ? Math.abs(previous) * 0.5 : 0;
    demandOverrides.value = {
      ...(lastInputDemands() ?? {}),
      ...demandOverrides.value,
      [sinkId]: toSinkOverrideFlow(nextMagnitude),
    };
    await startValidation();
  }

  function setRunScenarioSummary(summary: RunScenarioSummary | null) {
    runScenarioSummary.value = summary;
  }

  function setPreviewStep(step: { pressures: Record<string, number>; flows: Record<string, number> } | null) {
    previewStep.value = step;
  }

  async function runSinkCapacity(sinkIds?: string[]) {
    const scenarioId = activeScenarioId.value;
    if (!scenarioId) {
      capacityError.value = 'Aucune nomination active — sélectionnez une nomination.';
      return;
    }

    let ids: string[] | undefined;
    if (sinkIds !== undefined) {
      ids = sinkIds.length > 0 ? sinkIds : undefined;
    } else {
      const resolved = deficitSinkIds(sinkDiagnostics.value, novaVerdict.value);
      if (resolved.length === 0) {
        Notify.create({
          type: 'warning',
          message: novaVerdict.value?.feasible
            ? 'Aucun point déficitaire — l\'étude capacité cible les sinks en déficit.'
            : 'Aucun point déficitaire identifié pour l\'étude capacité.',
        });
        return;
      }
      ids = resolved;
    }

    capacityLoading.value = true;
    capacityError.value = null;
    try {
      sinkCapacity.value = await api.runNovaCapacity({
        scenario_id: scenarioId,
        sink_ids: ids,
      });
    } catch (err) {
      capacityError.value = err instanceof Error ? err.message : 'étude capacité échouée';
      sinkCapacity.value = [];
    } finally {
      capacityLoading.value = false;
    }
  }

  async function loadCompressorMapMode() {
    try {
      const { mode } = await api.getCompressorMapMode();
      compressorMapMode.value = mode;
    } catch {
      compressorMapMode.value = 'legacy';
    }
  }

  async function loadCompressorOperatingPoints() {
    try {
      const { points } = await api.getCompressorOperatingPoints();
      compressorOperatingPoints.value = points;
    } catch {
      compressorOperatingPoints.value = [];
    }
  }

  async function setCompressorMapMode(mode: CompressorMapMode) {
    const { mode: confirmed } = await api.setCompressorMapMode(mode);
    compressorMapMode.value = confirmed;
    await rerunLastSimulation();
  }

  function cancelSimulation() {
    if (!wsClient || !currentRunId.value || !loading.value) {
      return;
    }
    wsClient.cancelSimulation(currentRunId.value);
  }

  function handleWsMessage(msg: WsServerMessage) {
    switch (msg.type) {
      case 'started':
        status.value = 'running';
        currentRunId.value = msg.run_id;
        addLog(`started ${msg.run_id}`);
        break;
      case 'continuation_step':
        if (!isCurrentRun(msg.run_id)) return;
        continuationLabel.value = `Palier ${msg.step}/${msg.total_steps} — ${Math.round(msg.scale * 100)} % des soutirages`;
        addLog(
          `continuation ${msg.step}/${msg.total_steps} scale=${(msg.scale * 100).toFixed(0)}%`,
        );
        break;
      case 'iteration':
        if (!isCurrentRun(msg.run_id)) return;
        iteration.value = msg.iter;
        residual.value = msg.residual;
        elapsedMs.value = msg.elapsed_ms;
        addLog(`iter ${msg.iter} residual=${msg.residual.toExponential(3)}`);
        break;
      case 'snapshot':
        if (!isCurrentRun(msg.run_id)) return;
        queueSnapshot(msg);
        break;
      case 'converged':
        if (!isCurrentRun(msg.run_id)) return;
        clearSnapshotQueue();
        {
          const merged = mergeConvergedMessage(msg);
          result.value = merged;
          livePressures.value = { ...merged.pressures };
          liveFlows.value = { ...merged.flows };
          iteration.value = merged.iterations;
          residual.value = merged.residual;
          capacityViolations.value = merged.capacity_violations ?? [];
          adjustedDemands.value = merged.adjusted_demands ?? {};
          activeBounds.value = merged.active_bounds ?? [];
          equipmentStates.value = merged.equipment_states ?? [];
          warnings.value = merged.warnings ?? [];
          pressureSlips.value = merged.pressure_slips ?? [];
          pressureMargins.value = merged.pressure_margins ?? [];
          boundarySupply.value = merged.boundary_supply ?? [];
          sinkDiagnostics.value = merged.sink_diagnostics ?? [];
          novaVerdict.value = merged.nova_verdict ?? null;
          recordSessionVerdict();
          const scaleAchieved = merged.demand_scale_achieved;
          if (scaleAchieved !== undefined && scaleAchieved < 1) {
            addLog(
              `attention: convergence partielle à ${Math.round(scaleAchieved * 100)} % des soutirages`,
            );
          }
        }
        status.value = 'converged';
        loading.value = false;
        continuationLabel.value = null;
        addLog(`converged in ${msg.total_ms}ms`);
        void loadCompressorOperatingPoints();
        break;
      case 'cancelled':
        if (!isCurrentRun(msg.run_id)) return;
        clearSnapshotQueue();
        status.value = 'cancelled';
        loading.value = false;
        continuationLabel.value = null;
        if (msg.reason === 'timeout') {
          errorMessage.value =
            'Délai dépassé — activez la convergence renforcée ou réduisez le scénario.';
        } else if (msg.reason === 'diverged') {
          errorMessage.value =
            'Non-convergence — essayez la convergence renforcée.';
        } else {
          errorMessage.value = null;
        }
        addLog(`cancelled: ${msg.reason}`);
        break;
      case 'error':
        if (!isCurrentRun(msg.run_id)) return;
        clearSnapshotQueue();
        status.value = 'error';
        errorMessage.value = msg.message;
        loading.value = false;
        addLog(`error: ${msg.message}`);
        break;
    }
  }

  function isCurrentRun(runId: string): boolean {
    return currentRunId.value !== null && runId === currentRunId.value;
  }

  function clearSnapshotQueue() {
    pendingSnapshot = null;
    if (snapshotTimer !== null) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    lastSnapshotAt = 0;
  }

  function resetRuntimeState() {
    status.value = 'idle';
    errorMessage.value = null;
    iteration.value = 0;
    residual.value = null;
    elapsedMs.value = null;
    logs.value = [];
    result.value = null;
    livePressures.value = {};
    liveFlows.value = {};
    capacityViolations.value = [];
    adjustedDemands.value = {};
    activeBounds.value = [];
    equipmentStates.value = [];
    warnings.value = [];
    pressureSlips.value = [];
    pressureMargins.value = [];
    boundarySupply.value = [];
    sinkDiagnostics.value = [];
    novaVerdict.value = null;
    activeScenarioId.value = null;
    lastRunScenarioId.value = null;
    compressorOperatingPoints.value = [];
    continuationLabel.value = null;
    previewStep.value = null;
  }

  function queueSnapshot(msg: Extract<WsServerMessage, { type: 'snapshot' }>) {
    const now = Date.now();
    const minIntervalMs = 100;
    if (now - lastSnapshotAt >= minIntervalMs) {
      applySnapshot(msg);
      lastSnapshotAt = now;
      return;
    }
    pendingSnapshot = msg;
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      const pending = pendingSnapshot;
      pendingSnapshot = null;
      if (pending && isCurrentRun(pending.run_id)) {
        applySnapshot(pending);
        lastSnapshotAt = Date.now();
      }
    }, minIntervalMs);
  }

  function applySnapshot(msg: Extract<WsServerMessage, { type: 'snapshot' }>) {
    if (!isCurrentRun(msg.run_id)) {
      return;
    }
    livePressures.value = { ...msg.pressures };
    liveFlows.value = { ...msg.flows };
  }

  function addLog(entry: string) {
    logs.value = [`[${new Date().toLocaleTimeString()}] ${entry}`, ...logs.value].slice(0, 200);
  }

  function resetSimulation() {
    if (loading.value) {
      cancelSimulation();
      loading.value = false;
    }
    clearSnapshotQueue();
    resetRuntimeState();
    sinkCapacity.value = [];
    capacityError.value = null;
    currentRunId.value = null;
    lastRunParams.value = null;
    sessionVerdicts.value = {};
    clearInputOverrides();
    simulationMode.value = 'free';
  }

  function applyNovaRunState(applied: NovaRunState) {
    const nominationStore = useNominationStore();
    if (applied.scenario_id) {
      nominationStore.selectById(applied.scenario_id);
    }
    demandOverrides.value = { ...applied.demands };
    lastRunParams.value = { demands: { ...applied.demands } };
    lastRunScenarioId.value = applied.scenario_id;
    activeScenarioId.value = applied.scenario_id;
    currentRunId.value = applied.run_id;
    loading.value = false;
    errorMessage.value = null;
    iteration.value = applied.iterations;
    residual.value = applied.residual;
    warnings.value = applied.warnings ?? [];
    pressureSlips.value = applied.pressure_slips ?? [];
    pressureMargins.value = applied.pressure_margins ?? [];
    boundarySupply.value = applied.boundary_supply ?? [];
    sinkDiagnostics.value = applied.sink_diagnostics ?? [];
    novaVerdict.value = applied.nova_verdict ?? null;
    recordSessionVerdict();
    livePressures.value = { ...applied.pressures };
    liveFlows.value = { ...applied.flows };
    result.value = {
      pressures: { ...applied.pressures },
      flows: { ...applied.flows },
      iterations: applied.iterations,
      residual: applied.residual,
      warnings: applied.warnings,
      demand_scale_achieved: applied.demand_scale_achieved ?? undefined,
      pressure_slips: applied.pressure_slips,
      pressure_margins: applied.pressure_margins,
      boundary_supply: applied.boundary_supply,
      sink_diagnostics: applied.sink_diagnostics,
      nova_verdict: applied.nova_verdict ?? undefined,
    };
    status.value = 'converged';
    addLog(`run ${applied.run_id} chargé`);
  }

  async function hydrateFromNovaRun(runId: string): Promise<void> {
    const trimmed = runId.trim();
    if (!trimmed) {
      return;
    }
    const networkStore = useNetworkStore();
    const applied = await api.applyNovaRun(trimmed);
    await networkStore.fetchNetwork();
    applyNovaRunState(applied);
    void loadCompressorOperatingPoints();
  }

  async function exportResult(format: 'json' | 'csv' | 'zip' | 'xlsx') {
    if (!currentRunId.value || status.value !== 'converged') {
      return;
    }
    exporting.value = true;
    try {
      const blob = await api.exportSimulation(currentRunId.value, format);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${currentRunId.value}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      addLog(`export ${format} ready`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'export failed';
      errorMessage.value = msg;
      addLog(`error: export ${format} failed (${msg})`);
    } finally {
      exporting.value = false;
    }
  }

  return {
    result,
    loading,
    status,
    errorMessage,
    currentRunId,
    iteration,
    residual,
    elapsedMs,
    logs,
    exporting,
    livePressures,
    liveFlows,
    capacityViolations,
    adjustedDemands,
    activeBounds,
    equipmentStates,
    warnings,
    runScenarioSummary,
    robustMode,
    continuationLabel,
    previewStep,
    pressureSlips,
    pressureMargins,
    boundarySupply,
    sinkDiagnostics,
    novaVerdict,
    activeScenarioId,
    novaActive,
    sinkCapacity,
    capacityLoading,
    capacityError,
    compressorMapMode,
    compressorOperatingPoints,
    loadCompressorMapMode,
    loadCompressorOperatingPoints,
    setCompressorMapMode,
    runSinkCapacity,
    runSimulation,
    rerunLastSimulation,
    rerunWithRobustMode,
    hasLastRun,
    lastInputDemands,
    lastRunEquipmentOverrides,
    lastRunOptions,
    lastRunScenarioId,
    scenarioStale,
    scenarioDirty,
    nominationChangedSinceLastRun,
    sessionVerdicts,
    sessionVerdictFor,
    demandsDirty,
    equipmentDirty,
    inputDirty,
    demandOverrides,
    hasSessionDemandOverrides,
    equipmentOverrides,
    simulationMode,
    clearInputOverrides,
    clearDemandOverrides,
    startValidation,
    validateNomination,
    applySinkReduction,
    applySessionSinkReduction,
    applyAllCapacityReductions,
    setRunScenarioSummary,
    setPreviewStep,
    cancelSimulation,
    resetSimulation,
    hydrateFromNovaRun,
    exportResult,
  };
});
