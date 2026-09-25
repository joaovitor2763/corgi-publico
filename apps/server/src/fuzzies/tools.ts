// The chat tools around helpers: Corgi calls and creates them; a helper learns and reports.
import { createHash } from "node:crypto";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import type { Fuzzy } from "../../../../packages/domain/src/agent.ts";
import { describeRoutineSchedule } from "../../../../packages/domain/src/routine.ts";
import { createFuzzy, type FuzzyDeps, fuzzyByName, fuzzyGet, learn, runFuzzy } from "./fuzzies.ts";

/** What a helper may never do, whatever it is asked: it has fewer powers than Corgi. */
export const FUZZY_BLOCKED = new Set([
  "delegate_task",
  "manage_task",
  "create_routine",
  "create_goal",
  "watch_page",
  "save_skill",
  "remember_fact",
  "update_memory",
  "forget_memory",
  "request_checkout",
  "ask_fuzzy",
  "create_fuzzy",
]);
/** The web tools a helper without web access loses. */
export const FUZZY_WEB = new Set([
  "browse_web",
  "browser_task",
  "look_at_page",
  "apify_search",
  "apify_input",
  "apify_run",
]);

export const allowedForFuzzy = (fuzzy: Fuzzy) => (name: string) =>
  !FUZZY_BLOCKED.has(name) && (fuzzy.web || !FUZZY_WEB.has(name));

/** Corgi's side: who its helpers are, so it can call them. */
export function helpersContext(fuzzies: Fuzzy[]) {
  const active = fuzzies.filter((f) => f.status === "active");
  if (!active.length) return "";
  return `Your helpers (small assistants you can call with ask_fuzzy; they work in the background in their own chat and report back): ${active
    .map(
      (f) =>
        `\n- ${f.emoji} ${f.name}: ${f.mission}${f.schedule ? ` (runs on its own: ${describeRoutineSchedule(f.schedule)})` : ""}`,
    )
    .join("")}\nCall one when a request fits its mission, instead of doing it yourself.`;
}

/** The helper's role, in place of the main assistant's at the top of the standing prompt. */
export function fuzzyRole(fuzzy: Fuzzy) {
  return `You are ${fuzzy.name} ${fuzzy.emoji}, one of the person's helpers: a small assistant with one job, working alongside their main assistant (Corgi). You are not Corgi; when asked who you are, say you are ${fuzzy.name} and what your job is. Your job: ${fuzzy.mission} Anything outside it goes back to Corgi in the main chat.`;
}

