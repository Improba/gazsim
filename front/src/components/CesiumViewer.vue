<template>
  <div
    class="viewer-root"
    :class="{ 'viewer-root--edit-mode': editorStore.editMode }"
    :data-camera-height="Math.round(cameraHeightM)"
  >
    <div ref="canvasArea" class="canvas-area">
      <div ref="cesiumContainer" class="canvas-element cesium-container" />
      <div v-if="positioningWarningVisible" class="positioning-warning" aria-label="Positionnement cartographique approximatif">
        <q-icon name="warning_amber" color="warning" size="18px" />
        <q-tooltip anchor="bottom left" self="top left" class="bg-grey-10 text-white">
          <div class="positioning-warning-tooltip">
            <div class="text-weight-medium q-mb-xs">{{ positioningWarningTitle }}</div>
            {{ positioningWarningDetail }}
          </div>
        </q-tooltip>
      </div>
      <q-btn
        v-if="showPerfToggle"
        dense
        round
        icon="speed"
        color="dark"
        class="perf-toggle"
        aria-label="Afficher le panneau de performance"
        @click="debugOverlayEnabled = !debugOverlayEnabled"
      />
      <div v-if="debugOverlayEnabled" class="perf-overlay">
        <div><b>Performance</b></div>
        <div>Images/s : {{ fps.toFixed(1) }}</div>
        <div>Mise à jour couleurs : {{ renderUpdateMs.toFixed(2) }} ms</div>
        <div>Entités : {{ entityCount }}</div>
      </div>
      <div v-if="timeseriesStore.hasResult" class="timeseries-slider">
        <div class="text-caption text-grey-3 q-mb-xs">
          Heure {{ timeseriesStore.selectedHour }}h
          <span v-if="selectedStep && !selectedStep.converged" class="text-red-4">
            — échec convergence
          </span>
        </div>
        <q-slider
          :model-value="timeseriesStore.selectedStepIndex"
          :min="0"
          :max="Math.max(0, timeseriesStore.steps.length - 1)"
          :step="1"
          label
          color="primary"
          dark
          @update:model-value="timeseriesStore.setSelectedStepIndex"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import {
  Viewer,
  Entity,
  Cartesian2,
  Cartesian3,
  Color,
  Material,
  PolylineCollection,
  PolylineGlowMaterialProperty,
  HeightReference,
  LabelStyle,
  VerticalOrigin,
  UrlTemplateImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Cartographic,
  Math as CesiumMath,
  Rectangle,
} from 'cesium';
import { cameraRectangleForNodes, nodeLonLat, schematicKmPerUnit, type GeoRectangle } from 'src/utils/mapCamera';
import { useNetworkStore } from 'src/stores/network';
import { useSimulateStore } from 'src/stores/simulate';
import { useTimeseriesStore } from 'src/stores/timeseries';
import { useEditorStore } from 'src/stores/editor';
import { pressureRange, pressureToCss } from 'src/utils/pressureColor';
import {
  UNCONSTRAINED_NODE_CSS,
  contractMarginForNode,
  contractMarginToCss,
  hasContractMarginScale,
} from 'src/utils/contractMarginColor';
import { deficitSinkIds } from 'src/utils/novaDeficitSinks';
import { escapeHtml } from 'src/utils/escapeHtml';
import {
  equipmentKindLabel,
  equipmentMarkerColor,
  isEquipmentKind,
  regulatorModeLabel,
} from 'src/utils/equipmentLabels';
import {
  labelLodVisible,
  nodePointPixelSize,
  nodePointVisible,
  nodeStride,
  SMALL_NETWORK_LABEL_MAX_HEIGHT,
} from 'src/utils/mapLod';
import type { PipeDto } from 'src/stores/network';

const cesiumContainer = ref<HTMLElement>();
let viewer: Viewer | null = null;
let postRenderCb: (() => void) | null = null;
let cameraChangedCb: (() => void) | null = null;
let pipeCollection: PolylineCollection | null = null;
const nodeEntities: Entity[] = [];
const nodeEntitiesById = new Map<string, Entity>();
const pipeEntitiesById = new Map<string, Entity>();
const pipePolylinesById = new Map<string, { material: Color } | any>();
const equipmentEntitiesById = new Map<string, Entity>();
/**
 * Dernière couleur « résultat » appliquée par conduite. La passe de sélection repasse
 * sur toutes les conduites : sans ce relais elle réécrirait la couleur de type et le
 * réseau perdrait sa coloration débit au premier clic sur la carte.
 */
const pipeResultColorById = new Map<string, Color>();

