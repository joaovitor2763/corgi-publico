// /api/apify: connect Apify with an API token, set the spend cap per run, disconnect.
import { Hono } from "hono";
import { z } from "zod";
import type { ApifyService } from "./apify.ts";

const maxUsd = z.number().min(0.05).max(20);

export function apifyRoutes(apify: ApifyService) {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) => c.json(await apify.status(c.get("owner"))));
  app.post("/connect", async (c) => {
    const body = z
      .object({ token: z.string().trim().min(10).max(200), maxUsd: maxUsd.optional() })
      .parse(await c.req.json());
    return c.json(await apify.connect(c.get("owner"), body.token, body.maxUsd));
  });
  app.put("/limit", async (c) => {
    const body = z.object({ maxUsd }).parse(await c.req.json());
    return c.json(await apify.setLimit(c.get("owner"), body.maxUsd));
  });
  app.post("/disconnect", async (c) => c.json(await apify.disconnect(c.get("owner"))));
  return app;
}
