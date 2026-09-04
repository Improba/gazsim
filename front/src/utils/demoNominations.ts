/** Jeu démo nomination (GasLib-11). XML Improba, pas l'archive GasLib. */

export const DEMO_NETWORK_ID = 'GasLib-11';

export const DEMO_JOUR_FILENAME = 'nomination-jour.scn';
export const DEMO_POINTE_FILENAME = 'nomination-pointe.scn';

export const DEMO_JOUR_LABEL = 'Nomination du jour';
export const DEMO_POINTE_LABEL = 'Nomination de pointe';

const SCN_NS = `xmlns="http://gaslib.zib.de/Gas" xmlns:framework="http://gaslib.zib.de/Framework"`;

function scnXml(scenarioId: string, exit01LowerBarg: number, exit01UpperBarg: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<boundaryValue ${SCN_NS}>
  <scenario id="${scenarioId}">
    <node type="entry" id="entry01">
      <flow bound="lower" value="160.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="160.00" unit="1000m_cube_per_hour"/>
    </node>
    <node type="entry" id="entry02">
      <flow bound="lower" value="140.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="140.00" unit="1000m_cube_per_hour"/>
    </node>
    <node type="entry" id="entry03">
      <flow bound="lower" value="0.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="0.00" unit="1000m_cube_per_hour"/>
    </node>
    <node type="exit" id="exit01">
      <pressure unit="barg" bound="lower" value="${exit01LowerBarg.toFixed(1)}"/>
      <pressure unit="barg" bound="upper" value="${exit01UpperBarg.toFixed(1)}"/>
      <flow bound="lower" value="100.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="100.00" unit="1000m_cube_per_hour"/>
    </node>
    <node type="exit" id="exit02">
      <pressure unit="barg" bound="lower" value="20.0"/>
      <pressure unit="barg" bound="upper" value="70.0"/>
      <flow bound="lower" value="120.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="120.00" unit="1000m_cube_per_hour"/>
    </node>
    <node type="exit" id="exit03">
      <pressure unit="barg" bound="lower" value="20.0"/>
      <pressure unit="barg" bound="upper" value="70.0"/>
      <flow bound="lower" value="80.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="80.00" unit="1000m_cube_per_hour"/>
    </node>
  </scenario>
</boundaryValue>
`;
}

/** Bornes larges : la tenue pression doit passer. */
export const DEMO_JOUR_SCN_XML = scnXml('nomination_jour', 20, 70);

/** Borne basse serrée sur exit01 : déficit contractuel attendu après chute de ligne. */
export const DEMO_POINTE_SCN_XML = scnXml('nomination_pointe', 68, 72);

const FILENAME_LABELS: Record<string, string> = {
  [DEMO_JOUR_FILENAME]: DEMO_JOUR_LABEL,
  [DEMO_POINTE_FILENAME]: DEMO_POINTE_LABEL,
};

export function nominationDisplayLabel(filename: string | null | undefined): string {
  if (!filename) {
    return '';
  }
  return FILENAME_LABELS[filename] ?? filename;
}
