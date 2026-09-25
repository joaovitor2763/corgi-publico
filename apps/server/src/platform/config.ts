import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Tests never read the developer's .env: real app/model keys must not leak into the suite.
if (!process.env.NODE_TEST_CONTEXT && existsSync(".env")) process.loadEnvFile(".env");
// A key left blank in .env (`COMPOSIO_API_KEY=`) means "not set", never an empty secret.
for (const [name, value] of Object.entries(process.env)) if (value === "") delete process.env[name];
process.env.DO_NOT_TRACK ??= "1";
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

export interface Config {
  mode: "sample" | "live";
  port: number;
  host: string;
  publicUrl: string;
  dataDir: string;
  databaseUrl?: string;
  accessKey?: string;
  encryptionKey?: string;
  model?: string;
  agentBackend: "sample" | "model" | "agui" | "pi";
  /** Sample mode seeds a fictional mailbox and calendar; false keeps the local workspace empty. */
  sampleData?: boolean;
  /** Open-ended tasks run as side chats on the chat engine (default). false: the older task runner. */
  chatTasks?: boolean;
  impossiblBaseUrl?: string;
  /** The person's time zone: "today", routines and briefings. OPENMUSE_TIMEZONE. */
  timeZone?: string;
  agentUrl?: string;
  agentToken?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
  workerUrl?: string;
  workerToken?: string;
  taskWorkerEnabled?: boolean;
  computerEnabled?: boolean;
  computerImage?: string;
  /** Docker image for run_python (apps/python); unset turns the tool off. */
  pythonImage?: string;
  computerDeploymentId?: string;
  allowedOrigins: string[];
}

export function readConfig(): Config {
  const mode = process.env.WORKSPACE_MODE ?? "sample";
  if (mode !== "sample" && mode !== "live")
    throw new Error("WORKSPACE_MODE must be sample or live");
  const backend = process.env.AGENT_BACKEND ?? (mode === "sample" ? "sample" : "model");
  if (backend !== "sample" && backend !== "model" && backend !== "agui" && backend !== "pi")
    throw new Error("AGENT_BACKEND must be sample, model, agui or pi");
  if (mode === "live" && backend === "sample")
    throw new Error("Live workspaces cannot use the sample agent");
  const port = Number(process.env.PORT ?? 8787);
  const publicUrl = process.env.PUBLIC_API_URL ?? `http://localhost:${port}`;
  const config: Config = {
    mode,
    port,
    host: process.env.HOST ?? "127.0.0.1",
    publicUrl,
    dataDir: resolve(process.env.DATA_DIR ?? ".openmuse"),
    databaseUrl: process.env.DATABASE_URL,
    accessKey: process.env.OPENMUSE_ACCESS_KEY,
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
    model: process.env.MODEL,
    agentBackend: backend,
    timeZone: process.env.OPENMUSE_TIMEZONE ?? process.env.WORKER_TIMEZONE,
    sampleData: mode === "sample" && process.env.SAMPLE_DATA !== "false",
    impossiblBaseUrl: process.env.IMPOSSIBL_BASE_URL,
    agentUrl: process.env.AGENT_URL,
    agentToken: process.env.AGENT_TOKEN,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: `${publicUrl}/api/google/callback`,
    workerUrl: process.env.BROWSER_WORKER_URL,
    workerToken: process.env.WORKER_TOKEN,
    taskWorkerEnabled: process.env.TASK_WORKER_ENABLED !== "false",
    computerEnabled: process.env.COMPUTER_ENABLED === "true",
    computerImage: process.env.COMPUTER_IMAGE ?? "openmuse-computer:local",
    pythonImage:
      process.env.PYTHON_IMAGE ??
      (process.env.COMPUTER_ENABLED === "true" ? "corgi-python:local" : undefined),
    computerDeploymentId: process.env.COMPUTER_DEPLOYMENT_ID,
    allowedOrigins: (
      process.env.ALLOWED_ORIGINS ?? "http://localhost:8081,http://127.0.0.1:8081"
    ).split(","),
  };
  if (
    mode === "live" &&
    (!config.accessKey || config.accessKey.length < 24 || !config.encryptionKey)
  )
    throw new Error(
      "Live mode requires OPENMUSE_ACCESS_KEY (24+ characters) and TOKEN_ENCRYPTION_KEY (32-byte base64)",
    );
  if (config.accessKey !== undefined && config.accessKey.length < 24)
    throw new Error("OPENMUSE_ACCESS_KEY must have at least 24 characters");
  // Without a key the local workspace opens for anyone who reaches it: keep it on loopback
  // (tailscale serve proxies to loopback, so that still works from the phone).
  if (
    mode === "sample" &&
    !config.accessKey &&
    !["127.0.0.1", "localhost", "::1"].includes(config.host)
  )
    throw new Error(
      "Without OPENMUSE_ACCESS_KEY the local workspace is loopback-only. Set HOST=127.0.0.1 or a key.",
    );
  return config;
}

/** What is missing for the full assistant, said plainly at startup (the server still starts). */
export function setupWarnings(config: Config, env = process.env) {
  const warnings: string[] = [];
  if (config.agentBackend === "pi" && !env.IMPOSSIBL_API_KEY)
    warnings.push("IMPOSSIBL_API_KEY is not set: the assistant can't answer or run tasks.");
  if (!config.accessKey)
    warnings.push("OPENMUSE_ACCESS_KEY is not set: anyone who reaches this port can open it.");
  if (!config.encryptionKey)
    warnings.push(
      "TOKEN_ENCRYPTION_KEY is not set: stored app keys use a key kept in the database.",
    );
  if (!config.workerUrl || !config.workerToken)
    warnings.push("BROWSER_WORKER_URL / WORKER_TOKEN not set: the assistant has no browser.");
  if (!env.COMPOSIO_API_KEY)
    warnings.push("COMPOSIO_API_KEY is not set (optional): no Gmail, Slack, Notion… apps.");
  return warnings;
}

/** The configured time zone, São Paulo by default. */
export const timeZoneOf = (config: Pick<Config, "timeZone">) =>
  config.timeZone ?? "America/Sao_Paulo";
