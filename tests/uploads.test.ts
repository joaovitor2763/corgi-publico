import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/platform/config.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";
import type { Files } from "../apps/server/src/platform/files.ts";
import { readFileForAgent } from "../apps/server/src/platform/read-file-tool.ts";

// The person attaches everyday files in the chat; the agent reads their content.
let db: Store;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let files: Files;
let token: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "corgi-uploads-"));
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  ({ app, files } = await createApp(db, config, { webAppDir: "" }));
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = (await session.json()).token;
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

async function upload(name: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append("file", new File([Buffer.from(bytes)], name));
  return app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function pdfWithText(text: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText(text, { x: 50, y: 700, size: 14, font });
  return pdf.save();
}

// 1×1 transparent PNG.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const cases: [string, () => Promise<Uint8Array>, string, RegExp | "image"][] = [
  ["relatorio.pdf", () => pdfWithText("Receita de setembro: 42 mil"), "application/pdf", /42 mil/],
  [
    "vendas.csv",
    async () => new TextEncoder().encode("produto,receita\nScale,42000\n"),
    "text/csv",
    /Scale,42000/,
  ],
  [
    "notas.md",
    async () => new TextEncoder().encode("# Pauta\n- Diretoria"),
    "text/markdown",
    /Diretoria/,
  ],
  [
    "contrato.docx",
    async () => new Uint8Array(await readFile("tests/fixtures/sample.docx")),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    /R\$ 1\.234,56/,
  ],
  [
    "vendas.xlsx",
    async () => new Uint8Array(await readFile("tests/fixtures/sample.xlsx")),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    /## Vendas\nProduto,Receita\nScale,42000/,
  ],
  ["foto.png", async () => PNG, "image/png", "image"],
];

for (const [name, make, mime, expected] of cases)
  test(`uploads ${name} and the agent reads it`, async () => {
    const response = await upload(name, await make());
    assert.equal(response.status, 201, await response.clone().text());
    const file = await response.json();
    assert.equal(file.mimeType, mime);
    const read = await readFileForAgent(files, "local-user", file.id);
    if (expected === "image") {
      assert.equal(read.kind, "image");
      assert.equal(read.kind === "image" && read.mimeType, "image/png");
    } else {
      assert.equal(read.kind, "text");
      assert.match(read.kind === "text" ? read.text : "", expected);
    }
    const signed = new URL(file.url);
    const content = await app.request(`${signed.pathname}${signed.search}`);
    assert.equal(content.status, 200);
    assert.doesNotMatch(content.headers.get("content-type") ?? "", /html/);
  });

test("files that are not what they claim, or unsupported, are refused", async () => {
  const fake = await upload("virus.pdf", new TextEncoder().encode("MZ\u0000\u0000not a pdf"));
  assert.equal(fake.status, 422);
  assert.match(JSON.stringify(await fake.json()), /Formato não suportado/);
  const zip = await upload("coisas.zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
  assert.equal(zip.status, 422);
});

test("a scanned PDF reaches the model as page pictures, and gets a first-page thumbnail", async () => {
  const bytes = new Uint8Array(await readFile(new URL("./fixtures/scanned.pdf", import.meta.url)));
  const response = await upload("recibo-escaneado.pdf", bytes);
  assert.equal(response.status, 201, await response.clone().text());
  const file = await response.json();
  const read = await readFileForAgent(files, "local-user", file.id);
  assert.equal(read.kind, "images");
  assert.equal(read.kind === "images" && read.images.length, 1);
  assert.match(String(read.result.note), /Scanned PDF/);
  const thumb = new URL(file.thumbnailUrl);
  const picture = await app.request(`${thumb.pathname}${thumb.search}`);
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get("content-type"), "image/png");
});
