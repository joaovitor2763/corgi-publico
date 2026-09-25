// Turns an uploaded file into something the model can use: text (PDF, Word, spreadsheets, plain
// text) or the image itself. Output is capped so one file never floods the conversation.
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import type { FileFormat } from "./file-formats.ts";

export const TEXT_LIMIT = 30_000;

export type Extracted =
  | { kind: "text"; text: string; truncated: boolean; pages?: number; sheets?: string[] }
  | { kind: "image"; data: string; mimeType: string }
  /** A scanned PDF: its first pages as pictures, for a model that can see. */
  | { kind: "pages"; images: { data: string; mimeType: string }[]; pages: number };

/** Pages a scanned PDF sends as pictures (each ~1.5k tokens). */
const SCANNED_PAGES = 8;

const cap = (text: string) => {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: clean.slice(0, TEXT_LIMIT), truncated: clean.length > TEXT_LIMIT };
};

function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

/** A spreadsheet as CSV-like text, one block per sheet. */
function sheetText(name: string, rows: unknown[][]) {
  const cell = (value: unknown) => {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `## ${name}\n${rows.map((row) => row.map(cell).join(",")).join("\n")}`;
}

export async function extractContent(format: FileFormat, bytes: Uint8Array): Promise<Extracted> {
  switch (format.kind) {
    case "image":
      return { kind: "image", data: Buffer.from(bytes).toString("base64"), mimeType: format.mime };
    case "text":
      return { kind: "text", ...cap(decodeText(bytes)) };
    case "pdf": {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      const joined = text.map((page, i) => `--- página ${i + 1} ---\n${page}`).join("\n\n");
      // Almost no selectable text: a scan or a photo of paper. Send the pages as pictures.
      const letters = text.join("").replace(/\s+/g, "").length;
      if (letters < 10 * totalPages) {
        const images: { data: string; mimeType: string }[] = [];
        for (let page = 1; page <= Math.min(totalPages, SCANNED_PAGES); page++) {
          const png = await renderPageAsImage(new Uint8Array(bytes), page, {
            canvasImport: () => import("@napi-rs/canvas"),
            width: 1400,
          }).catch(() => undefined);
          if (png)
            images.push({ data: Buffer.from(png).toString("base64"), mimeType: "image/png" });
        }
        if (images.length) return { kind: "pages", images, pages: totalPages };
      }
      return {
        kind: "text",
        ...cap(joined.trim() ? joined : "(PDF sem texto selecionável: provavelmente escaneado.)"),
        pages: totalPages,
      };
    }
    case "docx": {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { kind: "text", ...cap(value) };
    }
    case "xlsx": {
      const sheets = await readXlsxFile(Buffer.from(bytes));
      return {
        kind: "text",
        ...cap(sheets.map((s) => sheetText(s.sheet, s.data as unknown[][])).join("\n\n")),
        sheets: sheets.map((s) => s.sheet),
      };
    }
  }
}
