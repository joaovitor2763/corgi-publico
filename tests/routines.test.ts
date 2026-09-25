import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { ComposioService } from "../apps/server/src/connected-apps/composio.ts";
import { taskAutoApproves } from "../apps/server/src/routines/auto-approve.ts";
import {
  describeSchedule,
  mergeSchedule,
  nextRun,
  normalizeSchedule,
} from "../apps/server/src/routines/routines.ts";
import type { Routine } from "../packages/domain/src/agent.ts";
import type { ActionProposal } from "../packages/domain/src/index.ts";
import type { RoutineSchedule } from "../packages/domain/src/routine.ts";
import { browserFixture } from "./helpers/browser.ts";
import { type PiCall, piModelFixture } from "./helpers/pi-model.ts";

const SP = "America/Sao_Paulo";
const at = (iso: string) => new Date(iso);
const iso = (date: Date | undefined) => date?.toISOString();

test("weekly routines keep their next run (weekdays at 08:00 São Paulo)", () => {
  const weekdays = { days: [1, 2, 3, 4, 5], time: "08:00", timeZone: SP };
  // Friday 09:00 local → Monday 08:00 local (11:00Z). Records without `frequency` are weekly.
  assert.equal(iso(nextRun(weekdays, at("2026-09-25T12:00:00Z"))), "2026-09-28T11:00:00.000Z");
  assert.equal(iso(nextRun({ ...weekdays, days: [] }, at("2026-09-25T12:00:00Z"))), undefined);
  assert.equal(describeSchedule(weekdays), "Seg a sex · 08:00");
});

test("next run follows the wall clock across a DST change", () => {
  // New York springs forward on 2026-03-08: Monday 08:00 is 12:00Z after, 13:00Z before.
  const monday = { days: [1], time: "08:00", timeZone: "America/New_York" };
  assert.equal(iso(nextRun(monday, at("2026-03-07T12:00:00Z"))), "2026-03-09T12:00:00.000Z");
  assert.equal(iso(nextRun(monday, at("2026-02-28T12:00:00Z"))), "2026-03-02T13:00:00.000Z");
  // Berlin, monthly on the 1st, computed from mid-March (CET) for April (CEST): 06:00Z.
  const first = {
    frequency: "monthly" as const,
    days: [],
    dayOfMonth: 1,
    time: "08:00",
    timeZone: "Europe/Berlin",
  };
  assert.equal(iso(nextRun(first, at("2026-03-15T12:00:00Z"))), "2026-04-01T06:00:00.000Z");
});

test("monthly on a day of the month clamps to shorter months; 31 is the last day", () => {
  const day31 = {
    frequency: "monthly" as const,
    days: [],
    dayOfMonth: 31,
    time: "09:00",
    timeZone: SP,
  };
  assert.equal(iso(nextRun(day31, at("2026-02-01T12:00:00Z"))), "2026-02-28T12:00:00.000Z");
  assert.equal(iso(nextRun(day31, at("2026-02-28T12:00:00Z"))), "2026-03-31T12:00:00.000Z");
  assert.equal(iso(nextRun(day31, at("2026-04-01T12:00:00Z"))), "2026-04-30T12:00:00.000Z");
  assert.equal(describeSchedule(day31), "Último dia do mês · 09:00");
  const day30 = { ...day31, dayOfMonth: 30 };
  assert.equal(iso(nextRun(day30, at("2026-02-01T12:00:00Z"))), "2026-02-28T12:00:00.000Z");
  const day2 = { ...day31, dayOfMonth: 2 };
  // The 2nd at 09:00 has passed at 12:01Z (09:01 local): next month.
  assert.equal(iso(nextRun(day2, at("2026-09-02T12:01:00Z"))), "2026-10-02T12:00:00.000Z");
  assert.equal(iso(nextRun(day2, at("2026-09-02T11:59:00Z"))), "2026-09-02T12:00:00.000Z");
  assert.equal(describeSchedule(day2), "Todo dia 2 do mês · 09:00");
});

