// Skills: reusable recipes the person invokes with @name in the chat ("@ads da semana"). Each one
// is instructions for the agent plus the apps it works best with. Built-ins ship with Corgi; the
// person (or the agent, when asked) saves their own. Invoking one adds its instructions to that
// turn's context; nothing else changes (approvals, trust guard and tools stay the same).
import { z } from "zod";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";

export interface Skill {
  /** What follows the @, lowercase: "ads", "post-linkedin". */
  name: string;
  /** Short title shown in the @ picker (pt-BR). */
  title: string;
  /** One line for the picker (pt-BR). */
  description: string;
  /** For the model: what to do, which tools, what shape to answer in. */
  instructions: string;
  /** Catalog app slugs it works best with (suggest connecting when missing). */
  apps: string[];
  builtIn?: boolean;
  createdAt?: string;
}

const SHAPES =
  "Use the right answer elements: stats for key figures, table for comparisons, timeline for time-ordered things, text for the rest. Every derived number comes from calculate.";

export const BUILT_IN_SKILLS: Skill[] = [
  {
    name: "briefing",
    title: "Resumo do dia",
    description: "Agenda, e-mails e Slack que importam hoje",
    apps: ["googlecalendar", "gmail", "slack"],
    instructions: `Build today's briefing across every connected account: (1) today's events as a timeline, flag overlaps and prep needed; (2) emails from the last 24h that need a reply or decision (list; skip newsletters/promos); (3) Slack mentions and DMs waiting on the person. End with the 3 priorities for the day in one short paragraph. ${SHAPES}`,
  },
  {
    name: "reuniao",
    title: "Preparar reunião",
    description: "Contexto, pauta e perguntas para a próxima reunião",
    apps: ["googlecalendar", "gmail", "slack", "googledrive", "notion"],
    instructions: `Find the meeting the person means (default: the next one today). Collect context: attendees, the invite description, recent emails/Slack with those people or on that topic, linked docs. Deliver: who is in it (one line each), what is at stake, a 3-point agenda, 2-3 sharp questions to ask, and anything the person promised last time. Keep it scannable on a phone.`,
  },
  {
    name: "post",
    title: "Escrever post",
    description: "Post para LinkedIn ou Instagram, com aprovação",
    apps: ["linkedin", "instagram"],
    instructions: `Write a social post from what the person gives (topic, link, file or a past result). LinkedIn by default; Instagram if they say so or share an image. Write in their voice and language (pt-BR unless asked): a strong first line, short paragraphs, one clear idea, at most 3 relevant hashtags. Offer the draft and one alternative angle in text; when they pick one, propose publishing through the app tool (it becomes an approval card showing the post). Never publish without approval.`,
  },
  {
    name: "ads",
    title: "Relatório de anúncios",
    description: "Google Ads (e Analytics) da semana, com recomendações",
    apps: ["googleads", "google_analytics"],
    instructions: `Report paid performance for the last 7 days (or the period asked) vs the previous period. Google Ads via GAQL (campaign name, impressions, clicks, cost_micros, conversions, conversions_value). Compute cost (micros/1e6), CTR, CPC, CPA and ROAS with calculate. Show totals as stats (with change vs previous period) and campaigns as a table sorted by cost. Close with the 3 most useful actions (pause/scale/test), as suggestions only — never change campaigns or budgets unless explicitly asked, and then only as an approval. ${SHAPES}`,
  },
  {
    name: "redes",
    title: "Desempenho nas redes",
    description: "Instagram, LinkedIn e YouTube: números e top posts",
    apps: ["instagram", "linkedin", "youtube", "facebook"],
    instructions: `For each connected social account, get reach/impressions, engagement and followers for the last 7 days (or asked period) and the best 3 posts. Totals as stats, top posts as a table (post, reach, engagement rate via calculate). One insight per network about what worked. ${SHAPES}`,
  },
  {
    name: "rota",
    title: "Rota e hora de sair",
    description: "Quanto tempo até o próximo compromisso e quando sair",
    apps: ["google_maps", "googlecalendar"],
    instructions: `Find the destination (the next event with a location, or the place the person names) and the origin (what they say, else their home/work from memory, else ask once). Get the route with traffic for driving (and transit if relevant). Answer in text: travel time, distance, the time to leave to arrive 10 minutes early, and one alternative if it's much slower than usual.`,
  },
  {
    name: "planilha",
    title: "Analisar planilha",
    description: "Números-chave, tendências e alertas de uma planilha",
    apps: ["googlesheets", "googledrive"],
    instructions: `Open the spreadsheet (Google Sheets URL/name, or an attached file via read_file). Read headers first, then only the ranges you need. Explain what it tracks in one line, then key figures (stats), the most useful breakdown (table), and anomalies or trends worth attention. Every total, average and % via calculate. ${SHAPES}`,
  },
  {
    name: "doc",
    title: "Virar documento",
    description: "Transformar a conversa ou um resultado em Google Doc",
    apps: ["googledocs", "googledrive"],
    instructions: `Turn what the person points to (this conversation, a result, a list) into a clean document: title, a 3-line summary on top, sections with headings, tables where there is tabular data. Write it in markdown and propose creating it as a Google Doc (approval). After it's created, reply with the link.`,
  },
  {
    name: "pesquisa",
    title: "Pesquisa rápida",
    description: "Várias fontes, comparadas e com links",
    apps: [],
    instructions: `Research the question on 3-5 reliable public sources with browse_web (browser_task only when a site needs interaction). Answer first in 2-3 sentences, then the evidence: a table when comparing options, otherwise short bullets, each with its source site. Say what you could not confirm.`,
  },
  {
    name: "responder",
    title: "Responder e-mail",
    description: "Rascunho de resposta no seu tom, para aprovar",
    apps: ["gmail", "outlook"],
    instructions: `Find the email the person means (default: the most recent that needs a reply). Read the whole thread. Draft a reply in their voice and language: answer what was asked, one clear next step, short. Propose it as a draft/send approval; mention anything you assumed.`,
  },
];

