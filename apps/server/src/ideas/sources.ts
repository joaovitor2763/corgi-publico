// What Corgi looks at to suggest ideas: which apps, which accounts, and what slice of each
// (Slack channels, DMs and mentions; a Gmail search; Instagram DMs). Chosen by the person in
// Ideias → Fontes; with nothing chosen yet, every calendar and Gmail account (the old default).
import { z } from "zod";
import type { Store } from "../platform/db.ts";

export const SCANNABLE = {
  googlecalendar: { name: "Google Agenda", detail: "Eventos dos próximos 3 dias" },
  gmail: { name: "Gmail", detail: "E-mails dos últimos 4 dias (ou a busca que você definir)" },
  slack: { name: "Slack", detail: "Menções, DMs e os canais que você escolher" },
  instagram: { name: "Instagram", detail: "DMs recentes (conta Business ou Creator)" },
} as const;
export type ScannableApp = keyof typeof SCANNABLE;

export const ideaSourceSchema = z.object({
  app: z.enum(Object.keys(SCANNABLE) as [ScannableApp, ...ScannableApp[]]),
  /** A connected account id; omitted = every account of the app. */
  account: z.string().max(100).optional(),
  enabled: z.boolean().default(true),
  /** What the person asked for in their words; the filters below were made from it. */
  note: z.string().trim().max(300).optional(),
  /** Gmail: a search (Gmail operators), replaces the default inbox query. */
  query: z.string().trim().max(300).optional(),
  /** Slack: channels to watch by name ("vendas", "#diretoria"). */
  channels: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  /** Slack: include messages that mention the person / DMs to them. */
  mentions: z.boolean().optional(),
  dms: z.boolean().optional(),
});
export type IdeaSource = z.infer<typeof ideaSourceSchema>;
export const ideaSourcesSchema = z.object({ sources: z.array(ideaSourceSchema).max(40) });

const KEY = "idea-sources";

export async function loadIdeaSources(db: Store, owner: string): Promise<IdeaSource[] | undefined> {
  const saved = await db.get<{ id: string; sources: IdeaSource[] }>(owner, "agent-settings", KEY);
  return saved?.sources;
}

export async function saveIdeaSources(db: Store, owner: string, raw: unknown) {
  const { sources } = ideaSourcesSchema.parse(raw);
  const clean = sources.map((source) => ({
    ...source,
    channels: source.channels?.map((c) => c.replace(/^#/, "").toLowerCase()),
  }));
  await db.put(owner, "agent-settings", { id: KEY, sources: clean });
  return clean;
}

/** Without a saved choice: every connected calendar and Gmail account, as before. */
export function defaultIdeaSources(connected: Set<string>): IdeaSource[] {
  return (["googlecalendar", "gmail"] as const)
    .filter((app) => connected.has(app))
    .map((app) => ({ app, enabled: true }));
}
