import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import type { ToolDefinition } from "@copilotkit/runtime/v2";
import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TSchema } from "@earendil-works/pi-ai";
import { Observable } from "rxjs";
import { z } from "zod";
import type { Config } from "../platform/config.ts";
import { impossiblProvider } from "./pi-provider.ts";

/** A log line with anything credential-shaped removed. */
export function redact(text: string) {
  return text
    .replace(/(bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/\b(imp|sk|pk|ak)[-_][\w-]{8,}/gi, "[redacted]")
    .slice(0, 300);
}

/** Working-memory tools are rewritten on purpose; repeating them is not a loop. */
const LOOP_EXEMPT = new Set(["update_todos", "write_notes"]);

/**
 * The same tool with the same arguments again in one run: the third time it is refused with a
 * way out; the fifth ends the run (the task says what blocked it instead of burning its steps).
 */
export function repeatedCall(seen: Map<string, number>, name: string, args: unknown) {
  if (LOOP_EXEMPT.has(name)) return undefined;
  const key = `${name}:${JSON.stringify(args ?? {})}`;
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  if (count < 3) return undefined;
  return {
    count,
    result: {
      block: true,
      reason: `You already called ${name} with these same arguments ${count - 1} times in this turn. Do not call it again: use what you already have, try a materially different approach, or stop and tell the person in one line exactly what is blocking you and what you need.`,
      ...(count >= 5 ? { terminate: true } : {}),
    },
  };
}

/**
 * reasoning_effort for one model call (docs/MODELS.md). Muse: the configured effort to plan, then
 * "low" on chat's tool steps (~1.5 s less each). GLM is sent nothing: it thinks adaptively, and
 * measured, its "low" was no faster (~5 s per call either way).
 */
export function reasoningFor(
  model: string,
  step: number,
  options: Pick<PiOptions, "reasoningEffort" | "quickSteps">,
): PiOptions["reasoningEffort"] {
  if (!model.startsWith("meta/muse-spark")) return undefined;
  return options.quickSteps && step > 0 ? "low" : options.reasoningEffort;
}

/**
 * Why a model call failed, for logs and timings. Only the status or kind: the provider's text
 * may echo request headers or the key.
 */
export function providerFailure(message: string) {
  const status = /\b([45]\d\d)\b/.exec(message)?.[1];
  if (status) return `HTTP ${status}`;
  if (/timed? ?out|timeout/i.test(message)) return "timeout";
  if (/abort/i.test(message)) return "interrupted";
  return "no response";
}

interface PiOptions {
  tools: ToolDefinition[];
  /** Tools that exist only for some people (e.g. an app connected with a key), resolved per run. */
  moreTools?: () => Promise<ToolDefinition[]>;
  /** The standing instructions for this run when they differ (a helper's chat); per thread, so still cached. */
  promptFor?: () => Promise<string | undefined>;
  /** Which tools this run may use (a helper has fewer); undefined = all. */
  allowTool?: () => Promise<((name: string) => boolean) | undefined>;
  prompt: string;
  maxSteps: number;
  signal?: AbortSignal;
  beforeTool?: () => Promise<void>;
  shouldStop?: () => boolean;
  resolveModel?: () => Promise<string>;
  /**
   * Sent as reasoning_effort to Muse Spark ("medium" in chat and tasks: ~8 s to the first word
   * instead of ~4 s with "none", for better judgment). GLM thinks adaptively when the field is
   * absent; its "low"/"medium" barely think, so it never gets one.
   */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  /**
   * Chat: think on the first model call of a turn (planning), then run the tool steps with less
   * thought (Muse "low"). Background tasks leave it off and think every step.
   */
  quickSteps?: boolean;
  /** Per-run context (time, memory, connected apps) appended after the static prompt. */
  context?: () => Promise<string>;
  /**
   * Pictures attached to a user message, sent with it so the model always sees them (it often
   * skipped read_file and answered without looking). Only for image-capable models.
   */
  images?: (text: string) => Promise<{ data: string; mimeType: string }[]>;
  /**
   * Fits a long thread into the model's window: returns the messages to send and any context
   * about what was left out (a summary of the older part).
   */
  window?: (history: AgentMessage[]) => Promise<{ history: AgentMessage[]; context: string }>;
  /** The full history when the app sent only its latest messages (see conversation-store.ts). */
  history?: (messages: RunAgentInput["messages"]) => Promise<RunAgentInput["messages"]>;
  /** Run the tool calls of one step at the same time (except SEQUENTIAL ones). */
  parallelTools?: boolean;
  /** Where the turn's time went (ms since start, label), for /api/agent/timings. */
  onTiming?: (marks: { at: number; label: string }[]) => void;
}

const noUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function messages(input: RunAgentInput, model: string): AgentMessage[] {
  const toolNames = new Map<string, string>();
  return input.messages.flatMap((message): AgentMessage[] => {
    const timestamp = Date.now();
    if (message.role === "user") {
      if (
        typeof message.content !== "string" &&
        message.content.some((part) => part.type !== "text")
      )
        throw new Error("Pi currently supports text messages only");
      return [
        {
          role: "user",
          content:
            typeof message.content === "string"
              ? message.content
              : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"),
          timestamp,
        },
      ];
    }
    if (message.role === "system" || message.role === "developer")
      return [{ role: "system", content: message.content, timestamp }];
    if (message.role === "assistant") {
      const content: AssistantMessage["content"] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        toolNames.set(call.id, call.function.name);
        content.push({
          type: "toolCall",
          id: call.id,
          name: call.function.name,
          arguments: JSON.parse(call.function.arguments || "{}"),
        });
      }
      return [
        {
          role: "assistant",
          content,
          timestamp,
          model,
          provider: "impossibl",
          api: "openai-completions",
          usage: noUsage(),
          stopReason: message.toolCalls?.length ? "toolUse" : "stop",
        },
      ];
    }
    if (message.role === "tool")
      return [
        {
          role: "toolResult",
          toolCallId: message.toolCallId,
          toolName: toolNames.get(message.toolCallId) ?? "unknown",
          content: [{ type: "text", text: message.content }],
          isError: message.error !== undefined,
          timestamp,
        },
      ];
    return [];
  });
}

