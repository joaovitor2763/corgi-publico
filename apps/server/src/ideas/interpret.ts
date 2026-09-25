// "Fontes das ideias" in plain words: the person writes what they want watched ("e-mails de
// clientes, sem newsletters"; "vendas e diretoria, e quando me marcarem") and a model turns it
// into the real filter: a Gmail search, or Slack channels (picked from the workspace's real
// channel names) and mention/DM switches. The result is shown to the person before saving.
import { z } from "zod";

export type Complete = (prompt: string) => Promise<string>;

const gmailResult = z.object({ query: z.string().trim().min(1).max(300) });
const slackResult = z.object({
  channels: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  mentions: z.boolean().default(true),
  dms: z.boolean().default(true),
});

/** The first {...} in a model reply (models like to wrap JSON in prose or code fences). */
function json(reply: string): unknown {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON");
  return JSON.parse(match[0]);
}

export async function interpretGmail(text: string, complete: Complete) {
  const reply =
    await complete(`Turn this request into ONE Gmail search query (Gmail operators: from:, to:, subject:, has:attachment, is:important, is:unread, category:, label:, newer_than:, OR, parentheses, - to exclude). It picks the e-mails an assistant should look at to suggest what to do next. Keep it reasonably broad; default to recent mail (newer_than:4d) when no period is said; exclude promotions/social unless asked. Never invent senders: use from:/to: only with a name, e-mail or domain the person wrote. For groups or topics (clientes, financeiro, contratos) use words that appear in such e-mails (OR'd, in Portuguese, with accents when natural) and signals like is:important, has:attachment; 'que pedem resposta' → is:inbox -from:me (and is:unread only if they said unread).
Request (pt-BR): """${text}"""
Answer with JSON only: {"query": "..."}`);
  return gmailResult.parse(json(reply));
}

export async function interpretSlack(text: string, channels: string[], complete: Complete) {
  const reply =
    await complete(`Turn this request into which Slack messages an assistant should watch. Choose channels ONLY from the list (exact names, without #); pick every channel that clearly matches the request (by topic or name), none if the request doesn't mention channels. mentions = messages that mention the person; dms = direct messages to them. Keep mentions and dms true unless the request says otherwise.
Request (pt-BR): """${text}"""
Channels: ${channels.slice(0, 400).join(", ") || "(unknown)"}
Answer with JSON only: {"channels": ["..."], "mentions": true, "dms": true}`);
  const parsed = slackResult.parse(json(reply));
  const known = new Set(channels.map((c) => c.toLowerCase()));
  // Only real channels survive (the model never gets to invent one).
  const picked = parsed.channels
    .map((c) => c.replace(/^#/, "").toLowerCase())
    .filter((c) => !known.size || known.has(c));
  return { ...parsed, channels: [...new Set(picked)] };
}
