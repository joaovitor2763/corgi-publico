// The main tools of each connected app, written into the chat context so common requests go
// straight to use_app_tool (one model round trip instead of find → use). A few hundred tokens
// per app, stable per person (cache friendly); find_app_tools stays for everything else.
import { catalogApp } from "./catalog.ts";
import type { AppTool, ComposioService } from "./composio.ts";

interface Schema {
  properties?: Record<string, { type?: string | string[]; enum?: unknown[] }>;
  required?: string[];
}

/** "GOOGLECALENDAR_EVENTS_LIST(calendar_id*: string, time_min: string, …)". */
export function signature(tool: AppTool, maxParams = 10) {
  const schema = (tool.parameters ?? {}) as Schema;
  const required = new Set(schema.required ?? []);
  const params = Object.entries(schema.properties ?? {})
    .sort(([a], [b]) => Number(required.has(b)) - Number(required.has(a)))
    .slice(0, maxParams)
    .map(([name, spec]) => {
      const type = Array.isArray(spec.type) ? spec.type.join("|") : (spec.type ?? "any");
      return `${name}${required.has(name) ? "*" : ""}: ${type}`;
    });
  const note = tool.readOnly
    ? ""
    : /SQL|QUERY|STATEMENT/.test(tool.slug)
      ? " [one SELECT/SHOW/DESCRIBE runs directly; any other SQL → approval]"
      : " [change → approval]";
  return `${tool.slug}(${params.join(", ")})${note}`;
}

/** Context block for the connected apps: guide + signatures of the tools the guide names. */
export function readyTools(
  toolkits: string[],
  index: Map<string, AppTool[]>,
  /** Active accounts, so the model knows them without a find_app_tools round trip. */
  accounts: {
    toolkit: string;
    id: string;
    account?: string;
    label?: string;
    isDefault?: boolean;
  }[] = [],
) {
  const blocks = toolkits.flatMap((toolkit) => {
    const guide = catalogApp(toolkit)?.guide;
    if (!guide) return [];
    const named = new Set(guide.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g) ?? []);
    const tools = (index.get(toolkit) ?? []).filter((tool) => named.has(tool.slug));
    const mine = accounts.filter((a) => a.toolkit === toolkit);
    const who =
      mine.length > 1
        ? ` Accounts (pass account to use one; reads without it cover all): ${mine
            .map(
              (a) =>
                `${a.label ? `${a.label} ` : ""}${a.account ?? a.id}${a.isDefault ? " (default)" : ""}`,
            )
            .join(", ")}.`
        : mine[0]?.account
          ? ` Account: ${mine[0].account}.`
          : "";
    return [
      `- ${toolkit} (connected):${who} ${guide}${tools.length ? `\n  ${tools.map((tool) => signature(tool)).join("\n  ")}` : ""}`,
    ];
  });
  return blocks.length
    ? `# Connected apps, ready to use\nCall use_app_tool directly with these (* = required); use find_app_tools only for anything not listed.\n${blocks.join("\n")}`
    : "";
}

/** The person's active app connections and their ready-tools block (chat and tasks). */
export async function connectedApps(
  composio: ComposioService,
  owner: string,
  /** Only these toolkits (a helper's allowed apps). */
  only?: (toolkit: string) => boolean,
) {
  const active = composio.enabled
    ? (await composio.recentConnections(owner).catch(() => [])).filter(
        (c) => c.status === "ACTIVE" && (!only || only(c.toolkit)),
      )
    : [];
  // Each app's index is cached after the first call.
  const toolkits = [...new Set(active.map((c) => c.toolkit))];
  const index = new Map(
    await Promise.all(
      toolkits.map(
        async (toolkit) =>
          [toolkit, await composio.toolIndex(toolkit).catch(() => [] as AppTool[])] as const,
      ),
    ),
  );
  return { active, appTools: readyTools(toolkits, index, active) };
}
