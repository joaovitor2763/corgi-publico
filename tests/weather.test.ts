import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, getWeather } from "../apps/server/src/weather/weather.ts";

const forecast = {
  current: {
    time: "2026-09-24T12:15",
    temperature_2m: 19.5,
    apparent_temperature: 19.8,
    relative_humidity_2m: 70,
    weather_code: 3,
    wind_speed_10m: 6.4,
    is_day: 1,
  },
  hourly: {
    time: ["2026-09-24T11:00", "2026-09-24T12:00", "2026-09-24T13:00", "2026-09-24T14:00"],
    temperature_2m: [18, 19.4, 20.2, 21],
    weather_code: [3, 3, 61, 61],
    precipitation_probability: [10, 20, 70, 80],
    is_day: [1, 1, 1, 1],
  },
  daily: {
    time: ["2026-09-24", "2026-09-25"],
    temperature_2m_max: [20.6, 24],
    temperature_2m_min: [13.2, 14],
    weather_code: [61, 0],
    precipitation_probability_max: [71, 5],
    sunrise: ["2026-09-24T05:53", "2026-09-25T05:52"],
    sunset: ["2026-09-24T18:03", "2026-09-25T18:04"],
  },
  minutely_15: {
    time: ["2026-09-24T12:15", "2026-09-24T12:30", "2026-09-24T12:45"],
    precipitation: [0, 0, 0.3],
  },
};
const fake = (async (url: string) =>
  new Response(
    JSON.stringify(
      String(url).includes("geocoding")
        ? {
            results: [
              {
                name: "São Paulo",
                admin1: "São Paulo",
                country_code: "BR",
                latitude: -23.5,
                longitude: -46.6,
                timezone: "America/Sao_Paulo",
              },
            ],
          }
        : forecast,
    ),
  )) as unknown as typeof fetch;

test("weather: now, days, next hours and a rain alert, in pt-BR", async () => {
  const report = await getWeather("São Paulo", { timeZone: "America/Sao_Paulo", fetch: fake });
  assert.equal(report.place, "São Paulo");
  assert.deepEqual(
    [report.now.temperature, report.now.label, report.now.icon],
    [20, "Nublado", "cloud"],
  );
  assert.deepEqual(
    report.days.map((d) => [d.name, d.label, d.max, d.min, d.rainChance]),
    [
      ["Hoje", "Chuva fraca", 21, 13, 71],
      ["Amanhã", "Céu limpo", 24, 14, 5],
    ],
  );
  assert.equal(report.hours[0].time, "12:00");
  assert.equal(report.alert, "Chuva prevista em ~30 min");
});

test("WMO codes map to words and icons, day and night", () => {
  assert.deepEqual(describe(0, false), { label: "Noite limpa", icon: "moon" });
  assert.equal(describe(95).icon, "thunder");
  assert.equal(describe(45).icon, "fog");
  assert.equal(describe(65).icon, "heavy-rain");
});

test("a network hiccup is retried once", async () => {
  let failures = 1;
  const flaky = (async (url: string) => {
    if (failures-- > 0) throw new TypeError("fetch failed");
    return fake(url);
  }) as unknown as typeof fetch;
  const report = await getWeather("São Paulo", { timeZone: "America/Sao_Paulo", fetch: flaky });
  assert.equal(report.place, "São Paulo");
});
