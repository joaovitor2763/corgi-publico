import "../platform/config.ts";
import { HttpAgent } from "@ag-ui/client";
import {
  type AgentsFactory,
  CopilotRuntime,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";
import type { Auth } from "../platform/auth.ts";
import type { Config } from "../platform/config.ts";
import { ConversationAgent } from "./conversation.ts";
import type { AgentService } from "./service.ts";

export function agentConfigured(config: Config) {
  return (
    config.agentBackend === "sample" ||
    (config.agentBackend === "pi" && Boolean(process.env.IMPOSSIBL_API_KEY?.trim())) ||
    (config.agentBackend === "agui"
      ? Boolean(config.agentUrl)
      : Boolean(
          config.agentBackend !== "pi" &&
            config.model &&
            (process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              process.env.GOOGLE_API_KEY),
        ))
  );
}
export function makeRuntime(config: Config, service: AgentService, auth: Auth) {
  const agents: AgentsFactory = async ({ request }) => ({
    default:
      config.agentBackend === "sample"
        ? new ConversationAgent(
            config,
            service,
            await auth.owner(request.headers.get("authorization") ?? undefined),
          )
        : config.agentBackend === "agui"
          ? new HttpAgent({
              url: config.agentUrl ?? "http://127.0.0.1:1/unconfigured",
              headers: config.agentToken ? { Authorization: `Bearer ${config.agentToken}` } : {},
            })
          : new ConversationAgent(
              config,
              service,
              await auth.owner(request.headers.get("authorization") ?? undefined),
            ),
  });
  const runtime = new CopilotRuntime({ agents });
  return createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });
}