const networkStore = useNetworkStore();
const simulateStore = useSimulateStore();
const timeseriesStore = useTimeseriesStore();
const editorStore = useEditorStore();
const selectedStep = computed(() => timeseriesStore.selectedStep);
const debugOverlayEnabled = ref(false);
const showPerfToggle = computed(
  () => editorStore.editMode || debugOverlayEnabled.value,
);
const fps = ref(0);
const cameraHeightM = ref(0);
const renderUpdateMs = ref(0);
const entityCount = ref(0);
const positioningWarningVisible = ref(false);
const positioningWarningTitle = ref('Positionnement cartographique approximatif');
const positioningWarningDetail = ref('');
const canvasArea = ref<HTMLElement>();
let resizeObserver: ResizeObserver | null = null;
let frameRetryTimers: ReturnType<typeof setTimeout>[] = [];
let editClickHandler: ScreenSpaceEventHandler | null = null;
let onKeyDown: ((event: KeyboardEvent) => void) | null = null;
const PRIMITIVE_PIPE_THRESHOLD = 200;
const SELECTED_NODE_COLOR = Color.fromCssColorString('#FFD54F');
const SELECTED_PIPE_GLOW = Color.fromCssColorString('#FFD54F');
const CONTINGENCY_NODE_COLOR = Color.fromCssColorString('#FF5252');
const props = withDefaults(
  defineProps<{
    contingencyViolationNodeIds?: string[];
  }>(),
  {
    contingencyViolationNodeIds: () => [],
  },
);
const contingencyViolationSet = computed(
  () => new Set((props.contingencyViolationNodeIds ?? []).filter(Boolean)),
);
const CALIBRATION_RESIDUAL_LOW = Color.fromCssColorString('#66bb6a');
const CALIBRATION_RESIDUAL_HIGH = Color.fromCssColorString('#ef5350');

function createPrimitivePipeMaterial(color: Color) {
  return Material.fromType('Color', {
    color: color.clone(),
  });
}

function pipeLineColor(kind: string): Color {
  const base = kind && kind !== 'pipe' ? equipmentMarkerColor(kind) : '#FFB74D';
  return Color.fromCssColorString(base);
}

function buildPipeDescription(pipe: PipeDto): string {
  const kindLine = isEquipmentKind(pipe.kind)
    ? `<p>Type : <b>${escapeHtml(equipmentKindLabel(pipe.kind))}</b></p>`
    : '';
  const eq = pipe.equipment;
  const eqLines: string[] = [];
  if (eq?.regulator_setpoint_bar != null) {
    eqLines.push(`Consigne : ${eq.regulator_setpoint_bar} bar`);
  }
  if (eq?.delivery_min_pressure_bar != null) {
    eqLines.push(`P min contractuel : ${eq.delivery_min_pressure_bar} bar`);
  }
  if (eq?.control_valve_cv != null) {
    eqLines.push(`Cv : ${eq.control_valve_cv}`);
  }
  if (eq?.control_valve_opening_pct != null) {
    eqLines.push(`Ouverture : ${eq.control_valve_opening_pct} %`);
  }
  const eqHtml =
    eqLines.length > 0
      ? `<p>${eqLines.map((l) => escapeHtml(l)).join('<br/>')}</p>`
      : '';
  return `<p>Conduite <b>${escapeHtml(pipe.id)}</b></p>
          <p>${escapeHtml(pipe.from)} → ${escapeHtml(pipe.to)}</p>
          <p>L : ${pipe.length_km} km | D : ${pipe.diameter_mm} mm</p>
          ${kindLine}${eqHtml}`;
}

function addEquipmentMarker(pipe: PipeDto, lon: number, lat: number) {
  if (!viewer || !isEquipmentKind(pipe.kind)) return;
  const entity = viewer.entities.add({
    id: `equip:${pipe.id}`,
    position: Cartesian3.fromDegrees(lon, lat, 80),
    point: {
      pixelSize: 12,
      color: pipeLineColor(pipe.kind),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.NONE,
    },
    label: {
      text: equipmentKindLabel(pipe.kind).split(' ')[0] ?? pipe.kind,
      font: '10px sans-serif',
      style: LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -14),
      showBackground: true,
      backgroundColor: Color.fromAlpha(Color.BLACK, 0.55),
    },
  });
  equipmentEntitiesById.set(pipe.id, entity);
}

function updateEquipmentStateLabels() {
  const states = simulateStore.equipmentStates;
  if (states.length === 0) return;
  for (const eq of states) {
    const entity = equipmentEntitiesById.get(eq.pipe_id);
    if (!entity?.label) continue;
    entity.label.text = `${equipmentKindLabel(eq.kind).split(' ')[0]} · ${regulatorModeLabel(eq.mode)}`;
  }
}