test("monthly on the Nth weekday, including the last one", () => {
  const secondMonday = {
    frequency: "monthly" as const,
    days: [],
    nthWeekday: { week: 2, weekday: 1 },
    time: "09:00",
    timeZone: SP,
  };
  // September 2026 starts on a Tuesday: Mondays are 7, 14, 21, 28.
  assert.equal(iso(nextRun(secondMonday, at("2026-09-10T12:00:00Z"))), "2026-09-14T12:00:00.000Z");
  assert.equal(iso(nextRun(secondMonday, at("2026-09-14T12:00:00Z"))), "2026-10-12T12:00:00.000Z");
  assert.equal(describeSchedule(secondMonday), "2ª segunda-feira do mês · 09:00");
  const lastFriday = { ...secondMonday, nthWeekday: { week: -1, weekday: 5 } };
  assert.equal(iso(nextRun(lastFriday, at("2026-09-20T12:00:00Z"))), "2026-09-25T12:00:00.000Z");
  assert.equal(iso(nextRun(lastFriday, at("2026-09-25T12:00:00Z"))), "2026-10-30T12:00:00.000Z");
  assert.equal(describeSchedule(lastFriday), "Última sexta-feira do mês · 09:00");
  assert.equal(
    describeSchedule({ ...secondMonday, nthWeekday: { week: 1, weekday: 0 } }),
    "1º domingo do mês · 09:00",
  );
});

test("quarterly runs every 3 months from the start month", () => {
  const day5 = {
    frequency: "quarterly" as const,
    days: [],
    dayOfMonth: 5,
    startMonth: 1,
    time: "09:00",
    timeZone: SP,
  };
  assert.equal(iso(nextRun(day5, at("2026-09-25T12:00:00Z"))), "2026-10-05T12:00:00.000Z");
  assert.equal(iso(nextRun(day5, at("2026-10-05T12:00:00Z"))), "2027-01-05T12:00:00.000Z");
  assert.equal(describeSchedule(day5), "Dia 5 de jan, abr, jul e out · 09:00");
  // Start month 9 (or 12, 6, 3: the same quarter grid).
  assert.equal(
    iso(nextRun({ ...day5, startMonth: 9 }, at("2026-09-25T12:00:00Z"))),
    "2026-12-05T12:00:00.000Z",
  );
  assert.equal(
    describeSchedule({ ...day5, startMonth: 12 }),
    "Dia 5 de mar, jun, set e dez · 09:00",
  );
  // The last Friday of each quarter's month.
  const lastFriday = { ...day5, dayOfMonth: undefined, nthWeekday: { week: -1, weekday: 5 } };
  assert.equal(iso(nextRun(lastFriday, at("2026-09-25T12:00:00Z"))), "2026-10-30T12:00:00.000Z");
  assert.equal(describeSchedule(lastFriday), "Última sexta-feira de jan, abr, jul e out · 09:00");
});

test("biweekly keeps the parity of the anchor week", () => {
  // Anchor Friday 2026-09-25 (week of Sep 20–26); Mondays: Oct 5, Oct 19 — not Sep 28.
  const monday = {
    frequency: "biweekly" as const,
    days: [1],
    anchor: "2026-09-25",
    time: "08:00",
    timeZone: SP,
  };
  assert.equal(iso(nextRun(monday, at("2026-09-25T12:00:00Z"))), "2026-10-05T11:00:00.000Z");
  assert.equal(iso(nextRun(monday, at("2026-10-05T11:00:00Z"))), "2026-10-19T11:00:00.000Z");
  // Created on a Sunday, the week starting that day counts: Monday is tomorrow.
  assert.equal(
    iso(nextRun({ ...monday, anchor: "2026-09-27" }, at("2026-09-27T12:00:00Z"))),
    "2026-09-28T11:00:00.000Z",
  );
  assert.equal(describeSchedule(monday), "A cada 2 semanas · Seg · 08:00");
});

