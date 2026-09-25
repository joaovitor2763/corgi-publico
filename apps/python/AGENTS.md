# apps/python — run_python sandbox image

Built as `corgi-python:local` (`docker build -t corgi-python:local apps/python`). The server
(`apps/server/src/analysis/python.ts`) starts one container per run with `--network none`,
`--read-only`, tmpfs `/tmp`, memory/CPU/pids limits, user 1000, and a bind-mounted work dir:
`/work/in` (the person's files, read-only) and `/work/out` (files to hand back).
Add libraries here only; the agent cannot install anything at run time.
