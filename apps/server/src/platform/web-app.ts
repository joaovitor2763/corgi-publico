// Serves the exported web app (apps/mobile/dist/web) from the API itself, so one port behind
// `tailscale serve` gives the phone both the app and /api on the same origin. Only used when
// WEB_APP_DIR is set (or the default export exists); /api/* never reaches here.
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { Hono } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".webmanifest": "application/manifest+json",
};

/** The web export to serve, or undefined when there is none (API-only deployments). */
export function webAppDir(env = process.env) {
  const dir = resolve(env.WEB_APP_DIR ?? "apps/mobile/dist/web");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".map", ".svg", ".webmanifest"]);
/** Compressed copies of the export's files, made once per file version (bundles never change). */
const packed = new Map<string, { mtime: number; br: Buffer; gzip: Buffer }>();

async function compressedFile(path: string, mtime: number) {
  const hit = packed.get(path);
  if (hit?.mtime === mtime) return hit;
  const raw = await readFile(path);
  const next = {
    mtime,
    br: brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
    gzip: gzipSync(raw, { level: 9 }),
  };
  packed.set(path, next);
  return next;
}

export function serveWebApp<E extends object>(app: Hono<E>, dir: string) {
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    let decoded: string;
    try {
      decoded = decodeURIComponent(c.req.path);
    } catch {
      decoded = "/";
    }
    const wanted = normalize(decoded).replace(/^([/\\])+/, "");
    const file = resolve(dir, wanted);
    // Never outside the export directory, whatever the path says.
    const inside = file === dir || file.startsWith(dir + sep);
    const info = inside ? await stat(file).catch(() => undefined) : undefined;
    const found = info?.isFile();
    // A missing file (a bundle from an older deploy, still named by a cached page) is a 404.
    // Answering it with index.html makes the browser run HTML as code: a blank screen.
    if (!found && (wanted.startsWith("_expo/") || /\.[a-z0-9]{2,5}$/i.test(wanted)))
      return c.text("Not found", 404);
    // Unknown paths are app routes (/regi, /mascot…): the single page decides.
    const path = found ? file : join(dir, "index.html");
    c.header("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
    // Hashed bundles never change; index.html must always be fresh to pick up a new deploy.
    c.header(
      "Cache-Control",
      found && path.includes(`${sep}_expo${sep}static${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    // The app's code is ~5 MB: compressed it is about a fifth, which is what a phone waits for.
    const accept = c.req.header("accept-encoding") ?? "";
    const mtime = found && info ? info.mtimeMs : (await stat(path)).mtimeMs;
    if (COMPRESSIBLE.has(extname(path)) && /\b(br|gzip)\b/.test(accept)) {
      const copy = await compressedFile(path, mtime);
      const br = /\bbr\b/.test(accept);
      c.header("Content-Encoding", br ? "br" : "gzip");
      c.header("Vary", "Accept-Encoding");
      return c.body(new Uint8Array(br ? copy.br : copy.gzip));
    }
    return c.body(await readFile(path));
  });
}
