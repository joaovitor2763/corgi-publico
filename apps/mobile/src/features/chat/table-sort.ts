// Tables in a structured answer: reading the numbers hidden in cell labels ("R$ 420 mil", "84%",
// "(-16%)"), so a column sorts by value, and sizing columns without measuring text.

const NEGATIVE = /^[\s(]*[-−▼↓]/;
const PREFIX = /^[\s(+\-−▼▲↑↓]*(?:R\$|US\$|U\$|\$|€|£|~|≈)?\s*/;
const NUMBER = /^(\d[\d.,]*)(?:\s*(mil|k|mi|mm|milh(?:ão|ões)|m|bi|bilh(?:ão|ões)|b)\b)?/i;
const SCALE: Record<string, number> = {
  mil: 1e3,
  k: 1e3,
  mi: 1e6,
  mm: 1e6,
  m: 1e6,
  milhão: 1e6,
  milhões: 1e6,
  bi: 1e9,
  b: 1e9,
  bilhão: 1e9,
  bilhões: 1e9,
};

/** "1.234,56" → 1234.56; "1,234" → 1234; "1,5" → 1.5; "1.234" → 1234. */
function digits(raw: string) {
  const dot = raw.lastIndexOf(".");
  const comma = raw.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    const decimal = Math.max(dot, comma);
    const whole = raw.slice(0, decimal).replace(/[.,]/g, "");
    return Number(`${whole}.${raw.slice(decimal + 1)}`);
  }
  const separator = dot >= 0 ? "." : comma >= 0 ? "," : "";
  if (!separator) return Number(raw);
  const parts = raw.split(separator);
  // One separator followed by exactly three digits reads as thousands ("1.234", "12,500").
  const thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
  return thousands ? Number(parts.join("")) : Number(parts.join("."));
}

/**
 * The number a cell starts with, scaled by its unit, negative when signed or in parentheses:
 * "R$ 420 mil" → 420000, "84%" → 84, "(-16%)" → -16, "US$10/membro/mês" → 10, "▲ 1.234,5" → 1234.5.
 * Dates become sortable ordinals ("12/09/2025" → 20250912). Text ("Sala 8") is undefined.
 */
export function numberOf(text: string): number | undefined {
  const value = text.trim();
  if (!value) return undefined;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return Number(`${iso[1]}${iso[2]}${iso[3]}`);
  const br = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (br) {
    const year = br[3] ? (br[3].length === 2 ? `20${br[3]}` : br[3]) : "0000";
    return Number(`${year}${br[2].padStart(2, "0")}${br[1].padStart(2, "0")}`);
  }
  const rest = value.replace(PREFIX, "");
  const m = rest.match(NUMBER);
  if (!m) return undefined;
  const base = digits(m[1]);
  if (Number.isNaN(base)) return undefined;
  const scale = m[2] ? (SCALE[m[2].toLowerCase()] ?? 1) : 1;
  return NEGATIVE.test(value) ? -base * scale : base * scale;
}

export type ColumnKind = "number" | "text";

/** A column reads as numbers when most of its filled cells do; those sort by value and align right. */
export function columnKind(cells: string[]): ColumnKind {
  const filled = cells.filter((cell) => cell.trim());
  if (!filled.length) return "text";
  const numeric = filled.filter((cell) => numberOf(cell) !== undefined).length;
  return numeric >= filled.length * 0.6 ? "number" : "text";
}

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

export type SortDirection = "asc" | "desc";

/** Rows ordered by one column: numbers by value (blanks last), text alphabetically; stable. */
export function sortRows<T extends { cells: string[] }>(
  rows: T[],
  column: number,
  direction: SortDirection,
  kind: ColumnKind = columnKind(rows.map((row) => row.cells[column] ?? "")),
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, cell: row.cells[column] ?? "" }))
    .sort((a, b) => {
      if (kind === "number") {
        const x = numberOf(a.cell);
        const y = numberOf(b.cell);
        if (x === undefined && y === undefined) return a.index - b.index;
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return (x - y) * sign || a.index - b.index;
      }
      if (!a.cell.trim() && b.cell.trim()) return 1;
      if (a.cell.trim() && !b.cell.trim()) return -1;
      return collator.compare(a.cell, b.cell) * sign || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Tap a header once for ascending, again for descending, a third time to restore the order. */
export function nextSort(
  current: { column: number; direction: SortDirection } | undefined,
  column: number,
): { column: number; direction: SortDirection } | undefined {
  if (current?.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : undefined;
}

export const CELL_FONT = 14;
export const CELL_PAD = 5;
const MAX_LINES = 3;
/** Text columns give up at most this share of their width (wrapping) before the table scrolls. */
const SQUEEZE = 0.3;
/** Room kept for the "+N" pill that stands for the columns a preview leaves out. */
const MORE_PILL = 44;

/**
 * Text width at CELL_FONT without measuring: glyph classes, calibrated on the system font (SF /
 * Segoe / Roboto are close), tell a price that fits on one line from a sentence that wraps.
 * Digits count at their tabular width, which is how numeric cells render.
 */
export function textWidth(text: string, bold = false) {
  let width = 0;
  for (const ch of text) {
    width += /[ijl|]/.test(ch)
      ? 3.4
      : /[!.,:;'` ]/.test(ch)
        ? 4
        : /[tfI/]/.test(ch)
          ? 4.8
          : /[r()]/.test(ch)
            ? 5.3
            : /[-–]/.test(ch)
              ? 6.5
              : /[mM]/.test(ch)
                ? 12.1
                : /[wW@%]/.test(ch)
                  ? 12.9
                  : /[\d$€£+−=<>~]/.test(ch)
                    ? 8.7
                    : /[A-ZÀ-Ý]/.test(ch)
                      ? 9.3
                      : 7.6;
  }
  return width * (bold ? 1.05 : 1);
}

export interface TableLayout {
  /** Widths of the columns shown, in px; they sum to the available width when `fits`. */
  widths: number[];
  /** True when the columns shown sit side by side (no sideways scroll). */
  fits: boolean;
  /** Font size: 13 when that is what makes four columns fit a phone, else CELL_FONT. */
  font: number;
  /** Columns left out (preview only): the table shows the first ones and says "+N". */
  hidden: number;
  /** Lines of text each row needs, at most MAX_LINES, so pinned and scrolling cells align. */
  lines: number[];
  kinds: ColumnKind[];
  /** Numbers align right, unless the column wraps (a price with a unit after it reads left). */
  align: ("left" | "right")[];
}

/**
 * Column widths from the longest text each column holds: enough for short values on one line,
 * long text wrapping up to three lines. Side by side, numbers keep their natural width and text
 * columns stretch or squeeze (they wrap) to fill the space, at 14px or, for up to four columns,
 * 13px. A `preview` that still doesn't fit shows only the leading columns that do, plus "+N";
 * the full table instead pins the first column and scrolls the rest at natural widths.
 */
export function layoutTable(
  rows: { cells: string[] }[],
  columns: string[],
  available: number,
  preview = false,
): TableLayout {
  const count = Math.max(columns.length, ...rows.map((row) => row.cells.length), 1);
  const kinds = Array.from({ length: count }, (_, column) =>
    columnKind(rows.map((row) => row.cells[column] ?? "")),
  );
  const minsAt = (scale: number) =>
    kinds.map((kind, column) =>
      Math.round((column === 0 ? 68 : kind === "number" ? 52 : 64) * scale),
    );
  const text = Array.from({ length: count }, (_, column) =>
    Math.max(
      textWidth(columns[column] ?? "", true) * 0.9,
      ...rows.map((row) => textWidth(row.cells[column] ?? "", column === 0)),
    ),
  );
  const naturalAt = (scale: number) =>
    text.map((width, column) =>
      Math.min(
        column === 0 ? 150 : 200,
        Math.max(minsAt(scale)[column], Math.ceil(width * scale + 1 + CELL_PAD * 2)),
      ),
    );
  /** The first `shown` columns side by side in `room` px, or undefined when they can't be. */
  const sideBySide = (natural: number[], shown: number, room: number, scale = 1) => {
    const mins = minsAt(scale);
    const head = natural.slice(0, shown);
    const fixed = head.reduce((sum, w, i) => sum + (kinds[i] === "number" ? w : 0), 0);
    const flexible = head.reduce((sum, w, i) => sum + (kinds[i] === "number" ? 0 : w), 0);
    const left = room - fixed;
    if (!flexible) return fixed <= room ? head.map((w) => (w / fixed) * room) : undefined;
    const minimum = mins
      .slice(0, shown)
      .reduce((sum, m, i) => sum + (kinds[i] === "number" ? 0 : m), 0);
    if (left < minimum || left < flexible * (1 - SQUEEZE)) return undefined;
    return head.map((w, i) => (kinds[i] === "number" ? w : (w / flexible) * left));
  };
  let font = CELL_FONT;
  let shown = count;
  let widths = available > 0 ? sideBySide(naturalAt(1), count, available) : undefined;
  if (!widths && available > 0 && count <= 4) {
    widths = sideBySide(naturalAt(13 / CELL_FONT), count, available, 13 / CELL_FONT);
    if (widths) font = 13;
  }
  if (!widths && available > 0 && preview) {
    for (shown = count - 1; shown >= 1 && !widths; shown--)
      widths = sideBySide(naturalAt(1), shown, available - MORE_PILL);
    shown++;
  }
  const fits = !!widths;
  if (!widths) {
    shown = count;
    widths = naturalAt(1);
  }
  const scale = font / CELL_FONT;
  const linesOf = (value: string, column: number) => {
    const room = Math.max(20, (widths[column] ?? 100) - CELL_PAD * 2);
    return Math.min(
      MAX_LINES,
      Math.max(1, Math.ceil((textWidth(value, column === 0) * scale) / room)),
    );
  };
  const lines = rows.map((row) =>
    Math.max(1, ...row.cells.slice(0, shown).map((cell, column) => linesOf(cell, column))),
  );
  const align = kinds.map((kind, column) =>
    kind === "number" &&
    column < shown &&
    rows.every((row) => linesOf(row.cells[column] ?? "", column) <= 1)
      ? "right"
      : "left",
  );
  return { widths, fits, font, hidden: count - shown, lines, kinds, align };
}
