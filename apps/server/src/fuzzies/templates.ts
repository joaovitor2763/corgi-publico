// Ready-made helpers to start from. Apps are the usual toolkit slugs; the person picks which of
// them are really allowed (only connected apps are offered).
import type { FuzzyInput } from "../../../../packages/domain/src/agent.ts";

export interface FuzzyTemplate extends Omit<FuzzyInput, "maxRunsPerDay" | "web" | "instructions"> {
  id: string;
  instructions: string;
  web: boolean;
  /** One line for the gallery card. */
  pitch: string;
}

export const FUZZY_TEMPLATES: FuzzyTemplate[] = [
  {
    id: "radar",
    name: "Radar",
    emoji: "📡",
    color: "#CFE3F7",
    pitch: "Olha seu Slack e e-mail e te chama só quando algo precisa de você.",
    mission:
      "Ficar de olho nas conversas de trabalho e avisar só o que precisa da pessoa: pedidos diretos, prazos, problemas com clientes e decisões pendentes.",
    instructions:
      "Leia as mensagens novas desde a última rodada (use suas notas para saber onde parou). Ignore o que já foi respondido ou é só informativo. Para cada item que precisa da pessoa: quem pediu, o quê, até quando, e o link. Se não houver nada novo que importe, não avise.",
    apps: ["slack", "gmail"],
    web: false,
    schedule: { days: [1, 2, 3, 4, 5], time: "09:00" },
    template: "radar",
  },
  {
    id: "meetings",
    name: "Preparador",
    emoji: "🗂️",
    color: "#E6DDF6",
    pitch: "Antes de cada dia, prepara as reuniões: quem, contexto e o que decidir.",
    mission:
      "Preparar as reuniões do dia: para cada uma, quem participa, o contexto recente (e-mails, mensagens, documentos) e o que precisa ser decidido.",
    instructions:
      "Pegue a agenda de hoje. Para cada reunião com outras pessoas, busque as trocas recentes com os participantes e os documentos citados no convite. Entregue um resumo por reunião: objetivo, contexto em 2–3 linhas, pontos em aberto. Pule reuniões pessoais e bloqueios de foco.",
    apps: ["googlecalendar", "gmail", "slack", "googledrive"],
    web: false,
    schedule: { days: [1, 2, 3, 4, 5], time: "07:30" },
    template: "meetings",
  },
  {
    id: "competitors",
    name: "Concorrentes",
    emoji: "🔭",
    color: "#DDF0E2",
    pitch: "Acompanha concorrentes na web e resume o que mudou na semana.",
    mission:
      "Acompanhar os concorrentes que a pessoa indicar: lançamentos, preços, contratações e notícias, e resumir o que mudou.",
    instructions:
      "Se ainda não sabe quais concorrentes acompanhar, pergunte uma vez e guarde com learn_fact. A cada rodada, veja sites, blogs e notícias recentes de cada um; compare com o que já anotou; relate só o que é novo, com o link da fonte.",
    apps: [],
    web: true,
    schedule: { days: [1], time: "08:00" },
    template: "competitors",
  },
  {
    id: "followups",
    name: "Cobrador",
    emoji: "📌",
    color: "#FBE3C8",
    pitch: "Lembra o que você prometeu e o que te prometeram, antes de atrasar.",
    mission:
      "Encontrar compromissos em aberto: o que a pessoa prometeu fazer e o que outras pessoas prometeram a ela, e avisar os que estão perto do prazo ou atrasados.",
    instructions:
      "Leia as mensagens e e-mails enviados e recebidos da última semana. Procure promessas ('te mando amanhã', 'até sexta'). Guarde cada compromisso nas notas com quem, o quê e prazo; marque como resolvido quando vir a entrega. Avise só os que vencem em até 2 dias ou já venceram.",
    apps: ["gmail", "slack"],
    web: false,
    schedule: { days: [1, 2, 3, 4, 5], time: "17:00" },
    template: "followups",
  },
];
