/** Projection par défaut si pas de GPS : Allemagne (50N, 10E). */
const REF_LAT = 50.0;
const REF_LON = 10.0;
const KM_PER_DEG_LAT = 111.0;
const KM_PER_DEG_LON = 111.0 * Math.cos((REF_LAT * Math.PI) / 180);

/** Réseaux plus petits : toujours cadrer tout le graphe (démo GasLib-11). */
export const COMPACT_NETWORK_NODE_COUNT = 80;

/** Si x/y dépassent cette emprise (unités), on les ramène à une emprise régionale. */
const SCHEMATIC_ALREADY_KM_SPAN = 72;
const SCHEMATIC_TARGET_KM = 64;

const MIN_SPAN_DEG = 0.05;
const NETWORK_PAD_RATIO = 0.28;
const FOCUS_HALF_SPAN_DEG = 0.08;

export type MapNodePosition = {
  lon: number | null;
  lat: number | null;
  x: number;
  y: number;
};

export type LonLat = { lon: number; lat: number };

export type GeoRectangle = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * GasLib-11 sert des x/y de layout (0–1141), pas des km : 1141 km projetés
 * étalent le réseau sur 16° et le fly-to nœud ne montre plus que exit01.
 */
export function schematicKmPerUnit(nodes: readonly MapNodePosition[]): number {
  if (nodes.length === 0) {
    return 1;
  }
  if (nodes.some((node) => node.lon != null && node.lat != null)) {
    return 1;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  if (span <= SCHEMATIC_ALREADY_KM_SPAN) {
    return 1;
  }
  return SCHEMATIC_TARGET_KM / span;
}

export function nodeLonLat(node: MapNodePosition, kmPerUnit = 1): LonLat {
  if (node.lon != null && node.lat != null) {
    return { lon: node.lon, lat: node.lat };
  }
  return {
    lon: REF_LON + (node.x * kmPerUnit) / KM_PER_DEG_LON,
    lat: REF_LAT + (node.y * kmPerUnit) / KM_PER_DEG_LAT,
  };
}

export function networkLonLatBounds(nodes: readonly MapNodePosition[]): GeoRectangle | null {
  if (nodes.length === 0) {
    return null;
  }
  const kmPerUnit = schematicKmPerUnit(nodes);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const node of nodes) {
    const { lon, lat } = nodeLonLat(node, kmPerUnit);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

function padRectangle(bounds: GeoRectangle, padRatio: number, minSpan: number): GeoRectangle {
  const rawLon = bounds.east - bounds.west;
  const rawLat = bounds.north - bounds.south;
  const spanLon = Math.max(rawLon, minSpan);
  const spanLat = Math.max(rawLat, minSpan);
  const extraLon = (spanLon - rawLon) / 2 + spanLon * padRatio;
  const extraLat = (spanLat - rawLat) / 2 + spanLat * padRatio;
  return {
    west: bounds.west - extraLon,
    south: bounds.south - extraLat,
    east: bounds.east + extraLon,
    north: bounds.north + extraLat,
  };
}

/**
 * Rectangle caméra : tout le réseau s'il est compact (≤ 80 nœuds), sinon un cadre
 * autour du nœud focal (déficit) pour ne pas perdre le point sur un grand graphe.
 */
export function cameraRectangleForNodes(
  nodes: readonly MapNodePosition[],
  focus: LonLat | null = null,
): GeoRectangle | null {
  const bounds = networkLonLatBounds(nodes);
  if (!bounds) {
    return null;
  }
  const compact = nodes.length <= COMPACT_NETWORK_NODE_COUNT;
  if (!focus || compact) {
    return padRectangle(bounds, NETWORK_PAD_RATIO, MIN_SPAN_DEG);
  }
  return padRectangle(
    {
      west: focus.lon,
      south: focus.lat,
      east: focus.lon,
      north: focus.lat,
    },
    0,
    FOCUS_HALF_SPAN_DEG * 2,
  );
}
