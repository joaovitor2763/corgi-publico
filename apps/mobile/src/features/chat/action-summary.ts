import type { ActionProposal, ActivityEntry } from "../../../../../packages/domain/src";
import { plainText } from "../../shared/markdown-parser";

/** Plain, human wording for reviewed actions: no raw status slugs or tool JSON in the UI. */

export type Tone = "waiting" | "running" | "done" | "declined" | "failed" | "muted";
export interface ActionState {
  label: string;
  tone: Tone;
}

const APP_NAMES: Record<string, string> = {
  googlecalendar: "Google Calendar",
  gmail: "Gmail",
  googledrive: "Google Drive",
  googledocs: "Google Docs",
  googlesheets: "Google Sheets",
  googleslides: "Google Slides",
  googlemeet: "Google Meet",
  googletasks: "Google Tasks",
  outlook: "Outlook",
  github: "GitHub",
  gitlab: "GitLab",
  hubspot: "HubSpot",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  clickup: "ClickUp",
  onedrive: "OneDrive",
};
/** "googlecalendar" → "Google Calendar", "microsoft_teams" → "Microsoft Teams". */
export function appName(toolkit: string) {
  const slug = toolkit.trim().toLowerCase();
  if (APP_NAMES[slug]) return APP_NAMES[slug];
  const google = slug.match(/^google[_-]?(.+)$/);
  const words = (google ? google[1] : slug).split(/[_\-\s]+/).filter(Boolean);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return google ? `Google ${name}` : name || toolkit;
}

const KEY_NAMES: Record<string, string> = {
  summary: "Título",
  title: "Título",
  start_datetime: "Início",
  end_datetime: "Fim",
  event_duration_minutes: "Duração (minutos)",
  event_duration_hours: "Duração (horas)",
  calendar_id: "Agenda",
  timezone: "Fuso horário",
  recipient_email: "Para",
  extra_recipients: "Também para",
  cc: "Cc",
  bcc: "Cco",
  is_html: "HTML",
  channel: "Canal",
  subject: "Assunto",
  body: "Mensagem",
  description: "Descrição",
  location: "Local",
  attendees: "Convidados",
};
/** "recipient_email" → "Para", "pageTitle" → "Page title" (other keys are humanized as-is). */
export function humanizeKey(key: string) {
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(id|url)\b/g, (w) => w.toUpperCase());
}
/** A short display value for one argument; nested values stay compact. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value) && value.every((v) => typeof v !== "object")) return value.join(", ");
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  }
  return String(value);
}
/** Key/value rows for any tool input, skipping empty values. */
export function argumentRows(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([key, value]) => ({ key, label: humanizeKey(key), value: displayValue(value) }));
}

