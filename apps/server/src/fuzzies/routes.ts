// /api/fuzzies: the person's helpers — list with templates, create, change, pause, run, delete.
import { Hono } from "hono";
import { z } from "zod";
import type { Fuzzy } from "../../../../packages/domain/src/agent.ts";
import {
  createFuzzy,
  deleteFuzzy,
  type FuzzyDeps,
  fuzzyGet,
  fuzzyList,
  runFuzzy,
  updateFuzzy,
} from "./fuzzies.ts";
import { FUZZY_TEMPLATES } from "./templates.ts";

export function fuzzyRoutes(deps: FuzzyDeps) {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) =>
    c.json({ fuzzies: await fuzzyList(deps.db, c.get("owner")), templates: FUZZY_TEMPLATES }),
  );
  app.post("/", async (c) =>
    c.json(await createFuzzy(deps, c.get("owner"), await c.req.json()), 201),
  );
  app.post("/:id", async (c) =>
    c.json(await updateFuzzy(deps, c.get("owner"), c.req.param("id"), await c.req.json())),
  );
  app.delete("/:id", async (c) =>
    c.json(await deleteFuzzy(deps.db, c.get("owner"), c.req.param("id"))),
  );
  app.post("/:id/run", async (c) => {
    const body = z
      .object({ request: z.string().trim().max(4000).optional() })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(
      await runFuzzy(deps, c.get("owner"), c.req.param("id"), {
        request: body.request,
        from: "person",
      }),
    );
  });
  // Forget one thing the helper learned for its job.
  app.post("/:id/unlearn", async (c) => {
    const { text } = z.object({ text: z.string().min(1).max(300) }).parse(await c.req.json());
    const fuzzy = await fuzzyGet(deps.db, c.get("owner"), c.req.param("id"));
    const next: Fuzzy = { ...fuzzy, learned: fuzzy.learned.filter((l) => l.text !== text) };
    await deps.db.put(c.get("owner"), "fuzzies", next);
    return c.json(next);
  });
  return app;
}
