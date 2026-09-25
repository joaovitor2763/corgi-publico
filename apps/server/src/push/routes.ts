// /api/push: the app turns notifications on for this device and picks what it hears about.
import { Hono } from "hono";
import { z } from "zod";
import type { PushService } from "./push.ts";

export function pushRoutes(push: PushService) {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) =>
    c.json({
      publicKey: (await push.vapid()).publicKey,
      prefs: await push.prefs(c.get("owner")),
      devices: await push.devices(c.get("owner")),
      pending: await push.pending(c.get("owner")),
    }),
  );
  app.post("/subscribe", async (c) => {
    const body = z
      .object({ subscription: z.unknown(), device: z.string().max(80).optional() })
      .parse(await c.req.json());
    return c.json(await push.subscribe(c.get("owner"), body.subscription, body.device));
  });
  app.post("/unsubscribe", async (c) => {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await c.req.json());
    await push.unsubscribe(c.get("owner"), endpoint);
    return c.json({ ok: true });
  });
  app.put("/prefs", async (c) => c.json(await push.setPrefs(c.get("owner"), await c.req.json())));
  app.post("/test", async (c) =>
    c.json({
      sent: await push.notify(c.get("owner"), {
        title: "Tudo certo por aqui 🐾",
        body: "É assim que o Corgi vai te chamar quando algo precisar de você.",
        category: "approvals",
        tag: "test",
      }),
    }),
  );
  return app;
}
