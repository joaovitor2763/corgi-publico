import { Composio } from "@composio/core";
import type { Config } from "../platform/config.ts";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";
import { CATALOG, type CategoryId, catalogApp } from "./catalog.ts";

export interface AppConnection {
  id: string;
  toolkit: string;
  status: string;
  name?: string;
  logo?: string;
  /** Who this connection signs in as (an email, or "user @ workspace"), when known. */
  account?: string;
  /** The person's own name for it, e.g. "Trabalho" or "Pessoal". */
  label?: string;
  /** The account used for this app when none is named. One per app among active accounts. */
  isDefault?: boolean;
  /** Another active connection of the same app already signs in as this account. */
  duplicate?: boolean;
  createdAt?: string;
}
/** Per-connection identity and naming, kept in the records table (kind "app-accounts"). */
interface AccountRecord {
  id: string;
  account?: string;
  label?: string;
}
/** The chosen default connection per app (kind "app-defaults", id = toolkit). */
interface DefaultRecord {
  id: string;
  connectionId: string;
}
export const ACCOUNTS = "app-accounts";
export const DEFAULTS = "app-defaults";

type RawAccount = { data?: unknown; state?: { val?: unknown }; alias?: string | null };
/** The e-mail (or name) inside an OpenID id_token: only the public payload is read. */
export function idTokenIdentity(token: unknown) {
  if (typeof token !== "string") return undefined;
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      email?: unknown;
      name?: unknown;
    };
    const value = payload.email ?? payload.name;
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}
/**
 * Who a connection is, from what the connected account already carries: identity fields some
 * toolkits return, or the OpenID id_token that Google (Drive, Docs, Sheets, YouTube…) and other
 * OIDC providers include. No call needed.
 */
function listedIdentity(item: RawAccount) {
  for (const source of [item.data, item.state?.val]) {
    if (!source || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    for (const key of ["email", "user_email", "account_label", "displayName", "account_email"])
      if (typeof record[key] === "string" && record[key]) return String(record[key]);
    const fromToken = idTokenIdentity(record.id_token);
    if (fromToken) return fromToken;
    // API-key apps with their own instance (Databricks, Jira, Salesforce…): the host names it.
    for (const key of ["full", "instance_url", "base_url", "host", "workspace_url", "domain"])
      if (typeof record[key] === "string" && /^https?:\/\/[^/]+/.test(record[key] as string))
        return new URL(record[key] as string).hostname.replace(/^www\./, "");
  }
  return item.alias || undefined;
}
/** Google apps without an id_token (Maps): the standard userinfo endpoint through the proxy. */
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
const isGoogle = (slug: string) => /^google|^gmail$|^youtube$/.test(slug);
const dig = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );
/**
 * A cheap read-only call that says who a connection is, for apps that don't list it. Only
 * read-only tools here: this runs against the person's real accounts.
 */
const IDENTITY: Record<
  string,
  { tool: string; args: Record<string, unknown>; pick: (d: unknown) => unknown }
> = {
  gmail: {
    tool: "GMAIL_GET_PROFILE",
    args: { user_id: "me" },
    pick: (d) => dig(d, "emailAddress") ?? dig(d, "response_data", "emailAddress"),
  },
  googlecalendar: {
    tool: "GOOGLECALENDAR_GET_CALENDAR",
    args: { calendar_id: "primary" },
    pick: (d) => dig(d, "calendar_data", "id") ?? dig(d, "id"),
  },
  slack: {
    tool: "SLACK_TEST_AUTH",
    args: {},
    pick: (d) => {
      const user = dig(d, "user") ?? dig(d, "response_data", "user");
      const team = dig(d, "team") ?? dig(d, "response_data", "team");
      return typeof user === "string" && typeof team === "string" ? `${user} @ ${team}` : team;
    },
  },
};
export interface AppToolkit {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  /** From the curated catalog (catalog.ts): how the app is grouped and pitched. */
  category?: CategoryId;
  pitch?: string;
  /** False when it can't connect in one tap; `note` says what it needs instead. */
  oneTap?: boolean;
  note?: string;
}
const toolkit = (t: {
  slug: string;
  name: string;
  meta: { logo?: string; description?: string };
}): AppToolkit => {
  const app = catalogApp(t.slug);
  return {
    slug: t.slug,
    name: t.name,
    logo: t.meta.logo,
    description: t.meta.description,
    ...(app
      ? { category: app.category, pitch: app.pitch, oneTap: app.oneTap !== false, note: app.note }
      : {}),
  };
};
export interface AppTool {
  slug: string;
  toolkit: string;
  name: string;
  description: string;
  /** Only tools Composio tags readOnlyHint (and not destructive) run without a review. */
  readOnly: boolean;
  /** Composio tags it destructiveHint (deletes or overwrites); never "always allowed". */
  destructive?: boolean;
  parameters: unknown;
}

