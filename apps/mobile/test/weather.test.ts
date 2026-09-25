import assert from "node:assert/strict";
import { test } from "node:test";
import {
  feelsLine,
  hourLabel,
  iconFamily,
  nextDays,
  shortDay,
  showRain,
  weatherOf,
} from "../src/features/weather/weather.ts";

const report = {
  kind: "weather",
  place: "São Paulo",
  now: {
    temperature: 20.4,
    feelsLike: 19.6,
    label: "Nublado",
    icon: "cloud",
    humidity: 78,
    windKmh: 12,
  },
  days: [
    {
      date: "2026-09-24",
      name: "Hoje",
      label: "Chuva",
      icon: "rain",
      max: 21,
      min: 13,
      rainChance: 80,
    },
    {
      date: "2026-09-25",
      name: "Amanhã",
      label: "Nublado",
      icon: "cloud",
      max: 24,
      min: 15,
      rainChance: 20,
    },
    {
      date: "2026-09-26",
      name: "Depois de amanhã",
      label: "Sol",
      icon: "sun",
      max: 27,
      min: 16,
      rainChance: 0,
    },
  ],
  hours: [{ time: "12:00", temperature: 20, icon: "hail", rainChance: 40 }],
  alert: "Chuva prevista em ~30 min",
};

test("reads a weather result from JSON or an object; unknown icons become a cloud", () => {
  const parsed = weatherOf(JSON.stringify(report));
  assert.ok(parsed);
  assert.equal(parsed.now.temperature, 20);
  assert.equal(parsed.now.feelsLike, 20);
  assert.equal(parsed.hours[0]?.icon, "cloud");
  assert.equal(weatherOf(report)?.alert, "Chuva prevista em ~30 min");
});

test("an error or a malformed result renders no card", () => {
  assert.equal(weatherOf({ error: 'Não encontrei "Xyz".' }), undefined);
  assert.equal(weatherOf("not json"), undefined);
  assert.equal(weatherOf({ ...report, now: undefined }), undefined);
});

test("formatting: feels-like line, rain threshold, hour and day labels", () => {
  const parsed = weatherOf(report);
  assert.ok(parsed);
  assert.equal(feelsLine(parsed), "Sensação 20° · Máx 21° · Mín 13°");
  assert.equal(feelsLine({ ...parsed, days: [] }), "Sensação 20°");
  assert.equal(showRain(29), false);
  assert.equal(showRain(30), true);
  assert.equal(hourLabel(0, "12:00"), "Agora");
  assert.equal(hourLabel(1, "13:00"), "13:00");
  assert.equal(shortDay("Depois de amanhã"), "Depois");
  assert.equal(shortDay("Amanhã"), "Amanhã");
  assert.deepEqual(
    nextDays(parsed).map((day) => day.name),
    ["Amanhã", "Depois de amanhã"],
  );
});

test("icon families pick the tile palette", () => {
  assert.equal(iconFamily("partly"), "sun");
  assert.equal(iconFamily("partly-night"), "night");
  assert.equal(iconFamily("heavy-rain"), "rain");
  assert.equal(iconFamily("thunder"), "storm");
  assert.equal(iconFamily("fog"), "fog");
  assert.equal(iconFamily("cloud"), "cloud");
});
