import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readConfig, setupWarnings } from "./platform/config.ts";
import { createStore } from "./platform/db.ts";

const config = readConfig();
const warnings = setupWarnings(config);
if (warnings.length)
  console.warn(
    `Corgi setup (run \`pnpm corgi:setup\` to fix):\n${warnings.map((w) => `  · ${w}`).join("\n")}`,
  );
const db = await createStore({
  dataDir: `${config.dataDir}/postgres`,
  databaseUrl: config.databaseUrl,
});
await db.recoverInterruptedActions();
const { app, agent } = await createApp(db, config);
if (config.taskWorkerEnabled) agent.start();
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () =>
  console.log(`Corgi ${config.mode} API ready at ${config.publicUrl}`),
);
const shutdown = () => {
  server.close(() => {
    void agent
      .stop()
      .then(() => db.close())
      .then(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