test("normalizing fills the anchor and start month and refuses schedules that cannot run", () => {
  const now = at("2026-09-25T12:00:00Z");
  const biweekly = normalizeSchedule(
    { frequency: "biweekly" as const, days: [1], time: "08:00" },
    SP,
    now,
  );
  assert.equal(biweekly.anchor, "2026-09-25");
  assert.equal(biweekly.timeZone, SP);
  const quarterly = normalizeSchedule(
    { frequency: "quarterly" as const, dayOfMonth: 5, time: "08:00" },
    SP,
    now,
  );
  assert.equal(quarterly.startMonth, 9);
  assert.deepEqual(quarterly.days, [1, 2, 3, 4, 5]);
  assert.throws(
    () => normalizeSchedule({ frequency: "monthly" as const, time: "08:00" }, SP, now),
    /dia do mês/,
  );
  assert.throws(
    () =>
      normalizeSchedule(
        { frequency: "monthly" as const, nthWeekday: { week: 0, weekday: 1 }, time: "08:00" },
        SP,
        now,
      ),
    /semana do mês/,
  );
  assert.throws(
    () => normalizeSchedule({ frequency: "weekly" as const, days: [], time: "08:00" }, SP, now),
    /dia da semana/,
  );
  // Editing to the other kind of monthly rule drops the old one.
  const stored: Partial<RoutineSchedule> = {
    frequency: "monthly",
    days: [],
    dayOfMonth: 2,
    time: "09:00",
  };
  const byWeekday = mergeSchedule(stored, { nthWeekday: { week: 2, weekday: 1 } });
  assert.equal(byWeekday.dayOfMonth, undefined);
  const byDay = mergeSchedule({ ...byWeekday }, { dayOfMonth: 15 });
  assert.equal(byDay.nthWeekday, undefined);
  assert.equal(byDay.dayOfMonth, 15);
});

test("a routine's task may run only always-allowable actions on its own", () => {
  assert.equal(taskAutoApproves({ input: { autoApprove: true } }, true), true);
  assert.equal(taskAutoApproves({ input: { autoApprove: true } }, false), false);
  assert.equal(taskAutoApproves({ input: { routineId: "r" } }, true), false);
  assert.equal(taskAutoApproves(null, true), false);
});

type Reply = string | { calls: PiCall[]; text?: string };
async function setup(t: TestContext, reply: (index: number) => Reply) {
  const fixture = await piModelFixture(t, (index) => {
    const next = reply(index);
    return typeof next === "string" ? { text: next } : next;
  });
  const local = await browserFixture(t, () => ({ data: {} }));
  const server = await createApp(local.db, {
    ...local.config,
    agentBackend: "pi",
    impossiblBaseUrl: fixture.baseUrl,
  });
  t.after(() => server.agent.stop());
  return { ...fixture, ...local, ...server };
}