const KIND = "skills";
export const skillName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "Use letras, números e hífen (ex.: relatorio-vendas)");
export const skillInput = z.object({
  name: skillName,
  title: z.string().trim().min(2).max(60),
  description: z.string().trim().max(120).default(""),
  instructions: z.string().trim().min(10).max(4000),
  apps: z.array(z.string().max(64)).max(10).default([]),
});

/** Built-ins plus the person's own (theirs override a built-in of the same name). */
export async function listSkills(db: Store, owner: string): Promise<Skill[]> {
  const own = (await db.list<Skill & { id: string }>(owner, KIND)).map(
    ({ id: _id, ...skill }) => skill,
  );
  const names = new Set(own.map((skill) => skill.name));
  return [
    ...own.sort((a, b) => a.name.localeCompare(b.name)),
    ...BUILT_IN_SKILLS.filter((skill) => !names.has(skill.name)).map((skill) => ({
      ...skill,
      builtIn: true,
    })),
  ];
}

export async function saveSkill(db: Store, owner: string, raw: unknown): Promise<Skill> {
  const input = skillInput.parse(raw);
  const skill: Skill = { ...input, createdAt: new Date().toISOString() };
  await db.put(owner, KIND, { id: input.name, ...skill });
  return skill;
}

export async function deleteSkill(db: Store, owner: string, name: string) {
  const parsed = skillName.parse(name);
  if (!(await db.get(owner, KIND, parsed)))
    throw new AppError("Só é possível excluir suas próprias skills", 404);
  await db.take(owner, KIND, parsed);
}

/** The skills a message invokes: "@ads da semana e @post" → [ads, post]. */
/** The @names written in a text ("rode via @coortes-mensais"). */
export function mentionedSkills(text: string) {
  return new Set(
    [...text.matchAll(/(?:^|[\s(])@([a-z0-9][a-z0-9-]{1,30})/gi)].map((m) => m[1].toLowerCase()),
  );
}

export function invokedSkills(text: string, skills: Skill[]) {
  const names = mentionedSkills(text);
  return skills.filter((skill) => names.has(skill.name));
}

/** @names mentioned that match no saved skill: the model says so instead of guessing. */
export function unknownSkills(text: string, skills: Skill[]) {
  const known = new Set(skills.map((skill) => skill.name));
  const missing = [...mentionedSkills(text)].filter((name) => !known.has(name));
  return missing.length
    ? `The person mentioned ${missing.map((n) => `@${n}`).join(", ")}, but no saved skill has that name${skills.length ? ` (saved: ${skills.map((s) => `@${s.name}`).join(", ")})` : ""}. Say so in one line and ask, or use the closest saved one only if it clearly is the same.`
    : "";
}

/** What an invoked skill adds to the turn's context. */
export function skillContext(skills: Skill[], connected: string[]) {
  return skills
    .map((skill) => {
      const missing = skill.apps.filter((app) => !connected.includes(app));
      return [
        `# Skill @${skill.name} — ${skill.title} (the person invoked it: follow it)`,
        skill.instructions,
        missing.length && missing.length === skill.apps.length
          ? `None of its apps are connected (${missing.join(", ")}): do what you can and say which to connect in Ajustes › Apps.`
          : missing.length
            ? `Not connected (skip, mention once if it matters): ${missing.join(", ")}.`
            : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
