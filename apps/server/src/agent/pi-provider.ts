import { createModels, createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { AgentModelOption } from "../../../../packages/domain/src/agent.ts";
import type { Config } from "../platform/config.ts";

export const IMPOSSIBL_MODEL = "meta/muse-spark-1.3-contributor";
export const IMPOSSIBL_BASE_URL = "https://api.impossibl.com/v1";

export const IMPOSSIBL_MODELS = [
  {
    id: "meta/muse-spark-1.3-contributor",
    name: "Muse Spark 1.3 Contributor",
    description: "O mais rápido: entende imagens e conversas longas. Usado no modo automático.",
    contextWindow: 1_048_576,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.2,
    cachedInputPricePerMillion: 0.002,
    note: "Neste plano, a Meta pode usar as conversas para treinar os modelos dela.",
    vision: true,
  },
  {
    id: "zai/glm-5.3-flash",
    name: "GLM-5.3 Flash",
    description: "Mais cuidadoso com documentos e pesquisas longas, porém mais lento.",
    contextWindow: 1_000_000,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.5,
    cachedInputPricePerMillion: 0.03,
  },
  {
    id: "meta/muse-glimmer-30b",
    name: "Muse Glimmer 30B",
    description: "Compacto e barato, para tarefas simples do dia a dia.",
    contextWindow: 131_072,
    inputPricePerMillion: 0.35,
    outputPricePerMillion: 1.5,
    cachedInputPricePerMillion: 0.04,
  },
] as const satisfies readonly AgentModelOption[];

export type ImpossiblModelId = (typeof IMPOSSIBL_MODELS)[number]["id"];

/**
 * The default: Corgi picks the model per turn (docs/MODELS.md). Measured on Impossibl, Muse Spark
 * answers in ~2 s per call against ~5 s for GLM (even when GLM's cache hits), and it sees
 * pictures, so automatic is Muse today; the pick stays per turn so it can change with the data.
 */
export const AUTO_MODEL = "auto";
export const AUTO_OPTION: AgentModelOption = {
  id: AUTO_MODEL,
  name: "Automático",
  description:
    "O Corgi escolhe a cada mensagem: responde rápido no dia a dia, enxerga fotos e pensa mais nas tarefas longas.",
  contextWindow: 1_048_576,
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.2,
  recommended: true,
  vision: true,
};

export function autoModel(_needs: { vision?: boolean }): ImpossiblModelId {
  return "meta/muse-spark-1.3-contributor";
}

export function isImpossiblModelId(value: string | undefined): value is ImpossiblModelId {
  return Boolean(value && IMPOSSIBL_MODELS.some((model) => model.id === value));
}

export function configuredImpossiblModel(model?: string): ImpossiblModelId {
  const selected = model ?? IMPOSSIBL_MODEL;
  if (!isImpossiblModelId(selected))
    throw new Error(`MODEL must be one of: ${IMPOSSIBL_MODELS.map((item) => item.id).join(", ")}`);
  return selected;
}

function piModel(
  entry: (typeof IMPOSSIBL_MODELS)[number],
  baseUrl: string,
): Model<"openai-completions"> {
  return {
    id: entry.id,
    name: entry.name,
    provider: "impossibl",
    api: "openai-completions",
    baseUrl,
    reasoning: false,
    // Chat messages stay text; Muse Spark (multimodal) also sees images tools return, e.g. a
    // screenshot of a seat map the browser agent can't read as text.
    input: "vision" in entry && entry.vision ? ["text", "image"] : ["text"],
    contextWindow: entry.contextWindow,
    // Keep output bounded until each upstream route publishes a stable output limit.
    maxTokens: 8192,
    // Billing is reported by Impossibl. Zero here means the local Pi SDK must not estimate it.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  };
}

// A private allowlisted collection, not the global built-in catalog. No OAuth,
// credential files, provider discovery or fallback to another model/provider.
export function impossiblProvider(config: Pick<Config, "model" | "impossiblBaseUrl">) {
  const rawBaseUrl = config.impossiblBaseUrl ?? IMPOSSIBL_BASE_URL;
  const url = new URL(rawBaseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw new Error("IMPOSSIBL_BASE_URL requires HTTPS (HTTP is allowed only on loopback)");
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const selectedId = configuredImpossiblModel(config.model);
  const catalog = IMPOSSIBL_MODELS.map((entry) => piModel(entry, baseUrl));
  const model = catalog.find((entry) => entry.id === selectedId);
  if (!model) throw new Error("Configured Impossibl model is unavailable");
  const provider = createProvider({
    id: "impossibl",
    name: "Impossibl",
    baseUrl,
    auth: { apiKey: envApiKeyAuth("Impossibl API key", ["IMPOSSIBL_API_KEY"]) },
    models: catalog,
    api: openAICompletionsApi(),
  });
  const models = createModels({
    authContext: {
      env: async (name) =>
        name === "IMPOSSIBL_API_KEY" ? process.env.IMPOSSIBL_API_KEY?.trim() : undefined,
      fileExists: async () => false,
    },
  });
  models.setProvider(provider);
  return { model, models };
}
