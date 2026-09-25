// Small display helpers shared by activity, goals, ideas and apps screens.

// pt-BR labels for the status/kind values the server sends. Unknown values fall
// back to a humanized version of the raw string.
const LABELS: Record<string, string> = {
  // task / step statuses
  queued: "Na fila",
  pending: "Pendente",
  running: "Em andamento",
  waiting: "Aguardando",
  waiting_approval: "Aguardando aprovação",
  waiting_input: "Aguardando você",
  scheduled: "Agendada",
  paused: "Pausada",
  succeeded: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
  timed_out: "Tempo esgotado",
  interrupted: "Interrompida",
  // approvals
  awaiting_review: "Aguardando revisão",
  executing: "Executando",
  outcome_unknown: "Resultado incerto",
  denied: "Recusada",
  expired: "Expirada",
  // goals / monitors / ideas
  active: "Ativa",
  completed: "Concluída",
  stopped: "Parada",
  new: "Nova",
  dismissed: "Descartada",
  accepted: "Aceita",
  done: "Feito",
  attention: "Atenção",
  blocked: "Bloqueada",
  // connections
  connected: "Conectado",
  disconnected: "Desconectado",
  sample: "Exemplo",
  unconfigured: "Não configurado",
  idle: "Ociosa",
  closed: "Encerrada",
  error: "Erro",
  // task / artifact kinds
  agent: "Tarefa geral",
  document: "Documento",
  monitor: "Monitor",
  finance: "Finanças",
  plan: "Plano",
  comparison: "Comparação",
  report: "Relatório",
  step: "Etapa",
  observation: "Observação",
  approval: "Aprovação",
  result: "Resultado",
  status: "Status",
  // assistant tones
  warm: "Acolhedor",
  concise: "Direto",
  thoughtful: "Cuidadoso",
};

export function statusLabel(value: string) {
  return LABELS[value] ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
export function stamp(value?: string) {
  return value
    ? new Date(value).toLocaleString("pt-BR", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Ainda não verificado";
}
export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
