import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AgentIdentity, AgentNotification } from "../../../../packages/domain/src/agent.ts";
import { interpretGmail, interpretSlack } from "../ideas/interpret.ts";
import {
  defaultIdeaSources,
  loadIdeaSources,
  SCANNABLE,
  saveIdeaSources,
} from "../ideas/sources.ts";
import { memoryRoutes } from "../memory/routes.ts";
import { timeZoneOf } from "../platform/config.ts";
import { AppError } from "../platform/errors.ts";
import { deleteSkill, listSkills, saveSkill } from "../skills/skills.ts";
import { complete, SIDE_MODEL } from "./complete.ts";
import { followUpTask } from "./follow-up.ts";
import type { AgentService } from "./service.ts";
import { archiveTask } from "./tidy.ts";
import { cacheSummary, recentTimings } from "./timings.ts";

const text = z.string().trim().min(1).max(4000);
const _memorySchema = z.object({ text, source: z.string().trim().min(1).max(200).optional() });
const goalPatchSchema = z.object({
  status: z.enum(["active", "paused", "completed"]).optional(),
  milestones: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        done: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
});

export function agentRoutes(service: AgentService): Hono<{ Variables: { owner: string } }> {
  const app = new Hono<{ Variables: { owner: string } }>();
  // The app polls this every few seconds: when nothing changed since the version it has
  // (?v=), answer 204 with no body instead of the whole snapshot again.
  app.get("/", async (c) => {
    const body = JSON.stringify(await service.snapshot(c.get("owner")));
    const version = createHash("sha1").update(body).digest("hex").slice(0, 16);
    c.header("X-Version", version);
    if (c.req.query("v") === version) return c.body(null, 204);
    return c.body(body, 200, { "Content-Type": "application/json; charset=utf-8" });
  });
  // Skills for the @ picker: built-ins plus the person's own.
  app.get("/skills", async (c) => {
    const owner = c.get("owner");
    const connected = service.composio.enabled
      ? (await service.composio.connections(owner).catch(() => []))
          .filter((account) => account.status === "ACTIVE")
          .map((account) => account.toolkit)
      : [];
    // Ready = needs no app, or its main app (the first) is connected; the picker lists these first.
    const skills = (await listSkills(service.db, owner)).map((skill) => ({
      ...skill,
      ready: !skill.apps.length || connected.includes(skill.apps[0]),
      missing: skill.apps.filter((app) => !connected.includes(app)),
    }));
    return c.json({ skills });
  });
  app.post("/skills", async (c) =>
    c.json(await saveSkill(service.db, c.get("owner"), await c.req.json()), 201),
  );
  app.delete("/skills/:name", async (c) => {
    await deleteSkill(service.db, c.get("owner"), c.req.param("name"));
    return c.json({ ok: true });
  });
  app.post("/model", async (c) => {
    const { modelId } = z.object({ modelId: z.string().min(1).max(200) }).parse(await c.req.json());
    return c.json(await service.selectModel(c.get("owner"), modelId));
  });
  app.post("/tasks", async (c) =>
    c.json(await service.createTask(c.get("owner"), await c.req.json()), 201),
  );
  app.get("/tasks/:id", async (c) =>
    c.json(await service.detail(c.get("owner"), c.req.param("id"))),
  );
  app.post("/tasks/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "cancel", "retry"]) })
      .parse(await c.req.json());
    return c.json(await service.control(c.get("owner"), c.req.param("id"), action));
  });
  // Which apps, accounts and slices Ideas reads (Ideias → Fontes).
  app.get("/idea-sources", async (c) => {
    const owner = c.get("owner");
    const connections = (await service.composio.connections(owner)).filter(
      (connection) => connection.status === "ACTIVE" && connection.toolkit in SCANNABLE,
    );
    const connected = new Set(connections.map((connection) => connection.toolkit));
    const saved = await loadIdeaSources(service.db, owner);
    return c.json({
      sources: saved ?? defaultIdeaSources(connected),
      custom: Boolean(saved),
      apps: Object.entries(SCANNABLE).map(([app, info]) => ({
        app,
        ...info,
        connected: connected.has(app),
        accounts: connections
          .filter((connection) => connection.toolkit === app)
          .map((connection) => ({
            id: connection.id,
            label: connection.label ?? connection.account ?? connection.id,
          })),
      })),
    });
  });
  // Plain words → a filter: a Gmail search, or Slack channels picked from the real list.
  app.post("/idea-sources/interpret", async (c) => {
    const owner = c.get("owner");
    const body = z
      .object({
        app: z.enum(["gmail", "slack"]),
        text: z.string().trim().min(3).max(300),
        account: z.string().max(100).optional(),
      })
      .parse(await c.req.json());
    const ask = (prompt: string) =>
      complete(service.config, SIDE_MODEL, prompt, { maxTokens: 600, timeoutMs: 30_000 });
    try {
      if (body.app === "gmail") return c.json(await interpretGmail(body.text, ask));
      const listed = (await service.composio
        .execute(
          owner,
          "SLACK_LIST_CONVERSATIONS",
          { types: "public_channel,private_channel", exclude_archived: true, limit: 1000 },
          undefined,
          body.account,
        )
        .catch(() => undefined)) as { channels?: { name?: string }[] } | undefined;
      const channels = (listed?.channels ?? []).flatMap((c) => (c.name ? [c.name] : []));
      return c.json(await interpretSlack(body.text, channels, ask));
    } catch {
      throw new AppError(
        "Não consegui transformar isso em filtro. Tente com outras palavras.",
        422,
      );
    }
  });
  app.put("/idea-sources", async (c) =>
    c.json({ sources: await saveIdeaSources(service.db, c.get("owner"), await c.req.json()) }),
  );
  app.get("/timings", async (c) => c.json(await recentTimings(service.db, c.get("owner"))));
  app.get("/timings/cache", async (c) => c.json(await cacheSummary(service.db, c.get("owner"))));
  app.post("/tasks/:id/archive", async (c) => {
    const { archived } = z.object({ archived: z.boolean() }).parse(await c.req.json());
    const task = await archiveTask(service.db, c.get("owner"), c.req.param("id"), archived);
    if (!task) throw new AppError("Tarefa não encontrada", 404);
    return c.json(task);
  });
  app.post("/tasks/:id/follow-up", async (c) => {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(4000) })
      .parse(await c.req.json());
    return c.json(await followUpTask(service, c.get("owner"), c.req.param("id"), text));
  });
  app.post("/tasks/:id/input", async (c) => {
    const body = z
      .object({
        answer: z.string().trim().min(1).max(12000),
        fields: z
          .record(z.string().min(1).max(300), z.union([z.string().max(12000), z.boolean()]))
          .optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.answer(c.get("owner"), c.req.param("id"), body.answer, body.fields),
    );
  });
  app.post("/goals", async (c) =>
    c.json(await service.createGoal(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/goals/:id", async (c) => {
    const body = goalPatchSchema.parse(await c.req.json());
    return c.json(await service.updateGoal(c.get("owner"), c.req.param("id"), body));
  });
  app.post("/monitors", async (c) =>
    c.json(await service.createMonitor(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/monitors/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "stop", "check"]) })
      .parse(await c.req.json());
    return c.json(await service.controlMonitor(c.get("owner"), c.req.param("id"), action));
  });
  app.post("/routines", async (c) =>
    c.json(await service.createRoutine(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/routines/:id", async (c) =>
    c.json(await service.updateRoutine(c.get("owner"), c.req.param("id"), await c.req.json())),
  );
  app.post("/routines/:id/run", async (c) =>
    c.json(await service.runRoutine(c.get("owner"), c.req.param("id"))),
  );
  app.delete("/routines/:id", async (c) =>
    c.json(await service.deleteRoutine(c.get("owner"), c.req.param("id"))),
  );
  app.post("/ideas/refresh", async (c) => c.json(await service.refreshIdeas(c.get("owner"), true)));
  app.post("/ideas/archive-done", async (c) =>
    c.json(await service.archiveDoneIdeas(c.get("owner"))),
  );
  app.post("/ideas/:id/archive", async (c) => {
    const body = z.object({ archived: z.boolean().default(true) }).parse(await c.req.json());
    return c.json(await service.archiveIdea(c.get("owner"), c.req.param("id"), body.archived));
  });
  // "Agendar para depois": hidden until `until` (ISO instant), then back in the list.
  app.post("/ideas/:id/snooze", async (c) => {
    const body = z.object({ until: z.string().trim().min(1) }).parse(await c.req.json());
    return c.json(await service.snoozeIdea(c.get("owner"), c.req.param("id"), body.until));
  });
  app.post("/ideas/:id", async (c) => {
    const body = z
      .object({
        action: z.enum(["accept", "dismiss", "restore"]),
        prompt: z.string().trim().min(1).max(12000).optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.decideIdea(c.get("owner"), c.req.param("id"), body.action, body.prompt),
    );
  });
  app.route(
    "/",
    memoryRoutes({
      db: service.db,
      timeZone: timeZoneOf(service.config),
      think: process.env.IMPOSSIBL_API_KEY?.trim()
        ? (prompt) => service.reflect(prompt)
        : undefined,
    }),
  );
  app.post("/identity", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        tone: z.enum(["warm", "concise", "thoughtful"]),
        avatar: z.enum(["sky", "sand", "lilac"]).optional(),
        showChatUpdates: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const owner = c.get("owner");
    await service.ensure(owner);
    const identity = await service.db.compareAndSwap<AgentIdentity>(
      owner,
      "agent-settings",
      "identity",
      {},
      body,
    );
    if (!identity)
      throw new AppError("A identidade do agente mudou; atualize e tente de novo", 409);
    return c.json(identity);
  });
  app.get("/notifications", async (c) =>
    c.json((await service.snapshot(c.get("owner"))).notifications),
  );
  app.post("/notifications/:id/read", async (c) => {
    const notification = await service.db.compareAndSwap<AgentNotification>(
      c.get("owner"),
      "notifications",
      c.req.param("id"),
      {},
      { read: true },
    );
    if (!notification) throw new AppError("Notificação não encontrada", 404);
    return c.json(notification);
  });
  app.post("/sample-page", async (c) => {
    if (service.config.mode !== "sample") throw new AppError("Não encontrado", 404);
    const body = z.object({ text: z.string().max(100000) }).parse(await c.req.json());
    await service.db.put(c.get("owner"), "sample-pages", { id: "availability", text: body.text });
    return c.json({ ok: true });
  });
  return app;
}
