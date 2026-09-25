# apps/mobile — Expo client (iOS, Android, web)

`App.tsx` is the shell (session, navigation, header with the Regi avatar). Source is organized as:

| Folder | Contents |
| --- | --- |
| `src/shared/` | API client, workspace contexts, UI kit (`ui.tsx`, `kit.tsx`), markdown, date/format helpers, platform-split pickers/PDF reader. Imports no feature. |
| `src/features/<domain>/` | One folder per domain: `chat`, `activity`, `approvals`, `ideas`, `goals`, `routines`, `memory`, `connected-apps`, `mail`, `calendar`, `browser`, `computer`, `files`, `settings`, `weather`, `routes`. Features may import `shared` and other features, never `screens`. |
| `src/screens/` | `details.tsx`: the detail-sheet router that composes features. |
| `src/mascot/` | Regi: 2D clips/sprites (shipped) and the 3D playground (web `/mascot`, lazy-loaded). |

- Platform files: `Name.native.tsx` / `Name.web.tsx`, imported as `./Name` (extensionless).
- UI strings are pt-BR for new surfaces; the agent's name comes from identity settings.
- Keep heavy libraries behind `lazy()` (see `MascotDemo` in `App.tsx`); check `pnpm build:web` output size.
- Tests: `apps/mobile/test/*.test.ts` run in the root `pnpm test`.

## Structured answer elements (`features/chat/result-cards.tsx`)

The agent answers in text by default and calls `show_results` only when data has structure. Every
element is an artifact: a grey shell, a white preview with a height limit (longer content fades out
at the bottom), and an identity footer (icon · title · "N linhas · fonte") that opens the full
element in a `Sheet`. Layouts: `timeline` (time-ordered; `date` draws the big day header and,
today, the "now" line; overlaps computed in `agenda.ts`), `table` (columns sized from content in
`table-sort.ts`; wide tables pin the first column and scroll the rest; the sheet sorts by header —
value-aware for "R$ 420 mil" / "84%" — opens a row as a detail card and zooms), `stats` (2–6 key
figures, sign-colored change pill), `cards` (carousel; sheet shows a grid), `list`, `times`,
`detail`. Badges shared by every item move to the footer. A single item in list/table/timeline
renders nothing (the text says it). Jev suggests the shape per tool result (`present_as`, server
`trust/guard.ts`); derived numbers come from the `calculate` tool.
Tool cards in the same shell (`Element`, exported): `get_weather` → `weather/weather-card.tsx`
(SVG `WeatherIcon`s), `show_route` → `routes/route-card.tsx` (path drawn from the encoded polyline,
no map tiles; pure logic in `routes/route.ts`).
Changing an element: open the web gallery at `/elements` (fixtures in `elements-gallery.tsx`) and
check it on an iPhone-sized screenshot, not just types.
