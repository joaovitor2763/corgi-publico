// Jev: TypeSafe's System One decision model, served by Impossibl at /v1/systemone. It answers
// structured questions (yes/no scores or a choice) about a JSON state in one fast call. Used to
// judge memories, filter ideas and, in trust/guard.ts, to spot malicious or off-request content.
export type Question =
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };
export type Answers = Record<
  string,
  { noul?: number; choice?: string; confidence?: number | null }
>;
export type AskJev = (state: unknown, questions: Record<string, Question>) => Promise<Answers>;

/** Jev over HTTP; undefined when no key is configured, so callers keep working without it. */
export function jevClient(env = process.env, fetcher: typeof fetch = fetch): AskJev | undefined {
  const apiKey = env.JEV_API_KEY ?? env.IMPOSSIBL_API_KEY;
  if (!apiKey) return undefined;
  const baseUrl = (env.JEV_BASE_URL ?? "https://api.impossibl.com").replace(/\/+$/, "");
  return async (state, questions) => {
    const response = await fetcher(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.JEV_MODEL ?? "typesafe-ai/jev", state, questions }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Jev request failed (${response.status})`);
    const body = (await response.json()) as { answers?: Answers };
    if (!body.answers) throw new Error("Jev returned no answers");
    return body.answers;
  };
}

/**
 * One Jev call as a filter: which of these candidates serve the request, best first. Used to
 * narrow app and tool discovery so the main model only sees what matters (less context, fewer
 * wrong picks). Returns undefined when Jev fails, so callers fall back to "all".
 */
export async function relevant(
  ask: AskJev,
  request: string,
  candidates: { id: string; text: string }[],
  { max = 3, threshold = 0.5 } = {},
): Promise<string[] | undefined> {
  if (candidates.length <= max) return candidates.map((c) => c.id);
  try {
    const answers = await ask(
      { request },
      Object.fromEntries(
        candidates.map((candidate, index) => [
          `c${index}`,
          {
            type: "noul" as const,
            instructions: `This can do what the request needs: ${candidate.text.slice(0, 300)}`,
            criteria: { true: "Needed for this request", false: "Not needed for this request" },
          },
        ]),
      ),
    );
    return candidates
      .map((candidate, index) => ({ id: candidate.id, score: answers[`c${index}`]?.noul ?? 0 }))
      .filter((c) => c.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((c) => c.id);
  } catch {
    return undefined;
  }
}
