// The apps Corgi offers, grouped the way a person thinks about them, each with one line for the
// person (pitch, pt-BR) and a usage guide for the agent (which tools, which answer shape, what
// needs approval). Only apps Composio can connect in one tap are `oneTap`; the others explain why.

export type CategoryId =
  | "comunicacao"
  | "documentos"
  | "redes"
  | "marketing"
  | "vendas"
  | "projetos"
  | "lugares"
  | "dados";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "comunicacao", label: "Comunicação" },
  { id: "documentos", label: "Documentos" },
  { id: "redes", label: "Redes sociais" },
  { id: "marketing", label: "Marketing e anúncios" },
  { id: "vendas", label: "Vendas e CRM" },
  { id: "projetos", label: "Projetos" },
  { id: "lugares", label: "Lugares" },
  { id: "dados", label: "Dados e dev" },
];

export interface CatalogApp {
  slug: string;
  category: CategoryId;
  /** What it gives the person, in a few words (pt-BR). */
  pitch: string;
  /** How the agent should use it (English, for the model). */
  guide: string;
  /** False when Composio has no managed OAuth: the note explains what's needed. */
  oneTap?: boolean;
  note?: string;
}

const APPROVAL =
  "Anything that creates, sends, posts or changes is a proposal the person approves.";

export const CATALOG: CatalogApp[] = [
  // Comunicação
  {
    slug: "gmail",
    category: "comunicacao",
    pitch: "Ler, buscar e responder e-mails",
    guide: `List: GMAIL_FETCH_EMAILS with a Gmail query ('newer_than:1d is:important', 'from:x'), include_payload false + verbose false for a fast list; read one in full with GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID, a thread with GMAIL_FETCH_MESSAGE_BY_THREAD_ID (pass account: the one the message came from). Reply: GMAIL_REPLY_TO_THREAD (thread_id, recipient_email, message_body); new: GMAIL_SEND_EMAIL or GMAIL_CREATE_EMAIL_DRAFT — approval cards. A no-reply/robot sender can't be answered: say so. Attachments: GMAIL_GET_ATTACHMENT (message_id, attachment_id, file_name) saves it to the library (fileId → read_file, run_python, send_file). Meeting notes arrive from gemini-notes@google.com. ${APPROVAL}`,
  },
  {
    slug: "googlecalendar",
    category: "comunicacao",
    pitch: "Agenda, convites e horários livres",
    guide: `Day or week: GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS (time_min, time_max; every calendar and account in one call; the server adds descriptions, attachments and Meet links of the main calendar) → timeline. One meeting in depth: GOOGLECALENDAR_EVENTS_LIST (calendarId 'primary', q = words of the title, timeMin/timeMax) — attachments hold notes and transcripts (Google Docs: read with open_link). Scheduling: GOOGLECALENDAR_FIND_FREE_SLOTS (time_min, time_max, timezone) first, never a time that has passed, then GOOGLECALENDAR_CREATE_EVENT (summary, start_datetime, event_duration_minutes, attendees, timezone); change: GOOGLECALENDAR_PATCH_EVENT. Accept or decline an invite: find the event, then GOOGLECALENDAR_PATCH_EVENT setting only the person's own attendee responseStatus ('accepted'/'declined'); delete only events they organize (GOOGLECALENDAR_DELETE_EVENT). Meeting notes: the event's attachments (Gemini notes, transcript docs). Always say the exact date ("quinta, 26/09 às 15h"). Creating, changing, answering or deleting is an approval.`,
  },
  {
    slug: "slack",
    category: "comunicacao",
    pitch: "Mensagens e canais do trabalho",
    guide: `Find: SLACK_SEARCH_MESSAGES (query with from:@name, in:#channel, 'is:dm after:YYYY-MM-DD', 'to:me after:YYYY-MM-DD'; count up to 100, then page); a channel or DM's recent messages: SLACK_FETCH_CONVERSATION_HISTORY. People: SLACK_FIND_USERS (name) or SLACK_FIND_USER_BY_EMAIL_ADDRESS. Send: SLACK_SEND_MESSAGE (channel = a channel id, or a user id for a DM; markdown_text) — one approval; never open a DM first. ${APPROVAL}`,
  },
  {
    slug: "whatsapp",
    category: "comunicacao",
    pitch: "WhatsApp Business: templates e histórico",
    guide: `WhatsApp Business (Cloud API), not the personal app: message templates, history and business profile. Sending is an approval.`,
  },
  {
    slug: "outlook",
    category: "comunicacao",
    pitch: "E-mail e agenda da Microsoft",
    guide: `Microsoft mail and calendar; same patterns as Gmail/Google Calendar. ${APPROVAL}`,
  },
  {
    slug: "microsoft_teams",
    category: "comunicacao",
    pitch: "Chats e canais do Teams",
    guide: `Read Teams chats and channels; posting is an approval.`,
  },
  {
    slug: "zoom",
    category: "comunicacao",
    pitch: "Reuniões e gravações",
    guide: `List meetings and recordings; creating a meeting is an approval.`,
  },
  // Documentos
  {
    slug: "googledrive",
    category: "documentos",
    pitch: "Encontrar e abrir seus arquivos",
    guide: `Find: GOOGLEDRIVE_FIND_FILE (q like "name contains 'contrato'" or "fullText contains 'proposta'", add "mimeType='application/pdf'" for PDFs; orderBy 'modifiedTime desc'). Read a Doc, Sheet or file: open_link with its URL or id. Hand a file over: GOOGLEDRIVE_DOWNLOAD_FILE (fileId) saves it to the library → send_file. Sharing, moving and deleting are approvals.`,
  },
  {
    slug: "googledocs",
    category: "documentos",
    pitch: "Ler e criar documentos",
    guide: `Read: open_link with the Doc URL or id (or GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT with document_id). Create: draft in markdown, then GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN (approval), then share the link.`,
  },
  {
    slug: "googlesheets",
    category: "documentos",
    pitch: "Analisar e atualizar planilhas",
    guide: `Read by URL or ID: GOOGLESHEETS_GET_SHEET_NAMES, then GOOGLESHEETS_BATCH_GET for the ranges you need (keep ranges small; read headers first). Compute every total or % with calculate; present as table or stats. Writing cells is an approval.`,
  },
  {
    slug: "googleslides",
    category: "documentos",
    pitch: "Ler e montar apresentações",
    guide: `Read presentations' text; creating slides is an approval.`,
  },
  {
    slug: "notion",
    category: "documentos",
    pitch: "Páginas, bases e notas",
    guide: `NOTION_SEARCH for pages and databases, NOTION_GET_PAGE_MARKDOWN to read, NOTION_FETCH_DATA / query a database for rows. Creating or editing pages is an approval.`,
  },
  {
    slug: "confluence",
    category: "documentos",
    pitch: "Wiki do time",
    guide: `Search and read pages; edits are approvals.`,
  },
  // Redes sociais
  {
    slug: "linkedin",
    category: "redes",
    pitch: "Posts e métricas do seu perfil",
    guide: `LINKEDIN_GET_MY_INFO for who you are; LINKEDIN_GET_SHARE_STATS and LINKEDIN_GET_ORG_PAGE_STATS for metrics (present as stats). To post: write in the person's voice (pt-BR unless asked), short paragraphs, no hashtag spam; propose LINKEDIN_CREATE_LINKED_IN_POST — the approval card shows the post as it will appear.`,
  },
  {
    slug: "instagram",
    category: "redes",
    pitch: "Posts, stories e insights",
    guide: `Needs an Instagram professional account linked to a Facebook page. INSTAGRAM_GET_USER_INFO, INSTAGRAM_GET_USER_MEDIA, INSTAGRAM_GET_USER_INSIGHTS / INSTAGRAM_GET_IG_MEDIA_INSIGHTS for performance (stats/table). Publishing: draft caption + image, then create the media container and publish only after approval.`,
  },
  {
    slug: "facebook",
    category: "redes",
    pitch: "Páginas: posts e métricas",
    guide: `Pages only (no ads here): FACEBOOK_LIST_MANAGED_PAGES, FACEBOOK_GET_PAGE_INSIGHTS, FACEBOOK_GET_PAGE_POSTS. Posting and replying are approvals.`,
  },
  {
    slug: "youtube",
    category: "redes",
    pitch: "Canal, vídeos e comentários",
    guide: `YOUTUBE_GET_CHANNEL_STATISTICS and YOUTUBE_LIST_CHANNEL_VIDEOS for performance; YOUTUBE_SEARCH_YOU_TUBE for research. Comments and uploads are approvals.`,
  },
  {
    slug: "reddit",
    category: "redes",
    pitch: "Pesquisar o que as pessoas dizem",
    guide: `Search and read posts and comments for research; posting is an approval.`,
  },
  {
    slug: "twitter",
    category: "redes",
    pitch: "Posts e menções no X",
    guide: `Not connected through Composio: for X, read and research with browse_web / browser_task.`,
    oneTap: false,
    note: "A API do X é paga e exige um app próprio. Enquanto isso, o Corgi lê e pesquisa o X pelo navegador.",
  },
  // Marketing e anúncios
  {
    slug: "googleads",
    category: "marketing",
    pitch: "Desempenho das campanhas",
    guide: `GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS, then GOOGLEADS_SEARCH_STREAM_GAQL, e.g. "SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS". cost_micros / 1000000 = money (use calculate); CPA = cost / conversions. Present totals as stats and campaigns as a table. Every MUTATE (budgets, bids, campaigns) spends money: propose only when asked, never on your own.`,
  },
  {
    slug: "metaads",
    category: "marketing",
    pitch: "Campanhas do Facebook e Instagram",
    guide: `Not connected: needs a Meta developer app. Explain and offer page insights via facebook/instagram instead.`,
    oneTap: false,
    note: "Precisa de um app da Meta for Developers com acesso à conta de anúncios. Dá para configurar; me peça quando quiser.",
  },
  {
    slug: "google_analytics",
    category: "marketing",
    pitch: "Tráfego e conversões do site",
    guide: `GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES for properties, then GOOGLE_ANALYTICS_BATCH_RUN_REPORTS (sessions, users, conversions by date/channel/page). Key figures as stats, breakdowns as a table.`,
  },
  {
    slug: "google_search_console",
    category: "marketing",
    pitch: "Buscas que trazem gente ao site",
    guide: `Queries and pages with clicks, impressions, CTR and position; table for top queries, stats for totals.`,
  },
  {
    slug: "mailchimp",
    category: "marketing",
    pitch: "Campanhas de e-mail",
    guide: `Campaign reports (opens, clicks) as stats/table; creating or sending campaigns are approvals.`,
  },
  // Vendas e CRM
  {
    slug: "hubspot",
    category: "vendas",
    pitch: "Contatos, negócios e pipeline",
    guide: `Search contacts, companies and deals; summarise the pipeline by stage (table) and totals (stats, amounts via calculate). Creating or updating records is an approval.`,
  },
  {
    slug: "salesforce",
    category: "vendas",
    pitch: "Oportunidades e contas",
    guide: `Query opportunities and accounts (SOQL); pipeline as table, totals as stats. Changes are approvals.`,
  },
  {
    slug: "gong",
    category: "vendas",
    pitch: "Chamadas e transcrições",
    guide: `Calls recorded in Gong (usually sales and customer calls; internal meetings rarely are). Find the call by date and participants first; if that meeting isn't there, say so, never use another call. Then GONG_GET_CALL_TRANSCRIPT and call stats to summarise objections and next steps.`,
  },
  {
    slug: "calendly",
    category: "vendas",
    pitch: "Agendamentos",
    guide: `List scheduled events and invitees.`,
  },
  // Projetos
  {
    slug: "asana",
    category: "projetos",
    pitch: "Tarefas e projetos",
    guide: `List tasks by project or assignee; overdue/at-risk as a table. Creating or updating tasks is an approval.`,
  },
  {
    slug: "clickup",
    category: "projetos",
    pitch: "Tarefas e listas",
    guide: `Same patterns as Asana.`,
  },
  {
    slug: "jira",
    category: "projetos",
    pitch: "Issues e sprints",
    guide: `JQL search for issues; sprint status as table. Changes are approvals.`,
  },
  {
    slug: "linear",
    category: "projetos",
    pitch: "Issues e ciclos",
    guide: `Issues by team/cycle; changes are approvals.`,
  },
  {
    slug: "trello",
    category: "projetos",
    pitch: "Quadros e cartões",
    guide: `Boards, lists and cards; changes are approvals.`,
  },
  // Lugares
  {
    slug: "google_maps",
    category: "lugares",
    pitch: "Lugares, rotas e tempo de deslocamento",
    guide: `Places: GOOGLE_MAPS_TEXT_SEARCH / GOOGLE_MAPS_NEARBY_SEARCH (cards or list with rating and address). Travel time and route: GOOGLE_MAPS_GET_ROUTE (origin_address, destination_address, travel_mode DRIVE/TRANSIT/WALK/BICYCLE) → show_route; say when to leave.`,
  },
  // Dados e dev
  {
    slug: "databricks",
    category: "dados",
    pitch: "Consultas no seu lakehouse",
    guide: `Numbers from data: DATABRICKS_LIST_SQL_WAREHOUSES once, then DATABRICKS_SQL_STATEMENT_EXEC_EXECUTE_STATEMENT with a read-only SELECT (explore with SHOW TABLES / DESCRIBE first if unsure). Results as table, key numbers as stats.`,
  },
  {
    slug: "supabase",
    category: "dados",
    pitch: "Banco e projetos Supabase",
    guide: `Read tables and project info; writes are approvals.`,
  },
  {
    slug: "github",
    category: "dados",
    pitch: "Repositórios, PRs e issues",
    guide: `PRs, issues and commits; reviews/comments are approvals.`,
  },
  {
    slug: "airtable",
    category: "dados",
    pitch: "Bases e registros",
    guide: `Read records; table for rows. Changes are approvals.`,
  },
];