onMounted(async () => {
  if (!cesiumContainer.value) return;

  viewer = new Viewer(cesiumContainer.value, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    imageryProvider: false,
    skyBox: false,
    contextOptions: {
      webgl: {
        alpha: true,
      },
    },
  });

  viewer.scene.backgroundColor = Color.BLACK;
  viewer.scene.globe.baseColor = Color.BLACK;
  if (viewer.scene.sun) viewer.scene.sun.show = false;
  if (viewer.scene.moon) viewer.scene.moon.show = false;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

  try {
    const osm = new UrlTemplateImageryProvider({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: 'Map tiles by OpenStreetMap, under ODbL. Data by OpenStreetMap, under ODbL.',
    });
    const baseLayer = viewer.imageryLayers.addImageryProvider(osm);
    // Palette sombre pour mettre en avant le réseau.
    baseLayer.brightness = 0.28;
    baseLayer.contrast = 1.15;
    baseLayer.saturation = 0.12;
    baseLayer.gamma = 0.85;
    baseLayer.alpha = 0.85;
  } catch (e) {
    console.warn('Failed to load OSM imagery', e);
  }

  if (networkStore.nodes.length === 0 && networkStore.pipes.length === 0) {
    await networkStore.fetchNetwork();
  }
  renderNetwork();

  let frames = 0;
  let lastSampleAt = performance.now();
  postRenderCb = () => {
    frames += 1;
    const now = performance.now();
    if (now - lastSampleAt >= 500) {
      fps.value = (frames * 1000) / (now - lastSampleAt);
      frames = 0;
      lastSampleAt = now;
    }
  };
  viewer.scene.postRender.addEventListener(postRenderCb);
  cameraChangedCb = () => updateNodeLod();
  viewer.camera.changed.addEventListener(cameraChangedCb);

  if (canvasArea.value) {
    resizeObserver = new ResizeObserver(() => {
      viewer?.resize();
      viewer?.scene.requestRender();
      updateNodeLod();
    });
    resizeObserver.observe(canvasArea.value);
  }

  setupEditInteractions();
});

function setupEditInteractions() {
  if (!viewer || editClickHandler) return;

  editClickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  editClickHandler.setInputAction((movement: { position: Cartesian2 }) => {
    // Camille (ingénieur, hors édition) peut cliquer un nœud déficitaire pour l'inspecter.
    // La sélection de nœud est donc autorisée en mode visualisation ; l'édition (pipes,
    // placement) reste gated par editMode plus bas.
    if (!editorStore.editMode) {
      void handleViewModeNodePick(movement.position);
      return;
    }
    void handleMapClick(movement.position);
  }, ScreenSpaceEventType.LEFT_CLICK);

  onKeyDown = (event: KeyboardEvent) => {
    if (!editorStore.editMode) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    void editorStore.deleteSelected();
  };
  window.addEventListener('keydown', onKeyDown);
}

function teardownEditInteractions() {
  editClickHandler?.destroy();
  editClickHandler = null;
  if (onKeyDown) {
    window.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }
}

function pickEntityId(screenPosition: Cartesian2): string {
  if (!viewer) return '';
  const picked = viewer.scene.pick(screenPosition);
  if (defined(picked) && picked.id) {
    const entity = picked.id as Entity;
    return typeof entity.id === 'string' ? entity.id : '';
  }
  return '';
}

// Mode visualisation (Camille) : sélection de nœud uniquement, pas d'édition.
function handleViewModeNodePick(screenPosition: Cartesian2) {
  const entityId = pickEntityId(screenPosition);
  if (entityId.startsWith('node:')) {
    editorStore.selectNode(entityId.slice(5));
    updateSelectionHighlight();
    return;
  }
  if (simulateStore.novaActive && entityId) {
    return;
  }
  editorStore.clearSelection();
  updateSelectionHighlight();
}

