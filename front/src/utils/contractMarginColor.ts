import type { ScenarioPressureMargin, ScenarioPressureSlip } from 'src/services/api';

/** Nœud sans borne contractuelle : ne pas le colorer comme une heatmap brute. */
export const UNCONSTRAINED_NODE_CSS = '#546e7a';

const STOPS = [
  { t: 0, r: 0xff, g: 0x17, b: 0x44 },
  { t: 0.5, r: 0xfb, g: 0x8c, b: 0x00 },
  { t: 1, r: 0x43, g: 0xa0, b: 0x47 },
];

const MARGIN_FLOOR_BAR = -10;
const MARGIN_CEIL_BAR = 10;

/**
 * Marge à la borne basse (bar) → CSS.
 * Négatif = déficit (rouge), 0 = juste à la borne (orange), positif = à l'aise (vert).
 */
export function contractMarginToCss(marginBar: number): string {
  const span = MARGIN_CEIL_BAR - MARGIN_FLOOR_BAR;
  const t = Math.min(1, Math.max(0, (marginBar - MARGIN_FLOOR_BAR) / span));
  let i = 0;
  while (i < STOPS.length - 1 && t > STOPS[i + 1].t) i += 1;
  const a = STOPS[i];
  const b = STOPS[Math.min(i + 1, STOPS.length - 1)];
  const local = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const r = Math.round(a.r + (b.r - a.r) * local);
  const g = Math.round(a.g + (b.g - a.g) * local);
  const bl = Math.round(a.b + (b.b - a.b) * local);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Marge basse affichable : shortfall > 0 gagne, sinon margin_lower_bar. */
export function contractMarginForNode(
  nodeId: string,
  margins: ScenarioPressureMargin[],
  slips: ScenarioPressureSlip[],
): number | null {
  const slip = slips.find((item) => item.node_id === nodeId);
  if (slip && slip.shortfall_bar > 0 && Number.isFinite(slip.shortfall_bar)) {
    return -slip.shortfall_bar;
  }
  const margin = margins.find((item) => item.node_id === nodeId);
  if (margin?.margin_lower_bar != null && Number.isFinite(margin.margin_lower_bar)) {
    return margin.margin_lower_bar;
  }
  return null;
}

export function hasContractMarginScale(
  margins: ScenarioPressureMargin[],
  slips: ScenarioPressureSlip[],
): boolean {
  if (margins.some((item) => item.margin_lower_bar != null && Number.isFinite(item.margin_lower_bar))) {
    return true;
  }
  return slips.some((item) => item.shortfall_bar > 0);
}