const BY_SLUG = new Map(CATALOG.map((app) => [app.slug, app]));
export const catalogApp = (slug: string) => BY_SLUG.get(slug);

/** Apps Corgi connects itself (not through Composio); the catalog never offers them twice. */
export const NATIVE_APPS = [/^apify/];

/** Apify as a connector in the Apps list: connected with the person's key (apify/). */
export const APIFY_APP = {
  slug: "apify",
  name: "Apify",
  logo: "https://logos.composio.dev/api/apify",
  category: "dados",
  pitch: "Coletores prontos: Google Maps, Instagram, lojas, avaliações",
  oneTap: true,
  native: "apify" as const,
};
const APIFY_WORDS = ["apify", "coletor", "scraper", "scraping", "dados", "raspar"];
export const apifyMatches = (query = "") => {
  const q = query.trim().toLowerCase();
  return !q || APIFY_WORDS.some((word) => word.includes(q) || q.includes(word));
};

/**
 * What the Apps list shows: an app with a working connection hides its dead ones (expired or
 * failed sign-ins left behind by reconnecting); an app with none keeps them, so it can be
 * reconnected.
 */
export function tidyConnections<T extends { toolkit: string; status: string }>(connections: T[]) {
  const working = new Set(connections.filter((c) => c.status === "ACTIVE").map((c) => c.toolkit));
  return connections.filter((c) => c.status === "ACTIVE" || !working.has(c.toolkit));
}