async function handleMapClick(screenPosition: Cartesian2) {
  if (!viewer) return;

  const entityId = pickEntityId(screenPosition);
  if (entityId.startsWith('node:')) {
    editorStore.selectNode(entityId.slice(5));
    updateSelectionHighlight();
    return;
  }
  if (entityId.startsWith('pipe:')) {
    editorStore.selectPipe(entityId.slice(5));
    updateSelectionHighlight();
    return;
  }
  if (entityId.startsWith('equip:')) {
    editorStore.selectPipe(entityId.slice(6));
    updateSelectionHighlight();
    return;
  }

  if (editorStore.placingNode) {
    const cartesian =
      viewer.scene.pickPosition(screenPosition) ??
      viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid);
    if (!cartesian) return;

    const cartographic = Cartographic.fromCartesian(cartesian);
    const lon = CesiumMath.toDegrees(cartographic.longitude);
    const lat = CesiumMath.toDegrees(cartographic.latitude);
    try {
      await editorStore.createNodeAt(lon, lat);
      updateSelectionHighlight();
    } catch (error) {
      console.warn('Failed to create node', error);
    }
    return;
  }

  editorStore.clearSelection();
  updateSelectionHighlight();
}

function updateSelectionHighlight() {
  for (const [nodeId, entity] of nodeEntitiesById.entries()) {
    if (!entity.point) continue;
    const selected = editorStore.selectedKind === 'node' && editorStore.selectedId === nodeId;
    const contingency = contingencyViolationSet.value.has(nodeId);
    entity.point.outlineColor = selected
      ? SELECTED_NODE_COLOR
      : contingency
        ? CONTINGENCY_NODE_COLOR
        : Color.TRANSPARENT;
    entity.point.outlineWidth = selected ? 3 : contingency ? 2.5 : 0;
  }

  for (const [pipeId, entity] of pipeEntitiesById.entries()) {
    if (!entity.polyline) continue;
    const selected = editorStore.selectedKind === 'pipe' && editorStore.selectedId === pipeId;
    const baseColor = selected
      ? SELECTED_PIPE_GLOW
      : (pipeResultColorById.get(pipeId) ??
        pipeLineColor(networkStore.pipes.find((pipe) => pipe.id === pipeId)?.kind ?? 'pipe'));
    entity.polyline.width = selected ? 6 : Math.max(
      2,
      (networkStore.pipes.find((pipe) => pipe.id === pipeId)?.diameter_mm ?? 100) / 100,
    );
    entity.polyline.material = new PolylineGlowMaterialProperty({
      glowPower: selected ? 0.45 : 0.2,
      color: baseColor,
    });
  }

  updateNodeLod();
  viewer?.scene.requestRender();
}

onBeforeUnmount(() => {
  teardownEditInteractions();
  resizeObserver?.disconnect();
  resizeObserver = null;
  clearFrameRetries();
  if (viewer && postRenderCb) {
    viewer.scene.postRender.removeEventListener(postRenderCb);
  }
  if (viewer && cameraChangedCb) {
    viewer.camera.changed.removeEventListener(cameraChangedCb);
  }
  pipeCollection = null;
  nodeEntities.length = 0;
  nodeEntitiesById.clear();
  pipeEntitiesById.clear();
  pipePolylinesById.clear();
  equipmentEntitiesById.clear();
  pipeResultColorById.clear();
  postRenderCb = null;
  cameraChangedCb = null;
  viewer?.destroy();
  viewer = null;
});

watch(
  () => [simulateStore.liveFlows, simulateStore.livePressures],
  () => {
    if (!timeseriesStore.hasResult) {
      updateColors();
    }
  },
  { deep: true },
);

watch(
  () => timeseriesStore.selectedStep,
  () => {
    if (timeseriesStore.hasResult) {
      updateColors();
    }
  },
  { deep: true },
);

watch(
  () => simulateStore.equipmentStates,
  () => {
    updateEquipmentStateLabels();
  },
  { deep: true },
);

watch(
  () => [simulateStore.pressureMargins, simulateStore.pressureSlips, simulateStore.novaActive, simulateStore.nominationChangedSinceLastRun],
  () => {
    updateColors();
  },
  { deep: true },
);

watch(
  () => simulateStore.previewStep,
  () => {
    updateColors();
  },
  { deep: true },
);

watch(
  () => [networkStore.nodes, networkStore.pipes],
  () => {
    renderNetwork();
    updateSelectionHighlight();
  },
);

watch(
  () => networkStore.calibrationPressureResiduals,
  () => {
    updateColors();
  },
  { deep: true },
);

watch(
  () => [editorStore.editMode, editorStore.selectedId, editorStore.selectedKind],
  () => {
    updateSelectionHighlight();
    if (viewer) {
      viewer.canvas.style.cursor = editorStore.editMode && editorStore.placingNode ? 'crosshair' : '';
    }
    // Mode visualisation (Camille) : vole vers le nœud sélectionné pour qu'il reste
    // visible sur les grands réseaux (ex. GasLib-582). En édition on ne perturbe pas la caméra.
    flyToSelectedNode();
  },
);

