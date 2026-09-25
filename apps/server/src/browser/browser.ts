import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserSession } from "../../../../packages/domain/src/index.ts";
import type { Auth } from "../platform/auth.ts";
import type { Config } from "../platform/config.ts";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";
import type { Files } from "../platform/files.ts";
import { browserConsole } from "./browser-console.ts";

const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.enum(["idle", "active", "closed", "error"]),
  updatedAt: z.string(),
});
const readSchema = z.object({
  url: z.string(),
  image: z.url().optional(),
  title: z.string().max(300),
  text: z.string().max(100_000),
  truncated: z.boolean(),
});
const taskSchema = z.object({
  status: z.enum([
    "done",
    "goal_achieved",
    "stuck",
    "max_steps",
    "timeout",
    "needs_login",
    "needs_human",
    "ready_to_checkout",
    "error",
  ]),
  url: z.string(),
  title: z.string().max(300),
  text: z.string().max(12_000),
  truncated: z.boolean(),
  steps: z
    .array(
      z.object({
        step: z.number(),
        action: z.string().nullable(),
        detail: z.string(),
        outcome: z.string(),
      }),
    )
    .max(30),
  jevCalls: z.number(),
  error: z.string().optional(),
  loginRequest: z.object({ id: z.string(), origin: z.string(), expiresAt: z.string() }).optional(),
  items: z
    .array(
      z.object({
        title: z.string().max(200),
        url: z.url(),
        image: z.url().optional(),
        price: z.string().max(40).optional(),
        was: z.string().max(40).optional(),
        detail: z.string().max(200).optional(),
      }),
    )
    .max(20)
    .default([]),
  session: sessionSchema,
});
const checkoutSchema = z.object({
  url: z.url(),
  merchant: z.string().max(200),
  title: z.string().max(300),
  total: z.string().max(40).optional(),
  totalValue: z.number().optional(),
  button: z.string().min(1).max(60),
  excerpt: z.string().max(2000),
  screenshot: z.string().max(600_000),
});
const receiptSchema = z.object({
  url: z.string(),
  title: z.string().max(300),
  excerpt: z.string().max(2000),
  screenshot: z.string().max(600_000),
});
const failureSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
type ChatBrowser = { id: string; sessionId: string };
/** The chat-browsers record naming the person's one shared browser session. */
const MAIN_BROWSER = "main";

