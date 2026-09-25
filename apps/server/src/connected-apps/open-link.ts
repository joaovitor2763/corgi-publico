// open_link: one step from a Google Docs / Sheets / Slides / Drive link (or file id) to its
// content. The model used to guess its way there (which app? which tool? which account?) and often
// gave up saying it "can't see links". Here the server finds the account that can open the file,
// exports it as text (Workspace files) or saves it to the library (PDF, Word…), and hands long
// texts to a side model that answers the question, keeping the full text pageable.
import type { AppConnection } from "./composio.ts";

export type LinkKind = "document" | "spreadsheet" | "presentation" | "file";

/** The file id and kind in a Google link; a bare id is accepted too (kind "file"). */
export function parseLink(link: string): { id: string; kind: LinkKind } | undefined {
  const text = link.trim();
  const path = text.match(
    /(?:docs|drive)\.google\.com\/(?:a\/[^/]+\/)?(document|spreadsheets|presentation|file|forms)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,})/,
  );
  if (path) {
    const kind: Record<string, LinkKind> = {
      document: "document",
      spreadsheets: "spreadsheet",
      presentation: "presentation",
    };
    return { id: path[2], kind: kind[path[1]] ?? "file" };
  }
  const query = text.match(/google\.com\/.*[?&]id=([A-Za-z0-9_-]{10,})/);
  if (query) return { id: query[1], kind: "file" };
  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return { id: text, kind: "file" };
  return undefined;
}

/** How each Google Workspace type is exported as text. */
const EXPORTS: Record<string, { mimeType: string; note?: string }> = {
  "application/vnd.google-apps.document": { mimeType: "text/plain" },
  "application/vnd.google-apps.presentation": { mimeType: "text/plain" },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "text/csv",
    note: "CSV of the first tab only. For other tabs use googlesheets tools (find_app_tools 'sheets get values').",
  },
};

/** Over this, a side model reads the text for the question instead of the main context. */
export const DOC_DIGEST_OVER = 20_000;

export interface OpenLinkDeps {
  accounts: AppConnection[];
  execute: (slug: string, args: Record<string, unknown>, accountId: string) => Promise<unknown>;
  download: (url: string) => Promise<Uint8Array>;
  saveFile?: (name: string, bytes: Uint8Array) => Promise<{ id: string; name: string }>;
  /** The side model: answers the question from a long text. */
  readDoc?: (title: string, question: string, text: string) => Promise<string>;
  /** Keeps the full text for app_result_page; returns its id. */
  keep: (text: string) => string;
  pageSize: number;
}

const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const byDefault = (a: AppConnection, b: AppConnection) =>
  Number(!!b.isDefault) - Number(!!a.isDefault);
const who = (c: AppConnection) => c.account ?? c.label ?? c.id;

export async function openLink(
  input: { link: string; question?: string; account?: string },
  deps: OpenLinkDeps,
): Promise<Record<string, unknown>> {
  const parsed = parseLink(input.link);
  if (!parsed)
    return {
      error:
        "Not a Google Docs/Sheets/Slides/Drive link or file id. For other web pages use read_web; for files the person attached use read_file.",
    };
  const wanted = input.account?.toLowerCase();
  const active = deps.accounts
    .filter((c) => c.status === "ACTIVE")
    .filter((c) => !wanted || [c.id, c.account, c.label].some((v) => v?.toLowerCase() === wanted))
    .sort(byDefault);
  const drive = active.filter((c) => c.toolkit === "googledrive");
  const docs = active.filter((c) => c.toolkit === "googledocs");
  if (!drive.length && !(parsed.kind === "document" && docs.length))
    return {
      error: wanted
        ? `No connected Google Drive account matches "${input.account}".`
        : "Google Drive isn't connected, so the file can't be opened.",
      connect: "googledrive",
      note: "Tell the person in one line to connect Google Drive in Ajustes › Apps (with the account that has access to the file).",
    };

  const tried: string[] = [];
  let content:
    | { title: string; text: string; account: string; url?: string; note?: string }
    | undefined;
  for (const account of drive) {
    tried.push(who(account));
    let meta: Record<string, unknown>;
    try {
      meta = record(
        await deps.execute("GOOGLEDRIVE_GET_FILE_METADATA", { fileId: parsed.id }, account.id),
      );
    } catch {
      continue; // This account can't see the file; try the next one.
    }
    const title = String(meta.name ?? "arquivo");
    const mime = String(meta.mimeType ?? "");
    const url = typeof meta.display_url === "string" ? meta.display_url : undefined;
    const format = EXPORTS[mime];
    if (format) {
      const exported = record(
        await deps.execute(
          "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE",
          { fileId: parsed.id, mimeType: format.mimeType },
          account.id,
        ),
      );
      const s3 = record(exported.file).s3url;
      if (typeof s3 !== "string") throw new Error("The export came back without the file.");
      const text = new TextDecoder().decode(await deps.download(s3));
      content = { title, text, account: who(account), url, note: format.note };
      break;
    }
    // PDF, Word, images…: saved to the library, read with read_file (pages, pictures, OCR).
    if (!deps.saveFile) return { title, mimeType: mime, error: "Can't save files here." };
    const downloaded = record(
      await deps.execute("GOOGLEDRIVE_DOWNLOAD_FILE", { fileId: parsed.id }, account.id),
    );
    const s3 = record(downloaded.downloaded_file_content ?? downloaded.file).s3url;
    if (typeof s3 !== "string") throw new Error("The download came back without the file.");
    const file = await deps.saveFile(title, await deps.download(s3));
    return {
      title,
      mimeType: mime,
      account: who(account),
      ...(url ? { url } : {}),
      fileId: file.id,
      note: "Saved to the person's files. Call read_file with this fileId to read it.",
    };
  }
  // Without Drive access, a Doc can still be read through Google Docs.
  if (!content && parsed.kind === "document")
    for (const account of docs) {
      tried.push(who(account));
      try {
        const doc = record(
          await deps.execute(
            "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT",
            { document_id: parsed.id },
            account.id,
          ),
        );
        if (typeof doc.plain_text !== "string") continue;
        content = {
          title: String(doc.title ?? "documento"),
          text: doc.plain_text,
          account: who(account),
        };
        break;
      } catch {}
    }
  if (!content)
    return {
      error: `None of the connected accounts can open this file (tried ${[...new Set(tried)].join(", ")}).`,
      note: "Tell the person which accounts you tried; the file may belong to another account (connect it in Ajustes › Apps) or need to be shared with one of these.",
    };

  const base = {
    title: content.title,
    account: content.account,
    ...(content.url ? { url: content.url } : {}),
    chars: content.text.length,
    ...(content.note ? { note: content.note } : {}),
  };
  if (content.text.length > DOC_DIGEST_OVER && deps.readDoc) {
    const answer = await deps
      .readDoc(content.title, input.question?.trim() || "", content.text)
      .catch(() => "");
    if (answer) {
      const resultId = deps.keep(content.text);
      return {
        ...base,
        resultId,
        pages: Math.ceil(content.text.length / deps.pageSize),
        answer,
        read_note:
          "Long document: a helper model read all of it and wrote this answer. For exact quotes or anything it left out, read the pages with app_result_page.",
      };
    }
  }
  if (content.text.length > deps.pageSize) {
    const resultId = deps.keep(content.text);
    return {
      ...base,
      resultId,
      pages: Math.ceil(content.text.length / deps.pageSize),
      text: content.text.slice(0, deps.pageSize),
      read_note: "Page 1 shown; read the rest with app_result_page.",
    };
  }
  return { ...base, text: content.text };
}
