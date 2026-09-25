// What agent_status shows the chat model: only what is open right now (approvals waiting, tasks in
// progress or waiting on the person, active monitors and goals, new ideas, unread notices). The
// full workspace snapshot (every memory, artifact and finished task) was ~17k tokens of mostly
// history, and without the approvals the model filled the gap from old chat messages.
import type {
  AgentNotification,
  AgentTask,
  Goal,
  Idea,
  Monitor,
} from "../../../../packages/domain/src/agent.ts";
import type { ActionProposal } from "../../../../packages/domain/src/index.ts";
import { presentIdeas } from "../ideas/lifecycle.ts";
import type { Store } from "../platform/db.ts";

const OPEN = new Set([
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "scheduled",
  "paused",
]);
const RECENT_MS = 3 * 86_400_000;

export async function pendingWork(db: Store, owner: string, now = new Date()) {
  const [actions, tasks, monitors, goals, ideas, notifications] = await Promise.all([
    db.list<ActionProposal>(owner, "actions"),
    db.list<AgentTask>(owner, "tasks"),
    db.list<Monitor>(owner, "monitors"),
    db.list<Goal>(owner, "goals"),
    db.list<Idea>(owner, "ideas"),
    db.list<AgentNotification>(owner, "notifications"),
  ]);
  const recent = (at: string) => now.getTime() - Date.parse(at) < RECENT_MS;
  return {
    checkedAt: now.toISOString(),
    approvals_waiting: actions
      .filter((a) => a.status === "awaiting_review" && Date.parse(a.expiresAt) > now.getTime())
      .map((a) => ({
        id: a.id,
        title: a.title,
        ...(a.account ? { account: a.account } : {}),
        since: a.createdAt,
      })),
    tasks_open: tasks
      .filter((t) => t.kind !== "monitor" && OPEN.has(t.status))
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        ...(t.question ? { question: t.question } : {}),
        updatedAt: t.updatedAt,
      })),
    tasks_finished_recently: tasks
      .filter(
        (t) =>
          t.kind !== "monitor" && ["succeeded", "failed"].includes(t.status) && recent(t.updatedAt),
      )
      .map((t) => ({ id: t.id, title: t.title, status: t.status, updatedAt: t.updatedAt })),
    monitors_active: monitors
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.id, title: m.title, url: m.url })),
    goals_active: goals
      .filter((g) => g.status === "active")
      .map((g) => ({ id: g.id, title: g.title })),
    ideas_new: presentIdeas(ideas, Date.now())
      .filter((i) => i.status === "new")
      .map((i) => i.title),
    notifications_unread: notifications
      .filter((n) => !n.read && recent(n.createdAt))
      .map((n) => ({ title: n.title, ...(n.taskId ? { taskId: n.taskId } : {}), at: n.createdAt })),
    note: "This is the live state; anything in earlier messages that disagrees is outdated. The person approves in the app (cards in the chat or Atividade). Full details of one task: manage_task read.",
  };
}
