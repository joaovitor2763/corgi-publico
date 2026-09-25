import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/** What the agent is doing right now, shown under its name while it works. */
const LiveStatusContext = createContext<{
  label?: string;
  set: (label?: string) => void;
}>({ set: () => {} });

export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [label, set] = useState<string>();
  const value = useMemo(() => ({ label, set }), [label]);
  return <LiveStatusContext.Provider value={value}>{children}</LiveStatusContext.Provider>;
}

export const useLiveStatus = () => useContext(LiveStatusContext);

function host(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** A short present-tense line for the tool the agent is running. */
export function liveLabel(name: string, rawArgs: string) {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    /* arguments still streaming */
  }
  const app = typeof args.tool === "string" ? args.tool.split("_")[0]?.toLowerCase() : undefined;
  switch (name) {
    case "browser_task":
      return host(args.url) ? `Navegando em ${host(args.url)}…` : "Navegando…";
    case "browse_web":
      return host(args.url) ? `Lendo ${host(args.url)}…` : "Lendo uma página…";
    case "find_app_tools":
      return "Procurando nos seus apps…";
    case "use_app_tool":
      return app ? `Usando ${app.charAt(0).toUpperCase()}${app.slice(1)}…` : "Usando um app…";
    case "search_mail":
    case "read_mail_thread":
      return "Lendo seus e-mails…";
    case "remember_fact":
    case "update_memory":
    case "forget_memory":
      return "Anotando…";
    case "update_todos":
      return "Organizando as etapas…";
    case "write_notes":
      return "Anotando o que encontrei…";
    case "look_at_page":
      return "Olhando a página…";
    case "show_results":
      return "Organizando os resultados…";
    case "watch_page":
      return "Criando um alerta…";
    case "delegate_task":
      return "Delegando uma tarefa…";
    case "create_routine":
      return "Criando uma rotina…";
    case "create_goal":
      return "Salvando uma meta…";
    case "send_file":
      return "Preparando o arquivo…";
    case "get_weather":
      return "Vendo a previsão do tempo…";
    case "apify_search":
    case "apify_input":
      return "Escolhendo um coletor no Apify…";
    case "apify_run":
      return "Coletando dados com o Apify…";
    case "show_route":
      return "Traçando a rota…";
    case "run_python":
      return "Calculando…";
    case "manage_task":
      return "Vendo a tarefa…";
    default:
      return name.includes("computer") ? "Usando o computador…" : "Trabalhando…";
  }
}
