// A background task is a side chat the server runs: the same engine, prompt, tools and approvals
// as the main chat. The person opens it like any side chat and can talk to it; the worker runs
// its turns when it starts, on schedule, and after each approval so it continues on its own.
import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type Message } from "@ag-ui/core";
import type { AgentTask, Fuzzy } from "../../../../packages/domain/src/agent.ts";
import type { ActionProposal } from "../../../../packages/domain/src/index.ts";
import { ConversationAgent } from "./conversation.ts";
import { followUpsOf } from "./follow-up.ts";
import type { AgentService } from "./service.ts";
import { lastText, type Thread, taskOutcome } from "./task-thread.ts";
import { loadWork, saveWork } from "./thread-work.ts";
import { openTodos, type Todo, toPlan } from "./todos.ts";
import type { TaskContext } from "./worker.ts";

/** Steps a background turn may take (a chat turn takes 10). */
const BACKGROUND_STEPS = 24;
/** Unfinished turns continued on their own before asking the person. */
const MAX_NUDGES = 2;
const DECIDED = new Set([
  "succeeded",
  "failed",
  "outcome_unknown",
  "denied",
  "expired",
  "cancelled",
]);

/**
 * The worker's own words in the task's side chat. Its id marks it as a note (the app shows it
 * small, not as the person's message) and paragraphs starting with "» " are guidance for the
 * model only: the app hides them.
 */
export const TASK_NOTE = "task-note-";

function note(visible: string, guidance: string): Message {
  return {
    id: `${TASK_NOTE}${randomUUID()}`,
    role: "user",
    content: `${visible}\n\n» ${guidance}`,
  };
}

/** What the model is told when the worker picks the task up again. */
function nextMessages(
  task: AgentTask,
  decided: ActionProposal[],
  instructions: string[],
  fresh: boolean,
  open: Todo[],
): Message[] {
  // Written in the task's own window or sent from the main chat: the person's words, as is.
  const words: Message[] = instructions.length
    ? [{ id: randomUUID(), role: "user", content: instructions.join("\n\n") }]
    : [];
  if (fresh)
    return [
      note(
        `Tarefa: ${task.prompt}`,
        "Tarefa em segundo plano: trabalhe nela até concluir, usando suas ferramentas; ninguém está olhando agora. Mudanças (enviar, criar, alterar, apagar) viram cartões de aprovação: prepare-as e diga em uma linha o que espera aprovação. Com 3 ou mais etapas, comece por update_todos e mantenha-o atualizado a cada etapa; anote ids e o que já foi feito com write_notes. Termine com pergunta só quando estiver bloqueado por algo que só a pessoa sabe; não ofereça próximos passos como pergunta. Ao concluir, dê o resultado curto e direto.",
      ),
      ...words,
    ];
  if (decided.length)
    return [
      note(
        decided
          .map((action) =>
            action.status === "succeeded"
              ? `Aprovada e executada: ${action.title}${action.result ? ` → ${action.result.slice(0, 600)}` : ""}`
              : action.status === "denied"
                ? `Negada: ${action.title}`
                : `Não concluída (${action.status}): ${action.title}${action.error ? ` → ${action.error}` : ""}`,
          )
          .join("\n"),
        "Marque como done a etapa que foi aprovada e executada; continue pela próxima da sua lista; não prepare de novo o que foi negado. Se já terminou, confirme o resultado em uma ou duas linhas.",
      ),
      ...words,
    ];
  if (words.length) return words;
  // The last turn stopped with steps still open (or mid-work): continue, don't start over.
  if (task.state.resume === "pending_todos")
    return [
      note(
        "Continuando as etapas pendentes",
        `Ainda faltam: ${open.map((todo) => todo.text).join("; ") || "concluir o que foi pedido"}. Continue de onde parou a partir da sua lista e notas; ao terminar cada etapa, atualize update_todos. Se uma etapa não for possível, marque skipped com o motivo e diga isso no resultado.`,
      ),
    ];
  return [note("Nova rodada da tarefa", `Execute de novo agora: ${task.prompt}`)];
}

