import { createWorkerServer } from "./server.ts";

const token = process.env.WORKER_TOKEN ?? "";
const worker = await createWorkerServer({
  token,
  dataDir: process.env.WORKER_DATA_DIR ?? ".openmuse/browser-profiles",
  // Each open Chromium costs ~200–400 MB. Idle ones close on their own and reopen with the
  // same profile (cookies kept), so the cap only limits browsers working at the same time.
  maxSessions: Number(process.env.WORKER_MAX_SESSIONS) || 8,
  idleTimeoutMs: (Number(process.env.WORKER_IDLE_MINUTES) || 10) * 60_000,
});
worker.server.listen(8790, process.env.WORKER_HOST ?? "127.0.0.1", () => {
  console.log("OpenMuse browser worker listening on port 8790");
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30_000);
  deadline.unref();
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