watch(
  () => props.contingencyViolationNodeIds,
  () => {
    updateSelectionHighlight();
  },
  { deep: true },
);

function renderNetwork() {
  if (!viewer) return;
    const { nodes, pipes } = networkStore;
    const gpsExactCount = nodes.reduce(
      (count, node) => (node.lon != null && node.lat != null ? count + 1 : count),
      0,
    );
    const partialGpsCount = nodes.reduce(
      (count, node) =>
        node.lon != null && node.lat != null ? count : node.lon != null || node.lat != null ? count + 1 : count,
      0,
    );
    const approxCount = nodes.length - gpsExactCount;
    positioningWarningVisible.value = approxCount > 0;
    positioningWarningDetail.value =
      approxCount > 0
        ? [
            `${approxCount}/${nodes.length} nœud(s) sont placés via une projection locale depuis x/y.`,
            `${gpsExactCount}/${nodes.length} nœud(s) ont des coordonnées GPS exactes (lon/lat).`,
            partialGpsCount > 0
              ? `${partialGpsCount} nœud(s) ont une coordonnée GPS partielle (lon ou lat manquant).`
              : null,
            'Projection utilisee: repere local centre a 50N, 10E (approximation).',
          ]
            .filter((line): line is string => line != null)
            .join('\n')
        : '';
    viewer.entities.removeAll();
    if (pipeCollection) {
      viewer.scene.primitives.remove(pipeCollection);
      pipeCollection = null;
    }
    nodeEntities.length = 0;
    nodeEntitiesById.clear();
    pipeEntitiesById.clear();
    pipePolylinesById.clear();
    equipmentEntitiesById.clear();
    pipeResultColorById.clear();

    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const neighborsByNode = new Map<string, Set<string>>();
    for (const pipe of pipes) {
      if (!neighborsByNode.has(pipe.from)) neighborsByNode.set(pipe.from, new Set<string>());
      if (!neighborsByNode.has(pipe.to)) neighborsByNode.set(pipe.to, new Set<string>());
      neighborsByNode.get(pipe.from)!.add(pipe.to);
      neighborsByNode.get(pipe.to)!.add(pipe.from);
    }

    // Projection par défaut si pas de GPS (GasLib-11)
    // On centre sur l'Allemagne (50N, 10E) et on considère x,y en km
    const kmPerUnit = schematicKmPerUnit(nodes);
    const getPos = (n: (typeof nodes)[0]) => nodeLonLat(n, kmPerUnit);

    for (const node of nodes) {
      const pos = getPos(node);
      const neighbors = Array.from(neighborsByNode.get(node.id) ?? []).sort();
      const neighborsText = neighbors.length > 0 ? neighbors.join(', ') : 'Aucun';
      const entity = viewer.entities.add({
        id: `node:${node.id}`,
        position: Cartesian3.fromDegrees(pos.lon, pos.lat, Math.max(node.height_m, 80)),
        point: {
          pixelSize: 8,
          color: Color.CYAN,
          heightReference: HeightReference.NONE,
        },
        label: {
          text: node.id,
          font: '12px sans-serif',
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -12),
        },
        description: `<p>Nœud <b>${escapeHtml(node.id)}</b></p><p>Alt. : ${node.height_m} m</p><p>Voisins : ${escapeHtml(neighborsText)}</p>`,
      });
      nodeEntities.push(entity);
      nodeEntitiesById.set(node.id, entity);
    }

    if (pipes.length > PRIMITIVE_PIPE_THRESHOLD) {
      pipeCollection = viewer.scene.primitives.add(new PolylineCollection());
      for (const pipe of pipes) {
        const fromNode = nodeById.get(pipe.from);
        const toNode = nodeById.get(pipe.to);
        if (!fromNode || !toNode) continue;

        const p1 = getPos(fromNode);
        const p2 = getPos(toNode);

        const polyline = pipeCollection.add({
          positions: Cartesian3.fromDegreesArray([p1.lon, p1.lat, p2.lon, p2.lat]),
          width: Math.max(2, pipe.diameter_mm / 100),
          material: createPrimitivePipeMaterial(pipeLineColor(pipe.kind ?? 'pipe')),
        });
        pipePolylinesById.set(pipe.id, polyline);
        addEquipmentMarker(pipe, (p1.lon + p2.lon) / 2, (p1.lat + p2.lat) / 2);
      }
    } else {
      for (const pipe of pipes) {
        const fromNode = nodeById.get(pipe.from);
        const toNode = nodeById.get(pipe.to);
        if (!fromNode || !toNode) continue;

        const p1 = getPos(fromNode);
        const p2 = getPos(toNode);

        const entity = viewer.entities.add({
          id: `pipe:${pipe.id}`,
          polyline: {
            positions: Cartesian3.fromDegreesArray([p1.lon, p1.lat, p2.lon, p2.lat]),
            width: Math.max(2, pipe.diameter_mm / 100),
            material: new PolylineGlowMaterialProperty({
              glowPower: 0.2,
              color: pipeLineColor(pipe.kind ?? 'pipe'),
            }),
            clampToGround: false,
          },
          description: buildPipeDescription(pipe),
        });
        pipeEntitiesById.set(pipe.id, entity);
        addEquipmentMarker(pipe, (p1.lon + p2.lon) / 2, (p1.lat + p2.lat) / 2);
      }
    }

  frameCamera();
  entityCount.value = viewer.entities.values.length;
  updateNodeLod();
  updateEquipmentStateLabels();
  updateColors();
  updateSelectionHighlight();
}

