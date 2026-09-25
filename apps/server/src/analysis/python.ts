// run_python: the agent's data analyst. Each run is a throwaway container from apps/python
// (pandas, numpy, openpyxl, matplotlib, reportlab…) with no network, a read-only root, memory,
// CPU and process limits and a non-root user. The person's files go in read-only at /work/in;
// whatever the script saves in /work/out comes back to their library.
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../../../../packages/domain/src/index.ts";
import { type DockerRunner, runDocker } from "../computer/computer.ts";
import type { Config } from "../platform/config.ts";
import { AppError } from "../platform/errors.ts";
import type { Files } from "../platform/files.ts";

const TIMEOUT_SECONDS = 90;
const MAX_OUTPUTS = 10;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const OUTPUT_TEXT = 20_000;

export interface PythonRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  inputs: { fileId: string; path: string }[];
  files: Artifact[];
  skipped: string[];
}

/** A file name safe to use inside /work/in, keeping the person's name when possible. */
export function sandboxName(name: string, taken: Set<string>) {
  const clean =
    name
      .normalize("NFKD")
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 80) || "arquivo";
  let candidate = clean;
  for (let n = 2; taken.has(candidate); n++) candidate = clean.replace(/(\.[^.]*)?$/, `_${n}$1`);
  taken.add(candidate);
  return candidate;
}

export class PythonSandbox {
  constructor(
    private readonly config: Config,
    private readonly files: Files,
    private readonly docker: DockerRunner = runDocker,
  ) {}

  get enabled() {
    return Boolean(this.config.pythonImage);
  }

  async run(
    owner: string,
    input: { code: string; fileIds: string[] },
    signal?: AbortSignal,
  ): Promise<PythonRun> {
    if (!this.config.pythonImage)
      throw new AppError("Python não está configurado neste servidor (PYTHON_IMAGE).", 503);
    const id = randomUUID();
    const work = join(this.config.dataDir, "python", id);
    const inDir = join(work, "in");
    const outDir = join(work, "out");
    await mkdir(inDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    // The container runs as uid 1000, which may not be the server's user.
    await chmod(work, 0o755);
    await chmod(outDir, 0o777);
    try {
      const taken = new Set<string>();
      const inputs: PythonRun["inputs"] = [];
      for (const fileId of input.fileIds) {
        const file = await this.files.get(owner, fileId);
        const name = sandboxName(file.name, taken);
        await writeFile(join(inDir, name), await this.files.bytes(owner, fileId), { mode: 0o644 });
        inputs.push({ fileId, path: `/work/in/${name}` });
      }
      await writeFile(join(work, "main.py"), input.code, { mode: 0o644 });
      const name = `corgi-python-${id.slice(0, 12)}`;
      const result = await this.docker(
        [
          "run",
          "--rm",
          "--name",
          name,
          "--network",
          "none",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,size=256m",
          "--memory",
          "1g",
          "--cpus",
          "1.5",
          "--pids-limit",
          "128",
          "--security-opt",
          "no-new-privileges",
          "--cap-drop",
          "ALL",
          "--user",
          "1000:1000",
          "-v",
          `${inDir}:/work/in:ro`,
          "-v",
          `${outDir}:/work/out:rw`,
          "-v",
          `${join(work, "main.py")}:/work/main.py:ro`,
          "-w",
          "/work",
          this.config.pythonImage,
          "timeout",
          "--signal=KILL",
          String(TIMEOUT_SECONDS),
          "python",
          "-I",
          "/work/main.py",
        ],
        { timeoutMs: (TIMEOUT_SECONDS + 20) * 1000, signal, maxOutputBytes: 256 * 1024 },
      );
      if (result.timedOut || result.interrupted)
        await this.docker(["rm", "-f", name], { timeoutMs: 10_000 }).catch(() => undefined);
      if (/Unable to find image|No such image/i.test(result.stderr))
        throw new AppError(`A imagem Python ${this.config.pythonImage} não foi construída.`, 503);
      const files: Artifact[] = [];
      const skipped: string[] = [];
      for (const entry of (await readdir(outDir)).sort().slice(0, MAX_OUTPUTS * 2)) {
        const path = join(outDir, entry);
        // lstat, never stat: the script could leave a symlink pointing at a host file.
        const info = await lstat(path);
        if (!info.isFile()) {
          skipped.push(`${entry} (not a regular file)`);
          continue;
        }
        if (files.length >= MAX_OUTPUTS || info.size > MAX_OUTPUT_BYTES) {
          skipped.push(
            `${entry} (${files.length >= MAX_OUTPUTS ? "too many files" : "over 10 MB"})`,
          );
          continue;
        }
        try {
          files.push(
            this.files.signed(
              owner,
              await this.files.import(owner, entry, new Uint8Array(await readFile(path)), "Python"),
            ),
          );
        } catch (error) {
          skipped.push(`${entry} (${error instanceof Error ? error.message : "not supported"})`);
        }
      }
      return {
        exitCode: result.exitCode,
        stdout: tail(result.stdout),
        stderr: tail(result.stderr),
        timedOut: result.timedOut || result.exitCode === 137,
        inputs,
        files,
        skipped,
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

/** Long output keeps its end, where results and errors are. */
function tail(text: string) {
  return text.length > OUTPUT_TEXT ? `…${text.slice(-OUTPUT_TEXT)}` : text;
}
