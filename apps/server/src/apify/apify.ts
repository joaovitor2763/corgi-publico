// Apify: ready-made scrapers ("actors") for sites the browser can't get through or would take long
// to read (Google Maps places, Instagram profiles, marketplaces, reviews). The person connects it
// with their own API token; each run is capped in dollars and time, and results are untrusted data.
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../../../../packages/integrations/src/vault.ts";
import { compact } from "../connected-apps/compact.ts";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";

export const APIFY_API = "https://api.apify.com";
/** Default spend cap for one run, in US dollars; the person can change it on the Apify card. */
export const DEFAULT_MAX_USD = 0.5;
const RUN_TIMEOUT_S = 240;
const MAX_RESULT_CHARS = 30_000;

interface Account {
  id: "account";
  secret: string;
  username?: string;
  maxUsd: number;
  connectedAt: string;
}

export interface ApifyStatus {
  connected: boolean;
  username?: string;
  maxUsd: number;
  connectedAt?: string;
}

/** "compass/crawler-google-places" or "compass~crawler-google-places" → the API's path form. */
export function actorPath(actor: string) {
  const name = actor.trim().replace("/", "~");
  if (!/^[\w.-]+~[\w.-]+$/.test(name) && !/^\w{17}$/.test(name))
    throw new AppError(
      "Ator do Apify inválido: use usuario/nome, como compass/crawler-google-places",
      400,
    );
  return encodeURIComponent(name);
}

/** What the model needs to fill an actor's input: fields, types, defaults, one example each. */
export function inputFields(schema: unknown) {
  const parsed = typeof schema === "string" ? safeJson(schema) : schema;
  if (!parsed || typeof parsed !== "object") return undefined;
  const { properties = {}, required = [] } = parsed as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  return Object.entries(properties)
    .slice(0, 40)
    .map(([name, field]) => ({
      name,
      type: field.type,
      required: required.includes(name) || undefined,
      title: field.title,
      description:
        typeof field.description === "string"
          ? field.description.replace(/<[^>]+>/g, "").slice(0, 200)
          : undefined,
      options: Array.isArray(field.enum) ? field.enum.slice(0, 12) : undefined,
      default: field.default,
      example: field.prefill ?? field.example,
    }));
}

function safeJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export class ApifyService {
  constructor(
    private readonly db: Store,
    private readonly encryptionKey: string | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly base = APIFY_API,
  ) {}

  async status(owner: string): Promise<ApifyStatus> {
    const account = await this.db.get<Account>(owner, "apify", "account");
    return account
      ? {
          connected: true,
          username: account.username,
          maxUsd: account.maxUsd,
          connectedAt: account.connectedAt,
        }
      : { connected: false, maxUsd: DEFAULT_MAX_USD };
  }

  /** Checks the token with Apify before keeping it (encrypted). */
  async connect(owner: string, token: string, maxUsd = DEFAULT_MAX_USD) {
    const me = await this.call<{ data?: { username?: string } }>(token.trim(), "/v2/users/me");
    await this.db.put<Account>(owner, "apify", {
      id: "account",
      secret: encryptSecret(token.trim(), await this.key()),
      username: me.data?.username,
      maxUsd,
      connectedAt: new Date().toISOString(),
    });
    return this.status(owner);
  }

  async disconnect(owner: string) {
    await this.db.take(owner, "apify", "account");
    return this.status(owner);
  }

  async setLimit(owner: string, maxUsd: number) {
    const account = await this.db.get<Account>(owner, "apify", "account");
    if (!account) throw new AppError("Apify não está conectado", 404);
    await this.db.put(owner, "apify", { ...account, maxUsd });
    return this.status(owner);
  }

  async connected(owner: string) {
    return Boolean(await this.db.get<Account>(owner, "apify", "account"));
  }

  /** Actors in the Apify Store for a job, most used first. */
  async search(owner: string, query: string) {
    const { token } = await this.account(owner);
    const params = new URLSearchParams({ search: query, limit: "8", sortBy: "popularity" });
    const found = await this.call<{ data?: { items?: StoreItem[] } }>(token, `/v2/store?${params}`);
    return (found.data?.items ?? []).map((item) => ({
      actor: `${item.username}/${item.name}`,
      title: item.title,
      description: item.description?.slice(0, 300),
      users: item.stats?.totalUsers,
      rating: item.stats?.actorReviewRating,
      pricing: pricingOf(item.currentPricingInfo),
    }));
  }

  /** The input an actor takes (from its default build). */
  async describe(owner: string, actor: string) {
    const { token } = await this.account(owner);
    const build = await this.call<{ data?: { inputSchema?: unknown } }>(
      token,
      `/v2/acts/${actorPath(actor)}/builds/default`,
    );
    const fields = inputFields(build.data?.inputSchema);
    return fields
      ? { actor, fields }
      : { actor, fields: [], note: "This actor publishes no input schema; check its page." };
  }

  /** Runs an actor and waits for its items, within the person's dollar cap and a time limit. */
  async run(owner: string, actor: string, input: unknown, maxItems: number, signal?: AbortSignal) {
    const { token, maxUsd } = await this.account(owner);
    const params = new URLSearchParams({
      timeout: String(RUN_TIMEOUT_S),
      maxItems: String(maxItems),
      maxTotalChargeUsd: String(maxUsd),
      clean: "true",
      format: "json",
    });
    const response = await this.fetcher(
      `${this.base}/v2/acts/${actorPath(actor)}/run-sync-get-dataset-items?${params}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input ?? {}),
        signal: signal ? AbortSignal.any([signal, timeout()]) : timeout(),
      },
    );
    if (response.status === 402)
      return { error: "Apify account has no credit left for this run. Tell the person." };
    if (response.status === 408)
      return {
        error: `The run took over ${RUN_TIMEOUT_S / 60} minutes. Try fewer items or a narrower input.`,
      };
    if (!response.ok) return { error: `Apify ${response.status}: ${await apifyError(response)}` };
    const items = (await response.json().catch(() => [])) as unknown[];
    const list = Array.isArray(items) ? items : [];
    let shown = list.map((item) => compact(item));
    while (shown.length > 1 && JSON.stringify(shown).length > MAX_RESULT_CHARS)
      shown = shown.slice(0, Math.ceil(shown.length * 0.7));
    return {
      actor,
      count: list.length,
      items: shown,
      ...(shown.length < list.length
        ? { truncated: `Showing ${shown.length} of ${list.length} items.` }
        : {}),
      maxUsd,
    };
  }

  private async account(owner: string) {
    const account = await this.db.get<Account>(owner, "apify", "account");
    if (!account) throw new AppError("Apify não está conectado", 404);
    return { token: decryptSecret(account.secret, await this.key()), maxUsd: account.maxUsd };
  }

  /**
   * TOKEN_ENCRYPTION_KEY when the server has one; otherwise a key made once and kept in the
   * database (like the push keys), so a setup without it still never stores the token in clear.
   */
  private async key() {
    if (this.encryptionKey) return this.encryptionKey;
    await this.db.insertIfAbsent("system", "vault-key", {
      id: "apify",
      key: randomBytes(32).toString("base64"),
    });
    const saved = await this.db.get<{ key: string }>("system", "vault-key", "apify");
    if (!saved) throw new AppError("Não foi possível guardar a chave com segurança", 500);
    return saved.key;
  }

  private async call<T>(token: string, path: string): Promise<T> {
    const response = await this.fetcher(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401)
      throw new AppError(
        "O Apify recusou a chave. Confira o token em Settings › API & Integrations.",
        400,
      );
    if (!response.ok)
      throw new AppError(`Apify ${response.status}: ${await apifyError(response)}`, 502);
    return (await response.json()) as T;
  }
}

const timeout = () => AbortSignal.timeout((RUN_TIMEOUT_S + 20) * 1000);

async function apifyError(response: Response) {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | undefined;
  return body?.error?.message?.slice(0, 200) ?? response.statusText;
}

interface StoreItem {
  name: string;
  username: string;
  title?: string;
  description?: string;
  stats?: { totalUsers?: number; actorReviewRating?: number };
  currentPricingInfo?: { pricingModel?: string; pricePerUnitUsd?: number; unitName?: string };
}

function pricingOf(info: StoreItem["currentPricingInfo"]) {
  if (!info?.pricingModel) return undefined;
  if (info.pricingModel === "FREE") return "free (platform usage only)";
  if (info.pricePerUnitUsd)
    return `${info.pricingModel.toLowerCase().replaceAll("_", " ")}: US$ ${info.pricePerUnitUsd} per ${info.unitName ?? "unit"}`;
  return info.pricingModel.toLowerCase().replaceAll("_", " ");
}