function cesiumRectangle(rect: GeoRectangle): Rectangle {
  return Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north);
}

function currentCameraRect(): GeoRectangle | null {
  let focus = null;
  if (editorStore.selectedKind === 'node' && editorStore.selectedId) {
    const node = networkStore.nodes.find((item) => item.id === editorStore.selectedId);
    if (node) {
      focus = nodeLonLat(node, schematicKmPerUnit(networkStore.nodes));
    }
  }
  return cameraRectangleForNodes(networkStore.nodes, focus);
}

function applyCameraRectangle(rect: GeoRectangle, duration: number): void {
  if (!viewer) return;
  const destination = cesiumRectangle(rect);
  if (duration <= 0) {
    viewer.camera.setView({ destination });
  } else {
    viewer.camera.flyTo({ destination, duration });
  }
  viewer.scene.requestRender();
}

function clearFrameRetries(): void {
  for (const timer of frameRetryTimers) {
    window.clearTimeout(timer);
  }
  frameRetryTimers = [];
}

function frameNetwork(duration = 0, withRetries = false): void {
  const rect = currentCameraRect();
  if (!rect) return;
  applyCameraRectangle(rect, duration);
  if (!withRetries) return;
  clearFrameRetries();
  // Cesium réapplique parfois la vue globe au premier rendu : recadrer après coup.
  frameRetryTimers = [
    window.setTimeout(() => {
      const next = currentCameraRect();
      if (next) applyCameraRectangle(next, 0);
    }, 120),
    window.setTimeout(() => {
      const next = currentCameraRect();
      if (next) applyCameraRectangle(next, 0);
    }, 500),
  ];
}

function flyToSelectedNode(): void {
  if (!viewer || editorStore.editMode) return;
  if (editorStore.selectedKind !== 'node' || !editorStore.selectedId) return;
  const rect = currentCameraRect();
  if (!rect) return;
  applyCameraRectangle(rect, 0.7);
}

function frameCamera(): void {
  frameNetwork(0, true);
}

function updateColors() {
  if (!viewer) return;
  const startedAt = performance.now();
  const staleNomination = simulateStore.nominationChangedSinceLastRun;

  const step = timeseriesStore.selectedStep;
  const preview = simulateStore.previewStep;
  const pressures = staleNomination
    ? {}
    : (preview?.pressures ??
      step?.pressures ??
      (Object.keys(simulateStore.livePressures).length > 0
        ? simulateStore.livePressures
        : (simulateStore.result?.pressures ?? {})));
  const flows = staleNomination
    ? {}
    : (preview?.flows ??
      step?.flows ??
      (Object.keys(simulateStore.liveFlows).length > 0
        ? simulateStore.liveFlows
        : (simulateStore.result?.flows ?? {})));

  if (Object.keys(pressures).length > 0) {
    updateNodePressureColors(pressures);
  } else {
    resetNodesToDefaultColor();
  }

  if (!staleNomination) {
    applyNovaDeficitHighlights();
  }

  if (Object.keys(flows).length > 0) {
    updatePipeFlowColors(flows);
  } else {
    resetPipesToKindColor();
  }

  applyCalibrationResidualHighlights(pressures);
  renderUpdateMs.value = performance.now() - startedAt;
  updateNodeLod();
}

function resetNodesToDefaultColor() {
  for (const entity of nodeEntitiesById.values()) {
    if (!entity.point) continue;
    entity.point.color = Color.CYAN;
  }
}

