import assert from "node:assert/strict";
import { test } from "node:test";
import { PythonSandbox, sandboxName } from "../apps/server/src/analysis/python.ts";
import type { DockerRunner } from "../apps/server/src/computer/computer.ts";
import type { Config } from "../apps/server/src/platform/config.ts";
import type { Files } from "../apps/server/src/platform/files.ts";

test("input names stay readable and unique inside the sandbox", () => {
  const taken = new Set<string>();
  assert.equal(sandboxName("Vendas Q3 (final).xlsx", taken), "Vendas_Q3_final.xlsx");
  assert.equal(sandboxName("Vendas Q3 (final).xlsx", taken), "Vendas_Q3_final_2.xlsx");
  assert.equal(sandboxName("../../etc/passwd", taken), "etcpasswd");
  assert.equal(sandboxName("relatório.pdf", taken), "relatorio.pdf");
});

test("each run is an isolated container: no network, read-only, limits, non-root", async () => {
  const calls: string[][] = [];
  const docker: DockerRunner = async (args) => {
    calls.push(args);
    return {
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      interrupted: false,
      truncated: false,
    };
  };
  const files = {
    get: async () => ({ id: "f1", name: "vendas.csv", mimeType: "text/csv" }),
    bytes: async () => Buffer.from("a,b\n1,2\n"),
  } as unknown as Files;
  const sandbox = new PythonSandbox(
    {
      dataDir: `${process.cwd()}/.openmuse-test-python`,
      pythonImage: "corgi-python:test",
    } as Config,
    files,
    docker,
  );
  const run = await sandbox.run("owner", { code: "print('ok')", fileIds: ["f1"] });
  assert.equal(run.stdout, "ok\n");
  assert.deepEqual(run.inputs, [{ fileId: "f1", path: "/work/in/vendas.csv" }]);
  const args = calls[0].join(" ");
  for (const flag of [
    "--network none",
    "--read-only",
    "--memory 1g",
    "--pids-limit",
    "--cap-drop ALL",
    "--user 1000:1000",
  ])
    assert.ok(args.includes(flag), flag);
  assert.match(args, /\/work\/in:ro/);
  assert.equal(run.files.length, 0);
});

test("without an image the tool is off", () => {
  const sandbox = new PythonSandbox({ dataDir: "/tmp" } as Config, {} as Files);
  assert.equal(sandbox.enabled, false);
});

test("a symlink left in /work/out never reads a host file", async () => {
  const { mkdir, symlink, writeFile } = await import("node:fs/promises");
  const dataDir = `${process.cwd()}/.openmuse-test-python-link`;
  const imported: string[] = [];
  const docker: DockerRunner = async (args) => {
    // Plays the script: a symlink to a host secret plus one real output.
    const out = args[args.indexOf("-v", args.indexOf("-v") + 1) + 1].split(":")[0];
    await mkdir(out, { recursive: true });
    await writeFile(`${dataDir}/secret.env`, "KEY=1");
    await symlink(`${dataDir}/secret.env`, `${out}/leak.csv`);
    await writeFile(`${out}/ok.csv`, "a\n1\n");
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      interrupted: false,
      truncated: false,
    };
  };
  const files = {
    import: async (_owner: string, name: string) => {
      imported.push(name);
      return { id: name, name, mimeType: "text/csv" };
    },
    signed: (_owner: string, file: unknown) => file,
  } as unknown as Files;
  const run = await new PythonSandbox({ dataDir, pythonImage: "x" } as Config, files, docker).run(
    "owner",
    { code: "", fileIds: [] },
  );
  assert.deepEqual(imported, ["ok.csv"]);
  assert.match(run.skipped.join(), /leak\.csv \(not a regular file\)/);
  const { rm } = await import("node:fs/promises");
  await rm(dataDir, { recursive: true, force: true });
});
