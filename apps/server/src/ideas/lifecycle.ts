// When an idea shows, hides and retires. Pure: the service persists what these decide.
//   - snoozed ("agendar para depois"): kept as `new` with `snoozedUntil`, hidden until then, so
//     the pipeline still lists it as current and never drafts a duplicate meanwhile
//   - expired: open for IDEA_TTL_DAYS without a decision (counted from when it came back from a
//     snooze, if it did); it leaves the list for the archive instead of lingering
import type { Idea } from "../../../../packages/domain/src/agent.ts";
import { AppError } from "../platform/errors.ts";

/** Days an untouched idea stays in "Para você". */
export const IDEA_TTL_DAYS = 7;
/** How far ahead an idea can be scheduled. */
export const MAX_SNOOZE_DAYS = 90;
const DAY = 86_400_000;

export const isSnoozed = (idea: Pick<Idea, "snoozedUntil">, now: number) =>
  !!idea.snoozedUntil && Date.parse(idea.snoozedUntil) > now;

/** When the idea (re)appeared: its creation, or the end of its snooze. */
export const shownSince = (idea: Pick<Idea, "createdAt" | "snoozedUntil">) =>
  Math.max(Date.parse(idea.createdAt), idea.snoozedUntil ? Date.parse(idea.snoozedUntil) : 0);

/** How long the idea has been waiting for a decision, in ms (0 while snoozed). */
export const ageOf = (idea: Pick<Idea, "createdAt" | "snoozedUntil">, now: number) =>
  Math.max(0, now - shownSince(idea));

export const isExpired = (
  idea: Pick<Idea, "status" | "createdAt" | "snoozedUntil">,
  now: number,
  ttlDays = IDEA_TTL_DAYS,
) => idea.status === "new" && !isSnoozed(idea, now) && ageOf(idea, now) >= ttlDays * DAY;

/** What the app sees: snoozed ideas are hidden; overdue ones already read as expired. */
export function presentIdeas(ideas: Idea[], now: number): Idea[] {
  return ideas
    .filter((idea) => !isSnoozed(idea, now))
    .map((idea) => (isExpired(idea, now) ? { ...idea, status: "expired" as const } : idea));
}

/** The snooze instant, checked: only open ideas, only into the future, at most MAX_SNOOZE_DAYS. */
export function snoozeInstant(idea: Pick<Idea, "status">, until: string, now: number): string {
  const at = Date.parse(until);
  if (Number.isNaN(at)) throw new AppError("Data inválida", 400);
  if (idea.status !== "new") throw new AppError("Só uma ideia em aberto pode ser adiada", 409);
  if (at <= now) throw new AppError("Escolha um horário no futuro", 400);
  if (at - now > MAX_SNOOZE_DAYS * DAY)
    throw new AppError(`Dá para adiar até ${MAX_SNOOZE_DAYS} dias`, 400);
  return new Date(at).toISOString();
}