/** The curated set shown before any search (catalog.ts). Order is the display order. */
export const FEATURED_APPS = CATALOG.map((app) => app.slug);

type RawTool = Awaited<ReturnType<Composio["tools"]["getRawComposioToolBySlug"]>>;

const describe = (tool: RawTool): AppTool => ({
  slug: tool.slug,
  toolkit: tool.toolkit?.slug ?? "",
  name: tool.name,
  description: (tool.description ?? "").slice(0, 600),
  readOnly: !!tool.tags?.includes("readOnlyHint") && !tool.tags.includes("destructiveHint"),
  destructive: !!tool.tags?.includes("destructiveHint"),
  parameters: tool.inputParameters ?? { type: "object", properties: {} },
});

/**
 * Composio-backed app connections. OpenMuse owners map 1:1 to Composio user IDs.
 * Read-only tools execute directly; everything else goes through ActionService review.
 */
export class ComposioService {
  private readonly client?: Composio;
  private readonly tools = new Map<string, RawTool>();
  private featured?: Promise<AppToolkit[]>;
  private readonly meta = new Map<string, Promise<AppToolkit | undefined>>();
  /** Identities found this process (also persisted when a store is given). */
  private readonly identities = new Map<string, Promise<string | undefined>>();
  private readonly identityFailedAt = new Map<string, number>();
  constructor(
    private readonly config: Config,
    private readonly db?: Store,
  ) {
    const apiKey = process.env.COMPOSIO_API_KEY?.trim();
    if (apiKey) this.client = new Composio({ apiKey, allowTracking: false });
  }
  get enabled() {
    return Boolean(this.client);
  }
  private get api() {
    if (!this.client)
      throw new AppError("Conexões de apps precisam de COMPOSIO_API_KEY no servidor.", 503);
    return this.client;
  }

