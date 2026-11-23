/** Parser for the bundled weather model guide (SCRUM-110). */

export type ModelCadence = '1h' | '3h' | '6h';

export interface ModelGuideRow {
  model: string;
  region: string;
  frequency: string;
  /** Badge cadence derived from the frequency cell; null when it is not 1h, 3h or 6h. */
  cadence: ModelCadence | null;
  notes: string;
}

export interface ModelGuide {
  title: string;
  headers: string[];
  rows: ModelGuideRow[];
}

const SEPARATOR_CELL = /^:?-{3,}:?$/;
const HOURS = /(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i;
const BADGE_HOURS: ReadonlyArray<number> = [1, 3, 6];

/** Map a frequency cell ("Every 1 hour") to a badge cadence, or null when unknown. */
export function cadenceFromFrequency(frequency: string): ModelCadence | null {
  const match = HOURS.exec(frequency);
  if (!match) return null;
  const hours = Number(match[1]);
  return BADGE_HOURS.includes(hours) ? (`${hours}h` as ModelCadence) : null;
}

/** Split one markdown table line into trimmed cells, without the outer pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Parse the guide's markdown tables into a title, header cells and model rows.
 * The file is one static table; extra text around it is ignored.
 */
export function parseModelGuide(markdown: string): ModelGuide {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? '';
  const tableLines = lines.filter((line) => line.trim().startsWith('|'));

  const [headerLine, ...rest] = tableLines;
  if (!headerLine) return { title, headers: [], rows: [] };

  const headers = splitRow(headerLine);
  const rows = rest
    .map(splitRow)
    .filter((cells) => !cells.every((cell) => SEPARATOR_CELL.test(cell)))
    .map((cells) => ({
      model: cells[0] ?? '',
      region: cells[1] ?? '',
      frequency: cells[2] ?? '',
      cadence: cadenceFromFrequency(cells[2] ?? ''),
      notes: cells[3] ?? '',
    }));

  return { title, headers, rows };
}
