#!/usr/bin/env node
// First run: creates .env from .env.example, generates the random secrets, and asks for the keys
// only you have (Impossibl, optionally Composio). Safe to run again: it never replaces a value
// that is already set. Keys you type are written to .env only (never printed back).
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const ENV = ".env";
if (!existsSync(ENV)) {
  copyFileSync(".env.example", ENV);
  console.log("✓ .env criado a partir de .env.example");
}
let text = readFileSync(ENV, "utf8");

const get = (name) => text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
function set(name, value) {
  const line = `${name}=${value}`;
  text = new RegExp(`^#?\\s*${name}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^#?\\s*${name}=.*$`, "m"), line)
    : `${text.trimEnd()}\n${line}\n`;
}

const generated = {
  OPENMUSE_ACCESS_KEY: () => randomBytes(30).toString("base64url"),
  TOKEN_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
  WORKER_TOKEN: () => randomBytes(24).toString("hex"),
};
const made = [];
for (const [name, make] of Object.entries(generated))
  if (!get(name)) {
    set(name, make());
    made.push(name);
  }
if (made.length) console.log(`✓ Gerados: ${made.join(", ")}`);

if (process.stdin.isTTY) {
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  if (!get("IMPOSSIBL_API_KEY")) {
    const key = (
      await ask.question("Chave da Impossibl (modelos do Corgi; Enter para pular): ")
    ).trim();
    if (key) set("IMPOSSIBL_API_KEY", key);
  }
  if (!get("COMPOSIO_API_KEY")) {
    const key = (
      await ask.question("Chave do Composio (Gmail, Slack, Notion…; opcional, Enter para pular): ")
    ).trim();
    if (key) set("COMPOSIO_API_KEY", key);
  }
  ask.close();
}
writeFileSync(ENV, text, { mode: 0o600 });

const missing = ["IMPOSSIBL_API_KEY"].filter((name) => !get(name));
const optional = ["COMPOSIO_API_KEY"].filter((name) => !get(name));
console.log(`
${missing.length ? `⚠ Falta: ${missing.join(", ")} (edite .env)` : "✓ Chaves essenciais prontas"}${optional.length ? `\n· Opcional, sem configurar: ${optional.join(", ")}` : ""}

Sua chave de acesso ao app (guarde; o app pede na primeira vez):
  ${get("OPENMUSE_ACCESS_KEY")}

Próximos passos:
  pnpm dev            # API em http://localhost:8787
  pnpm dev:browser    # navegador do assistente (outro terminal)
  pnpm dev:web        # o app em http://localhost:8081 (outro terminal)
Para rodar 24/7 numa VPS ou Mac mini: docs/DEPLOY.md
`);
