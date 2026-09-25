// get_weather: current conditions, today/tomorrow and the next hours for a place, from Open-Meteo
// (free, no key, so any self-hosted Corgi has it). The result is also the chat's weather card.
import { AppError } from "../platform/errors.ts";

export type WeatherIcon =
  | "sun"
  | "moon"
  | "partly"
  | "partly-night"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "snow"
  | "thunder";

/** WMO weather codes → words and an icon. */
export function describe(code: number, day = true): { label: string; icon: WeatherIcon } {
  if (code === 0) return { label: day ? "Céu limpo" : "Noite limpa", icon: day ? "sun" : "moon" };
  if (code <= 2) return { label: "Parcialmente nublado", icon: day ? "partly" : "partly-night" };
  if (code === 3) return { label: "Nublado", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Neblina", icon: "fog" };
  if (code >= 51 && code <= 57) return { label: "Garoa", icon: "drizzle" };
  if (code === 61 || code === 80) return { label: "Chuva fraca", icon: "rain" };
  if (code === 63 || code === 81) return { label: "Chuva", icon: "rain" };
  if (code === 65 || code === 82 || code === 66 || code === 67)
    return { label: "Chuva forte", icon: "heavy-rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { label: "Neve", icon: "snow" };
  if (code >= 95) return { label: "Tempestade", icon: "thunder" };
  return { label: "Nublado", icon: "cloud" };
}

export interface WeatherReport {
  kind: "weather";
  place: string;
  now: {
    temperature: number;
    feelsLike: number;
    label: string;
    icon: WeatherIcon;
    humidity: number;
    windKmh: number;
  };
  days: {
    date: string;
    /** "Hoje", "Amanhã", "Depois de amanhã". */
    name: string;
    label: string;
    icon: WeatherIcon;
    max: number;
    min: number;
    rainChance: number;
    sunrise?: string;
    sunset?: string;
  }[];
  hours: { time: string; temperature: number; icon: WeatherIcon; rainChance: number }[];
  /** "Chuva prevista em ~30 min" when rain starts within 2 hours. */
  alert?: string;
}

const round = (value: unknown) => Math.round(Number(value));
const hhmm = (iso: string) => iso.slice(11, 16);

export async function getWeather(
  place: string,
  options: { timeZone: string; fetch?: typeof fetch; signal?: AbortSignal },
): Promise<WeatherReport> {
  const once = options.fetch ?? fetch;
  // One retry on a network hiccup (Open-Meteo is free and occasionally drops a connection).
  const get: typeof fetch = (input, init) =>
    once(input, init).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return once(input, init);
    });
  const signal = options.signal ?? AbortSignal.timeout(15_000);
  const geo = (await (
    await get(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=${encodeURIComponent(place)}`,
      { signal },
    )
  ).json()) as {
    results?: {
      name: string;
      admin1?: string;
      country_code?: string;
      latitude: number;
      longitude: number;
      timezone?: string;
    }[];
  };
  const spot = geo.results?.[0];
  if (!spot) throw new AppError(`Não encontrei "${place}". Tente com cidade e estado.`, 404);
  const timeZone = spot.timezone ?? options.timeZone;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day" +
    "&hourly=temperature_2m,weather_code,precipitation_probability,is_day" +
    "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset" +
    "&minutely_15=precipitation&forecast_minutely_15=8&forecast_days=3" +
    `&timezone=${encodeURIComponent(timeZone)}`;
  const data = (await (await get(url, { signal })).json()) as {
    current: Record<string, number | string>;
    hourly: Record<string, (number | string)[]>;
    daily: Record<string, (number | string)[]>;
    minutely_15?: { time: string[]; precipitation: number[] };
  };
  if (!data.current) throw new AppError("A previsão do tempo não respondeu. Tente de novo.", 502);
  const current = data.current;
  const now = String(current.time);
  const code = Number(current.weather_code);
  const day = Number(current.is_day) === 1;
  const hourIndex = Math.max(
    0,
    data.hourly.time.findIndex((time) => String(time) >= now.slice(0, 13)),
  );
  const hours = data.hourly.time.slice(hourIndex, hourIndex + 12).map((time, i) => ({
    time: hhmm(String(time)),
    temperature: round(data.hourly.temperature_2m[hourIndex + i]),
    icon: describe(
      Number(data.hourly.weather_code[hourIndex + i]),
      Number(data.hourly.is_day[hourIndex + i]) === 1,
    ).icon,
    rainChance: round(data.hourly.precipitation_probability[hourIndex + i]),
  }));
  const names = ["Hoje", "Amanhã", "Depois de amanhã"];
  const days = data.daily.time.map((date, i) => ({
    date: String(date),
    name: names[i] ?? String(date),
    ...describe(Number(data.daily.weather_code[i])),
    max: round(data.daily.temperature_2m_max[i]),
    min: round(data.daily.temperature_2m_min[i]),
    rainChance: round(data.daily.precipitation_probability_max[i]),
    sunrise: data.daily.sunrise?.[i] ? hhmm(String(data.daily.sunrise[i])) : undefined,
    sunset: data.daily.sunset?.[i] ? hhmm(String(data.daily.sunset[i])) : undefined,
  }));
  // Rain in the next 2 hours (15-minute steps): when it starts, unless it's already raining.
  const rainingNow = ["drizzle", "rain", "heavy-rain", "thunder"].includes(describe(code).icon);
  const slots = data.minutely_15;
  const first = slots?.precipitation.findIndex((mm) => mm >= 0.1) ?? -1;
  let alert: string | undefined;
  if (!rainingNow && slots && first >= 0) {
    const minutes = Math.max(
      5,
      Math.round((Date.parse(`${slots.time[first]}:00Z`) - Date.parse(`${now}:00Z`)) / 60_000),
    );
    alert = `Chuva prevista em ~${minutes} min`;
  } else if (!rainingNow) {
    const soon = hours.slice(1, 4).find((hour) => hour.rainChance >= 60);
    if (soon) alert = `Chance de chuva às ${soon.time} (${soon.rainChance}%)`;
  }
  return {
    kind: "weather",
    place: [
      spot.name,
      spot.admin1 && spot.admin1 !== spot.name ? spot.admin1 : "",
      spot.country_code === "BR" ? "" : spot.country_code,
    ]
      .filter(Boolean)
      .join(", "),
    now: {
      temperature: round(current.temperature_2m),
      feelsLike: round(current.apparent_temperature),
      ...describe(code, day),
      humidity: round(current.relative_humidity_2m),
      windKmh: round(current.wind_speed_10m),
    },
    days,
    hours,
    ...(alert ? { alert } : {}),
  };
}
