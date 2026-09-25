import { z } from "zod";
import type { RoutineSchedule } from "./routine.ts";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_input"
  | "scheduled"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface Evidence {
  id: string;
  kind: "mail" | "file" | "web" | "user";
  title: string;
  excerpt: string;
  url?: string;
}
export interface TaskStep {
  id: string;
  title: string;
  status: "pending" | "running" | "succeeded" | "failed" | "waiting";
  detail?: string;
}
export interface AgentTask {
  id: string;
  title: string;
  prompt: string;
  kind: "agent" | "document" | "monitor" | "finance" | "plan";
  status: TaskStatus;
  goalId?: string;
  plan: TaskStep[];
  evidence: Evidence[];
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  leaseId?: string | null;
  leaseUntil?: string | null;
  attempts: number;
  /** Out of the lists (done and old, or put away by the person); still readable. */
  archivedAt?: string | null;
  /** Restarts in a row after its executor died mid-run (lease expired); reset on a normal start. */
  recoveries?: number;
  actionId?: string | null;
  result?: string;
  error?: string | null;
  question?: string;
  artifactIds: string[];
}
export interface RunEvent {
  id: string;
  taskId: string;
  date: string;
  kind: "plan" | "step" | "observation" | "approval" | "result" | "error" | "status";
  title: string;
  detail: string;
}
export interface Goal {
  id: string;
  title: string;
  description: string;
  category: string;
  status: "active" | "paused" | "completed";
  milestones: { id: string; title: string; done: boolean }[];
  createdAt: string;
}
export interface Monitor {
  id: string;
  taskId: string;
  title: string;
  url: string;
  condition: "change" | "contains" | "price_below";
  value: string;
  intervalMinutes: number;
  status: "active" | "paused" | "stopped";
  nextCheckAt: string;
  lastCheckedAt?: string;
  lastValue?: string;
  lastHash?: string;
  error?: string;
  checks: number;
}
/** Something the agent does on a schedule, e.g. a morning briefing on weekdays at 8:00. */
export interface Routine extends RoutineSchedule {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  /**
   * App actions eligible for "always allow" (create, update…) that a run prepares go ahead
   * without asking. Sending, replying, deleting and paying always wait for approval.
   */
  autoApprove?: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  lastTaskId?: string;
  createdAt: string;
}
export const routineInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000),
  frequency: z
    .enum(["weekly", "biweekly", "monthly", "quarterly"])
    .default("weekly")
    .describe(
      "weekly: on days every week. biweekly: on days every 2 weeks (quinzenal). monthly: once a month, on dayOfMonth or nthWeekday. quarterly: every 3 months from startMonth, on dayOfMonth or nthWeekday.",
    ),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5])
    .describe("weekly and biweekly: 0 = Sunday … 6 = Saturday"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  dayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe("monthly and quarterly: 1–31; 31 means the last day of the month"),
  nthWeekday: z
    .object({
      week: z.number().int().min(-1).max(4).describe("1–4, or -1 for the last one of the month"),
      weekday: z.number().int().min(0).max(6).describe("0 = Sunday … 6 = Saturday"),
    })
    .optional()
    .describe('monthly and quarterly, instead of dayOfMonth: "toda segunda segunda-feira"'),
  startMonth: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      "quarterly: one of the months it runs in (1 = Jan/Apr/Jul/Oct); the current month by default",
    ),
  anchor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("biweekly: a date (YYYY-MM-DD) in a week it runs; this week by default"),
  enabled: z.boolean().default(true),
  autoApprove: z
    .boolean()
    .default(false)
    .describe(
      "Only when the person asked the routine to act on its own: safe app actions (create, update) run without asking; sending, replying, deleting and paying still wait for approval.",
    ),
});
export type RoutineInput = z.infer<typeof routineInputSchema>;
export interface Idea {
  id: string;
  title: string;
  reason: string;
  evidence: Evidence[];
  prompt: string;
  kind: AgentTask["kind"];
  input: Record<string, unknown>;
  /** `expired`: nobody acted on it in time (see ideas/lifecycle.ts); shown under "arquivadas". */
  status: "new" | "dismissed" | "accepted" | "expired";
  /** Set aside until this instant: hidden from Ideas and from the pipeline's duplicates check. */
  snoozedUntil?: string;
  /** Hidden from Ideas once the person has cleaned it up; the task and its result remain. */
  archived?: boolean;
  taskId?: string;
  createdAt: string;
}
export interface AgentMemory {
  id: string;
  text: string;
  source: string;
  createdAt: string;
  /** preference, person, place, routine, work, health, finance or other (set by Jev). */
  tag?: string;
  /** Absent = active. Superseded ones keep the lineage; retracted ones are "forgotten". */
  status?: "active" | "superseded" | "retracted";
  /** Who put it there: the person, the chat, the hourly review, or the nightly reflection. */
  origin?: MemoryOrigin;
  /** 1–10: how much it matters when choosing what to recall. */
  salience?: number;
  /** Where it was said: the conversation and message range, with the person's words. */
  evidence?: MemoryEvidence[];
  /** The memories this one replaced (corrections, merges). */
  supersedes?: string[];
  supersededBy?: string;
  retractedAt?: string;
}
export type MemoryOrigin = "owner" | "chat" | "review" | "reflection";
export interface MemoryEvidence {
  thread: string;
  from?: number;
  to?: number;
  quote?: string;
}
/** A person the owner deals with, as the nightly reflection understood them. */
export interface MemoryPerson {
  id: string;
  name: string;
  aliases: string[];
  relation?: string;
  howToAddress?: string;
  notes: string[];
  updatedAt: string;
}
/** How the assistant should serve the owner, rewritten nightly (unless the owner pinned it). */
export interface MemorySynthesis {
  id: "alignment";
  reply: string;
  limits: string;
  friction: string[];
  week: string;
  pinned?: boolean;
  updatedAt: string;
}
/** One night's reflection: what changed and a short diary. Never used in replies. */
export interface MemoryDream {
  id: string;
  diary: string;
  merged: number;
  superseded: number;
  retired: number;
  rejected: number;
  at: string;
}
export interface AgentArtifact {
  id: string;
  taskId: string;
  kind: "plan" | "comparison" | "finance" | "report";
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}
/** A finished task's result at a glance; the full text stays in the notification body. */
export interface ResultCard {
  headline: string;
  status: "done" | "attention" | "blocked";
  highlights: string[];
  next: string[];
}
export interface AgentNotification {
  id: string;
  taskId?: string;
  title: string;
  body: string;
  card?: ResultCard;
  /** How the work ended, so the app never calls a paused or failed task "done". */
  status?: "done" | "attention" | "blocked" | "update";
  createdAt: string;
  read: boolean;
}
export interface AgentIdentity {
  name: string;
  tone: "warm" | "concise" | "thoughtful";
  avatar?: "sky" | "sand" | "lilac";
  showChatUpdates?: boolean;
}
export interface AgentModelOption {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cachedInputPricePerMillion?: number;
  note?: string;
  recommended?: boolean;
  /** Can look at pictures (attached photos, scanned PDFs, page screenshots). */
  vision?: boolean;
}
export interface AgentModelSettings {
  selectedId: string;
  options: AgentModelOption[];
}
export interface AgentWorkspace {
  tasks: AgentTask[];
  goals: Goal[];
  monitors: Monitor[];
  routines: Routine[];
  ideas: Idea[];
  memories: AgentMemory[];
  artifacts: AgentArtifact[];
  notifications: AgentNotification[];
  identity: AgentIdentity;
  model?: AgentModelSettings;
  /** The person's helpers (fuzzies/). */
  fuzzies?: Fuzzy[];
  worker: { running: boolean; lastTickAt?: string };
}
export const createTaskSchema = z.object({
  /** 2–6 words in the person's language, e.g. "Comparar voos para Recife". */
  title: z.string().trim().min(1).max(160).optional(),
  prompt: z.string().trim().min(1).max(12000),
  kind: z.enum(["agent", "document", "monitor", "finance", "plan"]).default("agent"),
  goalId: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export const monitorInputSchema = z
  .object({
    title: z.string().min(1).max(160),
    url: z.url().max(4096),
    condition: z.enum(["change", "contains", "price_below"]).default("change"),
    value: z.string().max(300).default(""),
    intervalMinutes: z.number().int().min(1).max(10080).default(15),
  })
  .superRefine((v, c) => {
    if (v.condition !== "change" && !v.value.trim())
      c.addIssue({ code: "custom", message: "Diga o que procurar na página" });
    if (
      v.condition === "price_below" &&
      (!Number.isFinite(Number(v.value)) || Number(v.value) <= 0)
    )
      c.addIssue({ code: "custom", message: "Informe um preço maior que zero" });
  });
export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).default(""),
  category: z.string().max(80).default("Personal"),
  milestones: z.array(z.string().min(1).max(200)).max(20).default([]),
});

