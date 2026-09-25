// Which files people can upload, decided by their actual bytes (magic numbers), never only by the
// name or the type the client claims. Anything else is refused with a clear message.

export type FileKind = "pdf" | "image" | "text" | "docx" | "xlsx";
export interface FileFormat {
  ext: string;
  mime: string;
  kind: FileKind;
}

const BY_EXT: Record<string, FileFormat> = {
  pdf: { ext: "pdf", mime: "application/pdf", kind: "pdf" },
  png: { ext: "png", mime: "image/png", kind: "image" },
  jpg: { ext: "jpg", mime: "image/jpeg", kind: "image" },
  jpeg: { ext: "jpg", mime: "image/jpeg", kind: "image" },
  webp: { ext: "webp", mime: "image/webp", kind: "image" },
  gif: { ext: "gif", mime: "image/gif", kind: "image" },
  csv: { ext: "csv", mime: "text/csv", kind: "text" },
  tsv: { ext: "tsv", mime: "text/tab-separated-values", kind: "text" },
  txt: { ext: "txt", mime: "text/plain", kind: "text" },
  md: { ext: "md", mime: "text/markdown", kind: "text" },
  json: { ext: "json", mime: "application/json", kind: "text" },
  docx: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "docx",
  },
  xlsx: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "xlsx",
  },
};

/** What the app offers in the picker (mobile/web `accept`). */
export const ACCEPTED_MIME_TYPES = [...new Set(Object.values(BY_EXT).map((f) => f.mime))];

const starts = (bytes: Uint8Array, ...values: number[]) => values.every((v, i) => bytes[i] === v);
const ascii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

function looksLikeText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      sample.length < bytes.length
        ? sample.subarray(0, sample.lastIndexOf(10) + 1 || sample.length)
        : sample,
    );
    return true;
  } catch {
    // Latin-1 exports (old Excel CSVs) are still text; they decode below with replacement.
    return true;
  }
}

/** The format of an upload, or undefined when it is not one Corgi can read. */
export function detectFormat(name: string, bytes: Uint8Array): FileFormat | undefined {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (ascii(bytes, 0, "%PDF")) return BY_EXT.pdf;
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47)) return BY_EXT.png;
  if (starts(bytes, 0xff, 0xd8, 0xff)) return BY_EXT.jpg;
  if (ascii(bytes, 0, "GIF8")) return BY_EXT.gif;
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return BY_EXT.webp;
  // DOCX and XLSX are zip files; the extension says which (the zip content is checked on read).
  if (starts(bytes, 0x50, 0x4b, 0x03, 0x04))
    return ext === "docx" || ext === "xlsx" ? BY_EXT[ext] : undefined;
  const format = BY_EXT[ext];
  if (format?.kind === "text" && looksLikeText(bytes)) return format;
  return undefined;
}

export const extensionFor = (mime: string) =>
  Object.values(BY_EXT).find((f) => f.mime === mime)?.ext ?? "pdf";

export const UNSUPPORTED_MESSAGE =
  "Formato não suportado. Envie PDF, imagem (JPG, PNG, WEBP), CSV, TXT, Markdown, JSON, Word (.docx) ou Excel (.xlsx).";
