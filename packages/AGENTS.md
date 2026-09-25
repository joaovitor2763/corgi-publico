# packages/ — shared code

- `domain/` — types + zod schemas used by server, app (via relative path / tsconfig path) and tests.
  Changing a schema changes the API contract: update server handlers, mobile callers and tests together.
- `integrations/` — Google (Gmail/Calendar), PDF forms, credential vault.
