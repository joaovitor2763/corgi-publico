import assert from "node:assert/strict";
import test from "node:test";
import { stepLabel } from "../apps/server/src/agent/step-label.ts";

test("task steps read as what the agent did, in Portuguese", () => {
  assert.equal(
    stepLabel("use_app_tool", { tool: "GMAIL_FETCH_EMAILS", summary: "Buscar alertas da Lovable" }),
    "Gmail: Buscar alertas da Lovable",
  );
  assert.equal(
    stepLabel("use_app_tool", { tool: "GOOGLECALENDAR_EVENTS_LIST" }),
    "Google Calendar: events list",
  );
  assert.equal(
    stepLabel("find_app_tools", { query: "api key", app: "gmail" }),
    "Procurando nos apps (gmail): api key",
  );
  assert.equal(stepLabel("read_web", { url: "https://www.ups.com/track" }), "Lendo ups.com");
  assert.equal(stepLabel("finish_task"), "Concluindo");
  assert.equal(
    stepLabel("create_routine", { title: "Briefing da manhã" }),
    "Criando a rotina “Briefing da manhã”",
  );
  assert.equal(stepLabel("create_routine"), "Criando a rotina");
  assert.equal(stepLabel("some_new_tool"), "Some new tool");
});
