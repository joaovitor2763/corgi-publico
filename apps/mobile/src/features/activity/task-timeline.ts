// A task's window reads like a small conversation: what the agent did (run events) and the
// person's own instructions (follow-ups) in time order. Pure, so ordering, de-duplication and the
// pt-BR wording of older English event titles are tested.
import { statusLabel } from "../../shared/format";

export interface TimelineEvent {
  id: string;
  date: string;
  kind: string;
  title: string;
  detail: string;
}

export interface Instruction {
  text: string;
  at: string;
}

export type TimelineItem =
  | { type: "event"; key: string; at: string; event: TimelineEvent }
  | { type: "instruction"; key: string; at: string; text: string; pending: boolean };

/** The server's own marker for a follow-up; the bubble replaces it. */
export const INSTRUCTION_EVENT = "Nova instrução sua";

export function followUpsOf(state: Record<string, unknown> | undefined): Instruction[] {
  const list = state?.followUps;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) =>
    item &&
    typeof item === "object" &&
    typeof (item as Instruction).text === "string" &&
    typeof (item as Instruction).at === "string"
      ? [{ text: (item as Instruction).text, at: (item as Instruction).at }]
      : [],
  );
}

const same = (a: string, b: string) => a.trim() === b.trim();

/**
 * Events and instructions in time order. Saved follow-ups and the "Nova instrução sua" event are
 * the same thing; `sent` holds what the person just sent from this window, shown until the
 * server has it.
 */
export function taskTimeline(
  events: readonly TimelineEvent[],
  followUps: readonly Instruction[],
  sent: readonly (Instruction & { pending?: boolean })[] = [],
): TimelineItem[] {
  const saved: Instruction[] = [...followUps];
  for (const event of events)
    if (event.title === INSTRUCTION_EVENT && !saved.some((f) => same(f.text, event.detail)))
      saved.push({ text: event.detail, at: event.date });
  const items: TimelineItem[] = [
    ...events
      .filter((event) => event.title !== INSTRUCTION_EVENT)
      .map((event) => ({ type: "event" as const, key: event.id, at: event.date, event })),
    ...saved.map((f, i) => ({
      type: "instruction" as const,
      key: `saved-${i}-${f.at}`,
      at: f.at,
      text: f.text,
      pending: false,
    })),
    ...sent
      .filter((s) => !saved.some((f) => same(f.text, s.text)))
      .map((s, i) => ({
        type: "instruction" as const,
        key: `sent-${i}-${s.at}`,
        at: s.at,
        text: s.text,
        pending: s.pending ?? true,
      })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** The task is back at work because of the person's newest instruction (no result since). */
export function workingOnInstruction(items: readonly TimelineItem[], status: string) {
  if (status !== "queued" && status !== "running") return false;
  let last = -1;
  items.forEach((item, i) => {
    if (item.type === "instruction") last = i;
  });
  if (last < 0) return false;
  return !items
    .slice(last + 1)
    .some((item) => item.type === "event" && ["result", "error"].includes(item.event.kind));
}

/**
 * What the task window's composer is for: steering (agent and plan tasks), answering a question
 * (any task waiting for input), or nothing, with a one-line hint instead.
 */
export function composerFor(task: {
  kind: string;
  status: string;
}): { mode: "steer" | "answer"; placeholder: string } | { mode: "hint"; hint: string } {
  if (task.status === "waiting_input") return { mode: "answer", placeholder: "Responder…" };
  if (task.kind === "monitor")
    return { mode: "hint", hint: "Acompanhamentos não recebem instruções; peça no chat." };
  if (task.kind !== "agent" && task.kind !== "plan")
    return { mode: "hint", hint: "Esta tarefa não recebe instruções; peça no chat." };
  return { mode: "steer", placeholder: "Dar uma instrução para esta tarefa…" };
}

const TITLES: Record<string, string> = {
  "Started working": "Comecei a trabalhar",
  "Resumed work": "Retomei o trabalho",
  "Work completed": "Trabalho concluído",
  "Reply completed": "Resposta concluída",
  "Task needs attention": "A tarefa precisa de atenção",
  "Approved action completed": "Ação aprovada concluída",
  "Found the document": "Encontrei o documento",
  "Saved a filled copy": "Salvei uma cópia preenchida",
  "Checked for changes": "Verifiquei se mudou algo",
  "Saved the first observation": "Salvei a primeira observação",
  "A meaningful change was found": "Encontrei uma mudança relevante",
  "Analyzing the imported transactions": "Analisando as transações importadas",
};

/** Event titles in pt-BR; the server still writes a few in English. */
export function eventTitle(title: string) {
  if (TITLES[title]) return TITLES[title];
  const status = title.match(/^Task (\w+)$/);
  if (status) return `Tarefa ${statusLabel(status[1]).toLowerCase()}`;
  const failed = title.match(/^(\S+) failed$/);
  if (failed) return `${failed[1]} falhou`;
  return title;
}

export function eventDetail(detail: string) {
  if (detail === "Changed by you") return "Alterado por você";
  const review = detail.match(/^Review prepared for (.+)$/);
  if (review)
    return `Revisão preparada para ${review[1] === "the connected account" ? "a conta conectada" : review[1]}`;
  return detail;
}
