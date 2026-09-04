import type { NovaScenarioSummary } from 'src/services/api';
import {
  DEMO_JOUR_FILENAME,
  DEMO_NETWORK_ID,
  DEMO_POINTE_FILENAME,
  nominationDisplayLabel,
} from './demoNominations';

export type NominationPickerItem = Pick<NovaScenarioSummary, 'filename' | 'relative_path'> & {
  source?: NovaScenarioSummary['source'];
};

/** Scénario catalogue livré avec un réseau GasLib (pas un contrat métier). */
export function isCatalogNetworkScn(filename: string): boolean {
  const stem = filename.replace(/\.scn$/i, '');
  return /^GasLib-\d+/i.test(stem);
}

export function isDemoNominationFilename(filename: string): boolean {
  return filename === DEMO_JOUR_FILENAME || filename === DEMO_POINTE_FILENAME;
}

function datasetStem(datasetId: string): string {
  return datasetId.toLowerCase();
}

function catalogBelongsToDataset(filename: string, datasetId: string): boolean {
  const stem = filename.replace(/\.scn$/i, '').toLowerCase();
  const ds = datasetStem(datasetId);
  return stem === ds || stem.startsWith(`${ds}-`) || stem.startsWith(`${ds}_`);
}

export function nominationBelongsToDataset(
  item: NominationPickerItem,
  datasetId: string | null,
): boolean {
  if (isDemoNominationFilename(item.filename)) {
    return !datasetId || datasetId === DEMO_NETWORK_ID;
  }
  if (item.source === 'imported') {
    return true;
  }
  if (!datasetId) {
    return false;
  }
  const ds = datasetStem(datasetId);
  const rel = (item.relative_path ?? '').toLowerCase();
  if (isCatalogNetworkScn(item.filename)) {
    return catalogBelongsToDataset(item.filename, datasetId);
  }
  if (rel.includes(ds)) {
    return true;
  }
  const numericId = ds.replace(/^gaslib-/, '');
  return numericId.length > 0 && rel.includes(numericId);
}

function demoRank(filename: string): number {
  if (filename === DEMO_JOUR_FILENAME) {
    return 0;
  }
  if (filename === DEMO_POINTE_FILENAME) {
    return 1;
  }
  return 2;
}

export function findDemoPair<T extends { filename: string }>(
  list: T[],
): { jour: T | undefined; pointe: T | undefined } {
  return {
    jour: list.find((item) => item.filename === DEMO_JOUR_FILENAME),
    pointe: list.find((item) => item.filename === DEMO_POINTE_FILENAME),
  };
}

/**
 * Nominations du réseau actif, sans les .scn catalogue des autres réseaux.
 * Si Jour et Pointe (ou une autre nomination métier) sont présents, les
 * fichiers `GasLib-*.scn` restent hors du premier pli.
 */
export function nominationsForStudyPicker<T extends NominationPickerItem>(
  list: T[],
  datasetId: string | null,
): T[] {
  const scoped = list.filter((item) => nominationBelongsToDataset(item, datasetId));
  const hasNonCatalog = scoped.some(
    (item) => item.source === 'imported' || !isCatalogNetworkScn(item.filename),
  );
  const visible = scoped.filter((item) => {
    if (item.source === 'imported' || isDemoNominationFilename(item.filename)) {
      return true;
    }
    if (isCatalogNetworkScn(item.filename)) {
      return !hasNonCatalog;
    }
    return true;
  });
  return [...visible].sort((a, b) => {
    const rank = demoRank(a.filename) - demoRank(b.filename);
    return rank !== 0 ? rank : a.filename.localeCompare(b.filename);
  });
}

export function nominationPickerLabel(filename: string | null | undefined): string {
  if (!filename) {
    return '';
  }
  const labeled = nominationDisplayLabel(filename);
  if (labeled !== filename) {
    return labeled;
  }
  if (isCatalogNetworkScn(filename)) {
    return 'Nomination catalogue';
  }
  return filename;
}
