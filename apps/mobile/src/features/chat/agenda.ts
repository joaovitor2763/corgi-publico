// Times in an agenda card: parsed from the labels the agent sends, to find overlaps ourselves.

/** "09:30–12:30" (also "9h30 - 12h30") → minutes since midnight, or undefined for all-day. */
export function timeRange(label?: string) {
  const m = label?.match(/(\d{1,2})[:h](\d{2})\s*[–—-]\s*(\d{1,2})[:h](\d{2})/);
  if (!m) return undefined;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return { start, end: end > start ? end : end + 24 * 60 };
}

/** Indexes of events that overlap another one. */
export function overlapping(items: { subtitle?: string }[]) {
  const ranges = items.map((item) => timeRange(item.subtitle));
  const clash = new Set<number>();
  ranges.forEach((a, i) => {
    ranges.forEach((b, j) => {
      if (i < j && a && b && a.start < b.end && b.start < a.end) {
        clash.add(i);
        clash.add(j);
      }
    });
  });
  return clash;
}

/**
 * Badges every item carries (the same account on each event, say) say nothing per row: lift them
 * out once, for the card's header, and keep only what differs on each item.
 */
export function liftCommonBadges<T extends { badges?: string[] }>(items: T[]) {
  if (items.length < 2) return { items, common: [] as string[] };
  const common = (items[0].badges ?? []).filter((badge) =>
    items.every((item) => item.badges?.includes(badge)),
  );
  if (!common.length) return { items, common };
  return {
    common,
    items: items.map((item) => ({
      ...item,
      badges: item.badges?.filter((badge) => !common.includes(badge)),
    })),
  };
}

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-09-24" as a local calendar day, or undefined when it isn't one. */
export function parseDay(date?: string) {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // JavaScript rolls "2026-13-40" over into a real date; only a day that reads back is one.
  return day.getMonth() === Number(m[2]) - 1 && day.getDate() === Number(m[3]) ? day : undefined;
}

/** The big day header of a one-day timeline: "24" · "quarta-feira" · "24 de setembro". */
export function dayHeader(date: string | undefined, now = new Date()) {
  const day = parseDay(date);
  if (!day) return undefined;
  const today =
    day.getFullYear() === now.getFullYear() &&
    day.getMonth() === now.getMonth() &&
    day.getDate() === now.getDate();
  return {
    day: String(day.getDate()),
    weekday: WEEKDAYS[day.getDay()] ?? "",
    month: `${day.getDate()} de ${MONTHS[day.getMonth()] ?? ""}`,
    today,
  };
}

/**
 * Where "now" falls in a day's events: the index before which to draw the marker (after every
 * event that already started), or undefined when the day isn't today or now is outside the span
 * of the day's timed events (a line above the first event or below the last says nothing).
 */
export function nowMarker(
  items: { subtitle?: string }[],
  date: string | undefined,
  now = new Date(),
) {
  const header = dayHeader(date, now);
  if (!header?.today) return undefined;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const ranges = items.map((item) => timeRange(item.subtitle));
  const timed = ranges.filter((range) => !!range);
  if (!timed.length) return undefined;
  const first = Math.min(...timed.map((range) => range.start));
  const last = Math.max(...timed.map((range) => range.end));
  if (minutes < first || minutes > last) return undefined;
  let index = 0;
  ranges.forEach((range, i) => {
    if (range && range.start <= minutes) index = i + 1;
  });
  return {
    index,
    label: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
  };
}

/**
 * A timeline in time order, whatever order the agent sent (it merges several calendars): items
 * without a time range (all-day) first, then by start, then by end. Stable otherwise.
 */
export function inTimeOrder<T extends { subtitle?: string }>(items: T[]) {
  return items
    .map((item, index) => ({ item, index, range: timeRange(item.subtitle) }))
    .sort((a, b) => {
      if (!a.range || !b.range) return (a.range ? 1 : 0) - (b.range ? 1 : 0) || a.index - b.index;
      return a.range.start - b.range.start || a.range.end - b.range.end || a.index - b.index;
    })
    .map((entry) => entry.item);
}