function applyCalibrationResidualHighlights(pressures: Record<string, number>) {
  const residuals = networkStore.calibrationPressureResiduals;
  const residualEntries = Object.entries(residuals).filter(([, value]) => Number.isFinite(value));
  if (residualEntries.length === 0) {
    if (Object.keys(pressures).length === 0) {
      for (const entity of nodeEntitiesById.values()) {
        if (!entity.point) continue;
        entity.point.color = Color.CYAN;
      }
    }
    return;
  }

  const geolocatedNodes = new Set(
    networkStore.nodes
      .filter((node) => node.lon != null && node.lat != null)
      .map((node) => node.id),
  );
  const maxResidual = Math.max(
    ...residualEntries.map(([, value]) => value),
    1e-9,
  );

  for (const [nodeId, entity] of nodeEntitiesById.entries()) {
    if (!entity.point) continue;
    const residual = residuals[nodeId];
    if (residual == null || !geolocatedNodes.has(nodeId)) {
      if (Object.keys(pressures).length === 0) {
        entity.point.color = Color.CYAN;
      }
      continue;
    }

    const ratio = Math.max(0, Math.min(1, residual / maxResidual));
    entity.point.color = Color.lerp(
      CALIBRATION_RESIDUAL_LOW,
      CALIBRATION_RESIDUAL_HIGH,
      ratio,
      new Color(),
    );
  }
}

function updateNodePressureColors(pressures: Record<string, number>) {
  const useContract =
    simulateStore.novaActive &&
    !simulateStore.nominationChangedSinceLastRun &&
    hasContractMarginScale(simulateStore.pressureMargins, simulateStore.pressureSlips);
  if (useContract) {
    for (const [nodeId, entity] of nodeEntitiesById.entries()) {
      if (!entity.point) continue;
      const margin = contractMarginForNode(
        nodeId,
        simulateStore.pressureMargins,
        simulateStore.pressureSlips,
      );
      entity.point.color = Color.fromCssColorString(
        margin == null ? UNCONSTRAINED_NODE_CSS : contractMarginToCss(margin),
      );
    }
    return;
  }
  const values = Object.values(pressures);
  const { min, max } = pressureRange(values);
  for (const [nodeId, entity] of nodeEntitiesById.entries()) {
    const p = pressures[nodeId];
    if (p == null || !entity.point) continue;
    entity.point.color = Color.fromCssColorString(pressureToCss(p, min, max));
  }
}

const NOVA_DEFICIT_COLOR = Color.fromCssColorString('#ff1744');
const NOVA_DEFICIT_PIXEL_SIZE = 16;

function applyNovaDeficitHighlights() {
  if (simulateStore.nominationChangedSinceLastRun) return;
  const slips = simulateStore.pressureSlips;
  if (slips.length === 0) return;
  for (const slip of slips) {
    if (slip.shortfall_bar <= 0) continue;
    const entity = nodeEntitiesById.get(slip.node_id);
    if (!entity?.point) continue;
    entity.point.color = NOVA_DEFICIT_COLOR;
    entity.point.pixelSize = NOVA_DEFICIT_PIXEL_SIZE;
  }
}

function updatePipeFlowColors(flows: Record<string, number>) {
  const maxFlow = Math.max(...Object.values(flows).map(Math.abs), 1);

  for (const [pipeId, entity] of pipeEntitiesById.entries()) {
    const flow = flows[pipeId] ?? 0;
    const ratio = Math.abs(flow) / maxFlow;
    const color = Color.fromHsl(0.33 * (1 - ratio), 1.0, 0.5);
    pipeResultColorById.set(pipeId, color);
    if (!entity.polyline) continue;
    entity.polyline.material = new PolylineGlowMaterialProperty({
      glowPower: 0.3,
      color,
    });
  }

  for (const [pipeId, polyline] of pipePolylinesById.entries()) {
    const flow = flows[pipeId] ?? 0;
    const ratio = Math.abs(flow) / maxFlow;
    const color = Color.fromHsl(0.33 * (1 - ratio), 1.0, 0.5);
    pipeResultColorById.set(pipeId, color);
    polyline.material = createPrimitivePipeMaterial(color);
  }
}

/**
 * Aucun débit à afficher (pas de run, ou nomination modifiée depuis le dernier verdict) :
 * les conduites reviennent à leur couleur de type, sinon une coloration périmée continue
 * de se lire comme un résultat.
 */
