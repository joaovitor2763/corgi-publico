// show_route: the tool's arguments are the trip (the agent copies them from a directions result),
// the result only adds the Maps link. The path is drawn from Google's encoded polyline, without
// map tiles: decoded here, projected and fitted into the card's drawing box.
import { z } from "zod";

export const routeSchema = z.object({
  from: z.string().min(1).max(200),
  to: z.string().min(1).max(200),
  mode: z.enum(["driving", "transit", "walking", "bicycling"]).catch("driving").default("driving"),
  duration: z.string().min(1).max(40),
  distance: z.string().max(40).optional(),
  leaveBy: z.string().max(10).optional(),
  arriveBy: z.string().max(10).optional(),
  via: z.string().max(120).optional(),
  warnings: z.array(z.string().max(120)).max(3).optional(),
  steps: z.array(z.string().max(160)).max(12).optional(),
  polyline: z.string().max(20_000).optional(),
});
export type Route = z.infer<typeof routeSchema>;
export type TravelMode = Route["mode"];

export function routeOf(args: unknown): Route | undefined {
  const parsed = routeSchema.safeParse(args);
  return parsed.success ? parsed.data : undefined;
}

/** The same link the server returns, for while the tool is still running. */
export function mapsUrlFor(route: Pick<Route, "from" | "to" | "mode">) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(route.from)}&destination=${encodeURIComponent(route.to)}&travelmode=${route.mode}`;
}

/** The server's link when the result has one (https only), else the same link built here. */
export function mapsUrlOf(result: unknown, route: Route) {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  }
  const url =
    value && typeof value === "object" ? (value as { mapsUrl?: unknown }).mapsUrl : undefined;
  return typeof url === "string" && /^https:\/\//.test(url) ? url : mapsUrlFor(route);
}

export const MODE_LABEL: Record<TravelMode, string> = {
  driving: "De carro",
  transit: "Transporte público",
  walking: "A pé",
  bicycling: "De bicicleta",
};

/** "10,7 km · via Av. Bandeirantes". */
export const distanceLine = (route: Route) =>
  [route.distance, route.via && `via ${route.via.replace(/^via\s+/i, "")}`]
    .filter(Boolean)
    .join(" · ");

/** "Saia até 09:15 para chegar 09:45", or whichever half the route has. */
export function timingLine(route: Route) {
  if (route.leaveBy && route.arriveBy)
    return `Saia até ${route.leaveBy} para chegar ${route.arriveBy}`;
  if (route.leaveBy) return `Saia até ${route.leaveBy}`;
  if (route.arriveBy) return `Chegada prevista às ${route.arriveBy}`;
  return "";
}

/** Google's encoded polyline format (precision 5) → [lat, lng] pairs. Malformed input stops early. */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return undefined;
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return undefined;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === undefined || dLng === undefined) break;
    lat += dLat;
    lng += dLng;
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

/** The inverse, for fixtures and tests. */
export function encodePolyline(points: [number, number][], precision = 5) {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const put = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    put(la - prevLat);
    put(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

export interface RoutePath {
  /** SVG path data in the box's coordinates. */
  d: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Fits the points into a width × height box with padding, keeping the shape (longitude is
 * shrunk by cos(latitude) so a city block stays square), centered. Points closer than half a
 * unit to the previous one are dropped: a long route has thousands the eye can't see.
 */
export function fitPath(
  points: [number, number][],
  width: number,
  height: number,
  padding = 20,
): RoutePath | undefined {
  if (points.length < 2 || width <= padding * 2 || height <= padding * 2) return undefined;
  const meanLat = points.reduce((sum, [lat]) => sum + lat, 0) / points.length;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const xy = points.map(([lat, lng]) => [lng * kx, -lat] as const);
  const xs = xy.map(([x]) => x);
  const ys = xy.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  if (spanX === 0 && spanY === 0) return undefined;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(spanX ? innerW / spanX : Infinity, spanY ? innerH / spanY : Infinity);
  const offsetX = padding + (innerW - spanX * scale) / 2;
  const offsetY = padding + (innerH - spanY * scale) / 2;
  const round = (n: number) => Math.round(n * 10) / 10;
  const projected = xy.map(([x, y]) => ({
    x: round(offsetX + (x - minX) * scale),
    y: round(offsetY + (y - minY) * scale),
  }));
  const kept = [projected[0]];
  for (let i = 1; i < projected.length; i++) {
    const last = kept[kept.length - 1];
    const point = projected[i];
    const isEnd = i === projected.length - 1;
    if (isEnd || Math.hypot(point.x - last.x, point.y - last.y) >= 0.5) kept.push(point);
  }
  const d = kept.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  return { d, start: kept[0], end: kept[kept.length - 1] };
}

/** The polyline the server filled in from the Maps result, when the model didn't pass one. */
export function polylineOf(result: unknown) {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const line =
    value && typeof value === "object" ? (value as { polyline?: unknown }).polyline : undefined;
  return typeof line === "string" && line.length > 10 ? line : undefined;
}

/** The server-drawn map picture of the path (https or same-origin signed URL). */
export function mapImageOf(result: unknown) {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const url =
    value && typeof value === "object" ? (value as { mapImage?: unknown }).mapImage : undefined;
  return typeof url === "string" && /^(https?:)?\/\//.test(url) ? url : undefined;
}
