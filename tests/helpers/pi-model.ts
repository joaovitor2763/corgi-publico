import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { TestContext } from "node:test";

export type PiCall = { name: string; arguments: object };
type Reply = { calls?: PiCall[]; text?: string; status?: number; error?: string };

// Real Pi SDK talks only to this loopback Chat Completions SSE fixture.
export async function piModelFixture(
  t: TestContext,
  reply: (index: number) => Reply | Promise<Reply>,
) {
  const requests: { path: string; body: string; authorization?: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const index = requests.length;
    requests.push({ path: request.url ?? "", body, authorization: request.headers.authorization });
    const result = await reply(index);
    if (response.destroyed) return;
    if (result.status) {
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: result.error ?? "Fixture failure" } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (delta: object, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({
          id: `chat-${index}`,
          object: "chat.completion.chunk",
          created: 1000,
          model: "fixture",
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`,
      );
    emit({ role: "assistant" });
    if (result.text) {
      emit({ content: result.text.slice(0, 5) });
      emit({ content: result.text.slice(5) });
    }
    for (const [callIndex, call] of (result.calls ?? []).entries()) {
      const args = JSON.stringify(call.arguments);
      emit({
        tool_calls: [
          {
            index: callIndex,
            id: `call-${index}-${callIndex}`,
            type: "function",
            function: { name: call.name, arguments: "" },
          },
        ],
      });
      emit({ tool_calls: [{ index: callIndex, function: { arguments: args.slice(0, 5) } }] });
      emit({ tool_calls: [{ index: callIndex, function: { arguments: args.slice(5) } }] });
    }
    emit({}, result.calls?.length ? "tool_calls" : "stop");
    response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const oldKey = process.env.IMPOSSIBL_API_KEY;
  process.env.IMPOSSIBL_API_KEY = "pi-local-fixture-not-a-secret";
  t.after(async () => {
    if (oldKey === undefined) delete process.env.IMPOSSIBL_API_KEY;
    else process.env.IMPOSSIBL_API_KEY = oldKey;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { requests, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}
