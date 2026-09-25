// Dictation: a short voice note from the composer becomes text the person reviews before sending.
import type { Config } from "../platform/config.ts";
import { AppError } from "../platform/errors.ts";

export const TRANSCRIBE_MODEL = "openai/whisper-large-v3-turbo";
/** About ten minutes of compressed speech; the composer records far less. */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export async function transcribe(
  config: Config,
  audio: File,
  options: { language?: string; signal?: AbortSignal } = {},
) {
  const apiKey = process.env.IMPOSSIBL_API_KEY?.trim();
  if (!apiKey) throw new AppError("Ditar por voz precisa de IMPOSSIBL_API_KEY no servidor", 503);
  if (!audio.size) throw new AppError("A gravação veio vazia. Tente de novo.");
  if (audio.size > MAX_AUDIO_BYTES) throw new AppError("Gravação longa demais para transcrever.");
  const baseUrl = (config.impossiblBaseUrl ?? "https://api.impossibl.com/v1").replace(/\/+$/, "");
  const form = new FormData();
  form.set("model", TRANSCRIBE_MODEL);
  form.set("language", options.language ?? "pt");
  form.set("file", audio, audio.name || "audio.m4a");
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  }).catch(() => undefined);
  const body = (await response?.json().catch(() => ({}))) as { text?: string } | undefined;
  // Provider messages can echo the request; keep ours short and generic.
  if (!response?.ok || typeof body?.text !== "string")
    throw new AppError("Não consegui transcrever o áudio agora. Tente de novo.", 502);
  return body.text.trim();
}