/** The helper's side: who it is, what it may use, what it learned. After the latest message. */
export function fuzzyContext(fuzzy: Fuzzy, apps: string[]) {
  return [
    `# In this conversation you are ${fuzzy.emoji} ${fuzzy.name}, a helper — not the main assistant`,
    `This overrides your role above: you are one of the person's helpers, with a single job. Introduce yourself as ${fuzzy.name} when relevant, stay on your mission, and send anything outside it back to the main assistant ("isso é com o Corgi, no chat principal"). Mission: ${fuzzy.mission}`,
    fuzzy.instructions ? `How to work: ${fuzzy.instructions}` : "",
    `Apps you may use: ${apps.length ? apps.join(", ") : "none"}.${fuzzy.web ? " You may read and browse public web pages." : " No web browsing."}`,
    fuzzy.learned.length
      ? `What you learned for this job (yours; use learn_fact to add):\n${fuzzy.learned.map((l) => `- ${l.text}`).join("\n")}`
      : "You haven't learned anything for this job yet; use learn_fact for lasting facts about it (which competitors, which clients matter…).",
    "Rules: you cannot create tasks, routines or goals, save facts about the person, or buy anything; changes in apps still wait for the person's approval. Your notes (write_notes) carry over between rounds: keep where you stopped and what you already reported.",
    "Ending a round of work: call report_finding once. notify: true only when there is something new the person needs to know or act on; otherwise notify: false (a quiet round is fine). When the person talks to you directly, just answer.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function corgiFuzzyTools(deps: FuzzyDeps & { owner: string }) {
  return [
    defineTool({
      name: "ask_fuzzy",
      description:
        "Hand a request to one of the person's helpers (listed in your context). It works in the background in its own chat and reports back in notifications; tell the person in one line that the helper is on it. name: the helper's name. request: what to do, with everything it needs.",
      parameters: z.object({
        name: z.string().trim().min(1).max(60),
        request: z.string().trim().min(1).max(4000),
      }),
      execute: async ({ name, request }) => {
        const fuzzy = await fuzzyByName(deps.db, deps.owner, name);
        if (!fuzzy)
          return { error: `No helper called "${name}". Helpers are listed in your context.` };
        if (fuzzy.status === "paused")
          return {
            error: `${fuzzy.name} is paused. The person can turn it back on under Ajudantes.`,
          };
        const result = await runFuzzy(deps, deps.owner, fuzzy.id, { request, from: "corgi" });
        return result.started
          ? {
              helper: `${fuzzy.emoji} ${fuzzy.name}`,
              taskId: result.taskId,
              note: result.followUp
                ? "It was already working; the request joined its current round."
                : "Started in the background. It reports in notifications; don't wait for it.",
            }
          : { error: `${fuzzy.name} didn't start: ${result.reason}.` };
      },
    }),
    defineTool({
      name: "create_fuzzy",
      description:
        "Create a helper only after the person asked for one or agreed: a small assistant with a standing mission (e.g. watch client messages, prepare meetings, follow competitors), its own chat, only the apps listed, and an optional schedule. apps: toolkit slugs of connected apps it may use (e.g. gmail, slack). schedule: days (0=Sun…6=Sat) and time HH:MM when it runs on its own; omit to run only when called. Confirm what you created in one line.",
      parameters: z.object({
        name: z.string().trim().min(1).max(40),
        emoji: z.string().trim().max(8).optional(),
        mission: z.string().trim().min(1).max(500),
        instructions: z.string().trim().max(4000).optional(),
        apps: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
        web: z.boolean().optional(),
        schedule: z
          .object({
            days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
            time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          })
          .optional(),
      }),
      execute: async (args) => {
        const fuzzy = await createFuzzy(
          deps,
          deps.owner,
          args,
          createHash("sha256")
            .update(`${deps.owner}:${args.name}:${args.mission}`)
            .digest("hex")
            .slice(0, 32),
        );
        return {
          created: `${fuzzy.emoji} ${fuzzy.name}`,
          schedule: fuzzy.schedule ? describeRoutineSchedule(fuzzy.schedule) : "only when called",
          apps: fuzzy.apps,
        };
      },
    }),
  ];
}

export function fuzzyRunTools(
  deps: Pick<FuzzyDeps, "db"> & {
    owner: string;
    fuzzyId: string;
    taskId?: string;
    notify: (
      title: string,
      body: string,
      taskId: string | undefined,
      key: string,
    ) => Promise<unknown>;
  },
) {
  return [
    defineTool({
      name: "learn_fact",
      description:
        "Keep a lasting fact about YOUR job (which competitors to follow, which clients matter, how the person likes your report). One short sentence. Not for facts about the person's life.",
      parameters: z.object({ text: z.string().trim().min(3).max(300) }),
      execute: async ({ text }) => {
        const fuzzy = await learn(deps.db, deps.owner, deps.fuzzyId, text);
        return { learned: text, total: fuzzy.learned.length };
      },
    }),
    defineTool({
      name: "report_finding",
      description:
        "End a round of work with what you found. notify: true only if there is something new the person needs to know or act on (it becomes a phone notification); false for a quiet round. headline: one line. detail: short, with names, dates and links.",
      parameters: z.object({
        notify: z.boolean(),
        headline: z.string().trim().min(1).max(160),
        detail: z.string().trim().max(2000).optional(),
      }),
      execute: async ({ notify, headline, detail }) => {
        const fuzzy = await fuzzyGet(deps.db, deps.owner, deps.fuzzyId);
        // The same news twice is not news.
        const repeat =
          notify && fuzzy.lastFinding?.notified && fuzzy.lastFinding.headline === headline;
        const notified = notify && !repeat;
        await deps.db.put(deps.owner, "fuzzies", {
          ...fuzzy,
          lastFinding: { headline, detail, at: new Date().toISOString(), notified },
        });
        if (notified)
          await deps.notify(
            `${fuzzy.emoji} ${fuzzy.name}: ${headline}`,
            detail ?? headline,
            deps.taskId,
            `fuzzy:${fuzzy.id}:${createHash("sha256").update(headline).digest("hex").slice(0, 16)}`,
          );
        return {
          reported: true,
          notified,
          note: repeat ? "Already reported this; not sent again." : undefined,
        };
      },
    }),
  ];
}
