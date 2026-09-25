// When a routine runs, and how to say it in Portuguese. Pure and dependency-free: the server
// computes the next run from it (`apps/server/src/routines`) and the app shows it.

export type RoutineFrequency = "weekly" | "biweekly" | "monthly" | "quarterly";

/** Wall-clock schedule of a routine. Records saved before `frequency` existed are weekly. */
export interface RoutineSchedule {
  frequency?: RoutineFrequency;
  /** 0 = Sunday … 6 = Saturday, in the routine's time zone (weekly and biweekly). */
  days: number[];
  /** "HH:MM", 24h, local to timeZone. */
  time: string;
  timeZone: string;
  /** Monthly and quarterly: day of the month, 1–31. 31 is the last day (shorter months clamp). */
  dayOfMonth?: number;
  /** Monthly and quarterly, instead of dayOfMonth: the Nth weekday ("2nd Monday"); week -1 = last. */
  nthWeekday?: { week: number; weekday: number };
  /** Quarterly: one of the months it runs in, 1–12; the others are every 3 months from it. */
  startMonth?: number;
  /** Biweekly: a local date (YYYY-MM-DD) in a week it runs; the week it was created by default. */
  anchor?: string;
}

const SHORT_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const LONG_DAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "Seg a sex", "Todo dia", "Fim de semana", "Seg, Qua". */
export function describeDays(days: number[]) {
  const sorted = [...new Set(days)].sort();
  return sorted.length === 7
    ? "Todo dia"
    : sorted.join() === "1,2,3,4,5"
      ? "Seg a sex"
      : sorted.join() === "0,6"
        ? "Fim de semana"
        : sorted.map((d) => SHORT_DAYS[d]).join(", ");
}

/** "2ª segunda-feira", "1º domingo", "Último sábado", "Última sexta-feira". */
export function describeNthWeekday({ week, weekday }: { week: number; weekday: number }) {
  const name = LONG_DAYS[weekday] ?? "";
  const feminine = weekday >= 1 && weekday <= 5;
  if (week === -1) return `${feminine ? "Última" : "Último"} ${name}`;
  return `${week}${feminine ? "ª" : "º"} ${name}`;
}

/** The four months a quarterly routine runs in, in calendar order: [1, 4, 7, 10] for startMonth 1. */
export function quarterMonths(startMonth = 1) {
  const first = ((startMonth - 1) % 3) + 1;
  return [first, first + 3, first + 6, first + 9];
}

/** "dia 2 do mês", "último dia do mês", "2ª segunda-feira do mês". */
function describeMonthDay(schedule: Pick<RoutineSchedule, "dayOfMonth" | "nthWeekday">) {
  if (schedule.nthWeekday) return describeNthWeekday(schedule.nthWeekday);
  const day = schedule.dayOfMonth ?? 1;
  return day >= 31 ? "Último dia" : `Dia ${day}`;
}

/**
 * The schedule as the person reads it: "Seg a sex · 08:00", "A cada 2 semanas · Seg · 08:00",
 * "Todo dia 2 do mês · 09:00", "Último dia do mês · 18:00", "2ª segunda-feira do mês · 09:00",
 * "Dia 5 de jan, abr, jul e out · 09:00".
 */
export function describeRoutineSchedule(
  schedule: Omit<RoutineSchedule, "timeZone"> & { timeZone?: string },
) {
  const { time } = schedule;
  switch (schedule.frequency ?? "weekly") {
    case "biweekly":
      return `A cada 2 semanas · ${describeDays(schedule.days)} · ${time}`;
    case "monthly": {
      const day = describeMonthDay(schedule);
      return `${schedule.nthWeekday || (schedule.dayOfMonth ?? 1) >= 31 ? day : `Todo ${day.toLowerCase()}`} do mês · ${time}`;
    }
    case "quarterly": {
      const months = quarterMonths(schedule.startMonth).map((m) => MONTHS[m - 1]);
      return `${describeMonthDay(schedule)} de ${months.slice(0, 3).join(", ")} e ${months[3]} · ${time}`;
    }
    default:
      return `${describeDays(schedule.days)} · ${time}`;
  }
}
