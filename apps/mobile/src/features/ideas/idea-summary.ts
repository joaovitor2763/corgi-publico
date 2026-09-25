// What one idea says at a glance, and when "agendar para depois" means. Pure: no React, no
// platform, so the list stays cheap to render and this stays testable in node.
import type { Idea } from "../../../../../packages/domain/src/agent";

export type SourceApp = "slack" | "mail" | "calendar" | "instagram" | "goal" | "memory" | "other";
export interface SourceChip {
  app: SourceApp;
  /** "Slack · #vendas · Ana · ontem" — what the chip reads. */
  label: string;
}
const APP_NAMES: Record<SourceApp, string> = {
  slack: "Slack",
  mail: "E-mail",
  calendar: "Agenda",
  instagram: "Instagram",
  goal: "Meta",
  memory: "Memória",
  other: "Fonte",
};
const DAY = 86_400_000;

/** The first sentence of the reason, cut to one readable line. */
export function whyLine(reason: string, max = 110) {
  const clean = reason.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean;
  const line = sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
  return line.replace(/[.]$/, "");
}

/** "hoje", "ontem", "há 3 d", "12 set": when a source spoke, relative to `now`. */
export function relativeDay(iso: string, now = Date.now()) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const local = (t: number) => new Date(t).toLocaleDateString("pt-BR");
  if (local(at) === local(now)) return "hoje";
  if (local(at) === local(now - DAY)) return "ontem";
  if (local(at) === local(now + DAY)) return "amanhã";
  const days = Math.round((now - at) / DAY);
  if (days > 1 && days < 7) return `há ${days} d`;
  return new Date(at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/** A source's detail as the pipeline wrote it, with machine timestamps made readable. */
export function humanizeExcerpt(excerpt: string) {
  return excerpt.replace(ISO_INSTANT, (iso) => {
    const at = Date.parse(iso);
    return Number.isNaN(at)
      ? iso
      : new Date(at).toLocaleString("pt-BR", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
  });
}

const appOf = (evidence: Idea["evidence"][number]): SourceApp => {
  const prefix = evidence.id.includes(":") ? evidence.id.split(":")[0] : "";
  if (prefix === "slack" || prefix === "calendar" || prefix === "instagram") return prefix;
  if (prefix === "mail" || evidence.kind === "mail") return "mail";
  if (prefix === "goal" || prefix === "memory") return prefix;
  if (prefix === "user" || evidence.kind === "user") return "goal";
  return "other";
};
/** "Ana <ana@acme.com>" → "Ana"; "ana@acme.com" → "ana". */
const personName = (raw: string) => {
  const name = raw
    .replace(/<[^>]*>/g, "")
    .replace(/["']/g, "")
    .trim();
  return (name || raw.split("@")[0]).slice(0, 24);
};

/**
 * Small "app · where · who · when" chips from the idea's evidence: the pipeline writes each
 * source's detail as " · "-separated facts ("slack Acme · #vendas · de ana · 2026-09-24T…").
 * Same app and person only once; at most `max` chips.
 */
/**
 * A place as a person would say it: Slack group DMs ("#mpdm-ana--bruno--caio-1") become
 * "Grupo (ana, bruno +1)"; very long channel names are shortened.
 */
export function placeLabel(place: string) {
  const group = /^#mpdm-(.+?)(?:-\d+)?$/.exec(place);
  if (group) {
    const names = (group[1] ?? "").split("--").filter(Boolean).map(personName);
    const shown = names.slice(0, 2).join(", ");
    return `Grupo (${shown}${names.length > 2 ? ` +${names.length - 2}` : ""})`;
  }
  return place.length > 28 ? `${place.slice(0, 27)}…` : place;
}

export function sourceChips(idea: Pick<Idea, "evidence" | "kind">, now = Date.now(), max = 3) {
  // One chip per app and place (channel, DM, mailbox): its people together, the latest day.
  const byPlace = new Map<
    string,
    { app: SourceChip["app"]; place?: string; people: string[]; when?: string; title?: string }
  >();
  for (const evidence of idea.evidence) {
    const app = appOf(evidence);
    const facts = evidence.excerpt.split(" · ").map((fact) => fact.trim());
    const place = facts.find((fact) => fact.startsWith("#") || fact === "DM");
    const who = facts.find((fact) => /^(de|com) /i.test(fact))?.replace(/^(de|com) /i, "");
    const when = facts.find((fact) => /^\d{4}-\d{2}-\d{2}/.test(fact))?.split(" ")[0];
    const person = who ? personName(who.split(",")[0] ?? who) : "";
    const key = `${app}:${place ?? (app === "goal" || app === "memory" ? evidence.title : person)}`;
    const entry = byPlace.get(key) ?? { app, place, people: [], when, title: evidence.title };
    if (person && !entry.people.includes(person)) entry.people.push(person);
    if (when && (!entry.when || when > entry.when)) entry.when = when;
    byPlace.set(key, entry);
  }
  const chips: SourceChip[] = [];
  for (const entry of byPlace.values()) {
    const people =
      entry.people.length > 2
        ? `${entry.people.slice(0, 2).join(", ")} +${entry.people.length - 2}`
        : entry.people.join(", ");
    const label = [
      APP_NAMES[entry.app],
      entry.place ? placeLabel(entry.place) : "",
      // A group's name already lists its people.
      entry.place?.startsWith("#mpdm-") ? "" : people,
      entry.when ? relativeDay(entry.when, now) : "",
      entry.app === "goal" || entry.app === "memory" ? (entry.title ?? "").slice(0, 28) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    chips.push({ app: entry.app, label });
    if (chips.length >= max) break;
  }
  if (!chips.length && idea.kind === "plan") chips.push({ app: "goal", label: "Meta" });
  return chips;
}

export type SnoozeChoice = "tonight" | "tomorrow" | "next-week";
export interface SnoozeOption {
  choice: SnoozeChoice;
  label: string;
  /** "hoje, 19:00" — what the row says under the label. */
  detail: string;
  until: Date;
}
const at = (base: Date, days: number, hour: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const weekday = (d: Date) => d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
const time = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** The instant one quick choice stands for: tonight 19:00, tomorrow 08:00, next Monday 08:00. */
export function snoozeUntil(choice: SnoozeChoice, now = new Date()): Date {
  if (choice === "tonight") return at(now, 0, 19);
  if (choice === "tomorrow") return at(now, 1, 8);
  return at(now, (8 - now.getDay()) % 7 || 7, 8);
}

/** The quick choices worth offering now: "Hoje à noite" only while 19:00 is still ahead. */
export function snoozeOptions(now = new Date()): SnoozeOption[] {
  const all: SnoozeChoice[] = ["tonight", "tomorrow", "next-week"];
  return all
    .map((choice) => ({ choice, until: snoozeUntil(choice, now) }))
    .filter(({ until }) => until.getTime() - now.getTime() > 15 * 60_000)
    .map(({ choice, until }) => ({
      choice,
      until,
      label:
        choice === "tonight"
          ? "Hoje à noite"
          : choice === "tomorrow"
            ? "Amanhã de manhã"
            : "Próxima semana",
      detail: `${choice === "tonight" ? "hoje" : choice === "tomorrow" ? "amanhã" : weekday(until)}, ${time(until)}`,
    }));
}

/** "Ignorada · sugerida ontem" / "Expirou · sugerida em 12 set": an archived idea's line. */
export function archiveLabel(idea: Pick<Idea, "status" | "createdAt">, now = Date.now()) {
  const state = idea.status === "expired" ? "Expirou" : "Ignorada";
  const when = relativeDay(idea.createdAt, now);
  return when ? `${state} · sugerida ${/^\d/.test(when) ? `em ${when}` : when}` : state;
}
