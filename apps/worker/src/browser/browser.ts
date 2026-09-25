import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { WorkerError } from "../errors.ts";
import { confirmCheckout, reviewCheckout } from "../navigator/checkout.ts";
import { type JevConfig, jevConfig, runJevTask } from "../navigator/jev.ts";
import { createLoginManager } from "../navigator/login.ts";
import {
  capturePdfDownload,
  MAX_DOWNLOAD_BYTES,
  type PdfDownload,
  readDownloadFailures,
} from "./downloads.ts";
import { validatePublicUrl } from "./network.ts";
import { startEgressProxy } from "./proxy.ts";

/** Saved browser profiles kept before the least recently used is removed. */
const PROFILE_LIMIT = Math.max(5, Number(process.env.WORKER_MAX_PROFILES) || 60);
/** Stores where a saved sign-in matters (same list the server's checkout policy allows). */
const STORES = (
  process.env.CHECKOUT_MERCHANTS ?? "ifood.com.br,mercadolivre.com.br,mercadolivre.com"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
function onStore(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return STORES.some((store) => host === store || host.endsWith(`.${store}`));
  } catch {
    return false;
  }
}

export interface Session {
  id: string;
  title: string;
  url: string;
  status: "active" | "closed" | "error";
  updatedAt: string;
  /** The browser profile (logins, cookies, storage) this session is a tab of. */
  profile?: string;
}
/** One Chromium per person: their logins and storage, with a tab for each session. */
type Profile = {
  context: BrowserContext;
  tempDirectory: string;
  tabs: Set<string>;
  /** Tabs the worker is opening itself (every other new page is a popup and is closed). */
  opening: number;
};
type Running = {
  profile: string;
  context: BrowserContext;
  page: Page;
  touched: number;
  pending: Set<Promise<void>>;
  downloadError?: boolean;
};
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSessionId(id: unknown): string {
  if (typeof id !== "string" || !SESSION_ID.test(id))
    throw new WorkerError("INVALID_SESSION", "É preciso um ID de sessão UUID válido.");
  return id.toLowerCase();
}

// Headless Chromium announces itself as "HeadlessChrome", which many sites block on
// sight. Sessions present the same browser's normal Chrome identity instead.
let userAgent: Promise<string> | undefined;
/** ws:// and wss:// checked by the same public-destination rule as http(s). */
export function socketHttpUrl(url: string) {
  return url.replace(/^ws(s?):/i, "http$1:");
}

function browserUserAgent() {
  userAgent ??= (async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage();
      return (await page.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome");
    } finally {
      await browser.close();
    }
  })().catch((error) => {
    userAgent = undefined;
    throw error;
  });
  return userAgent;
}

