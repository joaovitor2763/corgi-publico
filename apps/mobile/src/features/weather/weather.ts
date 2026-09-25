// The get_weather tool result, read defensively (results arrive as JSON strings or objects; an
// error or anything malformed renders no card), and the small formatting rules of the card.
import { z } from "zod";

export const WEATHER_ICONS = [
  "sun",
  "moon",
  "partly",
  "partly-night",
  "cloud",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "snow",
  "thunder",
] as const;
export type WeatherIconName = (typeof WEATHER_ICONS)[number];

/** An unknown icon still draws something sensible: a cloud. */
const icon = z
  .string()
  .catch("cloud")
  .transform(
    (value): WeatherIconName =>
      (WEATHER_ICONS as readonly string[]).includes(value) ? (value as WeatherIconName) : "cloud",
  );
const whole = z.number().transform(Math.round);
const percent = z
  .number()
  .catch(0)
  .transform((n) => Math.min(100, Math.max(0, Math.round(n))));

const reportSchema = z.object({
  kind: z.literal("weather"),
  place: z.string().min(1).max(200),
  now: z.object({
    temperature: whole,
    feelsLike: whole,
    label: z.string().max(80),
    icon,
    humidity: percent,
    windKmh: z.number().catch(0).transform(Math.round),
  }),
  days: z
    .array(
      z.object({
        date: z.string(),
        name: z.string().max(40),
        label: z.string().max(80),
        icon,
        max: whole,
        min: whole,
        rainChance: percent,
        sunrise: z.string().max(10).optional().catch(undefined),
        sunset: z.string().max(10).optional().catch(undefined),
      }),
    )
    .max(7)
    .catch([]),
  hours: z
    .array(z.object({ time: z.string().max(10), temperature: whole, icon, rainChance: percent }))
    .max(48)
    .catch([]),
  alert: z.string().max(160).optional().catch(undefined),
});
export type WeatherReport = z.infer<typeof reportSchema>;

export function weatherOf(result: unknown): WeatherReport | undefined {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const parsed = reportSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export const deg = (n: number) => `${n}°`;

/** "Sensação 20° · Máx 21° · Mín 13°" (today's max/min when the report has them). */
export function feelsLine(report: WeatherReport) {
  const today = report.days[0];
  return [
    `Sensação ${deg(report.now.feelsLike)}`,
    today && `Máx ${deg(today.max)}`,
    today && `Mín ${deg(today.min)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Rain chances below this are noise on a small card. */
export const RAIN_WORTH_SHOWING = 30;
export const showRain = (chance: number) => chance >= RAIN_WORTH_SHOWING;

/** The first hour of the strip is the current one. */
export const hourLabel = (index: number, time: string) => (index === 0 ? "Agora" : time);

/** Day names short enough for a half-width tile: "Depois de amanhã" → "Depois". */
export const shortDay = (name: string) => (/^depois de amanh/i.test(name) ? "Depois" : name);

/** Tomorrow and the day after, for the compact row under today. */
export const nextDays = (report: WeatherReport) => report.days.slice(1, 3);

export type IconFamily = "sun" | "night" | "cloud" | "fog" | "rain" | "storm" | "snow";

/** Which palette an icon uses; the pale tile behind it follows the family. */
export function iconFamily(name: WeatherIconName): IconFamily {
  switch (name) {
    case "sun":
    case "partly":
      return "sun";
    case "moon":
    case "partly-night":
      return "night";
    case "fog":
      return "fog";
    case "drizzle":
    case "rain":
    case "heavy-rain":
      return "rain";
    case "thunder":
      return "storm";
    case "snow":
      return "snow";
    default:
      return "cloud";
  }
}

export const TILE: Record<IconFamily, string> = {
  sun: "#FFF5DC",
  night: "#F1EEFC",
  cloud: "#EEF2F6",
  fog: "#F0F2F4",
  rain: "#E8F2FC",
  storm: "#EDEFF6",
  snow: "#EDF4FB",
};
