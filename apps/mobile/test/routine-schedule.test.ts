import assert from "node:assert/strict";
import test from "node:test";
import type { Routine } from "../../../packages/domain/src/agent";
import {
  LAST_DAY,
  quarterMonths,
  scheduleForm,
  scheduleInput,
  scheduleSummary,
  scheduleValid,
} from "../src/features/routines/schedule";

const routine = (over: Partial<Routine>): Partial<Routine> => ({
  id: "r1",
  title: "Rotina",
  prompt: "Faça algo",
  days: [1, 2, 3, 4, 5],
  time: "08:00",
  timeZone: "America/Sao_Paulo",
  enabled: true,
  nextRunAt: "2026-09-28T11:00:00.000Z",
  createdAt: "2026-09-25T12:00:00.000Z",
  ...over,
});

test("a new routine's form defaults to weekdays at 08:00 and asks before acting", () => {
  const form = scheduleForm({}, new Date("2026-09-25T12:00:00Z"));
  assert.equal(form.frequency, "weekly");
  assert.deepEqual(form.days, [1, 2, 3, 4, 5]);
  assert.equal(form.time, "08:00");
  assert.equal(form.startMonth, 9);
  assert.equal(form.autoApprove, false);
  assert.equal(scheduleSummary(form), "Seg a sex · 08:00");
  assert.deepEqual(scheduleInput(form), {
    frequency: "weekly",
    days: [1, 2, 3, 4, 5],
    time: "08:00",
    autoApprove: false,
  });
});

test("stored routines of every kind round-trip through the form", () => {
  const monthly = scheduleForm(
    routine({ frequency: "monthly", dayOfMonth: 2, time: "09:00", autoApprove: true }),
  );
  assert.equal(monthly.monthlyBy, "day");
  assert.equal(monthly.autoApprove, true);
  assert.equal(scheduleSummary(monthly), "Todo dia 2 do mês · 09:00");
  assert.deepEqual(scheduleInput(monthly), {
    frequency: "monthly",
    days: [1, 2, 3, 4, 5],
    time: "09:00",
    dayOfMonth: 2,
    autoApprove: true,
  });

  const lastDay = scheduleForm(routine({ frequency: "monthly", dayOfMonth: LAST_DAY }));
  assert.equal(scheduleSummary(lastDay), "Último dia do mês · 08:00");

  const nth = scheduleForm(
    routine({ frequency: "monthly", nthWeekday: { week: 2, weekday: 1 }, time: "09:00" }),
  );
  assert.equal(nth.monthlyBy, "weekday");
  assert.equal(scheduleSummary(nth), "2ª segunda-feira do mês · 09:00");
  assert.deepEqual(scheduleInput(nth).nthWeekday, { week: 2, weekday: 1 });
  assert.equal(scheduleInput(nth).dayOfMonth, undefined);

  const quarterly = scheduleForm(
    routine({ frequency: "quarterly", dayOfMonth: 5, startMonth: 1, time: "09:00" }),
  );
  assert.equal(scheduleSummary(quarterly), "Dia 5 de jan, abr, jul e out · 09:00");
  assert.equal(scheduleInput(quarterly).startMonth, 1);

  const biweekly = scheduleForm(
    routine({ frequency: "biweekly", days: [1], anchor: "2026-09-25" }),
  );
  assert.equal(scheduleSummary(biweekly), "A cada 2 semanas · Seg · 08:00");
  assert.equal("anchor" in scheduleInput(biweekly), false);
});

test("switching the frequency sends only that frequency's rule", () => {
  const form = scheduleForm(
    routine({ frequency: "monthly", nthWeekday: { week: -1, weekday: 5 } }),
  );
  const weekly = scheduleInput({ ...form, frequency: "weekly", days: [5] });
  assert.equal(weekly.nthWeekday, undefined);
  assert.equal(weekly.dayOfMonth, undefined);
  assert.deepEqual(weekly.days, [5]);
  const byDay = scheduleInput({ ...form, monthlyBy: "day", dayOfMonth: 15 });
  assert.equal(byDay.nthWeekday, undefined);
  assert.equal(byDay.dayOfMonth, 15);
  assert.equal(
    scheduleSummary({ ...form, frequency: "quarterly", startMonth: 11 }),
    "Última sexta-feira de fev, mai, ago e nov · 08:00",
  );
});

test("the form is valid only with a time and a rule that can run", () => {
  const form = scheduleForm({});
  assert.equal(scheduleValid(form), true);
  assert.equal(scheduleValid({ ...form, time: "8:00" }), false);
  assert.equal(scheduleValid({ ...form, days: [] }), false);
  assert.equal(scheduleValid({ ...form, frequency: "monthly", dayOfMonth: 0 }), false);
  assert.equal(scheduleValid({ ...form, frequency: "monthly", dayOfMonth: Number.NaN }), false);
  assert.equal(scheduleValid({ ...form, frequency: "monthly", dayOfMonth: 31 }), true);
  assert.equal(
    scheduleValid({ ...form, frequency: "quarterly", monthlyBy: "weekday", days: [] }),
    true,
  );
  assert.deepEqual(quarterMonths(11), [2, 5, 8, 11]);
});
