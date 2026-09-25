# platform/ — shared kernel

`config.ts` (env → `Config`; skips `.env` under tests), `db.ts` (`Store`: owner-scoped JSON records on
PGlite or Postgres), `auth.ts` (session tokens, access key), `files.ts` (documents + signed URLs),
`errors.ts` (`AppError`), `log.ts` (redacted background failures), `file-formats.ts` (uploads are
typed by their bytes: PDF, images, CSV/TXT/MD/JSON, DOCX, XLSX; anything else is refused),
`file-content.ts` (text for the agent via unpdf/mammoth/read-excel-file, capped at 30k chars; images
as images), `read-file-tool.ts` (the `read_file` tool shared by chat and tasks), `web-app.ts` (serves the exported
web app on the API origin; SPA fallback, never outside its directory).

Access: `OPENMUSE_ACCESS_KEY`, once set, is required in every mode; without it the local mode refuses
a non-loopback `HOST`.

This folder imports nothing from the domains. New env vars: add to `Config`, `.env.example` and docs.
