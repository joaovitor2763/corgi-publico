import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPageAsImage } from "unpdf";
import type { Artifact } from "../../../../packages/domain/src/index.ts";
import { fillPdf, inspectPdf } from "../../../../packages/integrations/src/pdf.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { type Extracted, extractContent } from "./file-content.ts";
import {
  detectFormat,
  extensionFor,
  type FileFormat,
  UNSUPPORTED_MESSAGE,
} from "./file-formats.ts";

export class Files {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {}
  async import(
    owner: string,
    name: string,
    bytes: Uint8Array,
    source: string,
    parentId?: string,
  ): Promise<Artifact> {
    if (bytes.length > 10 * 1024 * 1024)
      throw new AppError("Arquivos devem ter no máximo 10 MB", 413);
    const format = detectFormat(name, bytes);
    if (!format) throw new AppError(UNSUPPORTED_MESSAGE, 422);
    // PDFs keep their page count and form fields (the fill-a-form workflow); others have none.
    const metadata =
      format.kind === "pdf" ? await inspectPdf(bytes) : { pageCount: 0, fields: undefined };
    if (metadata.pageCount > 500) throw new AppError("PDFs devem ter no máximo 500 páginas", 422);
    const id = randomUUID();
    const safeName = Array.from(name.split(/[\\/]/).at(-1) ?? `document.${format.ext}`)
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 180);
    // Documents keep their first lines for a mini page preview in the chat.
    const excerpt =
      format.kind === "image" || format.kind === "pdf"
        ? undefined
        : await extractContent(format, bytes)
            .then((content) =>
              content.kind === "text"
                ? content.text.replace(/\s+\n/g, "\n").slice(0, 600)
                : undefined,
            )
            .catch(() => undefined);
    const artifact: Artifact = {
      id,
      ...(excerpt ? { excerpt } : {}),
      name: safeName,
      mimeType: format.mime,
      size: bytes.length,
      pageCount: metadata.pageCount,
      fields: metadata.fields,
      url: "",
      createdAt: new Date().toISOString(),
      source,
      parentId,
    };
    const directory = join(this.config.dataDir, "files");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${id}.${format.ext}`), bytes, { mode: 0o600, flag: "wx" });
    await this.db.put(owner, "files", artifact);
    return this.signed(owner, artifact);
  }
  signed(owner: string, file: Artifact): Artifact {
    const pictured = file.mimeType === "application/pdf" || file.mimeType.startsWith("image/");
    return {
      ...file,
      url: this.auth.sign(owner, `/api/files/${file.id}/content`),
      ...(pictured
        ? { thumbnailUrl: this.auth.sign(owner, `/api/files/${file.id}/thumbnail`) }
        : {}),
    };
  }
  /** A signed URL for any GET the app loads as an image (e.g. a route map). */
  signPath(owner: string, path: string) {
    return this.auth.sign(owner, path);
  }
  async signedFile(owner: string, id: string) {
    return this.signed(owner, await this.get(owner, id));
  }
  /** A PNG of a PDF's first page (cached next to the file), or the image itself. */
  async thumbnail(owner: string, id: string) {
    const file = await this.get(owner, id);
    if (file.mimeType.startsWith("image/"))
      return { mimeType: file.mimeType, bytes: await this.bytes(owner, id) };
    if (file.mimeType !== "application/pdf")
      throw new AppError("Não há pré-visualização para este arquivo", 404);
    const path = join(this.config.dataDir, "files", `${id}.thumb.png`);
    const cached = await readFile(path).catch(() => undefined);
    if (cached) return { mimeType: "image/png", bytes: cached };
    const png = await renderPageAsImage(new Uint8Array(await this.bytes(owner, id)), 1, {
      canvasImport: () => import("@napi-rs/canvas"),
      width: 600,
    }).catch(() => undefined);
    if (!png) throw new AppError("Não há pré-visualização para este arquivo", 404);
    const bytes = Buffer.from(png);
    await writeFile(path, bytes, { mode: 0o600 }).catch(() => undefined);
    return { mimeType: "image/png", bytes };
  }
  async list(owner: string) {
    return (await this.db.list<Artifact>(owner, "files")).map((file) => this.signed(owner, file));
  }
  async get(owner: string, id: string) {
    const file = await this.db.get<Artifact>(owner, "files", id);
    if (!file) throw new AppError("Arquivo não encontrado", 404);
    return file;
  }
  async bytes(owner: string, id: string) {
    const file = await this.get(owner, id);
    return readFile(join(this.config.dataDir, "files", `${id}.${extensionFor(file.mimeType)}`));
  }
  /** The file's content for the agent: text (capped) or the image itself. */
  async content(owner: string, id: string): Promise<{ file: Artifact; content: Extracted }> {
    const file = await this.get(owner, id);
    const bytes = new Uint8Array(await this.bytes(owner, id));
    const format =
      detectFormat(file.name, bytes) ??
      ({ ext: "pdf", mime: file.mimeType, kind: "pdf" } as FileFormat);
    return { file, content: await extractContent(format, bytes) };
  }
  async fill(owner: string, id: string, values: Record<string, string | boolean>) {
    const file = await this.get(owner, id);
    if (file.mimeType !== "application/pdf")
      throw new AppError("Só é possível preencher formulários em PDF", 422);
    const bytes = await this.bytes(owner, id);
    const output = await fillPdf(bytes, values);
    return this.import(
      owner,
      `${file.name.replace(/\.pdf$/i, "")} — filled.pdf`,
      output,
      `Filled from ${file.name}`,
      id,
    );
  }
}