/**
 * A helper ("fuzzy"): a small assistant with a standing mission, its own chat and memory, only
 * the apps the person allowed, an optional schedule and a daily budget. Corgi calls it with
 * ask_fuzzy; the person can talk to it in its chat. Never more power than Corgi: fewer tools.
 */
export interface Fuzzy {
  id: string;
  name: string;
  emoji: string;
  color: string;
  /** What it is for, 1–3 sentences. */
  mission: string;
  /** How to work: sources, what to look for, what a good report is. */
  instructions: string;
  /** Composio toolkit slugs it may use; empty = no apps. */
  apps: string[];
  /** May browse public pages and use Apify when connected. */
  web: boolean;
  /** When it runs on its own; absent = only when called. */
  schedule?: RoutineSchedule;
  nextRunAt?: string;
  status: "active" | "paused";
  /** Its one conversation: every run and every message to it lives there. */
  threadId: string;
  /** Runs per local day, at most (scheduled and called). */
  maxRunsPerDay: number;
  runs?: { day: string; count: number };
  lastRunAt?: string;
  lastTaskId?: string;
  /** What it found last time it reported (report_finding). */
  lastFinding?: { headline: string; detail?: string; at: string; notified: boolean };
  /** Facts it learned for its own job (learn_fact), newest last. */
  learned: { text: string; at: string }[];
  template?: string;
  createdAt: string;
}

export const fuzzyInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8).default("🐾"),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#F4D8B8"),
  mission: z.string().trim().min(1).max(500),
  instructions: z.string().trim().max(4000).default(""),
  apps: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  web: z.boolean().default(true),
  schedule: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .nullable()
    .optional(),
  maxRunsPerDay: z.number().int().min(1).max(24).default(4),
  template: z.string().max(40).optional(),
});
export type FuzzyInput = z.infer<typeof fuzzyInputSchema>;