export class BrowserService {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
    private readonly files: Files,
  ) {}
  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(id, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }
  }
  private async request(path: string, body?: unknown, signal?: AbortSignal, timeoutMs = 45000) {
    signal?.throwIfAborted();
    if (!this.config.workerUrl || !this.config.workerToken)
      throw new AppError(
        "O worker de navegador não está configurado. Inicie-o pelo guia de setup.",
        503,
      );
    let response: Response;
    try {
      response = await fetch(`${this.config.workerUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.config.workerToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      signal?.throwIfAborted();
      throw new AppError(
        "O worker de navegador está indisponível. Confira se o container dele está rodando.",
        503,
      );
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new AppError(
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "Falha na requisição do navegador",
        502,
      );
    }
    return response;
  }
  async get(owner: string, id: string) {
    const value = await this.db.get<BrowserSession>(owner, "browsers", id);
    if (!value) throw new AppError("Sessão de navegador não encontrada", 404);
    return value;
  }
  decorate(owner: string, session: BrowserSession) {
    return {
      ...session,
      consoleUrl: this.auth.sign(owner, `/api/browsers/${session.id}/console`),
      previewUrl: this.auth.sign(owner, `/api/browsers/${session.id}/preview`),
    };
  }
  private async save(owner: string, payload: unknown, expectedId: string) {
    const session = sessionSchema.parse(payload);
    if (session.id !== expectedId)
      throw new AppError("O worker de navegador retornou uma sessão diferente", 502);
    await this.db.put(owner, "browsers", session);
    return this.decorate(owner, session);
  }
  async create(owner: string, url: string) {
    const id = randomUUID();
    // Record ownership before calling the worker, including when its response is lost.
    await this.db.put(owner, "browsers", {
      id,
      url,
      title: "Nova sessão de navegador",
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    return this.reopen(owner, id, url);
  }
  private async openOwned(owner: string, id: string, url?: string, signal?: AbortSignal) {
    const value = await this.get(owner, id);
    const target = url ?? value.url;
    try {
      // Every session is a tab of the person's one browser profile: same logins everywhere,
      // tabs working in parallel. Their older separate browsers' sign-ins are merged in.
      const profile = await this.profileFor(owner, id);
      const adopt = (await this.db.list<BrowserSession>(owner, "browsers"))
        .map((session) => session.id)
        .filter((other) => other !== profile);
      const response = await this.request("/sessions", { id, url: target, profile, adopt }, signal);
      return await this.save(owner, await response.json(), id);
    } catch (error) {
      await this.save(
        owner,
        { ...value, url: target, status: "error", updatedAt: new Date().toISOString() },
        id,
      );
      throw error;
    }
  }
  reopen(owner: string, id: string, url?: string) {
    return this.serial(id, () => this.openOwned(owner, id, url));
  }
  navigate(owner: string, id: string, url: string) {
    return this.reopen(owner, id, url);
  }
  private async readOwned(owner: string, id: string, signal?: AbortSignal) {
    const session = await this.get(owner, id);
    const result = readSchema.parse(
      await (await this.request(`/sessions/${id}/read`, undefined, signal)).json(),
    );
    await this.save(
      owner,
      {
        ...session,
        url: result.url,
        title: result.title,
        status: "active",
        updatedAt: new Date().toISOString(),
      },
      id,
    );
    return result;
  }
  read(owner: string, id: string) {
    return this.serial(id, () => this.readOwned(owner, id));
  }
  async observe(owner: string, url: string, existingId?: string) {
    const id = existingId ?? (await this.create(owner, url)).id;
    return this.serial(id, async () => {
      if (existingId) await this.openOwned(owner, id, url);
      return { sessionId: id, ...(await this.readOwned(owner, id)) };
    });
  }
  /**
   * The person's browser profile (logins, cookies, storage): every chat's and task's session is
   * a tab of it, so they share sign-ins and work in parallel. Kept from the one-browser-per-chat
   * days: the browser chosen then (the one signed in to) is the profile, so logins keep working.
   */
  async profileFor(owner: string, opening: string) {
    const main = await this.db.get<ChatBrowser>(owner, "chat-browsers", MAIN_BROWSER);
    if (main && (await this.db.get(owner, "browsers", main.sessionId))) return main.sessionId;
    // The tab being opened was just recorded: the profile is an earlier browser, or this one.
    const recent = (await this.db.list<BrowserSession>(owner, "browsers"))
      .filter((session) => session.id !== opening)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0];
    const candidate = recent?.id ?? opening;
    if (main) {
      await this.db.put(owner, "chat-browsers", { id: MAIN_BROWSER, sessionId: candidate });
      return candidate;
    }
    // Two chats starting at once agree on one: the first insert wins, the other reads it.
    const inserted = await this.db.insertIfAbsent(owner, "chat-browsers", {
      id: MAIN_BROWSER,
      sessionId: candidate,
    });
    return (
      inserted?.sessionId ??
      (await this.db.get<ChatBrowser>(owner, "chat-browsers", MAIN_BROWSER))?.sessionId ??
      candidate
    );
  }
  /** Each chat's and task's own tab (a session in the person's profile), kept across turns. */
  private async threadSession(owner: string, threadId: string) {
    const found = await this.db.get<ChatBrowser>(owner, "chat-browsers", threadId);
    if (found) return found.sessionId;
    const inserted = await this.db.insertIfAbsent(owner, "chat-browsers", {
      id: threadId,
      sessionId: randomUUID(),
    });
    const id =
      inserted?.sessionId ??
      (await this.db.get<ChatBrowser>(owner, "chat-browsers", threadId))?.sessionId;
    if (!id) throw new AppError("Não foi possível reservar a aba do navegador", 500);
    return id;
  }
  async observeForThread(owner: string, threadId: string, url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    // Reserved before contacting the worker so a lost response never starts a second profile.
    const id = await this.threadSession(owner, threadId);
    await this.db.insertIfAbsent(owner, "browsers", {
      id,
      url,
      title: "Nova sessão de navegador",
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    return this.serial(id, async () => {
      signal?.throwIfAborted();
      await this.openOwned(owner, id, url, signal);
      signal?.throwIfAborted();
      const page = await this.readOwned(owner, id, signal);
      signal?.throwIfAborted();
      return {
        sessionId: id,
        ...page,
        text: page.text.slice(0, 30_000),
        truncated: page.truncated || page.text.length > 30_000,
      };
    });
  }
  /**
   * What the thread's browser shows right now, as an image for a vision model: for pages Jev
   * can't read as text, like seat maps, charts, canvases and product photos.
   */
  async lookForThread(owner: string, threadId: string, signal?: AbortSignal) {
    if (!(await this.db.get<ChatBrowser>(owner, "chat-browsers", threadId)))
      throw new AppError("Nenhuma página está aberta no navegador deste chat ainda", 400);
    const id = await this.threadSession(owner, threadId);
    const session = await this.get(owner, id);
    const bytes = await this.serial(id, async () => {
      signal?.throwIfAborted();
      const response = await this.request(`/sessions/${id}/screenshot`, undefined, signal);
      return Buffer.from(await response.arrayBuffer());
    });
    return { title: session.title, url: session.url, png: bytes.toString("base64") };
  }
  /** Lets Jev click, type and scroll toward a goal in the thread's browser session. */
  async taskForThread(
    owner: string,
    threadId: string,
    url: string | undefined,
    task: string,
    signal?: AbortSignal,
    text?: string,
  ) {
    const known = await this.db.get<ChatBrowser>(owner, "chat-browsers", threadId);
    // Start from the given URL, or continue on the page the thread's tab is showing.
    if (url || !known) {
      if (!url) throw new AppError("Informe uma URL inicial para esta tarefa de navegador", 400);
      await this.observeForThread(owner, threadId, url, signal);
    }
    const id = await this.threadSession(owner, threadId);
    return this.serial(id, async () => {
      if (!url) await this.openOwned(owner, id, undefined, signal);
      const result = taskSchema.parse(
        await (await this.request(`/sessions/${id}/task`, { task, text }, signal, 120_000)).json(),
      );
      await this.save(owner, result.session, id);
      return { sessionId: id, ...result, session: undefined };
    });
  }
  async login(owner: string, id: string) {
    await this.get(owner, id);
    return (await this.request(`/sessions/${id}/login`)).json();
  }
  async respondLogin(owner: string, id: string, body: unknown) {
    await this.get(owner, id);
    // Credentials pass straight through to the worker; they are never stored or logged.
    return (await this.request(`/sessions/${id}/login/respond`, body, undefined, 30_000)).json();
  }
  async close(owner: string, id: string) {
    return this.serial(id, async () => {
      await this.get(owner, id);
      return this.save(owner, await (await this.request(`/sessions/${id}/close`, {})).json(), id);
    });
  }
  /** The worker closes idle browsers on its own; show what is really open right now. */
  async withLiveStatus(sessions: BrowserSession[]): Promise<BrowserSession[]> {
    if (!sessions.some((session) => session.status === "active")) return sessions;
    try {
      const live = z
        .array(sessionSchema)
        .parse(await (await this.request("/sessions", undefined, undefined, 3000)).json());
      const open = new Set(live.filter((s) => s.status === "active").map((s) => s.id));
      return sessions.map((session) =>
        session.status === "active" && !open.has(session.id)
          ? { ...session, status: "closed" as const }
          : session,
      );
    } catch {
      return sessions;
    }
  }
  async closeAll(owner: string) {
    const open = (
      await this.withLiveStatus(await this.db.list<BrowserSession>(owner, "browsers"))
    ).filter((session) => session.status === "active");
    await Promise.allSettled(open.map((session) => this.close(owner, session.id)));
    return { closed: open.length };
  }
  async preview(owner: string, id: string) {
    await this.get(owner, id);
    return this.request(`/sessions/${id}/screenshot`);
  }
  async input(owner: string, id: string, value: unknown) {
    return this.serial(id, async () => {
      await this.get(owner, id);
      return this.save(
        owner,
        await (await this.request(`/sessions/${id}/input`, value)).json(),
        id,
      );
    });
  }
  /** Captures the thread browser's final order page for review; nothing is clicked. */
  async reviewCheckoutForThread(owner: string, threadId: string) {
    if (!(await this.db.get<ChatBrowser>(owner, "chat-browsers", threadId)))
      throw new AppError("Abra a loja no navegador primeiro", 409);
    const id = await this.threadSession(owner, threadId);
    return this.serial(id, async () => {
      await this.get(owner, id);
      const review = checkoutSchema.parse(
        await (await this.request(`/sessions/${id}/checkout`, {})).json(),
      );
      return { sessionId: id, ...review };
    });
  }
  /** Places an approved order; the worker refuses if the page changed since review. */
  async confirmCheckout(
    owner: string,
    approved: { sessionId: string; url: string; total?: string; button: string },
  ) {
    const id = approved.sessionId;
    return this.serial(id, async () => {
      await this.get(owner, id);
      return receiptSchema.parse(
        await (
          await this.request(
            `/sessions/${id}/checkout/confirm`,
            { url: approved.url, total: approved.total, button: approved.button },
            undefined,
            60_000,
          )
        ).json(),
      );
    });
  }
  async imports(owner: string, id: string) {
    await this.get(owner, id);
    const { downloads, failures } = z
      .object({
        downloads: z.array(
          z.object({ id: z.string(), name: z.string(), size: z.number(), mimeType: z.string() }),
        ),
        failures: z.array(failureSchema),
      })
      .parse(await (await this.request(`/sessions/${id}/downloads`)).json());
    const saved = [];
    for (const download of downloads) {
      const existing = await this.db.get<{ fileId: string }>(
        owner,
        "browser-downloads",
        download.id,
      );
      if (existing) {
        saved.push(this.files.signed(owner, await this.files.get(owner, existing.fileId)));
        continue;
      }
      const response = await this.request(
        `/sessions/${id}/downloads/${encodeURIComponent(download.id)}`,
      );
      const file = await this.files.import(
        owner,
        download.name,
        new Uint8Array(await response.arrayBuffer()),
        `Browser · ${id}`,
      );
      await this.db.put(owner, "browser-downloads", { id: download.id, fileId: file.id });
      saved.push(file);
    }
    return { files: saved, failures };
  }
  console(owner: string, id: string) {
    return browserConsole(this.auth.sign(owner, `/api/browsers/${id}/preview`));
  }
}
