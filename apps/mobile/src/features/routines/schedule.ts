// The routine form's state and how it becomes the API's input. Pure; the UI in routines.tsx.
import type { Routine } from "../../../../../packages/domain/src/agent";
import {
  describeRoutineSchedule,
  type RoutineFrequency,
} from "../../../../../packages/domain/src/routine";

export { describeRoutineSchedule, quarterMonths } from "../../../../../packages/domain/src/routine";

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The last day of the month is day 31: shorter months clamp to their last day. */
export const LAST_DAY = 31;

export const FREQUENCIES: { value: RoutineFrequency; label: string }[] = [
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "15 dias" },
  { value: "monthly", label: "Mensal" },
  { value: "quarterly", label: "3 meses" },
];
export const WEEKS: { value: number; label: string }[] = [
  { value: 1, label: "1ª" },
  { value: 2, label: "2ª" },
  { value: 3, label: "3ª" },
  { value: 4, label: "4ª" },
  { value: -1, label: "Última" },
];

export type ScheduleForm = {
  frequency: RoutineFrequency;
  /** Weekly and biweekly. */
  days: number[];
  time: string;
  /** Monthly and quarterly: by a day of the month or by the Nth weekday. */
  monthlyBy: "day" | "weekday";
  dayOfMonth: number;
  week: number;
  weekday: number;
  /** Quarterly: one of the months it runs in. */
  startMonth: number;
  autoApprove: boolean;
};

/** What the API receives for a routine's schedule (title and prompt aside). */
export type ScheduleInput = {
  frequency: RoutineFrequency;
  days: number[];
  time: string;
  dayOfMonth?: number;
  nthWeekday?: { week: number; weekday: number };
  startMonth?: number;
  autoApprove: boolean;
};

/** The form for a stored routine (or the defaults for a new one). */
export function scheduleForm(routine: Partial<Routine> = {}, now = new Date()): ScheduleForm {
  return {
    frequency: routine.frequency ?? "weekly",
    days: routine.days?.length ? routine.days : WEEKDAYS,
    time: routine.time ?? "08:00",
    monthlyBy: routine.nthWeekday ? "weekday" : "day",
    dayOfMonth: routine.dayOfMonth ?? 1,
    week: routine.nthWeekday?.week ?? 1,
    weekday: routine.nthWeekday?.weekday ?? 1,
    startMonth: routine.startMonth ?? now.getMonth() + 1,
    autoApprove: routine.autoApprove === true,
  };
}

/** Only what the chosen frequency uses, so an edit never keeps a stale rule. */
export function scheduleInput(form: ScheduleForm): ScheduleInput {
  const base = { frequency: form.frequency, time: form.time, autoApprove: form.autoApprove };
  if (form.frequency === "weekly" || form.frequency === "biweekly")
    return { ...base, days: form.days };
  const rule =
    form.monthlyBy === "weekday"
      ? { nthWeekday: { week: form.week, weekday: form.weekday } }
      : { dayOfMonth: form.dayOfMonth };
  return {
    ...base,
    days: WEEKDAYS,
    ...rule,
    ...(form.frequency === "quarterly" ? { startMonth: form.startMonth } : {}),
  };
}

export function scheduleValid(form: ScheduleForm) {
  if (!TIME_PATTERN.test(form.time)) return false;
  if (form.frequency === "weekly" || form.frequency === "biweekly") return form.days.length > 0;
  if (form.monthlyBy === "day")
    return Number.isInteger(form.dayOfMonth) && form.dayOfMonth >= 1 && form.dayOfMonth <= 31;
  return true;
}

/** "Todo dia 2 do mês · 09:00" for what the form holds right now. */
export function scheduleSummary(form: ScheduleForm) {
  return describeRoutineSchedule(scheduleInput(form));
}