test("the chat tool creates weekly, biweekly, monthly and quarterly routines", async (t) => {
  const fixture = await setup(t, (index) =>
    index === 0
      ? {
          calls: [
            {
              name: "create_routine",
              arguments: { title: "Semanal", prompt: "Resumo da semana", days: [5], time: "17:00" },
            },
            {
              name: "create_routine",
              arguments: {
                title: "Quinzenal",
                prompt: "Fechar a quinzena",
                frequency: "biweekly",
                days: [1],
                time: "08:00",
              },
            },
            {
              name: "create_routine",
              arguments: {
                title: "Mensal",
                prompt: "Relatório do mês",
                frequency: "monthly",
                dayOfMonth: 2,
                time: "09:00",
                autoApprove: true,
              },
            },
            {
              name: "create_routine",
              arguments: {
                title: "Segunda segunda",
                prompt: "Reunião mensal",
                frequency: "monthly",
                nthWeekday: { week: 2, weekday: 1 },
                time: "09:00",
              },
            },
            {
              name: "create_routine",
              arguments: {
                title: "Trimestral",
                prompt: "Fechamento do trimestre",
                frequency: "quarterly",
                dayOfMonth: 5,
                startMonth: 1,
                time: "09:00",
              },
            },
          ],
        }
      : "Criei as rotinas.",
  );
  const task = await fixture.agent.createTask("owner", { prompt: "Crie as rotinas" });
  await fixture.agent.worker.tick();
  const done = await fixture.agent.getTask("owner", task.id);
  assert.equal(done.status, "succeeded", done.error ?? undefined);
  const routines = await fixture.db.list<Routine>("owner", "routines");
  const byTitle = Object.fromEntries(routines.map((r) => [r.title, r]));
  assert.equal(routines.length, 5);
  assert.equal(byTitle.Semanal?.frequency, "weekly");
  assert.equal(byTitle.Quinzenal?.frequency, "biweekly");
  assert.match(byTitle.Quinzenal?.anchor ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(byTitle.Mensal?.dayOfMonth, 2);
  assert.equal(byTitle.Mensal?.autoApprove, true);
  assert.equal(byTitle.Semanal?.autoApprove, false);
  assert.deepEqual(byTitle["Segunda segunda"]?.nthWeekday, { week: 2, weekday: 1 });
  assert.equal(byTitle.Trimestral?.startMonth, 1);
  for (const routine of routines) {
    assert.equal(routine.timeZone, "America/Sao_Paulo");
    assert.ok(Date.parse(routine.nextRunAt) > Date.now(), `${routine.title} has a next run`);
    assert.equal(nextRun(routine, new Date())?.toISOString(), routine.nextRunAt);
  }
  // The tool's schema is what the model saw.
  const tools = JSON.parse(fixture.requests[0]?.body ?? "{}") as {
    tools: { function: { name: string; parameters: { properties: Record<string, unknown> } } }[];
  };
  const schema = tools.tools.find((tool) => tool.function.name === "create_routine");
  assert.ok(schema);
  for (const field of ["frequency", "dayOfMonth", "nthWeekday", "startMonth", "autoApprove"])
    assert.ok(field in schema.function.parameters.properties, field);
});

test("an edit switching the monthly rule and a bad schedule are handled by the API", async (t) => {
  const fixture = await setup(t, () => "ok");
  const routine = await fixture.agent.createRoutine("owner", {
    title: "Mensal",
    prompt: "Relatório",
    frequency: "monthly",
    dayOfMonth: 2,
    time: "09:00",
  });
  const edited = await fixture.agent.updateRoutine("owner", routine.id, {
    nthWeekday: { week: -1, weekday: 5 },
  });
  assert.equal(edited.dayOfMonth, undefined);
  assert.equal(describeSchedule(edited), "Última sexta-feira do mês · 09:00");
  // Pausing sends only `enabled`: the schedule (and the auto-approve flag) stay as they were.
  const paused = await fixture.agent.updateRoutine("owner", routine.id, { enabled: false });
  assert.equal(paused.enabled, false);
  assert.equal(describeSchedule(paused), "Última sexta-feira do mês · 09:00");
  await assert.rejects(
    fixture.agent.createRoutine("owner", {
      title: "Sem dia",
      prompt: "x",
      frequency: "quarterly",
      time: "09:00",
    }),
    /dia do mês/,
  );
  // A stored weekly routine from before `frequency` existed still computes its next run.
  const legacy = await fixture.agent.updateRoutine("owner", routine.id, {
    frequency: "weekly",
    days: [1, 2, 3, 4, 5],
  });
  assert.equal(describeSchedule(legacy), "Seg a sex · 09:00");
});

/** A connected calendar and mailbox that never touch the network. */
function fakeComposio() {
  const inspected: string[] = [];
  const composio = {
    enabled: true,
    connections: async () => [
      { id: "ca_cal", toolkit: "googlecalendar", status: "ACTIVE" },
      { id: "ca_mail", toolkit: "gmail", status: "ACTIVE" },
    ],
    search: async () => [],
    toolIndex: async () => [],
    inspect: async (_owner: string, slug: string) => {
      inspected.push(slug);
      return {
        slug,
        toolkit: slug.startsWith("GMAIL") ? "gmail" : "googlecalendar",
        name: slug,
        description: "",
        readOnly: false,
        parameters: {},
      };
    },
    execute: async () => ({ ok: true }),
  } as unknown as ComposioService;
  return { composio, inspected };
}

test("a routine set to approve safe actions runs a create but never a send", async (t) => {
  const fixture = await setup(t, (index) =>
    index % 2 === 0
      ? {
          calls: [
            {
              name: "use_app_tool",
              arguments: {
                tool: "GOOGLECALENDAR_CREATE_EVENT",
                arguments: { summary: "Revisão" },
                summary: "Criar o evento Revisão",
              },
            },
            {
              name: "use_app_tool",
              arguments: {
                tool: "GMAIL_SEND_EMAIL",
                arguments: { to: "someone@example.com" },
                summary: "Enviar o resumo por e-mail",
              },
            },
          ],
        }
      : "Preparei o evento e o e-mail.",
  );
  const { composio, inspected } = fakeComposio();
  Object.defineProperty(fixture.agent, "composio", { value: composio });
  const routine = await fixture.agent.createRoutine("owner", {
    title: "Fechamento",
    prompt: "Crie o evento e mande o resumo",
    days: [1, 2, 3, 4, 5],
    time: "18:00",
    autoApprove: true,
  });
  const run = await fixture.agent.runRoutine("owner", routine.id);
  assert.ok(run.lastTaskId);
  const task = await fixture.agent.getTask("owner", run.lastTaskId);
  assert.equal(task.input.autoApprove, true);
  await fixture.agent.worker.tick();
  assert.deepEqual(inspected, ["GOOGLECALENDAR_CREATE_EVENT", "GMAIL_SEND_EMAIL"]);
  const actions = (await fixture.db.list<ActionProposal>("owner", "actions")).filter(
    (action) => action.taskId === task.id,
  );
  const created = actions.find((action) => action.data.tool === "GOOGLECALENDAR_CREATE_EVENT");
  const sent = actions.find((action) => action.data.tool === "GMAIL_SEND_EMAIL");
  assert.ok(created && sent);
  // Decided without the person (the execution itself goes through the real app service).
  assert.notEqual(created.status, "awaiting_review");
  assert.equal(created.alwaysAllowable, true);
  // A send always waits, whatever the routine says.
  assert.equal(sent.status, "awaiting_review");
  assert.equal(sent.alwaysAllowable, false);
  assert.equal((await fixture.agent.getTask("owner", task.id)).status, "waiting_approval");

  // The same routine without the flag: the create waits too.
  const asking = await fixture.agent.createRoutine("owner", {
    title: "Fechamento com aprovação",
    prompt: "Crie o evento e mande o resumo",
    days: [1, 2, 3, 4, 5],
    time: "18:30",
  });
  const second = await fixture.agent.runRoutine("owner", asking.id);
  await fixture.agent.worker.tick();
  const waiting = (await fixture.db.list<ActionProposal>("owner", "actions")).filter(
    (action) => action.taskId === second.lastTaskId,
  );
  assert.equal(waiting.length, 2);
  assert.ok(waiting.every((action) => action.status === "awaiting_review"));
});

test("a scheduled run never starts while the previous one is still going; 'Rodar agora' always runs", async (t) => {
  const fixture = await setup(t, () => "ok");
  const routine = await fixture.agent.createRoutine("owner", {
    title: "Report mensal",
    prompt: "Rode o report",
    frequency: "monthly",
    dayOfMonth: 2,
    time: "09:00",
  });
  await fixture.agent.runRoutine("owner", routine.id);
  const first = await fixture.db.get<Routine>("owner", "routines", routine.id);
  assert.ok(first?.lastTaskId);
  // The first run is still waiting on the person; the schedule comes due.
  await fixture.db.put("owner", "tasks", {
    ...(await fixture.agent.getTask("owner", first.lastTaskId)),
    status: "waiting_input",
  });
  await fixture.db.put("owner", "routines", { ...first, nextRunAt: new Date(0).toISOString() });
  await fixture.agent.runRoutine("owner", routine.id, true);
  const skipped = await fixture.db.get<Routine>("owner", "routines", routine.id);
  assert.equal(skipped?.lastTaskId, first.lastTaskId, "no second run on schedule");
  assert.ok(Date.parse(skipped?.nextRunAt ?? "") > Date.now(), "next run moved on");
  await fixture.agent.runRoutine("owner", routine.id);
  const manual = await fixture.db.get<Routine>("owner", "routines", routine.id);
  assert.notEqual(manual?.lastTaskId, first.lastTaskId, "Rodar agora runs anyway");
});