function resetPipesToKindColor() {
  pipeResultColorById.clear();
  const kindOf = (pipeId: string) =>
    networkStore.pipes.find((pipe) => pipe.id === pipeId)?.kind ?? 'pipe';

  for (const [pipeId, entity] of pipeEntitiesById.entries()) {
    if (!entity.polyline) continue;
    entity.polyline.material = new PolylineGlowMaterialProperty({
      glowPower: 0.2,
      color: pipeLineColor(kindOf(pipeId)),
    });
  }

  for (const [pipeId, polyline] of pipePolylinesById.entries()) {
    polyline.material = createPrimitivePipeMaterial(pipeLineColor(kindOf(pipeId)));
  }
}

function updateNodeLod() {
  if (!viewer) return;
  const height = viewer.camera.positionCartographic.height;
  cameraHeightM.value = height;
  const networkSize = networkStore.nodes.length;
  const stride = nodeStride(height, networkSize);
  const selectedKind = editorStore.selectedKind;
  const selectedNodeId = editorStore.selectedId;
  const novaDeficitIds = new Set(
    simulateStore.nominationChangedSinceLastRun
      ? []
      : deficitSinkIds(simulateStore.sinkDiagnostics, simulateStore.novaVerdict),
  );

  nodeEntities.forEach((entity, index) => {
    const nodeId = entity.id?.startsWith('node:') ? entity.id.slice(5) : '';
    const selected = selectedKind === 'node' && selectedNodeId === nodeId;
    const contingency = contingencyViolationSet.value.has(nodeId);
    const novaDeficit = novaDeficitIds.has(nodeId);
    const basePixelSize = selected ? 14 : contingency || novaDeficit ? 10 : 8;
    const pointVisible = nodePointVisible(index, stride, {
      nodeId,
      selectedKind,
      selectedNodeId,
      isContingency: contingency,
      isNovaDeficit: novaDeficit,
    });
    const labelVisible = labelLodVisible(height, networkSize, {
      nodeId,
      selectedKind,
      selectedNodeId,
      isNovaDeficit: novaDeficit,
    });

    if (entity.point) {
      entity.point.show = pointVisible;
      entity.point.pixelSize = nodePointPixelSize(basePixelSize, height, networkSize);
    }
    if (entity.label) {
      entity.label.show = labelVisible;
    }
    entity.show = pointVisible || labelVisible;
  });

  const equipmentLabelsVisible = height < SMALL_NETWORK_LABEL_MAX_HEIGHT;
  for (const entity of equipmentEntitiesById.values()) {
    if (entity.label) {
      entity.label.show = equipmentLabelsVisible;
    }
  }

  // LOD écrase pixelSize : réappliquer les highlights NoVa après coup.
  applyNovaDeficitHighlights();
}
</script>

<style scoped>
.viewer-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.canvas-area {
  flex: 1;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.canvas-element {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.positioning-warning {
  position: absolute;
  top: 12px;
  left: calc(var(--map-sidebar-width) + var(--map-sidebar-inset) + 8px);
  z-index: 10;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(28, 24, 12, 0.9);
  border: 1px solid rgba(245, 196, 75, 0.55);
  cursor: help;
  pointer-events: auto;
}

.positioning-warning-tooltip {
  max-width: 360px;
  white-space: pre-line;
  font-size: 12px;
  line-height: 1.4;
}

.perf-toggle {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
}

.viewer-root--edit-mode .perf-toggle {
  right: calc(var(--map-property-width) + var(--map-sidebar-inset) + 8px);
}

.perf-overlay {
  position: absolute;
  top: 52px;
  right: 12px;
  min-width: 170px;
  max-width: calc(100% - var(--map-sidebar-width) - 3 * var(--map-sidebar-inset));
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(18, 18, 18, 0.88);
  color: #d9f3ff;
  font-size: 12px;
  line-height: 1.5;
  z-index: 10;
  border: 1px solid rgba(120, 180, 220, 0.45);
  pointer-events: auto;
}

.viewer-root--edit-mode .perf-overlay {
  right: calc(var(--map-property-width) + var(--map-sidebar-inset) + 8px);
}

.timeseries-slider {
  position: absolute;
  left: calc(var(--map-sidebar-width) + (2 * var(--map-sidebar-inset)));
  right: calc(var(--map-legend-width) + (2 * var(--map-sidebar-inset)));
  bottom: var(--map-sidebar-inset);
  z-index: 10;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(18, 18, 18, 0.88);
  border: 1px solid rgba(120, 180, 220, 0.35);
  pointer-events: auto;
  box-sizing: border-box;
}

@media (max-width: 960px) {
  .timeseries-slider {
    left: var(--map-sidebar-inset);
    right: var(--map-sidebar-inset);
  }

  .positioning-warning {
    left: var(--map-sidebar-inset);
  }
}
</style>