export async function createBrowserManager(options: {
  dataDir: string;
  maxSessions?: number;
  idleTimeoutMs?: number;
  jev?: JevConfig;
}) {
  const { dataDir, maxSessions = 8, idleTimeoutMs = 10 * 60_000, jev = jevConfig() } = options;
  const logins = createLoginManager();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const sessions = new Map<string, Session>();
  const running = new Map<string, Running>();
  const profiles = new Map<string, Profile>();
  const queues = new Map<string, Promise<unknown>>();
  const proxy = await startEgressProxy();
  for (const id of await readdir(dataDir)) {
    if (!SESSION_ID.test(id)) continue;
    try {
      const stored = JSON.parse(
        await readFile(join(dataDir, id, "session.json"), "utf8"),
      ) as Session;
      sessions.set(id, { ...stored, id, status: "closed" });
    } catch {
      /* An incomplete first launch has no session metadata to restore. */
    }
    if (sessions.has(id)) await readDownloadFailures(join(dataDir, id), true);
  }
  const directory = (id: string) => join(dataDir, validateSessionId(id));
  async function persist(session: Session) {
    const path = join(directory(session.id), "session.json");
    await writeFile(`${path}.tmp`, JSON.stringify(session), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    queues.set(id, next);
    try {
      return await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }
  function active(id: string) {
    const value = running.get(id);
    if (!value || value.page.isClosed())
      throw new WorkerError(
        "SESSION_CLOSED",
        "Abra esta sessão do navegador antes de usar o console dela.",
        409,
      );
    value.touched = Date.now();
    return value;
  }
  async function refresh(id: string) {
    const instance = active(id);
    if (instance.page.url() !== "about:blank") await validatePublicUrl(instance.page.url());
    const session: Session = {
      id,
      profile: instance.profile,
      title: (await instance.page.title()).slice(0, 300),
      url: instance.page.url(),
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    sessions.set(id, session);
    await persist(session);
    return session;
  }
  async function downloads(id: string): Promise<PdfDownload[]> {
    if (!sessions.has(id))
      throw new WorkerError("SESSION_NOT_FOUND", "Sessão do navegador não encontrada.", 404);
    const folder = join(directory(id), "downloads");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const list: PdfDownload[] = [];
    for (const name of await readdir(folder)) {
      if (!name.endsWith(".json")) continue;
      const item = JSON.parse(await readFile(join(folder, name), "utf8")) as PdfDownload;
      list.push(item);
    }
    return list;
  }
  async function navigate(id: string, url: string) {
    const target = await validatePublicUrl(url);
    const { page } = active(id);
    try {
      await page.goto(target.url.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
      // Chromium can follow redirects outside Playwright's initial route hook.
      // The proxy blocks those sockets, but its 403 is still an HTTP response:
      // validate the final location so the API does not report it as success.
      await validatePublicUrl(page.url());
    } catch (error) {
      if (error instanceof WorkerError && error.code === "BLOCKED_URL") {
        await page.goto("about:blank", { timeout: 5000 });
      }
      // A successful attachment intentionally aborts page navigation.
      if (!(error instanceof Error && /Download is starting/.test(error.message))) {
        throw new WorkerError(
          "NAVIGATION_FAILED",
          "Não deu para carregar a página. Ela pode estar fora do ar ou levar a um destino bloqueado.",
          502,
        );
      }
    }
    return refresh(id);
  }
  async function closeSession(id: string) {
    const instance = running.get(id);
    const stored = sessions.get(id);
    if (!stored)
      throw new WorkerError("SESSION_NOT_FOUND", "Sessão do navegador não encontrada.", 404);
    logins.cancel(id);
    if (instance) {
      const profile = profiles.get(instance.profile);
      await instance.context
        .storageState({ path: join(directory(instance.profile), "storage.json") })
        .catch(() => undefined);
      await instance.page.close().catch(() => {});
      await Promise.allSettled(instance.pending);
      running.delete(id);
      profile?.tabs.delete(id);
      // The last tab closed: the browser goes too (its profile keeps the logins on disk).
      if (profile && !profile.tabs.size) {
        profiles.delete(instance.profile);
        await instance.context.close().catch(() => {});
        await rm(profile.tempDirectory, { recursive: true, force: true }).catch(() => {});
      }
    }
    const result: Session = { ...stored, status: "closed", updatedAt: new Date().toISOString() };
    sessions.set(id, result);
    await persist(result);
    return result;
  }
  /**
   * Opens a person's browser: the profile folder of the session that owns it (so whatever was
   * signed in there stays signed in), its saved cookies, and the sign-ins of their older
   * one-per-chat browsers (`adopt`), added only where the profile doesn't already have that
   * cookie, so nothing that works today is overwritten.
   */
  async function openProfile(profileId: string, adopt: string[]): Promise<Profile> {
    const profileDir = join(directory(profileId), "profile");
    const tempDirectory = join("/tmp", `openmuse-downloads-${profileId}`);
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
    let context: BrowserContext;
    try {
      const { chromium } = await import("playwright");
      const locale = process.env.WORKER_LOCALE ?? "pt-BR";
      context = await chromium.launchPersistentContext(profileDir, {
        // Full Chromium in new headless mode, not the minimal headless shell.
        channel: "chromium",
        userAgent: await browserUserAgent(),
        locale,
        timezoneId: process.env.WORKER_TIMEZONE ?? "America/Sao_Paulo",
        extraHTTPHeaders: { "Accept-Language": `${locale},${locale.split("-")[0]};q=0.9,en;q=0.8` },
        // Chromium does not need the worker API credential in its environment.
        env: {
          HOME: process.env.HOME ?? "/tmp",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C.UTF-8",
        },
        headless: true,
        viewport: { width: 1280, height: 800 },
        proxy: { server: proxy.url, bypass: "<-loopback>" },
        serviceWorkers: "block",
        acceptDownloads: true,
        downloadsPath: tempDirectory,
        timeout: 25_000,
        args: [
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--disable-extensions",
          "--disable-blink-features=AutomationControlled",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        ],
      });
    } catch {
      await rm(tempDirectory, { recursive: true, force: true });
      throw new WorkerError(
        "BROWSER_UNAVAILABLE",
        "O Chromium não conseguiu iniciar. Reconstrua a imagem do browser-worker e cheque os limites de recursos.",
        503,
      );
    }
    try {
      type Cookies = Awaited<ReturnType<BrowserContext["storageState"]>>["cookies"];
      const saved = async (id: string): Promise<Cookies> => {
        try {
          return (
            JSON.parse(await readFile(join(directory(id), "storage.json"), "utf8")) as {
              cookies: Cookies;
            }
          ).cookies;
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
          throw error;
        }
      };
      const own = await saved(profileId);
      if (own.length) await context.addCookies(own);
      const key = (cookie: Cookies[number]) => `${cookie.name}|${cookie.domain}|${cookie.path}`;
      const have = new Set((await context.cookies()).map(key));
      for (const other of adopt) {
        if (other === profileId || !SESSION_ID.test(other)) continue;
        const missing = (await saved(other).catch(() => [])).filter(
          (cookie) => !have.has(key(cookie)),
        );
        if (!missing.length) continue;
        await context.addCookies(missing).catch(() => undefined);
        for (const cookie of missing) have.add(key(cookie));
      }
      await context.route("**/*", async (route) => {
        try {
          await validatePublicUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient").catch(() => {});
        }
      });
      // Live sites (WhatsApp Web, chats, live prices) need WebSockets. Public destinations
      // connect (and still go through the egress proxy, which checks every tunnel's address);
      // anything else is closed.
      await context.routeWebSocket("**/*", async (socket) => {
        try {
          await validatePublicUrl(socketHttpUrl(socket.url()));
          socket.connectToServer();
        } catch {
          await socket.close().catch(() => {});
        }
      });
      for (const old of context.pages()) await old.close();
      const profile: Profile = { context, tempDirectory, tabs: new Set(), opening: 0 };
      // Tabs are opened by the worker; anything else (a site's popup) is closed.
      context.on("page", (page) => {
        if (profile.opening > 0) return;
        void page.close();
      });
      profiles.set(profileId, profile);
      return profile;
    } catch (error) {
      await context.close().catch(() => {});
      await rm(tempDirectory, { recursive: true, force: true });
      throw error;
    }
  }
  async function createSession(
    id: string,
    url: string,
    options: { profile?: string; adopt?: string[] } = {},
  ) {
    await validatePublicUrl(url);
    if (running.has(id)) return navigate(id, url);
    if (running.size >= maxSessions) {
      // At the cap, close the open browser untouched the longest instead of refusing: its
      // cookies and profile are saved, so it reopens where it was. Never one that is working
      // right now or waiting for the person to sign in.
      const idle = [...running.entries()]
        .filter(([other]) => !queues.has(other) && !logins.busy(other))
        .sort(([, a], [, b]) => a.touched - b.touched)[0];
      if (!idle)
        throw new WorkerError(
          "SESSION_LIMIT",
          `Os ${maxSessions} navegadores estão trabalhando agora. Tente de novo em instantes.`,
          409,
        );
      console.warn(`Closing idle browser ${idle[0]} to open ${id}.`);
      await serial(idle[0], () => closeSession(idle[0]));
    }
    if (!sessions.has(id) && sessions.size >= PROFILE_LIMIT) {
      // Every chat thread keeps its own profile. At the cap, forget the one used longest ago
      // (never an open one) instead of refusing: new chats must keep working. Profiles last
      // used on a store you shop at hold your sign-in there, so they go last.
      // A profile other sessions are tabs of holds their logins: never evicted.
      const inUse = new Set([...sessions.values()].map((session) => session.profile ?? session.id));
      const closed = [...sessions.values()]
        .filter((session) => !running.has(session.id) && !inUse.has(session.id))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const oldest = closed.find((session) => !onStore(session.url)) ?? closed[0];
      if (!oldest)
        throw new WorkerError(
          "PROFILE_LIMIT",
          `O worker atingiu o limite de ${PROFILE_LIMIT} perfis salvos.`,
          409,
        );
      console.warn(`Evicting browser profile ${oldest.id} (last used ${oldest.updatedAt}).`);
      sessions.delete(oldest.id);
      await rm(directory(oldest.id), { recursive: true, force: true });
    }
    const previous = sessions.get(id);
    const profileId = validateSessionId(options.profile ?? previous?.profile ?? id);
    await mkdir(directory(id), { recursive: true, mode: 0o700 });
    let profile: Profile;
    try {
      profile = profiles.get(profileId) ?? (await openProfile(profileId, options.adopt ?? []));
    } catch (error) {
      if (!previous && profileId === id) await rm(directory(id), { recursive: true, force: true });
      throw error;
    }
    const { context, tempDirectory } = profile;
    try {
      profile.opening += 1;
      const page = await context.newPage().finally(() => {
        profile.opening -= 1;
      });
      profile.tabs.add(id);
      page.setDefaultTimeout(10_000);
      const instance: Running = {
        profile: profileId,
        context,
        page,
        touched: Date.now(),
        pending: new Set(),
      };
      running.set(id, instance);
      page.on("dialog", (dialog) => {
        void dialog.dismiss();
      });
      page.on("download", (download) => {
        const pending = downloads(id).then((saved) =>
          capturePdfDownload({
            directory: directory(id),
            tempDirectory,
            download,
            limitReached: saved.length + instance.pending.size > 20,
          }),
        );
        instance.pending.add(pending);
        void pending.then(
          () => instance.pending.delete(pending),
          () => {
            instance.downloadError = true;
            instance.pending.delete(pending);
          },
        );
      });
      const initial: Session = {
        id,
        title: previous?.title ?? "Nova sessão",
        url,
        status: "active",
        updatedAt: new Date().toISOString(),
        profile: profileId,
      };
      sessions.set(id, initial);
      await persist(initial);
      return await navigate(id, url);
    } catch (error) {
      await running
        .get(id)
        ?.page.close()
        .catch(() => {});
      await Promise.allSettled(running.get(id)?.pending ?? []);
      running.delete(id);
      profile.tabs.delete(id);
      if (!profile.tabs.size) {
        profiles.delete(profileId);
        await context.close().catch(() => {});
      }
      if (previous) {
        const failed: Session = {
          ...previous,
          url,
          status: "error",
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, failed);
        await persist(failed);
      } else if (profileId !== id) {
        sessions.delete(id);
        await rm(directory(id), { recursive: true, force: true });
      }
      if (!profiles.has(profileId)) await rm(tempDirectory, { recursive: true, force: true });
      throw error;
    }
  }
  const sweeper = setInterval(() => {
    for (const [id, instance] of running)
      if (Date.now() - instance.touched > idleTimeoutMs) {
        void serial(id, () => closeSession(id)).catch(() => {});
      }
  }, 60_000);
  sweeper.unref();
  return {
    list: () => [...sessions.values()],
    create: (id: string, url: string, options?: { profile?: string; adopt?: string[] }) =>
      serial("create", () => serial(id, () => createSession(id, url, options))),
    navigate: (id: string, url: string) => serial(id, () => navigate(id, url)),
    closeSession: (id: string) => serial(id, () => closeSession(id)),
    screenshot: (id: string) =>
      serial(id, () => active(id).page.screenshot({ type: "png", timeout: 10_000 })),
    read: (id: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await validatePublicUrl(page.url());
        // Evaluation is fixed by the worker; callers cannot inject JavaScript.
        const result = await page.evaluate(() => {
          const text = document.body?.innerText ?? "";
          // The page's own preview image, so a details card can show the real product photo.
          const image =
            document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ?? "";
          return {
            url: location.href,
            image: /^https:\/\//.test(image) ? image.slice(0, 2000) : undefined,
            title: document.title.slice(0, 300),
            text: text.slice(0, 100_000),
            truncated: text.length > 100_000,
          };
        });
        await validatePublicUrl(result.url);
        const session: Session = {
          id,
          profile: running.get(id)?.profile,
          url: result.url,
          title: result.title,
          status: "active",
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, session);
        await persist(session);
        return result;
      }),
    input: (id: string, input: Record<string, unknown>) =>
      serial(id, async () => {
        const { page } = active(id);
        const { type, x, y, key, text, deltaY } = input;
        if (
          type === "click" &&
          typeof x === "number" &&
          typeof y === "number" &&
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= 0 &&
          x < 1280 &&
          y >= 0 &&
          y < 800
        )
          await page.mouse.click(x, y);
        else if (type === "text" && typeof text === "string" && text.length <= 10_000)
          await page.keyboard.insertText(text);
        else if (
          type === "key" &&
          typeof key === "string" &&
          /^(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Control\+a|Meta\+a|Shift\+Tab)$/.test(
            key,
          )
        )
          await page.keyboard.press(key);
        else if (
          type === "scroll" &&
          typeof deltaY === "number" &&
          Number.isFinite(deltaY) &&
          Math.abs(deltaY) <= 5000
        )
          await page.mouse.wheel(0, deltaY);
        else
          throw new WorkerError(
            "INVALID_INPUT",
            "Entrada ou coordenadas de navegador não suportadas.",
          );
        return refresh(id);
      }),
    task: (id: string, body: Record<string, unknown>) =>
      serial(id, async () => {
        if (!jev)
          throw new WorkerError(
            "JEV_UNAVAILABLE",
            "As ações de navegador precisam de IMPOSSIBL_API_KEY (ou JEV_API_KEY) no browser worker.",
            503,
          );
        const task = typeof body.task === "string" ? body.task.trim() : "";
        if (!task || task.length > 2000)
          throw new WorkerError(
            "INVALID_TASK",
            "Descreva a tarefa do navegador em 1-2000 caracteres.",
          );
        if (logins.busy(id))
          throw new WorkerError("LOGIN_PENDING", "Aguardando a pessoa fazer login.", 409);
        const maxSteps =
          typeof body.maxSteps === "number" ? Math.min(Math.max(1, body.maxSteps), 25) : 15;
        const { page } = active(id);
        const text =
          typeof body.text === "string" && body.text.trim()
            ? body.text.trim().slice(0, 500)
            : undefined;
        const result = await runJevTask(page, jev, { task, text, maxSteps, maxSeconds: 90 });
        const loginRequest =
          result.status === "needs_login"
            ? await logins.request(id, page).catch(() => undefined)
            : undefined;
        return { ...result, loginRequest, session: await refresh(id) };
      }),
    checkout: (id: string) => serial(id, () => reviewCheckout(active(id).page)),
    confirmCheckout: (id: string, body: Record<string, unknown>) =>
      serial(id, async () => {
        const { url, total, button } = body;
        if (typeof url !== "string" || typeof button !== "string")
          throw new WorkerError("INVALID_CHECKOUT", "Faltam os detalhes do checkout aprovado.");
        return confirmCheckout(active(id).page, {
          url,
          button,
          total: typeof total === "string" ? total : undefined,
        });
      }),
    login: (id: string) => logins.get(id) ?? null,
    requestLogin: (id: string) => serial(id, () => logins.request(id, active(id).page)),
    // Not serialized behind agent work: the person is answering a request that paused it.
    respondLogin: async (id: string, body: Record<string, unknown>) => {
      const result = await logins.respond(id, active(id).page, {
        requestId: body.requestId,
        action: body.action,
        username: body.username,
        password: body.password,
      });
      body.username = "";
      body.password = "";
      return { ...result, session: await serial(id, () => refresh(id)) };
    },
    downloads: async (id: string) => {
      const saved = await downloads(id);
      if (running.get(id)?.downloadError)
        throw new WorkerError(
          "DOWNLOAD_STORE_FAILED",
          "Não deu para salvar o resultado do download. Confira o armazenamento do worker e tente de novo.",
          500,
        );
      return { downloads: saved, failures: await readDownloadFailures(directory(id)) };
    },
    download: async (id: string, downloadId: string) => {
      validateSessionId(downloadId);
      const metadata = (await downloads(id)).find((item) => item.id === downloadId);
      if (!metadata)
        throw new WorkerError("DOWNLOAD_NOT_FOUND", "Download de PDF não encontrado.", 404);
      const path = join(directory(id), "downloads", `${downloadId}.pdf`);
      const info = await stat(path);
      if (info.size > MAX_DOWNLOAD_BYTES)
        throw new WorkerError("DOWNLOAD_TOO_LARGE", "O PDF ultrapassa 10 MiB.", 413);
      return { metadata, bytes: await readFile(path) };
    },
    close: async () => {
      clearInterval(sweeper);
      await Promise.allSettled([...queues.values()]);
      await Promise.allSettled([...running.keys()].map(closeSession));
      await proxy.close();
    },
  };
}