/** Tools that share one browser session (or a checkout) never run alongside others. */
const SEQUENTIAL = new Set([
  "browse_web",
  "browser_task",
  "look_at_page",
  "request_checkout",
  "watch_page",
  // Load-modify-save of the conversation's checklist and notes: never two at once.
  "update_todos",
  "write_notes",
]);

/** Small AG-UI adapter. Domain tools/approvals remain owned by OpenMuse. */
/** Marks a tool result that carries an image for the model to look at. */
const IMAGE = "__toolImage";
export function toolImage(data: string, mimeType: string, rest: Record<string, unknown>) {
  return toolImages([{ data, mimeType }], rest);
}
/** Several pictures in one result, e.g. the pages of a scanned PDF. */
export function toolImages(
  images: { data: string; mimeType: string }[],
  rest: Record<string, unknown>,
) {
  return { ...rest, [IMAGE]: images };
}
function toolImageOf(result: unknown) {
  if (!result || typeof result !== "object" || !(IMAGE in result)) return undefined;
  const { [IMAGE]: images, ...rest } = result as Record<string, unknown> & {
    [IMAGE]: { data: string; mimeType: string }[];
  };
  return { images, rest };
}

export class PiAgent {
  private active?: Agent;
  constructor(
    private readonly config: Config,
    private readonly options: PiOptions,
  ) {}

