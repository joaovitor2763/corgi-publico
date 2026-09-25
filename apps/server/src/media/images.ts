// generate_image: pictures made on request (a post illustration, a mockup, an invitation),
// saved to the person's library so the agent can show them with send_file.
import type { Config } from "../platform/config.ts";
import { AppError } from "../platform/errors.ts";
import type { Files } from "../platform/files.ts";

export const IMAGE_MODEL = "openai/gpt-image-2";
const SIZES = { square: "1024x1024", portrait: "1024x1536", landscape: "1536x1024" } as const;
export type ImageShape = keyof typeof SIZES;

export function imageFileName(prompt: string) {
  const slug = prompt
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  return `${slug || "imagem"}.png`;
}

export async function generateImage(
  config: Config,
  files: Files,
  owner: string,
  input: { prompt: string; shape: ImageShape },
  signal?: AbortSignal,
) {
  const apiKey = process.env.IMPOSSIBL_API_KEY?.trim();
  if (!apiKey) throw new AppError("Geração de imagem precisa de IMPOSSIBL_API_KEY", 503);
  const baseUrl = (config.impossiblBaseUrl ?? "https://api.impossibl.com/v1").replace(/\/+$/, "");
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: input.prompt,
      size: SIZES[input.shape],
      n: 1,
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { b64_json?: string }[];
    error?: { message?: string };
  };
  const b64 = body.data?.[0]?.b64_json;
  if (!response.ok || !b64)
    // Provider messages can echo the request; keep ours short and generic.
    throw new AppError(
      response.status === 400
        ? "O gerador recusou esse pedido de imagem. Tente descrever de outro jeito."
        : "Não consegui gerar a imagem agora.",
      502,
    );
  return files.import(
    owner,
    imageFileName(input.prompt),
    Buffer.from(b64, "base64"),
    "Imagem gerada",
  );
}
