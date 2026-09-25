import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppConnection } from "../apps/server/src/connected-apps/composio.ts";
import {
  DOC_DIGEST_OVER,
  type OpenLinkDeps,
  openLink,
  parseLink,
} from "../apps/server/src/connected-apps/open-link.ts";

const ID = "1YHLh4bBGjHwTIKkQxvY2ra_9CFvGwVK6pRoN_oIVmDM";
const account = (id: string, toolkit: string, email: string, isDefault = false): AppConnection => ({
  id,
  toolkit,
  status: "ACTIVE",
  account: email,
  isDefault,
});

test("Google links and bare ids give the file id and kind", () => {
  assert.deepEqual(parseLink(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`), {
    id: ID,
    kind: "document",
  });
  assert.deepEqual(parseLink(`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit#gid=0`), {
    id: ID,
    kind: "spreadsheet",
  });
  assert.equal(parseLink(`https://drive.google.com/file/d/${ID}/view`)?.kind, "file");
  assert.equal(parseLink(`https://drive.google.com/open?id=${ID}`)?.id, ID);
  assert.equal(parseLink(ID)?.id, ID);
  assert.equal(parseLink("https://example.com/page"), undefined);
});

function deps(overrides: Partial<OpenLinkDeps> & { canOpen: string[]; text?: string }) {
  const calls: string[] = [];
  const kept: string[] = [];
  const value: OpenLinkDeps = {
    accounts: [],
    execute: async (slug, _args, accountId) => {
      calls.push(`${slug}@${accountId}`);
      if (!overrides.canOpen.includes(accountId)) throw new Error("File not found");
      if (slug === "GOOGLEDRIVE_GET_FILE_METADATA")
        return {
          name: "Reunião - Transcript",
          mimeType: "application/vnd.google-apps.document",
          display_url: `https://docs.google.com/document/d/${ID}/edit`,
        };
      if (slug === "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE")
        return { file: { s3url: "https://files.example/export.txt" } };
      if (slug === "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT")
        return { title: "Doc", plain_text: overrides.text ?? "texto" };
      throw new Error(`unexpected ${slug}`);
    },
    download: async () => new TextEncoder().encode(overrides.text ?? "Ana: vamos fechar sexta."),
    keep: (text) => {
      kept.push(text);
      return "r1";
    },
    pageSize: 60_000,
    ...overrides,
  };
  return { value, calls, kept };
}

test("the account that can open the file is found by itself; the doc comes back as text", async () => {
  const { value, calls } = deps({
    canOpen: ["ca_work"],
    accounts: [
      account("ca_home", "googledrive", "eu@gmail.com", true),
      account("ca_work", "googledrive", "eu@empresa.com"),
    ],
  });
  const result = await openLink({ link: `https://docs.google.com/document/d/${ID}/edit` }, value);
  assert.equal(result.text, "Ana: vamos fechar sexta.");
  assert.equal(result.account, "eu@empresa.com");
  assert.equal(result.title, "Reunião - Transcript");
  assert.deepEqual(calls.slice(0, 2), [
    "GOOGLEDRIVE_GET_FILE_METADATA@ca_home",
    "GOOGLEDRIVE_GET_FILE_METADATA@ca_work",
  ]);
});

test("a long document is answered by the side model and stays readable page by page", async () => {
  const long = "fala ".repeat(DOC_DIGEST_OVER / 4);
  const asked: string[] = [];
  const { value, kept } = deps({
    canOpen: ["ca_work"],
    text: long,
    accounts: [account("ca_work", "googledrive", "eu@empresa.com")],
    readDoc: async (_title, question) => {
      asked.push(question);
      return "Decidiram fechar na sexta.";
    },
  });
  const result = await openLink({ link: ID, question: "o que ficou decidido?" }, value);
  assert.equal(result.answer, "Decidiram fechar na sexta.");
  assert.equal(result.resultId, "r1");
  assert.equal(result.text, undefined, "the long text stays out of the main context");
  assert.deepEqual(asked, ["o que ficou decidido?"]);
  assert.equal(kept[0], long);
});

test("without Drive a Doc is read through Google Docs; with nothing connected, it says what to connect", async () => {
  const { value } = deps({
    canOpen: ["ca_docs"],
    text: "conteúdo",
    accounts: [account("ca_docs", "googledocs", "eu@empresa.com")],
  });
  const viaDocs = await openLink({ link: `https://docs.google.com/document/d/${ID}/edit` }, value);
  assert.equal(viaDocs.text, "conteúdo");

  const none = await openLink({ link: `https://drive.google.com/file/d/${ID}/view` }, value);
  assert.equal(none.connect, "googledrive");

  const blocked = deps({
    canOpen: [],
    accounts: [account("ca_work", "googledrive", "eu@empresa.com")],
  });
  const denied = await openLink({ link: ID }, blocked.value);
  assert.match(String(denied.error), /eu@empresa\.com/);
});
