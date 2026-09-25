// How a file looks in the app: its kind (from the MIME type, else the extension), a short type
// label, a readable size and a name that fits one line. Pure, so the library, the composer and
// the thread agree and the rules are tested.

export type FileKind = "image" | "pdf" | "sheet" | "doc" | "text" | "data" | "other";

const BY_EXTENSION: Record<string, FileKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  heic: "image",
  pdf: "pdf",
  xlsx: "sheet",
  xls: "sheet",
  csv: "sheet",
  tsv: "sheet",
  docx: "doc",
  doc: "doc",
  txt: "text",
  md: "text",
  json: "data",
};

const BY_MIME: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "text/csv": "sheet",
  "text/tab-separated-values": "sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
  "text/plain": "text",
  "text/markdown": "text",
  "application/json": "data",
};

export function extensionOf(name: string) {
  const match = name.match(/\.([a-z0-9]{1,5})$/i);
  return match ? match[1].toLowerCase() : "";
}

export function fileKind(name: string, mimeType?: string): FileKind {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  return BY_MIME[mime] ?? BY_EXTENSION[extensionOf(name)] ?? "other";
}

/** The badge text: the extension people know ("PDF", "XLSX"), else the kind. */
export function typeLabel(name: string, mimeType?: string) {
  const ext = extensionOf(name);
  if (ext === "jpeg") return "JPG";
  if (ext) return ext.toUpperCase();
  return KIND_NAMES[fileKind(name, mimeType)];
}

const KIND_NAMES: Record<FileKind, string> = {
  image: "Imagem",
  pdf: "PDF",
  sheet: "Planilha",
  doc: "Documento",
  text: "Texto",
  data: "JSON",
  other: "Arquivo",
};

/** Badge colors per kind: PDF red, sheets green, docs blue, text grey, data violet. */
export const KIND_COLORS: Record<FileKind, { solid: string; tint: string }> = {
  image: { solid: "#D9822B", tint: "#FDF0DF" },
  pdf: { solid: "#D6453D", tint: "#FCEBEA" },
  sheet: { solid: "#1E8A4F", tint: "#E3F3E8" },
  doc: { solid: "#2F6FE4", tint: "#E8F0FD" },
  text: { solid: "#6B7378", tint: "#F0F2F4" },
  data: { solid: "#7657D6", tint: "#F0EEFA" },
  other: { solid: "#8A9095", tint: "#F0F2F4" },
};

/** "820 B", "240 KB", "1,4 MB" (pt-BR decimal comma). */
export function formatSize(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${(mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace(".", ",")} MB`;
}

/** Shortens a long name in the middle so the start and the extension stay readable. */
export function middleEllipsis(name: string, max = 28) {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const ext = extensionOf(name);
  const tail = Math.min(ext ? ext.length + 5 : 6, Math.floor(max / 2));
  const head = max - tail - 1;
  return `${chars.slice(0, head).join("").trimEnd()}…${chars.slice(-tail).join("").trimStart()}`;
}

export type LibraryFilter = "all" | "photos" | "pdfs" | "sheets" | "docs";

export const LIBRARY_FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "Tudo" },
  { value: "photos", label: "Fotos" },
  { value: "pdfs", label: "PDFs" },
  { value: "sheets", label: "Planilhas" },
  { value: "docs", label: "Documentos" },
];

export function inFilter(kind: FileKind, filter: LibraryFilter) {
  if (filter === "all") return true;
  if (filter === "photos") return kind === "image";
  if (filter === "pdfs") return kind === "pdf";
  if (filter === "sheets") return kind === "sheet";
  return kind === "doc" || kind === "text" || kind === "data" || kind === "other";
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Newest first, matching every word of the query (accents and case ignored) and the filter. */
export function filterFiles<T extends { name: string; mimeType?: string; createdAt: string }>(
  files: readonly T[],
  query: string,
  filter: LibraryFilter,
) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return files
    .filter((f) => inFilter(fileKind(f.name, f.mimeType), filter))
    .filter((f) => words.every((word) => fold(f.name).includes(word)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
