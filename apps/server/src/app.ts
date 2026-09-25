import { randomUUID } from "node:crypto";
import { type Message, MessageSchema } from "@ag-ui/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  type ActionProposal,
  emailDraftSchema,
  proposalSchema,
} from "../../../packages/domain/src/index.ts";
import {
  isRunning,
  mergeWindow,
  pageOf,
  truncateAt,
  withLive,
} from "./agent/conversation-store.ts";
import { agentRoutes } from "./agent/routes.ts";
import { agentConfigured, makeRuntime } from "./agent/runtime.ts";
import { AgentService } from "./agent/service.ts";
import { taskThreadBusy } from "./agent/task-thread.ts";
import { shortTitle } from "./agent/titles.ts";
import { ApifyService } from "./apify/apify.ts";
import { apifyRoutes } from "./apify/routes.ts";
import { ActionService } from "./approvals/actions.ts";
import { BrowserService } from "./browser/browser.ts";
import { checkoutRefusal } from "./commerce/checkout-policy.ts";
import { ComputerService, type DockerRunner } from "./computer/computer.ts";
import { computerRoutes } from "./computer/computer-routes.ts";
import { APIFY_APP, apifyMatches, NATIVE_APPS, tidyConnections } from "./connected-apps/catalog.ts";
import { ComposioService } from "./connected-apps/composio.ts";
import {
  ALWAYS_ALLOW_DAYS,
  type AlwaysAllowRule,
  AUTO_ALLOW,
  alwaysAllowId,
  appPermission,
  canAlwaysAllow,
  ruleId,
  toolSlug,
} from "./connected-apps/composio-tools.ts";
import { fuzzyRoutes } from "./fuzzies/routes.ts";
import { StaticMaps } from "./maps/static-map.ts";
import { transcribe } from "./media/transcribe.ts";
import { createAuth } from "./platform/auth.ts";
import type { Config } from "./platform/config.ts";
import type { Store } from "./platform/db.ts";
import { AppError } from "./platform/errors.ts";
import { Files } from "./platform/files.ts";
import { serveWebApp, webAppDir } from "./platform/web-app.ts";
import { PushService } from "./push/push.ts";
import { pushRoutes } from "./push/routes.ts";
import { GoogleAuth } from "./workspace/google-auth.ts";
import { WorkspaceService } from "./workspace/workspace.ts";

