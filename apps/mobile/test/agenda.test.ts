import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dayHeader,
  liftCommonBadges,
  nowMarker,
  overlapping,
  timeRange,
} from "../src/features/chat/agenda.ts";

test("agenda times parse and overlaps are found from the times", () => {
  assert.deepEqual(timeRange("09:30–12:30"), { start: 570, end: 750 });
  assert.deepEqual(timeRange("9h30 - 12h30"), { start: 570, end: 750 });
  assert.equal(timeRange("Dia todo"), undefined);
  const day = [
    { subtitle: "06:30–08:30" },
    { subtitle: "08:00–09:30" },
    { subtitle: "09:30–12:30" },
    { subtitle: "10:00–11:15" },
    { subtitle: "13:00–14:00" },
  ];
  assert.deepEqual([...overlapping(day)].sort(), [0, 1, 2, 3]);
});

test("a badge on every item moves to the header; the rest stay", () => {
  const { items, common } = liftCommonBadges([
    { badges: ["ana@empresa.com", "Meet"] },
    { badges: ["ana@empresa.com"] },
  ]);
  assert.deepEqual(common, ["ana@empresa.com"]);
  assert.deepEqual(items, [{ badges: ["Meet"] }, { badges: [] }]);
  assert.deepEqual(liftCommonBadges([{ badges: ["a"] }]).common, [], "one item keeps its badges");
});

test("a one-day timeline gets a day header in pt-BR and a now marker only today", () => {
  const now = new Date(2026, 8, 24, 14, 26);
  assert.deepEqual(dayHeader("2026-09-24", now), {
    day: "24",
    weekday: "quinta-feira",
    month: "24 de setembro",
    today: true,
  });
  assert.equal(dayHeader("2026-09-25", now)?.today, false);
  assert.equal(dayHeader("hoje", now), undefined);
  assert.equal(dayHeader("2026-13-40", now), undefined);
  const day = [
    { subtitle: "08:30–09:30" },
    { subtitle: "12:00–13:00" },
    { subtitle: "Dia todo" },
    { subtitle: "15:00–16:00" },
  ];
  assert.deepEqual(nowMarker(day, "2026-09-24", now), { index: 2, label: "14:26" });
  assert.equal(nowMarker(day, "2026-09-25", now), undefined, "not today");
  assert.equal(nowMarker([{ subtitle: "Dia todo" }], "2026-09-24", now), undefined, "no times");
  assert.equal(nowMarker(day, "2026-09-24", new Date(2026, 8, 24, 9, 0))?.index, 1, "inside");
  assert.equal(nowMarker(day, "2026-09-24", new Date(2026, 8, 24, 7, 0)), undefined, "before");
  assert.equal(nowMarker(day, "2026-09-24", new Date(2026, 8, 24, 23, 0)), undefined, "after");
});

test("a timeline is always in time order; all-day items first", async () => {
  const { inTimeOrder } = await import("../src/features/chat/agenda.ts");
  const ordered = inTimeOrder([
    { subtitle: "09:00–09:30", title: "pessoal" },
    { subtitle: "08:00–11:00", title: "workshop" },
    { subtitle: "Dia todo", title: "feriado" },
    { subtitle: "08:00–08:30", title: "curto" },
  ]).map((item) => item.title);
  assert.deepEqual(ordered, ["feriado", "curto", "workshop", "pessoal"]);
});