export async function executeChatTask(
  service: AgentService,
  owner: string,
  initial: AgentTask,
  ctx: TaskContext,
): Promise<Partial<AgentTask>> {
  let task = initial;
  const now = new Date().toISOString();
  // The task's side chat: created on its first run, listed with the other side chats. A helper's
  // round runs in the helper's one conversation instead (its notes carry over; its checklist
  // starts fresh each round).
  let threadId = typeof task.state.threadId === "string" ? task.state.threadId : undefined;
  const fuzzyId = typeof task.input.fuzzyId === "string" ? task.input.fuzzyId : undefined;
  const fuzzy = fuzzyId ? await service.db.get<Fuzzy>(owner, "fuzzies", fuzzyId) : undefined;
  const newRound = Boolean(fuzzy && !threadId);
  if (fuzzy && !threadId) {
    threadId = fuzzy.threadId;
    const thread = await service.db.get<Thread & { fuzzyId?: string }>(owner, "threads", threadId);
    await service.db.put(owner, "threads", {
      ...(thread ?? {
        id: threadId,
        title: `${fuzzy.emoji} ${fuzzy.name}`,
        pinned: false,
        archived: false,
        createdAt: now,
        fuzzyId: fuzzy.id,
      }),
      fuzzyId: fuzzy.id,
      updatedAt: now,
      taskId: task.id,
    });
    await saveWork(service.db, owner, threadId, { todos: [] });
    task = await ctx.checkpoint({ state: { ...task.state, threadId } });
  }
  if (!threadId) {
    threadId = randomUUID();
    await service.db.put(owner, "threads", {
      id: threadId,
      title: task.title.slice(0, 80),
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      taskId: task.id,
    } satisfies Thread);
    task = await ctx.checkpoint({ state: { ...task.state, threadId } });
    await ctx.event(
      "status",
      "Conversa da tarefa criada",
      "Abra a tarefa para acompanhar e conversar",
    );
  }
  const stored =
    (await service.db.get<{ messages: Message[] }>(owner, "conversations", threadId))?.messages ??
    [];
  // Approvals decided since the last turn, each reported once.
  const reported = new Set(
    Array.isArray(task.state.reported) ? (task.state.reported as string[]) : [],
  );
  const decided = (await service.db.list<ActionProposal>(owner, "actions")).filter(
    (action) => action.taskId === task.id && DECIDED.has(action.status) && !reported.has(action.id),
  );
  // Instructions and answers not yet passed on (answer and follow-up both record them).
  const followUps = followUpsOf(task);
  const sent = Number(task.state.sentFollowUps ?? 0);
  const instructions = followUps.slice(sent).map((followUp) => followUp.text);
  const open = openTodos((await loadWork(service.db, owner, threadId)).todos);
  const asked = task.input.asked === true;
  const next = newRound
    ? [
        note(
          asked
            ? `Pedido${task.input.from === "corgi" ? " do Corgi" : ""}: ${task.prompt}`
            : "Nova rodada",
          `${asked ? `Faça isto agora: ${task.prompt}` : "Cumpra sua missão agora, a partir de onde parou (veja suas notas)."} Com 3 ou mais etapas, use update_todos. Mudanças em apps viram cartões de aprovação. No fim, chame report_finding uma vez${asked ? " com a resposta (notify: true)" : " (notify: true só se houver algo novo que a pessoa precise saber)"}.`,
        ),
        ...instructions.map((text) => ({ id: randomUUID(), role: "user" as const, content: text })),
      ]
    : nextMessages(task, decided, instructions, !stored.length, open);
  task = await ctx.checkpoint({
    actionId: null,
    state: {
      ...task.state,
      reported: [...reported, ...decided.map((action) => action.id)],
      sentFollowUps: followUps.length,
      resume: null,
    },
  });
  await ctx.event(
    "status",
    decided.length ? "Continuando após sua decisão" : stored.length ? "Nova rodada" : "Comecei",
    decided.map((action) => action.title).join(" · ") || undefined,
  );
  const agent = new ConversationAgent(service.config, service, owner, {
    background: true,
    maxSteps: BACKGROUND_STEPS,
    reasoningEffort: "medium",
    // The checklist becomes the task's plan (steps and progress in Activity) as it changes.
    onTodos: async (todos) => {
      task = await ctx.checkpoint({ plan: toPlan(todos) });
    },
  });
  const events: BaseEvent[] = [];
  let runError: string | undefined;
  await new Promise<void>((resolve, reject) => {
    const subscription = agent
      .run({
        threadId,
        runId: randomUUID(),
        messages: [...stored, ...next],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      })
      .subscribe({
        next: (event) => {
          events.push(event);
          if (event.type === EventType.RUN_ERROR && "message" in event)
            runError = String(event.message);
        },
        error: (error) => {
          ctx.signal.removeEventListener("abort", abort);
          reject(error);
        },
        complete: () => {
          ctx.signal.removeEventListener("abort", abort);
          resolve();
        },
      });
    const abort = () => {
      subscription.unsubscribe();
      reject(new Error("Tarefa interrompida"));
    };
    ctx.signal.addEventListener("abort", abort, { once: true });
  });
  await agent.saved;
  if (runError) throw new Error(runError);
  const text = lastText(events);
  let outcome = await taskOutcome(service.db, owner, task.id, text, threadId);
  // Unfinished: nudged to continue at most twice, then the person hears exactly what is left.
  const nudges = Number(task.state.nudges ?? 0);
  if (outcome.status === "queued") {
    const left = openTodos((await loadWork(service.db, owner, threadId)).todos);
    outcome =
      nudges < MAX_NUDGES
        ? { ...outcome, state: { ...task.state, nudges: nudges + 1, resume: "pending_todos" } }
        : {
            ...outcome,
            status: "waiting_input",
            question: `Não consegui concluir${left.length ? `: ${left.map((todo) => todo.text).join("; ")}` : " esta rodada"}. Quer que eu tente de novo ou mude algo?`,
            state: { ...task.state, nudges: 0 },
          };
  } else if (nudges) outcome = { ...outcome, state: { ...task.state, nudges: 0 } };
  await ctx.event(
    outcome.status === "succeeded" ? "result" : "status",
    outcome.status === "succeeded"
      ? "Concluí"
      : outcome.status === "waiting_approval"
        ? "Esperando sua aprovação"
        : outcome.status === "queued"
          ? "Continuando: ainda há etapas"
          : "Pergunta para você",
    text.slice(0, 4000) || undefined,
  );
  return outcome;
}
