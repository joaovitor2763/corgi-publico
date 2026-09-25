// The Memória screen's API (mounted under /api/agent): what Corgi knows, why, what it forgot, how
// it serves the person and who is who. Every change goes through the memory book.
import { Hono } from "hono";
import { z } from "zod";
import type { AgentMemory, MemorySynthesis } from "../../../../packages/domain/src/agent.ts";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";
import {
  allMemories,
  correctMemory,
  dreamsOf,
  explainMemory,
  forgetMemory,
  peopleOf,
  restoreMemory,
  saveMemory,
  synthesisOf,
} from "./book.ts";
import { dream } from "./dream.ts";
import type { MemoryItem } from "./memory.ts";

const text = z.string().trim().min(1).max(2000);

export function memoryRoutes(deps: {
  db: Store;
  timeZone: string;
  think?: (prompt: string) => Promise<string>;
}) {
  const { db } = deps;
  const app = new Hono<{ Variables: { owner: string } }>();
  const find = async (owner: string, id: string) => {
    const memory = await db.get<MemoryItem>(owner, "memories", id);
    if (!memory) throw new AppError("Memória não encontrada", 404);
    return memory;
  };
  app.get("/memory", async (c) => {
    const owner = c.get("owner");
    const memories = (await allMemories(db, owner)).filter((m) => m.status !== "superseded");
    return c.json({
      memories: memories.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
      alignment: await synthesisOf(db, owner),
      people: (await peopleOf(db, owner)).sort((a, b) => a.name.localeCompare(b.name)),
      dreams: await dreamsOf(db, owner),
    });
  });
  app.post("/memories", async (c) => {
    const body = z.object({ text }).parse(await c.req.json());
    return c.json(await saveMemory(db, c.get("owner"), { text: body.text, origin: "owner" }), 201);
  });
  app.post("/memories/:id", async (c) => {
    const body = z.object({ text }).parse(await c.req.json());
    const memory = await find(c.get("owner"), c.req.param("id"));
    if (memory.text === body.text) return c.json(memory);
    return c.json(await correctMemory(db, c.get("owner"), memory, body.text, "owner"));
  });
  app.post("/memories/:id/forget", async (c) => {
    const memory = await find(c.get("owner"), c.req.param("id"));
    await forgetMemory(db, c.get("owner"), memory);
    return c.json({ ok: true });
  });
  app.post("/memories/:id/restore", async (c) => {
    const restored = await restoreMemory(db, c.get("owner"), c.req.param("id"));
    if (!restored) throw new AppError("Memória não encontrada", 404);
    return c.json(restored as AgentMemory);
  });
  app.get("/memories/:id/why", async (c) =>
    c.json(await explainMemory(db, c.get("owner"), await find(c.get("owner"), c.req.param("id")))),
  );
  // The person's own version of "how to serve me": the nightly reflection stops rewriting it.
  app.put("/memory/alignment", async (c) => {
    const body = z
      .object({
        reply: z.string().trim().max(500),
        limits: z.string().trim().max(400),
        friction: z.array(z.string().trim().max(160)).max(5).default([]),
        week: z.string().trim().max(400).default(""),
      })
      .parse(await c.req.json());
    const saved: MemorySynthesis = {
      id: "alignment",
      ...body,
      pinned: true,
      updatedAt: new Date().toISOString(),
    };
    await db.put(c.get("owner"), "memory-synthesis", saved);
    return c.json(saved);
  });
  app.post("/memory/alignment/unpin", async (c) => {
    const current = await synthesisOf(db, c.get("owner"));
    if (!current) return c.json(null);
    const next = { ...current, pinned: false };
    await db.put(c.get("owner"), "memory-synthesis", next);
    return c.json(next);
  });
  app.post("/memory/people/:id/forget", async (c) => {
    if (!(await db.take(c.get("owner"), "people", c.req.param("id"))))
      throw new AppError("Pessoa não encontrada", 404);
    return c.json({ ok: true });
  });
  // "Refletir agora": the nightly reflection on demand.
  app.post("/memory/reflect", async (c) => {
    if (!deps.think) throw new AppError("O modelo não está configurado neste servidor", 409);
    return c.json(
      await dream({ db, owner: c.get("owner"), think: deps.think, timeZone: deps.timeZone }),
    );
  });
  return app;
}