  private readonly recent = new Map<string, { at: number; value: Promise<AppConnection[]> }>();
  /**
   * The same list, reused for 60 s: chat turns and app tools ask for it several times per turn
   * (~1 s each from Composio). Screens that show accounts use `connections` (always fresh).
   */
  /**
   * The connections, fast: a list from the last 10 minutes is used at once (and refreshed in the
   * background past 1 minute), so a chat turn never waits ~3 s on Composio for it.
   */
  recentConnections(owner: string): Promise<AppConnection[]> {
    const hit = this.recent.get(owner);
    const age = hit ? Date.now() - hit.at : Number.POSITIVE_INFINITY;
    if (hit && age < 60_000) return hit.value;
    const value = this.connections(owner);
    value.then(
      () => this.recent.set(owner, { at: Date.now(), value }),
      () => undefined,
    );
    if (hit && age < 600_000) return hit.value.catch(() => value);
    this.recent.set(owner, { at: Date.now(), value });
    value.catch(() => this.recent.delete(owner));
    return value;
  }
  async connections(owner: string): Promise<AppConnection[]> {
    this.recent.delete(owner);
    if (!this.client) return [];
    const { items } = await this.api.connectedAccounts.list({ userIds: [owner], limit: 100 });
    const [records, defaults] = await Promise.all([
      this.db ? this.db.list<AccountRecord>(owner, ACCOUNTS) : Promise.resolve([]),
      this.db ? this.db.list<DefaultRecord>(owner, DEFAULTS) : Promise.resolve([]),
    ]);
    const saved = new Map(records.map((r) => [r.id, r]));
    const connections = await Promise.all(
      items
        .filter((item) => !item.isDisabled)
        .map(async (item): Promise<AppConnection> => {
          const slug = item.toolkit.slug;
          if (!this.meta.has(slug))
            this.meta.set(
              slug,
              this.api.toolkits.get(slug).then(toolkit, () => {
                this.meta.delete(slug);
                return undefined;
              }),
            );
          const info = await this.meta.get(slug);
          const record = saved.get(item.id);
          const account =
            record?.account ??
            (item.status === "ACTIVE"
              ? await this.identify(owner, item.id, slug, item as RawAccount, record)
              : undefined);
          return {
            id: item.id,
            toolkit: slug,
            status: item.status,
            name: info?.name,
            logo: info?.logo,
            account,
            label: record?.label,
            createdAt: item.createdAt,
          };
        }),
    );
    // One default per app: the person's pick while it is active, else the oldest active one.
    const picked = new Map(defaults.map((d) => [d.id, d.connectionId]));
    const byApp = new Map<string, AppConnection[]>();
    for (const c of connections)
      if (c.status === "ACTIVE") byApp.set(c.toolkit, [...(byApp.get(c.toolkit) ?? []), c]);
    for (const [slug, list] of byApp) {
      const chosen =
        list.find((c) => c.id === picked.get(slug)) ??
        [...list].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0];
      if (chosen) chosen.isDefault = true;
      // The same account connected twice: the extra one can go (the default one stays).
      const seen = new Set<string>();
      for (const c of [...list].sort(
        (a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false),
      ))
        if (c.account) {
          if (seen.has(c.account)) c.duplicate = true;
          seen.add(c.account);
        }
    }
    return connections;
  }

  /** Active accounts for one app, default first. */
  async accounts(owner: string, toolkitSlug: string) {
    return (await this.connections(owner))
      .filter((c) => c.toolkit === toolkitSlug && c.status === "ACTIVE")
      .sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
  }

  /** Finds out once who a connection signs in as, then remembers it. Never throws. */
  private identify(
    owner: string,
    id: string,
    slug: string,
    item: RawAccount,
    record?: AccountRecord,
  ): Promise<string | undefined> {
    const cached = this.identities.get(id);
    if (cached) return cached;
    const listed = listedIdentity(item);
    const lookup = IDENTITY[slug];
    // Tests share the local owner id with a developer's real account: never call real apps there.
    const canCall =
      (!!lookup || isGoogle(slug)) &&
      !process.env.NODE_TEST_CONTEXT &&
      Date.now() - (this.identityFailedAt.get(id) ?? 0) > 10 * 60_000;
    if (!listed && !canCall) return Promise.resolve(undefined);
    const found = (async () => {
      let account = listed;
      if (!account && lookup) {
        try {
          const value = lookup.pick(
            await this.execute(owner, lookup.tool, lookup.args, undefined, id),
          );
          if (typeof value === "string" && value) account = value;
        } catch {
          // Missing scope or an expired token: show the app without an account name.
        }
      }
      if (!account && isGoogle(slug)) {
        try {
          const response = (await this.api.tools.proxyExecute({
            endpoint: GOOGLE_USERINFO,
            method: "GET",
            connectedAccountId: id,
          })) as { data?: { email?: unknown; name?: unknown } };
          const value = response.data?.email ?? response.data?.name;
          if (typeof value === "string" && value) account = value;
        } catch {
          // The app's scopes don't include the profile: fine, it shows without a name.
        }
      }
      if (!account) {
        this.identityFailedAt.set(id, Date.now());
        this.identities.delete(id);
        return undefined;
      }
      await this.db?.put<AccountRecord>(owner, ACCOUNTS, { ...record, id, account });
      return account;
    })();
    this.identities.set(id, found);
    return found;
  }

  /** Renames an account or makes it the app's default. */
  async updateAccount(
    owner: string,
    id: string,
    change: { label?: string | null; isDefault?: boolean },
  ) {
    const connection = (await this.connections(owner)).find((c) => c.id === id);
    if (!connection) throw new AppError("Conexão não encontrada", 404);
    if (!this.db)
      throw new AppError("Configurações de conta precisam do armazenamento do servidor", 503);
    if (change.label !== undefined) {
      const current = await this.db.get<AccountRecord>(owner, ACCOUNTS, id);
      const label = change.label?.trim() || undefined;
      await this.db.put<AccountRecord>(owner, ACCOUNTS, {
        ...current,
        id,
        account: current?.account ?? connection.account,
        label,
      });
    }
    if (change.isDefault)
      await this.db.put<DefaultRecord>(owner, DEFAULTS, {
        id: connection.toolkit,
        connectionId: id,
      });
    return (await this.connections(owner)).find((c) => c.id === id);
  }

  private async activeToolkits(owner: string) {
    return [
      ...new Set(
        (await this.connections(owner)).filter((c) => c.status === "ACTIVE").map((c) => c.toolkit),
      ),
    ];
  }

  async toolkits(search?: string): Promise<AppToolkit[]> {
    const query = search?.trim().toLowerCase();
    if (!query) {
      // One listing call for every catalog app's name and logo (not one call per app).
      this.featured ??= this.api.toolkits
        .get({ sortBy: "usage", limit: 1000 })
        .then((list) => {
          const found = new Map(list.map((t) => [t.slug, t]));
          return CATALOG.map((app) => {
            const t = found.get(app.slug);
            return toolkit(t ?? { slug: app.slug, name: app.slug, meta: {} });
          });
        })
        .catch((error) => {
          this.featured = undefined;
          throw error;
        });
      return this.featured;
    }
    const list = await this.api.toolkits.get({ sortBy: "usage", limit: 500 });
    return list
      .filter((t) => t.slug.includes(query) || t.name.toLowerCase().includes(query))
      .slice(0, 30)
      .map(toolkit);
  }

  /**
   * Every connection goes through Composio's hosted page, which also collects API keys
   * (e.g. a Databricks token), so secrets never pass through OpenMuse.
   */
  async connect(owner: string, toolkitSlug: string) {
    const slug = toolkitSlug.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(slug)) throw new AppError("App desconhecido", 400);
    const listed = catalogApp(slug);
    if (listed?.oneTap === false)
      throw new AppError(listed.note ?? "Esse app precisa de configuração antes.", 409);
    const { items } = await this.api.authConfigs.list({ toolkit: slug });
    const authConfig =
      items.find((item) => item.status === "ENABLED") ?? (await this.createAuthConfig(slug));
    const request = await this.api.connectedAccounts.link(owner, authConfig.id, {
      callbackUrl: `${this.config.publicUrl}/api/apps/callback`,
      allowMultiple: true,
    });
    if (!request.redirectUrl) throw new AppError("O Composio não retornou um link de login", 502);
    return { id: request.id, redirectUrl: request.redirectUrl };
  }

  private async createAuthConfig(slug: string) {
    const details = await this.api.toolkits.get(slug);
    if (details.composioManagedAuthSchemes?.length)
      return this.api.authConfigs.create(slug, {
        type: "use_composio_managed_auth",
        name: `OpenMuse ${slug}`,
      });
    // Without managed OAuth, pick a scheme the person can complete alone (API key, token).
    const scheme = details.authConfigDetails?.find(
      (d) => !d.fields.authConfigCreation.required.length,
    );
    if (!scheme)
      throw new AppError(
        `${details.name} precisa de um app OAuth registrado no Composio antes de conectar.`,
        409,
      );
    return this.api.authConfigs.create(slug, {
      type: "use_custom_auth",
      authScheme: scheme.mode,
      name: `OpenMuse ${slug}`,
      credentials: {},
    } as Parameters<Composio["authConfigs"]["create"]>[1]);
  }

  async disconnect(owner: string, id: string) {
    // Listing by owner first keeps one user from deleting another user's account by ID.
    if (!(await this.connections(owner)).some((c) => c.id === id))
      throw new AppError("Conexão não encontrada", 404);
    await this.api.connectedAccounts.delete(id);
    this.identities.delete(id);
    await this.db?.remove(owner, ACCOUNTS, id);
  }

  private async tool(slug: string) {
    const cached = this.tools.get(slug);
    if (cached) return cached;
    const tool = await this.api.tools.getRawComposioToolBySlug(slug);
    this.tools.set(slug, tool);
    return tool;
  }

  /** Searches tools, limited to apps the owner has connected. */
  private readonly index = new Map<string, Promise<AppTool[]>>();
  /** Every tool of an app (cached per process): the local index discovery ranks against. */
  toolIndex(toolkit: string): Promise<AppTool[]> {
    let cached = this.index.get(toolkit);
    if (!cached) {
      cached = this.api.tools
        .getRawComposioTools({ toolkits: [toolkit], limit: 1000 })
        .then((tools) => {
          for (const tool of tools) this.tools.set(tool.slug, tool);
          return tools.filter((tool) => !tool.isDeprecated).map(describe);
        })
        .catch((error) => {
          this.index.delete(toolkit);
          throw error;
        });
      this.index.set(toolkit, cached);
    }
    return cached;
  }

  /** Searches tools in the owner's connected apps, optionally only in `only` (one or several). */
  async search(owner: string, query: string, only?: string | string[]): Promise<AppTool[]> {
    const connected = await this.activeToolkits(owner);
    const wanted = (Array.isArray(only) ? only : only ? [only] : []).map((t) => t.toLowerCase());
    const toolkits = wanted.length ? connected.filter((t) => wanted.includes(t)) : connected;
    if (!toolkits.length) return [];
    const tools = await this.api.tools.getRawComposioTools({ toolkits, search: query, limit: 10 });
    for (const tool of tools) this.tools.set(tool.slug, tool);
    return tools.filter((tool) => !tool.isDeprecated).map(describe);
  }

  async inspect(owner: string, slug: string): Promise<AppTool> {
    const tool = describe(await this.tool(slug));
    if (!(await this.activeToolkits(owner)).includes(tool.toolkit))
      throw new AppError(`Conecte ${tool.toolkit || "este app"} em Ajustes primeiro.`, 409);
    return tool;
  }

  /** Runs a tool as the owner; `connectedAccountId` picks one of several accounts of an app. */
  async execute(
    owner: string,
    slug: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    connectedAccountId?: string,
  ) {
    const tool = await this.tool(slug);
    const result = await this.api.tools.execute(
      slug,
      {
        userId: owner,
        ...(connectedAccountId ? { connectedAccountId } : {}),
        arguments: args,
        version: tool.version ?? "latest",
        dangerouslySkipVersionCheck: !tool.version,
      },
      { signal },
    );
    if (!result.successful) throw new AppError(result.error ?? `Falha em ${slug}`, 502);
    return result.data;
  }
}
