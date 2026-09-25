import { z } from "zod";

export type WorkspaceMode = "sample" | "live";
export type Section =
  | "today"
  | "chat"
  | "mail"
  | "calendar"
  | "browser"
  | "files"
  | "activity"
  | "connections"
  | "ideas"
  | "goals"
  | "apps";
export interface Mail {
  id: string;
  threadId: string;
  from: string;
  sender: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
  unread: boolean;
  label: string;
  attachments: string[];
}
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string;
  location: string;
  description: string;
  attendees: string[];
}
export interface Artifact {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  pageCount: number;
  url: string;
  createdAt: string;
  source: string;
  parentId?: string;
  fields?: { name: string; value: string; type: "text" | "checkbox" | "unsupported" }[];
  /** Signed URL of a small picture of it: a photo itself, or a PDF's first page. */
  thumbnailUrl?: string;
  /** The first lines of a document's text, for a mini page preview. */
  excerpt?: string;
}
export interface BrowserSession {
  id: string;
  title: string;
  url: string;
  status: "idle" | "active" | "closed" | "error";
  updatedAt: string;
  previewUrl?: string;
  consoleUrl?: string;
}
export const emailDraftSchema = z.object({
  to: z.array(z.email()).min(1).max(50),
  cc: z.array(z.email()).max(50).default([]),
  bcc: z.array(z.email()).max(50).default([]),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(998)
    .refine((s) => !/[\r\n]/.test(s), "Subject must be a single line"),
  body: z.string().min(1).max(100000),
  attachmentIds: z.array(z.string()).max(10).default([]),
  threadId: z.string().optional(),
  replyToMessageId: z.string().optional(),
});
export const eventDraftSchema = z
  .object({
    calendarId: z.string().default("primary"),
    title: z.string().trim().min(1).max(500),
    start: z.string().min(1),
    end: z.string().min(1),
    allDay: z.boolean().default(false),
    timeZone: z.string().default("America/Los_Angeles"),
    location: z.string().max(2000).default(""),
    description: z.string().max(10000).default(""),
    attendees: z.array(z.email()).max(50).default([]),
  })
  .superRefine((value, ctx) => {
    if (
      !Number.isFinite(Date.parse(value.start)) ||
      !Number.isFinite(Date.parse(value.end)) ||
      Date.parse(value.end) <= Date.parse(value.start)
    ) {
      ctx.addIssue({ code: "custom", message: "End must be after a valid start", path: ["end"] });
    }
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const timed = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
    if (
      !(value.allDay ? dateOnly : timed).test(value.start) ||
      !(value.allDay ? dateOnly : timed).test(value.end)
    ) {
      ctx.addIssue({
        code: "custom",
        message: value.allDay
          ? "All-day events need date-only values"
          : "Timed events need an explicit offset",
        path: ["start"],
      });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timeZone });
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid time zone", path: ["timeZone"] });
    }
  });
export const proposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email.send"), data: emailDraftSchema }),
  z.object({ kind: z.literal("calendar.create"), data: eventDraftSchema }),
  z.object({
    kind: z.literal("calendar.update"),
    data: eventDraftSchema.and(z.object({ eventId: z.string().min(1) })),
  }),
  z.object({
    kind: z.literal("calendar.delete"),
    data: z.object({ calendarId: z.string(), eventId: z.string().min(1), title: z.string() }),
  }),
  // A write through a connected app (Composio). Reviewed exactly like email and calendar.
  z.object({
    kind: z.literal("app.action"),
    data: z.object({
      toolkit: z.string().min(1).max(64),
      tool: z.string().min(1).max(200),
      summary: z.string().min(1).max(300),
      arguments: z.record(z.string(), z.unknown()),
      // Which of several accounts of the app it runs as (e.g. work vs. personal Gmail).
      connectedAccountId: z.string().min(1).max(100).optional(),
      account: z.string().max(300).optional(),
    }),
  }),
  // Placing an order on a store's final review page, exactly as captured for review.
  z.object({
    kind: z.literal("browser.checkout"),
    data: z.object({
      sessionId: z.string().min(1).max(100),
      merchant: z.string().min(1).max(200),
      url: z.url().max(4096),
      total: z.string().max(40).optional(),
      totalValue: z.number().nonnegative().optional(),
      button: z.string().min(1).max(60),
      summary: z.string().min(1).max(300),
      screenshot: z.string().max(600_000).optional(),
    }),
  }),
]);
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type EventDraft = z.infer<typeof eventDraftSchema>;
export type ProposalInput = z.infer<typeof proposalSchema>;
/** Email and calendar proposals run through the owner's Google connection; others do not. */
export const usesGoogle = (kind: ProposalInput["kind"]) =>
  kind.startsWith("email.") || kind.startsWith("calendar.");
/** Why the trust guard wants the person to check a change before it runs (see trust/guard.ts). */
export interface GuardFlag {
  /** "check": confirm as usual; "high": looks malicious, needs a second explicit confirmation. */
  risk: "check" | "high";
  reason: string;
  /** The e-mail, page or app data that raised it. */
  source?: string;
}
export interface ActionProposal {
  /** Set by the trust guard: never auto-runs, and the review shows the reason. */
  guard?: GuardFlag;
  /** Whether "always allow" may be offered (app actions that neither send nor delete, unflagged). */
  alwaysAllowable?: boolean;
  target?: CalendarEvent;
  targetVersion?: string;
  taskId?: string;
  account?: string;
  connectionId?: string;
  id: string;
  title: string;
  kind: ProposalInput["kind"];
  data: Record<string, unknown>;
  status:
    | "awaiting_review"
    | "executing"
    | "succeeded"
    | "failed"
    | "outcome_unknown"
    | "denied"
    | "cancelled"
    | "expired";
  hash: string;
  createdAt: string;
  expiresAt: string;
  result?: string;
  error?: string;
}
export interface ActivityEntry {
  id: string;
  title: string;
  detail: string;
  date: string;
  status: string;
  actionId?: string;
}
export interface Connection {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "sample" | "unconfigured";
  account?: string;
  capabilities: string[];
}
export interface Workspace {
  mode: WorkspaceMode;
  profile: { name: string; email: string };
  mail: Mail[];
  events: CalendarEvent[];
  files: Artifact[];
  browsers: BrowserSession[];
  actions: ActionProposal[];
  activity: ActivityEntry[];
  connections: Connection[];
  runtime: {
    provider: "sample" | "model";
    configured: boolean;
    sampleData?: boolean;
  };
}

export type { ComputerCommand, ComputerDirectory, ComputerSnapshot } from "./computer.ts";
export type { RoutineFrequency, RoutineSchedule } from "./routine.ts";
