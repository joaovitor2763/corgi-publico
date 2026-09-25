import assert from "node:assert/strict";
import test from "node:test";
import type { ActionProposal, ActivityEntry } from "../../../packages/domain/src";
import {
  actionApp,
  actionParts,
  actionPhrase,
  actionState,
  actionSummary,
  appName,
  argumentRows,
  eventSummary,
  groupByDay,
  humanizeKey,
  relativeTime,
  resultAtAGlance,
  resultLine,
  resultLink,
  stepDetail,
  timelineItems,
  zoneLabel,
} from "../src/features/chat/action-summary";

const calendarAction = (over: Partial<ActionProposal> = {}): ActionProposal => ({
  id: "a1",
  kind: "app.action",
  title: "Criar lembrete amanhã 9h para revisar emails",
  data: {
    tool: "GOOGLECALENDAR_CREATE_EVENT",
    toolkit: "googlecalendar",
    summary: "Criar lembrete amanhã 9h para revisar emails",
    arguments: {
      summary: "Revisar meus emails",
      timezone: "America/Sao_Paulo",
      calendar_id: "primary",
      description: "Revisar emails",
      start_datetime: "2026-09-24T09:00:00",
      event_duration_minutes: 30,
    },
  },
  status: "succeeded",
  hash: "h",
  createdAt: "2026-09-23T19:27:55.421Z",
  expiresAt: "2026-09-23T19:57:55.421Z",
  ...over,
});

test("app names read like products", () => {
  assert.equal(appName("googlecalendar"), "Google Calendar");
  assert.equal(appName("gmail"), "Gmail");
  assert.equal(appName("google_maps"), "Google Maps");
  assert.equal(appName("microsoft_teams"), "Microsoft Teams");
  assert.equal(appName("github"), "GitHub");
  assert.equal(appName("notion"), "Notion");
});

test("calendar app actions summarize as title plus wall-clock time range", () => {
  const action = calendarAction();
  const event = eventSummary(action);
  assert.equal(event?.title, "Revisar meus emails");
  assert.equal(event?.when, "qui, 24 set · 09:00 – 09:30");
  assert.equal(event?.calendar, "Agenda principal");
  assert.equal(event?.description, "Revisar emails");
  assert.equal(actionSummary(action), "Revisar meus emails · qui, 24 set · 09:00 – 09:30");
  assert.equal(actionApp(action), "Google Calendar");
});

test("native calendar proposals use their end time in the event's zone", () => {
  const event = eventSummary({
    kind: "calendar.create",
    title: "Create Coffee with Jamie",
    data: {
      title: "Coffee with Jamie",
      start: "2026-09-23T18:00:00.000Z",
      end: "2026-09-23T19:00:00.000Z",
      timeZone: "America/Sao_Paulo",
      attendees: ["jamie@example.com"],
      calendarId: "primary",
    },
  });
  assert.equal(event?.when, "qua, 23 set · 15:00 – 16:00");
  assert.deepEqual(event?.attendees, ["jamie@example.com"]);
});

test("email and generic app actions get one readable line", () => {
  assert.equal(
    actionSummary({
      kind: "app.action",
      title: "Send recap",
      data: {
        toolkit: "gmail",
        tool: "GMAIL_SEND_EMAIL",
        summary: "Send recap",
        arguments: { recipient_email: "ana@example.com", subject: "Recap", body: "Hi" },
      },
    }),
    "“Recap” para ana@example.com",
  );
  assert.equal(
    actionSummary({
      kind: "app.action",
      title: "Post update",
      data: {
        toolkit: "slack",
        tool: "SLACK_SEND_MESSAGE",
        summary: "Post the weekly update",
        arguments: { channel: "#team" },
      },
    }),
    "Post the weekly update",
  );
  assert.deepEqual(
    argumentRows({ channel: "#team", markdown_text: "Hi", thread_ts: "", is_html: false }).map(
      (r) => [r.label, r.value],
    ),
    [
      ["Canal", "#team"],
      ["Markdown text", "Hi"],
      ["HTML", "Não"],
    ],
  );
  assert.equal(humanizeKey("pageId"), "Page ID");
});

test("results never surface raw JSON and expose the created item's link", () => {
  const result =
    'GOOGLECALENDAR_CREATE_EVENT · {"composio_execution_message":null,"display_url":"https://www.google.com/calendar/event?eid=abc","response_data":{"attendees":[{"email":"x';
  assert.equal(resultLink(result), "https://www.google.com/calendar/event?eid=abc");
  assert.equal(resultLine({ status: "succeeded", result }), "Feito");
  assert.equal(resultLine({ status: "failed", error: "Token revoked\nstack" }), "Token revoked");
  assert.equal(resultLine({ status: "succeeded", result: "Saved locally" }), "Saved locally");
});