export async function createApp(
  db: Store,
  config: Config,
  /** webAppDir: "" disables serving the web export (tests); undefined finds the default. */
  options: { docker?: DockerRunner; webAppDir?: string } = {},
) {
  const auth = await createAuth(db, config),
    files = new Files(db, config, auth),
    google = new GoogleAuth(db, config),
    workspace = new WorkspaceService(db, config, files, google),
    composio = new ComposioService(config, db);
  const actions = new ActionService(db, {
    execute: async (owner, input, connectionId, targetVersion) => {
      if (input.kind === "browser.checkout") {
        // Re-check at approval time: the limit or store list may have changed since the proposal.
        const refusal = checkoutRefusal(input.data);
        if (refusal) throw new AppError(refusal, 422);
        const receipt = await browser.confirmCheckout(owner, input.data);
        return `${receipt.title} · ${receipt.url} · ${receipt.excerpt.slice(0, 400)}`;
      }
      if (input.kind !== "app.action")
        return workspace.execute(owner, input, connectionId, targetVersion);
      const result = await composio.execute(
        owner,
        input.data.tool,
        input.data.arguments,
        undefined,
        input.data.connectedAccountId,
      );
      return `${input.data.tool} · ${JSON.stringify(result).slice(0, 400)}`;
    },
    prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
    connected: (owner) => workspace.connected(owner),
    connection: (owner) => workspace.connection(owner),
  });
  const browser = new BrowserService(db, config, auth, files);
  const computer = new ComputerService(db, config, options.docker);
  const agent = new AgentService(
    db,
    config,
    workspace,
    files,
    actions,
    browser,
    computer,
    composio,
  );
  const runtime = makeRuntime(config, agent, auth);
  const app = new Hono<{ Variables: { owner: string } }>();
  const origins = new Set([...config.allowedOrigins, new URL(config.publicUrl).origin]);
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    // The web app this server serves is always allowed, however it was reached (localhost,
    // LAN or the Tailscale name); other sites need to be listed.
    const sameOrigin = origin === new URL(c.req.url).origin;
    if (origin && !sameOrigin && !origins.has(origin))
      return c.json({ error: "Origem não permitida" }, 403);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  // JSON goes out compressed (the app polls it over a phone link). The chat stream is left alone:
  // compressing it would buffer events.
  const compressed = compress();
  app.use("/api/*", (c, next) =>
    c.req.path.startsWith("/api/copilotkit") ? next() : compressed(c, next),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 12 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: "Requisição muito grande; PDFs devem ter no máximo 10 MB" }, 413),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: error.issues.map((i) => i.message).join("; ") }, 422);
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    if (error.name === "PdfError" || error.name === "RecurringEventError")
      return c.json({ error: error.message }, 422);
    if (error instanceof SyntaxError)
      return c.json({ error: "Dados da requisição inválidos" }, 400);
    // Provider and document errors are useful, but raw stack traces and token-bearing responses are not.
    console.error(`[OpenMuse] ${error.name}`);
    return c.json(
      {
        error:
          error.name === "PdfError" || error.name === "GoogleApiError"
            ? error.message
            : "A requisição falhou. Verifique a configuração do servidor e tente de novo.",
      },
      502,
    );
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      mode: config.mode,
      agentConfigured: agentConfigured(config),
      browserConfigured: Boolean(config.workerUrl && config.workerToken),
    }),
  );
  let loginWindow = 0,
    loginAttempts = 0;
  app.post("/api/session", async (c) => {
    if (Date.now() - loginWindow > 60000) {
      loginWindow = Date.now();
      loginAttempts = 0;
    }
    if (++loginAttempts > 30)
      throw new AppError("Muitas tentativas de login. Tente de novo em um minuto.", 429);
    const body = z.object({ accessKey: z.string().optional() }).parse(await c.req.json());
    const session = await auth.session(body.accessKey);
    await workspace.ensureSample("local-user", actions);
    await workspace.purgeSample("local-user");
    await agent.ensure("local-user");
    if (config.mode === "sample" && config.sampleData !== false)
      await agent.refreshIdeas("local-user");
    return c.json(session);
  });
  app.get("/api/google/callback", async (c) => {
    if (c.req.query("error"))
      return c.html(
        "<h1>Conexão com o Google cancelada</h1><p>Você pode voltar ao OpenMuse.</p>",
        400,
      );
    const state = c.req.query("state"),
      code = c.req.query("code");
    if (!state || !code) throw new AppError("Retorno do Google está incompleto");
    await google.callback(state, code);
    return c.html("<h1>Google conectado</h1><p>Volte ao OpenMuse e atualize seu workspace.</p>");
  });
  app.get("/api/apps/callback", (c) => {
    const ok = c.req.query("status") !== "failed";
    return c.html(
      ok
        ? "<h1>App conectado</h1><p>Você pode fechar esta aba e voltar ao OpenMuse.</p><script>setTimeout(()=>window.close(),1200)</script>"
        : "<h1>Falha ao conectar o app</h1><p>Volte ao OpenMuse e tente de novo.</p>",
      ok ? 200 : 400,
    );
  });
  app.use("/api/*", async (c, next) => {
    const signedRoute =
      /^\/api\/files\/[^/]+\/(?:content|thumbnail)$|^\/api\/maps\/route\/[\w-]+$|^\/api\/browsers\/[^/]+\/(?:preview|console)$/.test(
        c.req.path,
      );
    // A signed link (an <img>, a new tab, a share sheet) carries no bearer. A client that does
    // send one (the app downloading a file to share it) is judged by the session, so a link it
    // kept past its expiry still works for it.
    const bearer = c.req.header("authorization");
    const owner =
      signedRoute && !bearer && c.req.query("signature")
        ? auth.verify(new URL(c.req.url))
        : await auth.owner(bearer);
    c.set("owner", owner);
    await next();
  });
  app.get("/api/workspace", async (c) => {
    const snapshot = await workspace.snapshot(c.get("owner"), c.req.query("q"));
    snapshot.browsers = (await browser.withLiveStatus(snapshot.browsers)).map((s) =>
      browser.decorate(c.get("owner"), s),
    );
    return c.json(snapshot);
  });
  app.route("/api/agent", agentRoutes(agent));
  const push = new PushService(
    db,
    config.publicUrl.startsWith("https:") ? config.publicUrl : "mailto:corgi@localhost",
  );
  agent.push = push;
  app.route("/api/push", pushRoutes(push));
  const apify = new ApifyService(db, config.encryptionKey);
  agent.apify = apify;
  app.route("/api/apify", apifyRoutes(apify));
  app.route("/api/fuzzies", fuzzyRoutes(agent.fuzzyDeps()));
  app.route("/api/computer", computerRoutes(computer, files));
  app.get("/api/calendars", async (c) => c.json(await workspace.calendars(c.get("owner"))));
  app.get("/api/calendar/events", async (c) => {
    const query = z
      .object({
        calendarId: z.string().min(1).max(1024).optional(),
        timeMin: z.iso.datetime({ offset: true }).optional(),
        timeMax: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(c.req.query());
    if (
      query.timeMin &&
      query.timeMax &&
      (Date.parse(query.timeMax) <= Date.parse(query.timeMin) ||
        Date.parse(query.timeMax) - Date.parse(query.timeMin) > 366 * 86400000)
    )
      throw new AppError("Escolha um intervalo de calendário entre um instante e 366 dias", 422);
    return c.json(await workspace.events(c.get("owner"), query));
  });
  app.get("/api/mail/threads/:id", async (c) =>
    c.json(await workspace.thread(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/actions", async (c) => {
    const input = proposalSchema.parse(await c.req.json());
    // Checkouts come only from the agent, which verified the live checkout page first.
    if (input.kind === "browser.checkout")
      throw new AppError("Checkouts só são propostos pelo agente", 400);
    if (input.kind === "email.send")
      for (const id of input.data.attachmentIds) await files.get(c.get("owner"), id);
    return c.json(await actions.propose(c.get("owner"), input), 201);
  });
  app.post("/api/actions/:id/decide", async (c) => {
    const body = z
      .object({
        hash: z.string(),
        decision: z.enum(["approve", "deny"]),
        // "Always allow" this app action on this account for ALWAYS_ALLOW_DAYS. Only offered for
        // low-stakes, unflagged app actions (proposal.alwaysAllowable); never sends or purchases.
        always: z.boolean().optional(),
        // The person confirmed the trust guard's "looks malicious" warning.
        acknowledgeRisk: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const owner = c.get("owner");
    if (body.decision === "approve" && body.always) {
      const proposal = await db.get<ActionProposal>(owner, "actions", c.req.param("id"));
      if (proposal?.kind !== "app.action" || proposal.hash !== body.hash)
        throw new AppError("Só ações de apps podem ser sempre permitidas", 400);
      const data = proposal.data as {
        tool: string;
        toolkit: string;
        connectedAccountId?: string;
        account?: string;
      };
      if (!proposal.alwaysAllowable || !canAlwaysAllow(data.tool))
        throw new AppError("Esta ação sempre pede sua confirmação.", 400);
      const rule: AlwaysAllowRule = {
        id: alwaysAllowId(toolSlug.parse(data.tool), data.connectedAccountId),
        tool: data.tool,
        toolkit: data.toolkit,
        title: proposal.title,
        ...(data.account ? { account: data.account } : {}),
        expiresAt: new Date(Date.now() + ALWAYS_ALLOW_DAYS * 86_400_000).toISOString(),
      };
      await db.put(owner, AUTO_ALLOW, rule);
    }
    return c.json(
      await actions.decide(owner, c.req.param("id"), body.hash, body.decision, {
        acknowledgeRisk: body.acknowledgeRisk,
      }),
    );
  });
  app.get("/api/apps", async (c) => {
    const owner = c.get("owner");
    const permission = appPermission(db, owner);
    const connections = tidyConnections(composio.enabled ? await composio.connections(owner) : []);
    // Apify is connected with the person's own key, and listed like any other app.
    const apifyStatus = await apify.status(owner).catch(() => undefined);
    const native = apifyStatus?.connected
      ? [
          {
            id: "apify",
            toolkit: APIFY_APP.slug,
            name: APIFY_APP.name,
            logo: APIFY_APP.logo,
            status: "ACTIVE",
            account: apifyStatus.username,
            native: APIFY_APP.native,
          },
        ]
      : [];
    return c.json({
      enabled: composio.enabled,
      connections: [
        ...(await Promise.all(
          connections.map(async (item) => ({
            ...item,
            permission: await permission(item.toolkit),
          })),
        )),
        ...native,
      ],
      // Rules from before per-account scoping (no "@") or past expiry no longer apply.
      alwaysAllowed: (await db.list<AlwaysAllowRule>(owner, AUTO_ALLOW)).filter(
        (rule) =>
          ruleId.safeParse(rule.id).success &&
          canAlwaysAllow(rule.tool) &&
          Date.parse(rule.expiresAt) > Date.now(),
      ),
    });
  });
  app.delete("/api/apps/always/:rule", async (c) => {
    await db.take(c.get("owner"), AUTO_ALLOW, ruleId.parse(c.req.param("rule")));
    return c.json({ ok: true });
  });
  app.post("/api/apps/permissions", async (c) => {
    const body = z
      .object({
        toolkit: z.string().regex(/^[a-z0-9_-]{1,64}$/),
        level: z.enum(["ask", "read", "off"]),
      })
      .parse(await c.req.json());
    await db.put(c.get("owner"), "app-permissions", { id: body.toolkit, level: body.level });
    return c.json(body);
  });
  app.get("/api/apps/toolkits", async (c) =>
    c.json({
      toolkits: [
        ...((await apify.connected(c.get("owner"))) || !apifyMatches(c.req.query("q"))
          ? []
          : [APIFY_APP]),
        ...(composio.enabled ? await composio.toolkits(c.req.query("q")) : []).filter(
          (toolkit) => !NATIVE_APPS.some((native) => native.test(toolkit.slug)),
        ),
      ],
    }),
  );
  app.post("/api/apps/connect", async (c) => {
    const body = z.object({ toolkit: z.string().min(1).max(64) }).parse(await c.req.json());
    return c.json(await composio.connect(c.get("owner"), body.toolkit));
  });
  app.patch("/api/apps/connections/:id", async (c) => {
    const body = z
      .object({
        label: z.string().trim().max(40).nullable().optional(),
        isDefault: z.literal(true).optional(),
      })
      .parse(await c.req.json());
    return c.json(await composio.updateAccount(c.get("owner"), c.req.param("id"), body));
  });
  app.delete("/api/apps/connections/:id", async (c) => {
    await composio.disconnect(c.get("owner"), c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/drafts", async (c) => c.json(await db.list(c.get("owner"), "drafts")));
  app.post("/api/drafts", async (c) => {
    const body = emailDraftSchema.extend({ id: z.string().optional() }).parse(await c.req.json());
    const existing = body.id
      ? await db.get<{ createdAt: string }>(c.get("owner"), "drafts", body.id)
      : null;
    if (body.id && !existing) throw new AppError("Rascunho não encontrado", 404);
    return c.json(
      await db.put(c.get("owner"), "drafts", {
        ...body,
        id: body.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
      201,
    );
  });
  app.get("/api/main-thread", async (c) => {
    const owner = c.get("owner");
    await db.insertIfAbsent(owner, "conversation-settings", {
      id: "main",
      threadId: randomUUID(),
      existing: false,
    });
    const main = await db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    if (!main) throw new AppError("Não foi possível carregar a conversa principal", 503);
    return c.json({ threadId: main.threadId, existing: false });
  });
  // Local conversations: "default" is the main chat; side chats are UUID threads.
  const threadParam = z.union([z.literal("default"), z.uuid()]);
  type LocalThread = {
    id: string;
    title: string;
    pinned: boolean;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
    taskId?: string;
    fuzzyId?: string;
  };
  app.get("/api/conversation", async (c) => {
    const thread = threadParam.parse(c.req.query("thread") ?? "default");
    const saved = await db.get<{ messages: Message[] }>(c.get("owner"), "conversations", thread);
    // The app opens the latest page and asks for older ones as the person scrolls up.
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(80)
      .parse(c.req.query("limit") ?? undefined);
    const page = pageOf(
      withLive(c.get("owner"), thread, saved?.messages ?? []),
      limit,
      c.req.query("before") || undefined,
    );
    // running: a turn is still being worked on (the app was away); it saves itself when done.
    return c.json({
      ...page,
      running:
        isRunning(c.get("owner"), thread) ||
        (thread !== "default" && (await taskThreadBusy(db, c.get("owner"), thread))),
    });
  });
  app.post("/api/conversation/truncate", async (c) => {
    const owner = c.get("owner");
    const thread = threadParam.parse(c.req.query("thread") ?? "default");
    if (isRunning(owner, thread))
      throw new AppError("Espere a resposta atual terminar para tentar de novo.", 409);
    const { from } = z.object({ from: z.string().min(1).max(200) }).parse(await c.req.json());
    const stored = await db.get<{ messages: Message[] }>(owner, "conversations", thread);
    if (stored)
      await db.put(owner, "conversations", {
        id: thread,
        messages: truncateAt(stored.messages, from),
      });
    return c.json({ ok: true });
  });
  app.post("/api/transcribe", async (c) => {
    const data = await c.req.parseBody();
    if (!(data.audio instanceof File)) throw new AppError("Envie o áudio gravado");
    return c.json({ text: await transcribe(config, data.audio) });
  });
  app.put("/api/conversation", async (c) => {
    const owner = c.get("owner");
    const thread = threadParam.parse(c.req.query("thread") ?? "default");
    const body = await c.req.json();
    // The app's loaded window (the latest pages), not the whole conversation.
    const messages = z.array(z.unknown()).max(5_000).parse(body.messages);
    for (const message of messages) MessageSchema.parse(message);
    // The app sends the window it has loaded; older stored messages are kept.
    const stored = await db.get<{ messages: Message[] }>(owner, "conversations", thread);
    await db.put(owner, "conversations", {
      id: thread,
      messages: mergeWindow(stored?.messages ?? [], messages as Message[]),
    });
    if (thread !== "default") {
      const now = new Date().toISOString();
      const existing = await db.get<LocalThread>(owner, "threads", thread);
      // A side chat is named after its first message until the person renames it.
      const first = messages.find(
        (m): m is { role: string; content: string } =>
          typeof m === "object" && m !== null && "role" in m && m.role === "user",
      );
      await db.put(owner, "threads", {
        // Keep what else the thread carries (the task or helper it belongs to).
        ...existing,
        id: thread,
        title:
          existing?.title ||
          (typeof first?.content === "string" ? shortTitle(first.content) : "") ||
          "Nova conversa",
        pinned: existing?.pinned ?? false,
        archived: existing?.archived ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      } satisfies LocalThread);
    }
    return c.json({ ok: true });
  });
  app.get("/api/threads", async (c) => {
    const threads = await db.list<LocalThread>(c.get("owner"), "threads");
    return c.json({
      threads: threads.sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      ),
    });
  });
  app.patch("/api/threads/:id", async (c) => {
    const owner = c.get("owner");
    const id = z.uuid().parse(c.req.param("id"));
    const patch = z
      .object({
        title: z.string().trim().min(1).max(80).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const existing = await db.get<LocalThread>(owner, "threads", id);
    if (!existing) throw new AppError("Conversa não encontrada", 404);
    const next = { ...existing, ...patch };
    await db.put(owner, "threads", next);
    return c.json(next);
  });
  app.delete("/api/threads/:id", async (c) => {
    const owner = c.get("owner");
    const id = z.uuid().parse(c.req.param("id"));
    await db.remove(owner, "threads", id);
    await db.remove(owner, "conversations", id);
    return c.json({ ok: true });
  });
  app.post("/api/files", async (c) => {
    const data = await c.req.parseBody();
    const file = data.file;
    if (!(file instanceof File)) throw new AppError("Escolha um arquivo para enviar");
    return c.json(
      await files.import(
        c.get("owner"),
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        "Uploaded by you",
      ),
      201,
    );
  });
  // A file with fresh signed links: the app asks right before showing or opening one, since the
  // links it keeps (in a chat card, in an open sheet) expire after a few minutes.
  app.get("/api/files/:id", async (c) =>
    c.json(await files.signedFile(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/files/:id/content", async (c) => {
    const file = await files.get(c.get("owner"), c.req.param("id"));
    // PDFs and images open in place; text shows as plain text; Office files download.
    // `?download=1` (outside the signature, which covers only the path) forces a download.
    const download = c.req.query("download") === "1";
    const inline = file.mimeType === "application/pdf" || file.mimeType.startsWith("image/");
    const text = file.mimeType.startsWith("text/") || file.mimeType === "application/json";
    c.header("Content-Type", text ? "text/plain; charset=utf-8" : file.mimeType);
    c.header(
      "Content-Disposition",
      `${(inline || text) && !download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return c.body(await files.bytes(c.get("owner"), file.id));
  });
  // The route card's map picture (show_route stored the path under this id).
  const maps = new StaticMaps(config);
  app.get("/api/maps/route/:id", async (c) => {
    const saved = await db.get<{ polyline: string }>(
      c.get("owner"),
      "route-maps",
      c.req.param("id"),
    );
    if (!saved) throw new AppError("Mapa não encontrado", 404);
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "private, max-age=604800");
    return c.body(new Uint8Array(await maps.render(saved.polyline)));
  });
  app.get("/api/files/:id/thumbnail", async (c) => {
    const { mimeType, bytes } = await files.thumbnail(c.get("owner"), c.req.param("id"));
    c.header("Content-Type", mimeType);
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(bytes);
  });
  app.post("/api/files/:id/fill", async (c) => {
    const body = z
      .object({ fields: z.record(z.string(), z.union([z.string(), z.boolean()])) })
      .parse(await c.req.json());
    return c.json(await files.fill(c.get("owner"), c.req.param("id"), body.fields), 201);
  });
  app.post("/api/mail/import-attachment", async (c) => {
    const body = z.object({ reference: z.string() }).parse(await c.req.json());
    return c.json(await workspace.importAttachment(c.get("owner"), body.reference), 201);
  });
  app.post("/api/google/connect", async (c) => {
    const body = z.object({ capability: z.enum(["read", "write"]) }).parse(await c.req.json());
    if (config.mode === "sample") {
      await db.put(c.get("owner"), "settings", {
        id: "google",
        enabled: true,
        connectionId: randomUUID(),
      });
      return c.json({ url: null, connected: true });
    }
    return c.json(await google.connect(c.get("owner"), body.capability === "write"));
  });
  app.post("/api/google/disconnect", async (c) => {
    if (config.mode === "sample")
      await db.put(c.get("owner"), "settings", { id: "google", enabled: false });
    else await google.disconnect(c.get("owner"));
    return c.json({ ok: true });
  });
  app.post("/api/browsers", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.create(c.get("owner"), body.url), 201);
  });
  app.get("/api/browsers/:id", async (c) => {
    const owner = c.get("owner");
    return c.json(browser.decorate(owner, await browser.get(owner, c.req.param("id"))));
  });
  app.post("/api/browsers/:id/navigate", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.navigate(c.get("owner"), c.req.param("id"), body.url));
  });
  app.get("/api/browsers/:id/login", async (c) =>
    c.json(await browser.login(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/browsers/:id/login", async (c) => {
    const body = z
      .object({
        requestId: z.string().max(100),
        action: z.enum(["submit", "cancel"]),
        username: z.string().max(2048).optional(),
        password: z.string().max(4096).optional(),
      })
      .parse(await c.req.json());
    try {
      return c.json(await browser.respondLogin(c.get("owner"), c.req.param("id"), body));
    } finally {
      body.username = "";
      body.password = "";
    }
  });
  app.post("/api/browsers/close-all", async (c) => c.json(await browser.closeAll(c.get("owner"))));
  app.post("/api/browsers/:id/close", async (c) =>
    c.json(await browser.close(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/read", async (c) =>
    c.json(await browser.read(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/browsers/:id/reopen", async (c) => {
    const raw = await c.req.text();
    const body = z.object({ url: z.url().max(4096).optional() }).parse(raw ? JSON.parse(raw) : {});
    return c.json(await browser.reopen(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/import-downloads", async (c) =>
    c.json(await browser.imports(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/preview", async (c) => {
    const response = await browser.preview(c.get("owner"), c.req.param("id"));
    c.header("Content-Type", "image/png");
    return c.body(await response.arrayBuffer());
  });
  app.get("/api/browsers/:id/console", async (c) => {
    await browser.get(c.get("owner"), c.req.param("id"));
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    );
    return c.html(browser.console(c.get("owner"), c.req.param("id")));
  });
  app.post("/api/browsers/:id/console", async (c) => {
    await browser.input(c.get("owner"), c.req.param("id"), await c.req.json());
    return c.json({ ok: true });
  });
  app.all("/api/copilotkit/*", async (c) => {
    if (!agentConfigured(config))
      throw new AppError(
        "Configure um modelo e a chave de API do provedor, ou um endpoint AG-UI válido, para iniciar o chat",
        503,
      );
    const response = await runtime.fetch(c.req.raw);
    // Runtime 1.70 emits SSE strings; a WHATWG Response body requires byte chunks.
    const encoder = new TextEncoder();
    const body = response.body?.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  });
  const web = options.webAppDir === undefined ? webAppDir() : options.webAppDir || undefined;
  if (web) serveWebApp(app, web);
  else
    app.get("/", (c) =>
      c.json({ name: "Corgi", app: "http://localhost:8081", health: "/api/health" }),
    );
  return { app, auth, files, actions, workspace, agent, computer };
}
