// Finding the right app tool without flooding the model. The main model decides to use an app and
// writes a search (in English, like tool names); nothing here reads the person's words to trigger
// anything. Composio's search matches keywords, so "calendar events tomorrow" finds nothing while
// "list events" works. Instead, after the model asks:
//   1. candidates = the tools each app's guide recommends + tools matching the model's search words
//      (a local, cached index of the connected apps) + Composio's own search,
//   2. one Jev call picks the best few for the request; only those get full parameter schemas.
import { type AskJev, relevant } from "../trust/jev.ts";
import { catalogApp } from "./catalog.ts";
import type { AppTool } from "./composio.ts";

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const STOP = new Set(
  "a o e de da do das dos em no na para por com um uma que me meu minha my the of to for in on from and what who".split(
    " ",
  ),
);

/** "files" → "file", "entries" → "entry": tool names mix singular and plural. */
const stem = (word: string) =>
  word.length > 4 && word.endsWith("ies")
    ? `${word.slice(0, -3)}y`
    : word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word;

/** Tool vocabulary varies by app ("find" vs "search" vs "list"): each verb also matches its kin. */
const KIN: string[][] = [
  ["search", "find", "list", "lookup", "query"],
  ["get", "read", "fetch", "retrieve", "view"],
  ["send", "post", "reply"],
  ["create", "add", "new", "insert"],
  ["update", "edit", "patch", "modify"],
  ["delete", "remove", "trash"],
  ["download", "export"],
];

function terms(text: string) {
  const words = fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
  return [...new Set(words)];
}

/** The app a search names ("drive", "gmail", "calendar", "slack"…), matched on toolkit words. */
/** The words that name an app: "googledrive" and "drive", "google_maps" and "map". */
function appWordsOf(toolkit: string) {
  return [
    fold(toolkit).replace(/_/g, ""),
    ...fold(toolkit.replace(/^google_?/, ""))
      .split(/[^a-z0-9]+/)
      .map(stem),
  ];
}

function namedApps(wanted: string[], toolkits: string[]) {
  return new Set(
    toolkits.filter((toolkit) => {
      const words = appWordsOf(toolkit);
      return wanted.some((w) => words.includes(w));
    }),
  );
}

/** Tools the app's guide recommends (it names them by slug): strong hints. */
function recommended(toolkit: string) {
  const guide = catalogApp(toolkit)?.guide ?? "";
  return new Set(guide.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g) ?? []);
}

/** Candidates for the model's search: guide picks first, then word matches (slug words double). */
export function preselect(tools: AppTool[], search: string, max = 12) {
  const all = terms(search);
  // Naming an app ("drive files") narrows to it; its name then isn't a search word.
  const apps = namedApps(all, [...new Set(tools.map((t) => t.toolkit))]);
  const appWords = new Set([...apps].flatMap(appWordsOf));
  const wanted = all.filter((w) => !appWords.has(w));
  const kin = (term: string) => KIN.find((group) => group.includes(term)) ?? [term];
  const hints = new Map<string, Set<string>>();
  const scored = tools.map((tool) => {
    let hint = hints.get(tool.toolkit);
    if (!hint) {
      hint = recommended(tool.toolkit);
      hints.set(tool.toolkit, hint);
    }
    // The app's own name is in every one of its tools: match on what the tool does, not on it.
    const prefix = new RegExp(`^${tool.toolkit}_?`, "i");
    const slug = fold(tool.slug.replace(prefix, "").replace(/_/g, " "));
    const text = fold(`${tool.name.replace(prefix, "")} ${tool.description}`);
    if (apps.size && !apps.has(tool.toolkit)) return { tool, score: 0 };
    let matched = 0;
    for (const term of wanted) {
      if (new RegExp(`\\b${term}`).test(slug)) matched += 2;
      else if (kin(term).some((k) => new RegExp(`\\b${k}`).test(slug))) matched += 1.5;
      else if (text.includes(term)) matched += 1;
    }
    // A named app with no other words: its guide's picks are the answer.
    if (!wanted.length && apps.size) matched = hint.has(tool.slug) ? 1 : 0;
    // The guide's picks and reads rank higher, but only among tools the search relates to.
    const score = matched ? matched + (hint.has(tool.slug) ? 3 : 0) + (tool.readOnly ? 0.5 : 0) : 0;
    return { tool, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.tool);
}

/**
 * The tools to show the model: the best few with schemas, the rest by name. Without Jev (or if it
 * fails) the lexical order decides.
 */
export async function discover(
  index: AppTool[],
  search: string,
  request: string,
  ask?: AskJev,
  { keep = 5, extra = [] as AppTool[] } = {},
): Promise<{ tools: AppTool[]; more: AppTool[] }> {
  const seen = new Set<string>();
  const candidates = [...preselect(index, search), ...extra].filter((tool) => {
    if (seen.has(tool.slug)) return false;
    seen.add(tool.slug);
    return true;
  });
  if (candidates.length <= keep) return { tools: candidates, more: [] };
  const best = ask
    ? await relevant(
        ask,
        `${request}\n(the assistant is looking for: ${search})`,
        candidates.map((tool) => ({ id: tool.slug, text: `${tool.slug}: ${tool.description}` })),
        { max: keep, threshold: 0.35 },
      )
    : undefined;
  const picked = best?.length
    ? best.map((slug) => candidates.find((tool) => tool.slug === slug)).filter((t) => !!t)
    : candidates.slice(0, keep);
  return {
    tools: picked as AppTool[],
    more: candidates.filter((tool) => !picked.includes(tool)).slice(0, 8),
  };
}
