// A task's step as the person reads it in the timeline: what the agent did, in plain
// Portuguese, from the tool it called and its arguments. Never the tool's own description.

const APPS: Record<string, string> = {
  GMAIL: "Gmail",
  GOOGLECALENDAR: "Google Calendar",
  GOOGLEDRIVE: "Google Drive",
  GOOGLESHEETS: "Google Sheets",
  SLACK: "Slack",
  NOTION: "Notion",
  GITHUB: "GitHub",
  CLICKUP: "ClickUp",
  SUPABASE: "Supabase",
  DATABRICKS: "Databricks",
};

const text = (value: unknown, max = 80) => {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

function host(value: unknown) {
  try {
    return typeof value === "string" ? new URL(value).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

/** "GMAIL_FETCH_EMAILS" → { app: "Gmail", action: "fetch emails" }. */
export function appAction(slug: string) {
  const prefix = Object.keys(APPS).find((key) => slug.startsWith(`${key}_`));
  const app = prefix ? (APPS[prefix] as string) : (slug.split("_")[0] ?? slug);
  const rest = prefix ? slug.slice(prefix.length + 1) : slug.split("_").slice(1).join("_");
  return { app, action: rest.toLowerCase().replace(/_/g, " ") };
}

export function stepLabel(name: string, args: Record<string, unknown> = {}): string {
  switch (name) {
    case "use_app_tool": {
      const { app, action } = appAction(String(args.tool ?? ""));
      const summary = text(args.summary);
      return summary ? `${app}: ${summary}` : `${app}: ${action}`;
    }
    case "find_app_tools":
      return `Procurando nos apps${args.app ? ` (${text(args.app, 30)})` : ""}: ${text(args.query, 60)}`;
    case "read_web":
    case "browse_web":
      return `Lendo ${host(args.url) || "uma página"}`;
    case "browser_task":
      return `No navegador${host(args.url) ? ` (${host(args.url)})` : ""}: ${text(args.goal, 70)}`;
    case "look_at_page":
      return "Olhando a página";
    case "set_plan":
      return "Montando o plano";
    case "create_routine":
      return `Criando a rotina${args.title ? ` “${text(args.title, 50)}”` : ""}`;
    case "read_workspace":
      return "Lendo seu espaço de trabalho";
    case "read_mail_thread":
      return "Lendo uma conversa de e-mail";
    case "save_skill":
      return `Salvando a skill${args.name ? ` @${text(args.name, 30)}` : ""}`;
    case "calculate":
      return "Fazendo as contas";
    case "apify_search":
      return `Procurando um coletor no Apify: ${text(args.query, 50)}`;
    case "apify_input":
      return `Vendo como usar ${text(args.actor, 50)}`;
    case "apify_run":
      return `Coletando dados com ${text(args.actor, 50)}`;
    case "get_weather":
      return `Vendo o tempo${args.place ? ` em ${text(args.place, 40)}` : ""}`;
    case "show_route":
      return "Montando a rota";
    case "generate_image":
      return "Criando a imagem";
    case "run_python":
      return "Analisando com Python";
    case "manage_task":
      return args.action === "read"
        ? "Lendo a tarefa"
        : args.action === "follow_up"
          ? "Passando a instrução para a tarefa"
          : "Controlando a tarefa";
    case "send_file":
      return "Enviando o arquivo";
    case "conversation_history":
      return args.query ? `Procurando na conversa: ${text(args.query, 40)}` : "Relendo a conversa";
    case "open_link":
      return args.question
        ? `Abrindo o documento: ${text(args.question, 50)}`
        : "Abrindo o documento";
    case "app_result_page":
      return "Lendo o resultado completo";
    case "read_file":
      return "Lendo o arquivo que você mandou";
    case "import_pdf":
    case "inspect_pdf":
      return "Lendo o PDF";
    case "fill_pdf":
      return "Preenchendo o PDF";
    case "save_artifact":
      return `Salvando${args.title ? `: ${text(args.title, 60)}` : " o resultado"}`;
    case "prepare_email":
      return "Preparando um e-mail para sua aprovação";
    case "prepare_event":
      return "Preparando um evento para sua aprovação";
    case "ask_user":
      return "Perguntando a você";
    case "finish_task":
      return "Concluindo";
    case "update_todos":
      return "Organizando as etapas";
    case "write_notes":
      return "Anotando o que encontrei";
    default:
      return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}
