// What a file card shows above its name: the first page of a PDF, the photo itself, a mini page
// with the document's first lines, or a tiny table for spreadsheets. Pure, so the rules are
// tested and the chat, the composer and the thread agree.
import { fileKind } from "./file-kind";

export type PreviewShape =
  | { kind: "page"; uri: string }
  | { kind: "image"; uri: string }
  | { kind: "table"; table: ExcerptTable }
  | { kind: "text"; text: string }
  | { kind: "none" };

export interface PreviewSource {
  name: string;
  mimeType?: string;
  url?: string;
  thumbnailUrl?: string;
  excerpt?: string;
}

export function previewOf(file: PreviewSource): PreviewShape {
  const kind = fileKind(file.name, file.mimeType);
  if (kind === "pdf") return file.thumbnailUrl ? { kind: "page", uri: file.thumbnailUrl } : NONE;
  if (kind === "image") {
    const uri = file.url || file.thumbnailUrl;
    return uri ? { kind: "image", uri } : NONE;
  }
  const excerpt = file.excerpt?.trim();
  if (!excerpt) return NONE;
  if (kind === "sheet") {
    const table = excerptTable(excerpt);
    if (table) return { kind: "table", table };
  }
  return { kind: "text", text: excerptText(excerpt) };
}

const NONE: PreviewShape = { kind: "none" };

export interface ExcerptTable {
  /** The sheet's name, when the excerpt came from a workbook ("## Vendas"). */
  sheet?: string;
  header: string[];
  rows: string[][];
}

/** One CSV line, honoring quotes ("a, b" stays one cell; "" is a quote). */
export function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

const DELIMITERS = [",", ";", "\t", "|"];

/**
 * The first rows of a spreadsheet-like excerpt as a small table, or undefined when it doesn't
 * look like one (fewer than two columns, or rows that don't agree on the column count).
 */
export function excerptTable(
  excerpt: string,
  maxRows = 6,
  maxColumns = 5,
): ExcerptTable | undefined {
  let lines = excerpt.replace(/\r\n/g, "\n").split("\n");
  let sheet: string | undefined;
  if (/^##\s+/.test(lines[0] ?? "")) {
    sheet = lines[0].replace(/^##\s+/, "").trim() || undefined;
    lines = lines.slice(1);
  }
  // One block: a blank line or the next sheet ends it.
  const end = lines.findIndex((line) => !line.trim() || /^##\s+/.test(line));
  if (end >= 0) lines = lines.slice(0, end);
  if (lines.length < 2) return undefined;
  // The last line may be cut short, so it doesn't vote on the column count.
  const sample = lines.slice(0, Math.min(6, lines.length > 2 ? lines.length - 1 : lines.length));
  const delimiter = DELIMITERS.map((d) => ({
    d,
    counts: sample.map((line) => splitCsvLine(line, d).length),
  }))
    .filter(({ counts }) => counts[0] >= 2 && counts.every((n) => n === counts[0]))
    .sort((a, b) => b.counts[0] - a.counts[0])[0]?.d;
  if (!delimiter) return undefined;
  const parsed = lines.map((line) => splitCsvLine(line, delimiter));
  const width = parsed[0].length;
  // The excerpt is cut at ~600 characters: a last row with missing cells is a fragment.
  const whole = parsed.filter((row, i) => i < parsed.length - 1 || row.length === width);
  const columns = Math.min(width, maxColumns);
  const [header, ...rows] = whole.map((row) => row.slice(0, columns));
  if (!rows.length) return undefined;
  return { ...(sheet ? { sheet } : {}), header, rows: rows.slice(0, maxRows) };
}

/** How wide each column of the mini table is, from its longest value (1 to 3 shares). */
export function columnWeights(table: ExcerptTable) {
  return table.header.map((_, c) => {
    const longest = Math.max(...[table.header, ...table.rows].map((row) => (row[c] ?? "").length));
    return Math.min(3, Math.max(1, Math.round((longest / 7) * 10) / 10));
  });
}

/** A number-like cell ("R$ 1.200", "60%", "-3,5") reads right-aligned. */
export const numeric = (value: string) => /^[-+R$\s\d.,%]+$/.test(value) && /\d/.test(value);

/** The excerpt as it reads on a small page: tidy spacing, no half-cut last word. */
export function excerptText(excerpt: string, max = 420) {
  const tidy = excerpt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (tidy.length <= max) return tidy;
  const cut = tidy.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
