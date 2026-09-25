import assert from "node:assert/strict";
import { test } from "node:test";
import { shortTitle, watchPrompt } from "../apps/server/src/agent/titles.ts";

test("tasks without a title get a short one from the request, links as their site", () => {
  assert.equal(
    shortTitle("pesquise voos pra Recife em outubro. Prefiro manhã"),
    "Pesquise voos pra Recife em outubro",
  );
  assert.equal(
    shortTitle("Abra https://pt.wikipedia.org/wiki/Muse e resuma"),
    "Abra pt.wikipedia.org e resuma",
  );
  const long = shortTitle(
    "Limpe minha agenda de amanhã movendo as reuniões internas para a semana que vem e avise todo mundo",
  );
  assert.ok(long.length <= 49 && long.endsWith("…"), long);
  assert.equal(shortTitle("  "), "Tarefa");
});

test("page watches read in Portuguese", () => {
  assert.equal(
    watchPrompt({ url: "https://www.amazon.com.br/dp/1", condition: "price_below", value: "80" }),
    "Avisar quando o preço em amazon.com.br ficar abaixo de 80",
  );
  assert.equal(
    watchPrompt({ url: "https://site.com/x", condition: "change" }),
    "Avisar quando site.com mudar",
  );
});

test("old side-chat titles made from the raw request are shortened; typed titles stay", async () => {
  const { tidyTitle } = await import("../apps/server/src/agent/tidy.ts");
  assert.equal(tidyTitle("Tarefa: Limpe minha agenda de amanhã"), "Limpe minha agenda de amanhã");
  assert.equal(
    tidyTitle("Tarefa em segundo plano: pesquisa de concorrentes"),
    "Pesquisa de concorrentes",
  );
  assert.equal(tidyTitle("Abra https://pt.wikipedia.org/wiki/Muse"), "Abra pt.wikipedia.org");
  assert.equal(tidyTitle("Viagem Recife"), "Viagem Recife");
});