test("states use plain labels and past-due reviews read as expired", () => {
  const now = Date.parse("2026-09-23T19:30:00Z");
  assert.deepEqual(actionState(calendarAction({ status: "awaiting_review" }), now), {
    label: "Aguardando você",
    tone: "waiting",
  });
  assert.equal(
    actionState(calendarAction({ status: "awaiting_review" }), now + 3_600_000).label,
    "Expirada",
  );
  assert.equal(actionState(calendarAction({ status: "denied" })).label, "Recusada");
  assert.equal(actionState(calendarAction()).label, "Feito");
});

test("an action's history collapses into one timeline row", () => {
  const entry = (
    id: string,
    date: string,
    status: string,
    detail: string,
    actionId?: string,
  ): ActivityEntry => ({
    id,
    title: "t",
    date,
    status,
    detail,
    actionId,
  });
  const items = timelineItems(
    [calendarAction()],
    [
      entry(
        "e3",
        "2026-09-23T19:28:27Z",
        "succeeded",
        'GOOGLECALENDAR_CREATE_EVENT · {"a":1',
        "a1",
      ),
      entry("e2", "2026-09-23T19:28:25Z", "executing", "Aprovada; execução iniciada", "a1"),
      entry("e1", "2026-09-23T19:27:55Z", "awaiting_review", "Pronta para sua revisão", "a1"),
      entry("e0", "2026-09-22T10:00:00Z", "succeeded", "Saved a note"),
    ],
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ["a1", "e0"],
  );
  assert.deepEqual(
    items[0].history.map((h) => h.id),
    ["e1", "e2", "e3"],
  );
  assert.equal(items[0].date, "2026-09-23T19:28:27Z");
  assert.equal(stepDetail(items[0].history[2]), "Feito");
});

test("relative times and day groups", () => {
  const now = new Date(2026, 8, 23, 18, 0);
  assert.equal(
    relativeTime(new Date(2026, 8, 23, 17, 55).toISOString(), now.getTime()),
    "há 5 min",
  );
  assert.equal(relativeTime(new Date(2026, 8, 23, 15, 0).toISOString(), now.getTime()), "há 3 h");
  const groups = groupByDay(
    [
      { date: new Date(2026, 8, 23, 17).toISOString() },
      { date: new Date(2026, 8, 23, 9).toISOString() },
      { date: new Date(2026, 8, 22, 9).toISOString() },
      { date: new Date(2026, 8, 20, 9).toISOString() },
    ],
    now,
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.length]),
    [
      ["Hoje", 2],
      ["Ontem", 1],
      ["dom, 20 set", 1],
    ],
  );
});

test("row parts split the headline from the start time", () => {
  assert.deepEqual(
    actionParts({
      kind: "app.action",
      title: "x",
      data: {
        tool: "GOOGLECALENDAR_CREATE_EVENT",
        toolkit: "googlecalendar",
        arguments: {
          summary: "Teste",
          start_datetime: "2026-09-24T10:00:00",
          event_duration_minutes: 30,
        },
      },
    }),
    { title: "Teste", detail: "qui, 24 set · 10:00" },
  );
  assert.equal(zoneLabel("America/Sao_Paulo"), "Horário de Sao Paulo");
});

test("an app action reads as a plain phrase for the always-allow line", () => {
  assert.equal(actionPhrase("GOOGLECALENDAR_CREATE_EVENT"), "criar eventos");
  assert.equal(actionPhrase("GMAIL_SEND_EMAIL"), "enviar e-mails");
  assert.equal(actionPhrase("SUPABASE_RUN_SQL"), "fazer esta ação");
});

test("a result reads as one headline: the agent's card, or the conclusion of older text", () => {
  const card = resultAtAGlance({
    title: "Posso acompanhar a entrega UPS",
    body: "full report",
    card: { headline: "Pacote liberado", status: "done", highlights: ["a", "b"], next: ["Avisar"] },
  });
  assert.equal(card.subject, "Acompanhar a entrega UPS");
  assert.equal(card.headline, "Pacote liberado");
  assert.deepEqual(card.next, ["Avisar"]);
  const legacy = resultAtAGlance({
    title: "Posso acompanhar a entrega UPS",
    body: "Rastreio UPS — verificado e-mails + site UPS:\n\n• E-mail 1: exceção\n\nConclusão: NÃO há mais pendência de fatura — já foi liberado.\n\nPróximos passos:",
  });
  assert.equal(legacy.headline, "NÃO há mais pendência de fatura — já foi liberado.");
  assert.equal(
    resultAtAGlance({ title: "X", body: "Primeira linha útil.\nOutra" }).headline,
    "Primeira linha útil.",
  );
});

test("a one-line notice says it once, and without a status it is an update, not 'done'", () => {
  const notice = resultAtAGlance({
    title: "UPS pacote 2x ao dia",
    body: "Mudou em https://ups.com: entregue",
  });
  assert.equal(notice.status, "update");
  assert.equal(notice.headline, "Mudou em https://ups.com: entregue");
  assert.equal(notice.details, "");
  assert.equal(notice.subject, "UPS pacote 2x ao dia");
  const failed = resultAtAGlance({ title: "Pausei: UPS", body: "Erro", status: "blocked" });
  assert.equal(failed.status, "blocked");
});
