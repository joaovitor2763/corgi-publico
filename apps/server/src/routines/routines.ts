// When a routine runs next. Schedules are wall-clock ("weekdays at 08:00 in São Paulo", "day 2
// of every month", "every 2 weeks on Monday", "the 2nd Monday of Jan/Apr/Jul/Oct"), so the next
// run is found by walking local calendar days and converting that local time to UTC with the
// zone's offset on that day (DST-safe for zones that still have it).
import type { RoutineSchedule } from "../../../../packages/domain/src/routine.ts";
import { AppError } from "../platform/errors.ts";

export { describeRoutineSchedule as describeSchedule } from "../../../../packages/domain/src/routine.ts";

const DAY = 86_400_000;

/** A calendar date with no time zone: what "day 2 of the month" or "Monday" is about. */
type CalendarDay = { year: number; month: number; day: number; weekday: number };

/** Minutes east of UTC for `timeZone` at the instant `at`, e.g. -180 for São Paulo. */
function offsetMinutes(timeZone: string, at: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0; // "GMT" alone is UTC
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** The local calendar date of `at` in `timeZone`. */
export function localDate(timeZone: string, at: Date): CalendarDay {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdays.indexOf(parts.weekday ?? ""),
  };
}

/** "2026-09-25" for a calendar day. */
export function isoDate({ year, month, day }: Pick<CalendarDay, "year" | "month" | "day">) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days since 1970-01-01, counting calendar days (no zone, no DST). */
const dayNumber = (d: Pick<CalendarDay, "year" | "month" | "day">) =>
  Math.floor(Date.UTC(d.year, d.month - 1, d.day) / DAY);
const calendarDay = (n: number): CalendarDay => {
  const at = new Date(n * DAY);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    weekday: at.getUTCDay(),
  };
};
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
/** Which week (Sunday to Saturday) a day is in, counted from 1970: biweekly keeps one parity. */
const weekNumber = (n: number) => Math.floor((n + 4) / 7); // 1970-01-01 was a Thursday
const parseIsoDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return { year, month, day };
};

/** Whether a monthly-style rule (day of month or Nth weekday) falls on `day`. */
function monthDayMatches(
  schedule: Pick<RoutineSchedule, "dayOfMonth" | "nthWeekday">,
  day: CalendarDay,
) {
  if (schedule.nthWeekday) {
    const { week, weekday } = schedule.nthWeekday;
    if (day.weekday !== weekday) return false;
    if (week === -1) return day.day + 7 > daysInMonth(day.year, day.month);
    return Math.ceil(day.day / 7) === week;
  }
  // Day 31 (or 30, 29) in a shorter month: its last day.
  return day.day === Math.min(schedule.dayOfMonth ?? 1, daysInMonth(day.year, day.month));
}

/** Whether the routine runs on this calendar day (time aside). */
export function runsOn(schedule: RoutineSchedule, day: CalendarDay) {
  switch (schedule.frequency ?? "weekly") {
    case "biweekly": {
      if (!schedule.days.includes(day.weekday)) return false;
      if (!schedule.anchor) return true;
      const anchor = weekNumber(dayNumber(parseIsoDate(schedule.anchor)));
      return (weekNumber(dayNumber(day)) - anchor) % 2 === 0;
    }
    case "monthly":
      return monthDayMatches(schedule, day);
    case "quarterly": {
      const start = schedule.startMonth ?? 1;
      return (((day.month - start) % 3) + 3) % 3 === 0 && monthDayMatches(schedule, day);
    }
    default:
      return schedule.days.includes(day.weekday);
  }
}

/**
 * The first scheduled moment strictly after `after`, or undefined when the schedule never runs
 * (no weekdays chosen). Quarterly rules are at most ~3 months apart, so a year of days is enough.
 */
export function nextRun(schedule: RoutineSchedule, after: Date): Date | undefined {
  const [hour, minute] = schedule.time.split(":").map(Number) as [number, number];
  const start = dayNumber(localDate(schedule.timeZone, after));
  for (let offset = 0; offset <= 400; offset++) {
    const day = calendarDay(start + offset);
    if (!runsOn(schedule, day)) continue;
    // Guess with the offset at `after`, then correct with the offset at the guessed instant.
    const utc = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
    let at = new Date(utc - offsetMinutes(schedule.timeZone, after) * 60_000);
    at = new Date(utc - offsetMinutes(schedule.timeZone, at) * 60_000);
    if (at.getTime() > after.getTime()) return at;
  }
  return undefined;
}

/**
 * A change to a routine's schedule on top of the stored one. Day-of-month and Nth-weekday rules
 * exclude each other: setting one drops the other, so an edit never keeps a stale rule around.
 */
export function mergeSchedule<T extends Partial<RoutineSchedule>>(
  current: T,
  patch: Partial<RoutineSchedule>,
): T {
  const next = { ...current, ...patch };
  if (patch.nthWeekday && patch.dayOfMonth === undefined) delete next.dayOfMonth;
  if (patch.dayOfMonth !== undefined && !patch.nthWeekday) delete next.nthWeekday;
  return next;
}

/**
 * Fills what the frequency needs (the biweekly anchor week, the quarterly start month) and
 * refuses a schedule that cannot run. `now` is the moment the routine is created or edited.
 */
export function normalizeSchedule<T extends Partial<RoutineSchedule> & { time: string }>(
  schedule: T,
  timeZone: string,
  now = new Date(),
): T & RoutineSchedule {
  const today = localDate(timeZone, now);
  const frequency = schedule.frequency ?? "weekly";
  const days = schedule.days ?? [1, 2, 3, 4, 5];
  const next: T & RoutineSchedule = { ...schedule, frequency, days, timeZone };
  if (frequency === "weekly" || frequency === "biweekly") {
    if (!days.length) throw new AppError("Escolha pelo menos um dia da semana", 400);
    if (frequency === "biweekly" && !next.anchor) next.anchor = isoDate(today);
    return next;
  }
  if (next.nthWeekday) {
    const { week } = next.nthWeekday;
    if (!(week === -1 || (week >= 1 && week <= 4)))
      throw new AppError("A semana do mês vai de 1 a 4, ou -1 para a última", 400);
  } else if (!next.dayOfMonth)
    throw new AppError(
      "Diga o dia do mês (dayOfMonth, 31 = último dia) ou a semana e o dia (nthWeekday)",
      400,
    );
  if (frequency === "quarterly" && !next.startMonth) next.startMonth = today.month;
  return next;
}
