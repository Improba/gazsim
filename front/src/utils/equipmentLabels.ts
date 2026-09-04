/** Libellés et couleurs pour les organes P8 (alignés sur ConnectionKind camelCase API). */

export const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  pressureRegulator: 'Détendeur / régulateur',
  deliveryStation: 'Poste de livraison',
  controlValve: 'Vanne de régulation',
  valve: 'Vanne',
  compressorStation: 'Compresseur',
  shortPipe: 'Liaison courte',
  resistor: 'Résistance',
  pipe: 'Canalisation',
};

export function equipmentKindLabel(kind: string): string {
  return EQUIPMENT_KIND_LABELS[kind] ?? kind;
}

export function isEquipmentKind(kind: string): boolean {
  return (
    kind === 'pressureRegulator' ||
    kind === 'deliveryStation' ||
    kind === 'controlValve' ||
    kind === 'valve' ||
    kind === 'compressorStation'
  );
}

export function regulatorModeLabel(mode: string): string {
  if (mode === 'active') return 'Actif (consigne aval)';
  if (mode === 'bypass') return 'Bypass (amont insuffisant)';
  return mode;
}

/**
 * Couleur Cesium (#RRGGBB) pour marqueur carte.
 *
 * Les organes disent un **type**, jamais un état : ils restent donc hors des couleurs
 * porteuses de sens résultat, sinon un organe sain se lit comme une alarme. Sont
 * réservés le rouge et l'orange (déficit et borne serrée), le vert (marge à l'aise),
 * l'ambre `#FFD54F` (sélection carte) et le rouge `#FF5252` (ouvrage retiré en N-1).
 * D'où une famille froide et neutre pour les organes.
 */
export function equipmentMarkerColor(kind: string): string {
  switch (kind) {
    case 'pressureRegulator':
      return '#9575CD';
    case 'deliveryStation':
      return '#4DB6AC';
    case 'controlValve':
      return '#EA80FC';
    case 'valve':
      return '#B0BEC5';
    case 'compressorStation':
      return '#40C4FF';
    default:
      return '#FFB74D';
  }
}

export interface EquipmentLegendItem {
  kind: string;
  label: string;
  color: string;
}

/** Ordre d'affichage stable, du plus structurant au plus discret. */
const LEGEND_KIND_ORDER = [
  'compressorStation',
  'pressureRegulator',
  'controlValve',
  'valve',
  'deliveryStation',
];

/** Organes réellement présents dans le réseau, pour n'annoncer que ce qui est tracé. */
export function equipmentLegendItems(
  pipes: { kind?: string | null }[],
): EquipmentLegendItem[] {
  const present = new Set<string>();
  for (const pipe of pipes) {
    const kind = pipe.kind ?? '';
    if (isEquipmentKind(kind)) {
      present.add(kind);
    }
  }
  return LEGEND_KIND_ORDER.filter((kind) => present.has(kind)).map((kind) => ({
    kind,
    label: equipmentKindLabel(kind),
    color: equipmentMarkerColor(kind),
  }));
}
