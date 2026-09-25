// A small map picture for the route card: basemap tiles around the path, the path drawn on top,
// start and end dots, attribution. No API key: tiles come from MAP_TILES_URL (default the
// OpenStreetMap tile server, fine for a personal assistant's light use: identified User-Agent,
// every picture cached on disk), so any self-hosted Corgi can draw it.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../platform/config.ts";

const TILE = 256;
const DEFAULT_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = "© OpenStreetMap";

/** Google's encoded polyline → [lat, lng] points. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Web Mercator: world pixel coordinates at a zoom level. */
const project = ([lat, lng]: [number, number], zoom: number) => {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
};

/** The largest zoom (≤ 16) where the path fits in the picture with some margin. */
export function fitZoom(points: [number, number][], width: number, height: number) {
  for (let zoom = 16; zoom > 2; zoom--) {
    const xy = points.map((p) => project(p, zoom));
    const w = Math.max(...xy.map((p) => p.x)) - Math.min(...xy.map((p) => p.x));
    const h = Math.max(...xy.map((p) => p.y)) - Math.min(...xy.map((p) => p.y));
    if (w <= width * 0.86 && h <= height * 0.82) return zoom;
  }
  return 3;
}

export class StaticMaps {
  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private get tiles() {
    return process.env.MAP_TILES_URL?.trim() || DEFAULT_TILES;
  }

  /** A stable id for this path (the picture's cache key). */
  static id(polyline: string) {
    return createHash("sha256").update(polyline).digest("hex").slice(0, 24);
  }

  /** PNG of the path over the basemap, 2x for phones (width/height in points). */
  async render(polyline: string, width = 360, height = 200): Promise<Buffer> {
    const directory = join(this.config.dataDir, "maps");
    const path = join(directory, `${StaticMaps.id(polyline)}-${width}x${height}.png`);
    const cached = await readFile(path).catch(() => undefined);
    if (cached) return cached;
    const points = decodePolyline(polyline);
    if (points.length < 2) throw new Error("Rota sem pontos suficientes");
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const scale = 2;
    const canvas = createCanvas(width * scale, height * scale);
    const context = canvas.getContext("2d");
    const zoom = fitZoom(points, width, height);
    const xy = points.map((p) => project(p, zoom));
    const centerX = (Math.max(...xy.map((p) => p.x)) + Math.min(...xy.map((p) => p.x))) / 2;
    const centerY = (Math.max(...xy.map((p) => p.y)) + Math.min(...xy.map((p) => p.y))) / 2;
    const left = centerX - width / 2;
    const top = centerY - height / 2;
    context.fillStyle = "#EEF1F4";
    context.fillRect(0, 0, width * scale, height * scale);
    // Tiles covering the picture (at @2x each tile image is 512 px for 256 world pixels).
    const jobs: Promise<void>[] = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++)
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        const url = this.tiles
          .replace("{z}", String(zoom))
          .replace("{x}", String(tx))
          .replace("{y}", String(ty));
        jobs.push(
          this.fetcher(url, {
            headers: { "User-Agent": "Corgi self-hosted assistant (route card)" },
            signal: AbortSignal.timeout(8000),
          })
            .then(async (response) => {
              if (!response.ok) return;
              const image = await loadImage(Buffer.from(await response.arrayBuffer()));
              context.drawImage(
                image,
                (tx * TILE - left) * scale,
                (ty * TILE - top) * scale,
                TILE * scale,
                TILE * scale,
              );
            })
            .catch(() => undefined),
        );
      }
    await Promise.all(jobs);
    // Soften the basemap so the route stands out, in the app's light style.
    context.fillStyle = "rgba(246,248,250,0.45)";
    context.fillRect(0, 0, width * scale, height * scale);
    // The path: a white casing under a blue line, then the start and end dots.
    const line = () => {
      context.beginPath();
      xy.forEach((p, i) => {
        const x = (p.x - left) * scale;
        const y = (p.y - top) * scale;
        if (i) context.lineTo(x, y);
        else context.moveTo(x, y);
      });
    };
    context.lineJoin = "round";
    context.lineCap = "round";
    line();
    context.strokeStyle = "rgba(255,255,255,0.95)";
    context.lineWidth = 9 * scale;
    context.stroke();
    line();
    context.strokeStyle = "#2F6FDE";
    context.lineWidth = 5 * scale;
    context.stroke();
    const dot = (p: { x: number; y: number }, color: string) => {
      context.beginPath();
      context.arc((p.x - left) * scale, (p.y - top) * scale, 7 * scale, 0, Math.PI * 2);
      context.fillStyle = "#FFFFFF";
      context.fill();
      context.beginPath();
      context.arc((p.x - left) * scale, (p.y - top) * scale, 4.5 * scale, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    };
    dot(xy[0], "#3E8E5E");
    dot(xy[xy.length - 1], "#11191C");
    context.font = `${9 * scale}px sans-serif`;
    context.fillStyle = "rgba(60,70,80,0.75)";
    context.textAlign = "right";
    context.fillText(ATTRIBUTION, (width - 6) * scale, (height - 6) * scale);
    const png = canvas.toBuffer("image/png");
    await mkdir(directory, { recursive: true });
    await writeFile(path, png).catch(() => undefined);
    return png;
  }
}
