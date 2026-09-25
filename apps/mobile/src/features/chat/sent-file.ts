// Tool results that carry files: send_file (the agent shows a file as a card) and run_python
// (files the script produced). Results arrive as JSON strings or objects; anything malformed
// renders nothing rather than a broken card.

export interface SentFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  pageCount: number;
  url: string;
  thumbnailUrl?: string;
  excerpt?: string;
}

function parse(result: unknown): unknown {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function sentFileOf(result: unknown): { caption?: string; file: SentFile } | undefined {
  const value = parse(result);
  if (!isRecord(value) || !isRecord(value.file)) return undefined;
  const f = value.file;
  const id = str(f.id);
  const name = str(f.name);
  if (!id || !name) return undefined;
  const caption = str(value.caption)?.trim();
  return {
    ...(caption ? { caption } : {}),
    file: {
      id,
      name,
      mimeType: str(f.mimeType) ?? "",
      size: num(f.size),
      pageCount: num(f.pageCount),
      url: str(f.url) ?? "",
      ...(str(f.thumbnailUrl) ? { thumbnailUrl: str(f.thumbnailUrl) } : {}),
      ...(str(f.excerpt) ? { excerpt: str(f.excerpt) } : {}),
    },
  };
}

/** The files a run_python call produced: `{ files: [{ fileId, name, type, size }] }`. */
export function pythonFilesOf(result: unknown) {
  const value = parse(result);
  if (!isRecord(value) || !Array.isArray(value.files)) return [];
  return value.files.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = str(item.fileId);
    const name = str(item.name);
    return id && name ? [{ id, name, mimeType: str(item.type) ?? "", size: num(item.size) }] : [];
  });
}