/** Waiting reviews expire server-side lazily, so the client treats a past expiry as expired. */
export function isWaiting(action: ActionProposal, now = Date.now()) {
  return action.status === "awaiting_review" && Date.parse(action.expiresAt) > now;
}
export function actionState(action: ActionProposal, now = Date.now()): ActionState {
  if (action.status === "awaiting_review")
    return isWaiting(action, now)
      ? { label: "Aguardando você", tone: "waiting" }
      : { label: "Expirada", tone: "muted" };
  return statusState(action.status);
}
/** Maps any status slug (actions, activity entries) to a label and a tone. */
export function statusState(status: string): ActionState {
  switch (status) {
    case "awaiting_review":
      return { label: "Aguardando você", tone: "waiting" };
    case "executing":
    case "running":
      return { label: "Em andamento", tone: "running" };
    case "succeeded":
      return { label: "Feito", tone: "done" };
    case "denied":
    case "cancelled":
      return { label: "Recusada", tone: "declined" };
    case "failed":
      return { label: "Falhou", tone: "failed" };
    case "outcome_unknown":
      return { label: "Confira o resultado", tone: "failed" };
    case "expired":
      return { label: "Expirada", tone: "muted" };
    default:
      return {
        label: status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
        tone: "muted",
      };
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const pick = (data: Record<string, unknown>, ...keys: string[]) =>
  keys.map((k) => text(data[k])).find(Boolean) || "";
const list = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((v) => (typeof v === "string" ? v : text((v as { email?: unknown })?.email)))
        .filter(Boolean)
    : typeof value === "string" && value
      ? value.split(/\s*,\s*/)
      : [];

export interface EventSummary {
  title: string;
  /** "qui, 24 set · 09:00 – 09:30", or just the date for all-day events. */
  when: string;
  timeZone?: string;
  calendar?: string;
  location?: string;
  attendees: string[];
  description?: string;
}
/** Wall-clock parts of a start/end value. Naive values ("2026-09-24T09:00:00") keep their clock time. */
function clock(value: string, timeZone?: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const naive = dateOnly || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value);
  const instant = new Date(naive ? `${dateOnly ? `${value}T00:00:00` : value}Z` : value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  let zone = naive ? "UTC" : timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  return { instant, zone, dateOnly };
}
/** "qui, 24 set" (or "dom, 20 set 2025"): pt-BR parts without abbreviation dots or "de". */
function shortDay(instant: Date, options: { timeZone?: string; year?: boolean } = {}) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(options.year ? { year: "numeric" } : {}),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    (parts.find((p) => p.type === type)?.value ?? "").replace(/\.$/, "");
  const date = `${part("weekday")}, ${part("day")} ${part("month")}`;
  return options.year ? `${date} ${part("year")}` : date;
}
function formatDay(instant: Date, timeZone: string) {
  return shortDay(instant, { timeZone });
}
function formatTime(instant: Date, timeZone: string) {
  return instant.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone });
}
/** "qui, 24 set · 09:00 – 09:30" from a start plus an end or a duration. */
export function timeRange(
  start: string,
  options: { end?: string; minutes?: number; timeZone?: string },
) {
  const from = clock(start, options.timeZone);
  if (!from) return start;
  const day = formatDay(from.instant, from.zone);
  if (from.dateOnly) return day;
  let until: Date | undefined;
  let untilZone = from.zone;
  if (options.end) {
    const to = clock(options.end, options.timeZone);
    if (to) [until, untilZone] = [to.instant, to.zone];
  } else if (options.minutes && options.minutes > 0)
    until = new Date(from.instant.getTime() + options.minutes * 60_000);
  const startTime = formatTime(from.instant, from.zone);
  if (!until) return `${day} · ${startTime}`;
  const endDay = formatDay(until, untilZone);
  const endTime = formatTime(until, untilZone);
  return endDay === day
    ? `${day} · ${startTime} – ${endTime}`
    : `${day} · ${startTime} – ${endDay} · ${endTime}`;
}
const CALENDAR_TOOL = /GOOGLECALENDAR_(CREATE|UPDATE|PATCH|QUICK_ADD)/i;
/** Calendar event details from either a native calendar proposal or a Google Calendar app action. */
export function eventSummary(action: Pick<ActionProposal, "kind" | "data" | "title">) {
  const d = action.data;
  const args =
    action.kind === "app.action" && CALENDAR_TOOL.test(text(d.tool))
      ? ((d.arguments as Record<string, unknown>) ?? {})
      : action.kind === "calendar.create" || action.kind === "calendar.update"
        ? d
        : undefined;
  if (!args) return undefined;
  const timeZone = pick(args, "timezone", "timeZone", "time_zone") || undefined;
  const start = pick(args, "start_datetime", "start", "start_time");
  const minutes =
    (Number(args.event_duration_hours) || 0) * 60 + (Number(args.event_duration_minutes) || 0);
  const calendar = pick(args, "calendar_id", "calendarId");
  const description = pick(args, "description");
  const location = pick(args, "location");
  return {
    title: pick(args, "summary", "title") || text(d.summary) || action.title,
    when: start
      ? timeRange(start, { end: pick(args, "end_datetime", "end", "end_time"), minutes, timeZone })
      : "",
    timeZone,
    calendar: calendar ? (calendar === "primary" ? "Agenda principal" : calendar) : undefined,
    location: location || undefined,
    attendees: list(args.attendees),
    description: description || undefined,
  } satisfies EventSummary;
}
/** App name shown for an action: the connected app, or the built-in surface. */
export function actionApp(action: Pick<ActionProposal, "kind" | "data">) {
  if (action.kind === "app.action") return appName(text(action.data.toolkit) || "app");
  if (action.kind === "browser.checkout") return text(action.data.merchant) || "Compra";
  return action.kind.startsWith("email.") ? "Gmail" : "Google Calendar";
}
/** A single human line describing what the action does. Never raw JSON. */
export function actionSummary(action: Pick<ActionProposal, "kind" | "data" | "title">) {
  const d = action.data;
  const event = eventSummary(action);
  if (event) return [event.title, event.when].filter(Boolean).join(" · ");
  if (action.kind === "browser.checkout")
    return [text(d.summary) || action.title, text(d.total)].filter(Boolean).join(" · ");
  const args = action.kind === "app.action" ? ((d.arguments as Record<string, unknown>) ?? {}) : d;
  const subject = pick(args, "subject");
  const to = list(args.recipient_email ?? args.to ?? args.recipients)[0];
  if (subject || (to && /MAIL|email/i.test(`${text(d.tool)}${action.kind}`)))
    return [subject ? `“${subject}”` : "", to ? `para ${to}` : ""].filter(Boolean).join(" ");
  if (action.kind === "calendar.delete") return `Excluir “${text(d.title) || action.title}”`;
  return text(d.summary) || action.title;
}
/** The link a tool returned for what it created (Composio display_url or Google htmlLink). */
export function resultLink(result?: string) {
  if (!result) return undefined;
  const match = result.match(/"(?:display_url|htmlLink|webViewLink|url)"\s*:\s*"(https?:[^"]+)"/);
  return match?.[1].replace(/\\\//g, "/");
}
/** The plain outcome line shown when a tool returned only a raw payload. */
export const DONE_LINE = "Feito";
/** A short outcome line; raw tool payloads are replaced with a plain DONE_LINE. */
export function resultLine(action: Pick<ActionProposal, "status" | "result" | "error">) {
  if (action.error) return action.error.split("\n")[0];
  const raw = (action.result || "").replace(/^[A-Z0-9_]+ · /, "").trim();
  if (!raw || /^[[{]/.test(raw)) return action.status === "succeeded" ? DONE_LINE : "";
  return raw.length > 160 ? `${raw.slice(0, 159)}…` : raw;
}

/** One timeline row per action (its current state), plus standalone activity entries. */
export interface TimelineItem {
  id: string;
  date: string;
  action?: ActionProposal;
  entry?: ActivityEntry;
  /** Earlier steps for this action, oldest first. */
  history: ActivityEntry[];
}
export function timelineItems(actions: ActionProposal[], activity: ActivityEntry[]) {
  const byAction = new Map<string, ActivityEntry[]>();
  const loose: ActivityEntry[] = [];
  const known = new Set(actions.map((a) => a.id));
  for (const entry of activity) {
    if (entry.actionId && known.has(entry.actionId))
      byAction.set(entry.actionId, [...(byAction.get(entry.actionId) || []), entry]);
    else loose.push(entry);
  }
  const items: TimelineItem[] = actions.map((action) => {
    const history = (byAction.get(action.id) || []).sort((a, b) => a.date.localeCompare(b.date));
    const last = history.at(-1)?.date;
    return {
      id: action.id,
      action,
      history,
      date: last && last > action.createdAt ? last : action.createdAt,
    };
  });
  for (const entry of loose) items.push({ id: entry.id, entry, date: entry.date, history: [] });
  return items.sort((a, b) => b.date.localeCompare(a.date));
}
/** A readable step line for an action's history; tool payloads become the status label. */
export function stepDetail(entry: ActivityEntry) {
  const detail = entry.detail.replace(/^[A-Z0-9_]+ · /, "").trim();
  return !detail || /^[[{]/.test(detail) ? statusState(entry.status).label : detail;
}

const DAY = 86_400_000;
const dayKey = (date: Date) => date.toLocaleDateString("en-CA");
/** "Hoje", "Ontem", or "seg, 21 set" in the viewer's time zone. */
export function dayLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  if (dayKey(date) === dayKey(now)) return "Hoje";
  if (dayKey(date) === dayKey(new Date(now.getTime() - DAY))) return "Ontem";
  return shortDay(date, { year: date.getFullYear() !== now.getFullYear() });
}
/** "Agora mesmo", "há 5 min", "há 3 h", then the date ("21 set"). */
export function relativeTime(value: string, now = Date.now()) {
  const diff = now - new Date(value).getTime();
  if (!Number.isFinite(diff)) return value;
  if (diff < 60_000) return "Agora mesmo";
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / 3_600_000)} h`;
  return new Date(value)
    .toLocaleDateString("pt-BR", { month: "short", day: "numeric" })
    .replace(/\.$/, "")
    .replace(" de ", " ");
}
/** Groups already-sorted items under day headings, keeping order. */
export function groupByDay<T extends { date: string }>(items: T[], now = new Date()) {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.date, now);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
/** Tasks that wait on the owner and are not already represented by a pending review. */
export function waitingTasks<T extends { id: string; status: string }>(
  tasks: T[],
  actions: ActionProposal[],
  now = Date.now(),
) {
  const reviewed = new Set(actions.filter((a) => isWaiting(a, now)).map((a) => a.taskId));
  return tasks.filter(
    (t) => (t.status === "waiting_input" || t.status === "waiting_approval") && !reviewed.has(t.id),
  );
}
/** What the bell counts; the Notifications sheet lists exactly these. */
export function attentionCount(
  actions: ActionProposal[],
  tasks: { id: string; status: string }[],
  notifications: { read: boolean }[],
  now = Date.now(),
) {
  return (
    actions.filter((a) => isWaiting(a, now)).length +
    waitingTasks(tasks, actions, now).length +
    notifications.filter((n) => !n.read).length
  );
}
/** Row-sized parts: a headline and a short secondary line (event start, recipient…). */
export function actionParts(action: Pick<ActionProposal, "kind" | "data" | "title">) {
  const event = eventSummary(action);
  if (event) return { title: event.title, detail: event.when.replace(/ – .*$/, "") };
  const summary = actionSummary(action);
  const email = summary.match(/^“(.+)” para (.+)$/);
  return email ? { title: email[1], detail: `para ${email[2]}` } : { title: summary, detail: "" };
}
/** "America/Sao_Paulo" → "Horário de Sao Paulo". */
export function zoneLabel(timeZone?: string) {
  return timeZone ? `Horário de ${(timeZone.split("/").pop() || timeZone).replace(/_/g, " ")}` : "";
}

const VERBS: Record<string, string> = {
  CREATE: "criar",
  INSERT: "criar",
  ADD: "adicionar",
  SEND: "enviar",
  REPLY: "responder",
  POST: "postar",
  UPDATE: "atualizar",
  PATCH: "atualizar",
  EDIT: "editar",
  DELETE: "apagar",
  REMOVE: "remover",
  MOVE: "mover",
};
const NOUNS: Record<string, string> = {
  EVENT: "eventos",
  EMAIL: "e-mails",
  MESSAGE: "mensagens",
  DRAFT: "rascunhos",
  ISSUE: "issues",
  PAGE: "páginas",
  ROW: "linhas",
  FILE: "arquivos",
  COMMENT: "comentários",
  TASK: "tarefas",
};

/** "GOOGLECALENDAR_CREATE_EVENT" → "criar eventos", for the "always allow" line. */
export function actionPhrase(tool: string) {
  const words = tool.split("_").slice(1);
  const verb = words.map((w) => VERBS[w]).find(Boolean);
  const noun = words.map((w) => NOUNS[w]).find(Boolean);
  return verb && noun ? `${verb} ${noun}` : "fazer esta ação";
}

/** "Posso acompanhar a entrega UPS" → "Acompanhar a entrega UPS": the offer, as a task name. */
export function taskName(title: string) {
  const name = title.replace(/^posso\s+/i, "").trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * A finished task's result at a glance. New results carry a card written by the agent;
 * older ones only have text, so take the "Conclusão:" line (or the first sentence) as the
 * headline and keep the rest for details.
 */
export function resultAtAGlance(notification: {
  title: string;
  body: string;
  status?: "done" | "attention" | "blocked" | "update";
  card?: { headline: string; status: string; highlights: string[]; next: string[] };
}) {
  const subject = taskName(notification.title);
  if (notification.card && notification.status !== "attention" && notification.status !== "blocked")
    return {
      subject,
      headline: plainText(notification.card.headline),
      status: notification.card.status as "done" | "attention" | "blocked",
      highlights: notification.card.highlights.slice(0, 4).map(plainText),
      next: notification.card.next.slice(0, 3),
      details: notification.body,
    };
  const body = notification.body.trim();
  const conclusion = body.match(/conclus[ãa]o\s*:\s*(.+)/i)?.[1];
  const first = body.split(/\n+/).find((line) => line.trim() && !/:\s*$/.test(line.trim()));
  const line = plainText((conclusion ?? first ?? subject).replace(/^[•\-*\d.)\s]+/, ""));
  const headline = line.length > 120 ? `${line.slice(0, 117)}…` : line;
  // Details only when they add something beyond the headline (no echo of the same sentence).
  const rest = plainText(body).replace(line, "").trim();
  return {
    subject: subject === headline ? "" : subject,
    headline,
    // No status means an update (a watch saw a change), never a claim that work finished.
    status: notification.status ?? ("update" as const),
    highlights: [] as string[],
    next: [] as string[],
    details: rest.length > 3 ? body : "",
  };
}
