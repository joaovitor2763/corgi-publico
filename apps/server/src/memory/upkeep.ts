// When the memory jobs run, for every person on this server: the review of new conversations at
// most once an hour, the reflection once a night (from 03:00 local time), and the purge of what
// was forgotten over 30 days ago. Called from the agent's minute-by-minute maintenance.
import type { Store } from "../platform/db.ts";
import type { AskJev } from "../trust/jev.ts";
import { purgeForgotten } from "./book.ts";
import { reviewConversations } from "./consolidate.ts";
import { dream, localDay, localHour } from "./dream.ts";

const HOUR = 60 * 60 * 1000;
/** The reflection runs from this local hour on, once per day. */
export const DREAM_HOUR = 3;

type Schedule = { id: "schedule"; reviewedAt?: string; dreamDay?: string };

export async function memoryUpkeep(deps: {
  db: Store;
  owners: string[];
  timeZone: string;
  extract: (prompt: string) => Promise<string>;
  think: (prompt: string) => Promise<string>;
  jev?: AskJev;
  busy?: (owner: string, conversation: string) => boolean;
  now?: Date;
}) {
  const now = deps.now ?? new Date();
  for (const owner of deps.owners) {
    const schedule = (await deps.db.get<Schedule>(owner, "memory-state", "schedule")) ?? {
      id: "schedule" as const,
    };
    if (!schedule.reviewedAt || now.getTime() - Date.parse(schedule.reviewedAt) >= HOUR) {
      // Marked first: a failing model is retried next hour, not every minute.
      await deps.db.put(owner, "memory-state", { ...schedule, reviewedAt: now.toISOString() });
      await reviewConversations({
        db: deps.db,
        owner,
        extract: deps.extract,
        jev: deps.jev,
        busy: (conversation) => deps.busy?.(owner, conversation) ?? false,
      });
    }
    const today = localDay(now, deps.timeZone);
    if (localHour(now, deps.timeZone) >= DREAM_HOUR && schedule.dreamDay !== today) {
      const latest = (await deps.db.get<Schedule>(owner, "memory-state", "schedule")) ?? schedule;
      await deps.db.put(owner, "memory-state", { ...latest, dreamDay: today });
      if ((await deps.db.list(owner, "memories")).length)
        await dream({ db: deps.db, owner, think: deps.think, now, timeZone: deps.timeZone });
    }
  }
  if (now.getMinutes() === 0) await purgeForgotten(deps.db, now.getTime());
}