  abortRun() {
    this.active?.abort();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      let agent: Agent | undefined;
      let unsubscribe: (() => void) | undefined;
      const abort = () => agent?.abort();
      const emit = (event: BaseEvent) => subscriber.next(event);
      emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });
      const started = Date.now();
      const marks: { at: number; label: string }[] = [];
      const mark = (label: string) => marks.push({ at: Date.now() - started, label });
      // History messages are replayed as events too; only a live model call counts.
      let calling = false;
      // Model calls in this run: the first plans (it may think); later ones act (quickSteps).
      let modelSteps = 0;
      const seenCalls = new Map<string, number>();
      const run = async () => {
        if (!process.env.IMPOSSIBL_API_KEY?.trim())
          throw new Error("Pi requires IMPOSSIBL_API_KEY on the server");
        this.options.signal?.throwIfAborted();
        const selectedModel = await this.options.resolveModel?.();
        const runContext = await this.options.context?.().catch(() => "");
        const allowed = await this.options.allowTool?.().catch(() => undefined);
        const serverTools = [
          ...this.options.tools,
          ...((await this.options.moreTools?.().catch(() => [])) ?? []),
        ].filter((tool) => !allowed || allowed(tool.name));
        mark("app context");
        this.options.signal?.throwIfAborted();
        const { model, models } = impossiblProvider({
          ...this.config,
          model: selectedModel ?? this.config.model,
        });
        let turns = 0;
        let clientPending = false;
        let guardFailed = false;
        const guard = async () => {
          try {
            await this.options.beforeTool?.();
          } catch (error) {
            guardFailed = true;
            throw error;
          }
        };
        let messageId = "";
        let textOpen = false;
        const streamedCalls = new Map<
          number,
          { id: string; name: string; started: boolean; args: string; sent: number }
        >();
        const clientNames = new Set(
          input.tools
            .filter((tool) => !serverTools.some((server) => server.name === tool.name))
            .map((tool) => tool.name),
        );
        const tools: AgentTool[] = serverTools.map((tool) => {
          // All current OpenMuse server tools use Zod. Retain its stricter validation,
          // including refinements, rather than trusting the model's JSON schema alone.
          const schema = tool.parameters as z.ZodType;
          return {
            name: tool.name,
            label: tool.name,
            description: tool.description,
            parameters: z.toJSONSchema(schema, { io: "input" }) as TSchema,
            ...(SEQUENTIAL.has(tool.name) ? { executionMode: "sequential" as const } : {}),
            execute: async (_id, args, signal) => {
              signal?.throwIfAborted();
              this.options.signal?.throwIfAborted();
              if (this.options.shouldStop?.())
                return {
                  content: [{ type: "text", text: '{"paused":true}' }],
                  details: null,
                  terminate: true,
                };
              await guard();
              const parsed = await schema.parseAsync(args);
              if (!tool.execute) throw new Error("Tool has no server executor");
              const result = await tool.execute(parsed);
              // A tool may hand the model an image (see toolImage); the rest stays JSON text.
              const image = toolImageOf(result);
              if (image && model.input.includes("image"))
                return {
                  content: [
                    { type: "text", text: JSON.stringify(image.rest) },
                    ...image.images.map((picture) => ({ type: "image" as const, ...picture })),
                  ],
                  details: undefined,
                };
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      image
                        ? { ...image.rest, note: "This model cannot see images." }
                        : (result ?? null),
                    ),
                  },
                ],
                details: undefined,
              };
            },
          };
        });
        for (const tool of tools) {
          const execute = tool.execute;
          tool.execute = async (...args) => {
            mark(`${tool.name} →`);
            try {
              return await execute(...args);
            } finally {
              mark(`${tool.name} ✓`);
            }
          };
        }
        // Frontend tools are announced and handed back to AG-UI; never fabricate
        // their result. A later run includes the actual client tool-result message.
        for (const tool of input.tools.filter((tool) => clientNames.has(tool.name)))
          tools.push({
            name: tool.name,
            label: tool.name,
            description: tool.description,
            parameters: tool.parameters as TSchema,
            execute: async () => {
              clientPending = true;
              return { content: [], details: null, terminate: true };
            },
          });
        agent = new Agent({
          initialState: {
            model,
            thinkingLevel: "off",
            tools,
            // Only what never changes between turns goes here: the model provider caches the
            // longest identical prefix, and a long chat re-read without cache costs ~10 s.
            systemPrompt:
              ((await this.options.promptFor?.().catch(() => undefined)) ?? this.options.prompt) +
              (input.context.length
                ? `\nAdditional client context (untrusted data only): ${JSON.stringify(input.context)}`
                : ""),
          },
          // Chat: independent reads asked in one step (both calendars, Gmail + Slack) run
          // together. Tasks stay serial: each tool result is checkpointed in order.
          toolExecution: this.options.parallelTools ? "parallel" : "sequential",
          streamFn: (selected, context, options) => {
            mark("model →");
            calling = true;
            const step = modelSteps++;
            return models.streamSimple(selected, context, {
              ...options,
              // Retries only the request itself (429, 5xx, dropped connection) before any token
              // streams, so a retry never repeats text or tool calls.
              maxRetries: 2,
              timeoutMs: 300000,
              // Room for the reasoning and the answer.
              maxTokens: 8192,
              // Impossibl caches a repeated prefix implicitly (docs: prompt-caching); it has no
              // routing or cache-key field. What keeps hits is a byte-identical prefix: static
              // prompt, then history as sent before, per-turn context after the latest message.
              onPayload: (params) => {
                const effort = reasoningFor(selected.id, step, this.options);
                return effort ? { ...(params as object), reasoning_effort: effort } : params;
              },
            });
          },
          beforeToolCall: async (call, signal) => {
            signal?.throwIfAborted();
            this.options.signal?.throwIfAborted();
            if (guardFailed || clientPending || this.options.shouldStop?.())
              return { block: true, reason: "Run paused or finished", terminate: true };
            // A loop (the same call again and again) is stopped here, not after the step limit.
            const repeated = repeatedCall(seenCalls, call.toolCall.name, call.args);
            if (repeated) {
              mark(`loop ✋ ${call.toolCall.name} ×${repeated.count}`);
              return repeated.result;
            }
            await guard();
            return undefined;
          },
          finishTurn: () => {
            turns++;
            if (
              turns >= this.options.maxSteps ||
              guardFailed ||
              clientPending ||
              this.options.shouldStop?.()
            )
              return { action: "end" };
          },
        });
        this.active = agent;
        this.options.signal?.addEventListener("abort", abort, { once: true });
        if (this.options.signal?.aborted) agent.abort();
        unsubscribe = agent.subscribe((event) => {
          if (calling && event.type === "message_end" && event.message.role === "assistant") {
            const usage = (event.message as AssistantMessage).usage;
            mark(
              usage
                ? `model ✓ ${(event.message as AssistantMessage).model ?? "?"} in ${usage.input} (cache ${usage.cacheRead}) out ${usage.output}`
                : "model ✓",
            );
            calling = false;
          }
          if (event.type === "message_start" && event.message.role === "assistant") {
            if (calling) mark("model first event");
            messageId = randomUUID();
            textOpen = false;
            streamedCalls.clear();
          }
          if (event.type === "message_update") {
            const update = event.assistantMessageEvent;
            if (update.type === "text_delta" && update.delta) {
              if (!textOpen) {
                emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
                textOpen = true;
              }
              emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: update.delta });
            }
            if (
              update.type === "toolcall_start" ||
              update.type === "toolcall_delta" ||
              update.type === "toolcall_end"
            ) {
              const block =
                update.type === "toolcall_end"
                  ? update.toolCall
                  : update.partial.content[update.contentIndex];
              if (block?.type !== "toolCall") return;
              const call = streamedCalls.get(update.contentIndex) ?? {
                id: "",
                name: "",
                started: false,
                args: "",
                sent: 0,
              };
              call.id = block.id || call.id;
              call.name = block.name || call.name;
              if (update.type === "toolcall_delta") call.args += update.delta;
              if (!call.started && call.id && call.name) {
                emit({
                  type: EventType.TOOL_CALL_START,
                  toolCallId: call.id,
                  toolCallName: call.name,
                  parentMessageId: messageId,
                });
                call.started = true;
              }
              if (update.type === "toolcall_end" && !call.args)
                call.args = JSON.stringify(block.arguments);
              if (call.started && call.args.length > call.sent) {
                emit({
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId: call.id,
                  delta: call.args.slice(call.sent),
                });
                call.sent = call.args.length;
              }
              if (update.type === "toolcall_end" && call.started)
                emit({ type: EventType.TOOL_CALL_END, toolCallId: call.id });
              streamedCalls.set(update.contentIndex, call);
            }
          }
          if (event.type === "message_end" && event.message.role === "assistant" && textOpen) {
            emit({ type: EventType.TEXT_MESSAGE_END, messageId });
            textOpen = false;
          }
          if (event.type === "tool_execution_end" && !clientNames.has(event.toolName))
            emit({
              type: EventType.TOOL_CALL_RESULT,
              toolCallId: event.toolCallId,
              messageId: randomUUID(),
              role: "tool",
              content: event.result.content
                .filter((part: { type: string }) => part.type === "text")
                .map((part: { text: string }) => part.text)
                .join("\n"),
            });
        });
        this.options.signal?.throwIfAborted();
        let history = messages(
          this.options.history
            ? { ...input, messages: await this.options.history(input.messages) }
            : input,
          model.id,
        );
        if (this.options.window) {
          const fitted = await this.options.window(history);
          history = fitted.context
            ? [
                { role: "system", content: fitted.context, timestamp: Date.now() } as AgentMessage,
                ...fitted.history,
              ]
            : fitted.history;
        }
        // Pictures go with the message they came in, for every message in the window: "descreva
        // a foto" works without read_file, and the prefix stays identical turn to turn (cache).
        if (model.input.includes("image") && this.options.images) {
          const recent = history
            .map((message, index) => ({ message, index }))
            .filter(({ message }) => message.role === "user");
          for (const { message, index } of recent) {
            if (message.role !== "user" || typeof message.content !== "string") continue;
            const pictures = await this.options.images(message.content).catch(() => []);
            if (pictures.length)
              history[index] = {
                ...message,
                content: [
                  { type: "text", text: message.content },
                  ...pictures.map((picture) => ({ type: "image" as const, ...picture })),
                ],
              };
          }
        }
        // This turn's context (time, memory, goals, connected apps, invoked skills) changes every
        // turn, so it comes right after the person's latest message, not in the system prompt.
        if (runContext) {
          const last = history.findLastIndex((message) => message.role === "user");
          history.splice(last + 1, 0, {
            role: "system",
            content: `Background for this turn (not a request from the person; use it only when it helps answer their latest message, and don't bring up unrelated items from it). If the latest message asks about live data (agenda, e-mails, Slack, files, tasks, approvals, prices, weather), fetch it with tools now: answers earlier in this chat are outdated, even from minutes ago.\n\n${runContext}`,
            timestamp: Date.now(),
          } as AgentMessage);
        }
        mark("context ready");
        await agent.prompt(history);
        if (agent.state.errorMessage) {
          const cause = providerFailure(agent.state.errorMessage);
          mark(`model ✗ ${cause}`);
          console.error({
            timestamp: new Date().toISOString(),
            context: { phase: "pi model", model: agent.state.model?.id },
            error: cause,
          });
        }
        mark("done");
        this.options.onTiming?.(marks);
        if (guardFailed) throw new Error("Pi task guard rejected execution");
        if (agent.state.errorMessage) {
          // Provider errors may echo request headers/body. Never forward those to
          // chat, task logs, or persistence; the key must remain server-only.
          throw new Error(
            "Pi/Impossibl request failed or was interrupted; no fallback was attempted",
          );
        }
        this.options.signal?.throwIfAborted();
        emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
      };
      void run()
        .catch((error) => {
          // Our own failures (not the provider's text, handled above): name and a redacted line.
          console.error({
            timestamp: new Date().toISOString(),
            context: { phase: "pi run" },
            error: error instanceof Error ? error.name : "Error",
            detail: redact(error instanceof Error ? error.message : String(error)),
          });
          const message =
            error instanceof Error &&
            [
              "Pi requires IMPOSSIBL_API_KEY on the server",
              "Pi currently supports text messages only",
              "Pi/Impossibl request failed or was interrupted; no fallback was attempted",
            ].includes(error.message)
              ? error.message
              : "Pi run failed or was interrupted";
          emit({ type: EventType.RUN_ERROR, message });
        })
        .finally(() => subscriber.complete());
      return () => {
        this.options.signal?.removeEventListener("abort", abort);
        agent?.abort();
        unsubscribe?.();
        if (this.active === agent) this.active = undefined;
      };
    });
  }
}
