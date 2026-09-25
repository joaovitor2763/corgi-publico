import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type AgentArtifact,
  type AgentIdentity,
  type AgentMemory,
  type AgentModelSettings,
  type AgentNotification,
  type AgentTask,
  type AgentWorkspace,
  createTaskSchema,
  type Evidence,
  type Goal,
  goalInputSchema,
  type Idea,
  type Monitor,
  monitorInputSchema,
  type ResultCard,
  type Routine,
  type RunEvent,
  routineInputSchema,
} from "../../../../packages/domain/src/agent.ts";
import type {
  ActionProposal,
  Artifact,
  BrowserSession,
  GuardFlag,
  Mail,
  ProposalInput,
} from "../../../../packages/domain/src/index.ts";
import { PythonSandbox } from "../analysis/python.ts";
import type { ApifyService } from "../apify/apify.ts";
import type { ActionService } from "../approvals/actions.ts";
import type { BrowserService } from "../browser/browser.ts";
import { mainPrice } from "../commerce/prices.ts";
import { ComputerService } from "../computer/computer.ts";
import { ComposioService } from "../connected-apps/composio.ts";
import { analyzeSpending } from "../finance/finance.ts";
import { type FuzzyDeps, fuzzyList, runDueFuzzies } from "../fuzzies/fuzzies.ts";
import {
  filterIdeas,
  gatherSignals,
  proposeIdeas,
  withoutRefs,
  withSources,
} from "../ideas/ideas.ts";
import { ageOf, isExpired, presentIdeas, snoozeInstant } from "../ideas/lifecycle.ts";
import { loadIdeaSources } from "../ideas/sources.ts";
import { activeMemories } from "../memory/book.ts";
import { memoryUpkeep } from "../memory/upkeep.ts";
import { type Config, timeZoneOf } from "../platform/config.ts";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";
import type { Files } from "../platform/files.ts";
import { backgroundFailure } from "../platform/log.ts";
import { type PushService, pushFor } from "../push/push.ts";
import { AUTO_APPROVE_NOTE } from "../routines/auto-approve.ts";
import { mergeSchedule, nextRun, normalizeSchedule } from "../routines/routines.ts";
import { jevClient } from "../trust/jev.ts";
import type { WorkspaceService } from "../workspace/workspace.ts";
import { executeChatTask } from "./chat-task.ts";
import { complete, SIDE_MODEL } from "./complete.ts";
import { isRunning } from "./conversation-store.ts";
import { type FollowUp, followUpsOf, followUpTask } from "./follow-up.ts";
import { executeModelTask } from "./model.ts";
import {
  AUTO_MODEL,
  AUTO_OPTION,
  autoModel,
  configuredImpossiblModel,
  IMPOSSIBL_MODELS,
  isImpossiblModelId,
} from "./pi-provider.ts";
import { runsAsChat } from "./task-thread.ts";
import { tidyUp } from "./tidy.ts";
import { shortTitle, watchPrompt } from "./titles.ts";
import { LostLeaseError, type TaskContext, TaskWorker } from "./worker.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const date = () => new Date().toISOString();
const terminal = new Set(["succeeded", "failed", "cancelled"]);
const STATUS_PT: Record<string, string> = {
  paused: "pausada",
  queued: "retomada",
  cancelled: "cancelada",
  scheduled: "retomada",
};
export class AgentService {
  readonly worker: TaskWorker;
  readonly python: PythonSandbox;
  private maintenance?: ReturnType<typeof setInterval>;
  private refreshing = false;
  constructor(
    readonly db: Store,
    readonly config: Config,
    readonly workspace: WorkspaceService,
    readonly files: Files,
    readonly actions: ActionService,
    readonly browser: BrowserService,
    readonly computer: ComputerService = new ComputerService(db, config),
    readonly composio: ComposioService = new ComposioService(config),
  ) {
    this.python = new PythonSandbox(config, files);
    this.worker = new TaskWorker(db, (owner, task, context) => this.execute(owner, task, context), {
      settled: (owner, task) => this.publishOutcome(owner, task),
    });
  }
  start() {
    this.worker.start();
    // Maintenance is independent of the HTTP response and reconciles durable records.
    void this.maintain().catch((error) => backgroundFailure("initial maintenance", error));
    this.maintenance = setInterval(() => {
      void this.maintain().catch((error) => backgroundFailure("maintenance", error));
    }, 60000);
  }
  async stop() {
    if (this.maintenance) clearInterval(this.maintenance);
    this.maintenance = undefined;
    await this.worker.stop();
    while (this.refreshing) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  private async maintain() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // Recover publications if the process exited after committing an outcome.
      for (const { owner, value } of await this.db.scan<AgentTask>("tasks"))
        await this.publishOutcome(owner, value);
      for (const { owner, value } of await this.db.scan<Monitor>("monitors"))
        await this.activateMonitor(owner, value);
      for (const { owner, value } of await this.db.scan<Routine>("routines"))
        if (value.enabled && Date.parse(value.nextRunAt) <= Date.now())
          await this.runRoutine(owner, value.id, true).catch((error) =>
            backgroundFailure("routine", error),
          );
      for (const { owner, value } of await this.db.scan<Idea>("ideas"))
        if (
          value.status === "accepted" &&
          value.taskId &&
          !(await this.db.get(owner, "tasks", value.taskId))
        )
          await this.decideIdea(owner, value.id, "accept").catch(async (error) => {
            backgroundFailure("recover accepted idea", error);
            await this.notify(
              owner,
              "Ideia aceita precisa de atenção",
              "Abra a ideia de novo depois de liberar espaço para outra tarefa.",
              undefined,
              `idea-recovery:${value.id}`,
            );
          });
      for (const { owner, value } of await this.db.scan<{ id: string; lastIdeasAt?: string }>(
        "agent-settings",
      )) {
        if (value.id !== "identity") continue;
        if (!value.lastIdeasAt || Date.now() - Date.parse(value.lastIdeasAt) > 15 * 60000)
          await this.refreshIdeas(owner).catch(async () => {
            await this.notify(
              owner,
              "Atualização de fonte precisa de atenção",
              "Reconecte a fonte ou atualize Ideias para ver o erro.",
              undefined,
              `source-error:${Math.floor(Date.now() / 3600000)}`,
            );
          });
      }
      await runDueFuzzies(this.fuzzyDeps()).catch((error) => backgroundFailure("helpers", error));
      await this.memoryUpkeep().catch((error) => backgroundFailure("memory", error));
      // Put away what is done and old, at most once an hour.
      if (Date.now() - this.tidiedAt > 3600000) {
        this.tidiedAt = Date.now();
        await tidyUp(this.db).catch((error) => backgroundFailure("tidy", error));
      }
    } finally {
      this.refreshing = false;
    }
  }
  private tidiedAt = 0;
  /** What the helpers module needs from here (fuzzies/ never imports the agent). */
  fuzzyDeps(): FuzzyDeps {
    return {
      db: this.db,
      timeZone: timeZoneOf(this.config),
      createTask: (owner, input, key) => this.createTask(owner, input, key),
      followUp: (owner, taskId, text) => followUpTask(this, owner, taskId, text),
    };
  }
  /** Memory v2: hourly review of conversations, nightly reflection, purge (memory/upkeep.ts). */
  private async memoryUpkeep() {
    if (this.config.agentBackend !== "pi" || !process.env.IMPOSSIBL_API_KEY?.trim()) return;
    const owners = (await this.db.scan<{ id: string }>("agent-settings"))
      .filter(({ value }) => value.id === "identity")
      .map(({ owner }) => owner);
    await memoryUpkeep({
      db: this.db,
      owners,
      timeZone: timeZoneOf(this.config),
      jev: jevClient(),
      busy: (owner, conversation) => isRunning(owner, conversation),
      extract: (prompt) =>
        complete(this.config, SIDE_MODEL, prompt, { maxTokens: 2000, timeoutMs: 90_000 }),
      think: (prompt) => this.reflect(prompt),
    });
  }
  /** The nightly reflection thinks with the chat's automatic model. */
  reflect(prompt: string) {
    return complete(this.config, autoModel({}), prompt, {
      maxTokens: 6000,
      timeoutMs: 240_000,
      reasoningEffort: "medium",
    });
  }
  async ensure(owner: string) {
    await this.db.insertIfAbsent(owner, "agent-settings", {
      id: "identity",
      name: "Corgi",
      tone: "warm",
    });
  }
  async modelSettings(owner: string): Promise<AgentModelSettings | undefined> {
    if (this.config.agentBackend !== "pi") return undefined;
    const saved = await this.db.get<{ id: string; modelId?: string }>(
      owner,
      "agent-settings",
      "model",
    );
    // Automatic unless the person pinned a model (Configurações › Avançado).
    const selectedId =
      saved?.modelId === AUTO_MODEL || isImpossiblModelId(saved?.modelId)
        ? saved.modelId
        : AUTO_MODEL;
    return {
      selectedId,
      options: [AUTO_OPTION, ...IMPOSSIBL_MODELS.map((option) => ({ ...option }))],
    };
  }
  /** The model for this call: the pinned one, or the automatic pick for what the turn needs. */
  async modelId(owner: string, needs: { vision?: boolean } = {}): Promise<string> {
    const settings = await this.modelSettings(owner);
    if (!settings) throw new AppError("Escolha de modelo indisponível para este backend", 409);
    return settings.selectedId === AUTO_MODEL ? autoModel(needs) : settings.selectedId;
  }
  async selectModel(owner: string, modelId: string): Promise<AgentModelSettings> {
    if (this.config.agentBackend !== "pi")
      throw new AppError("Escolha de modelo indisponível para este backend", 409);
    if (modelId !== AUTO_MODEL && !isImpossiblModelId(modelId))
      throw new AppError("Modelo não permitido", 422);
    await this.db.put(owner, "agent-settings", { id: "model", modelId });
    const settings = await this.modelSettings(owner);
    if (!settings) throw new AppError("Escolha de modelo indisponível", 409);
    return settings;
  }
  async snapshot(owner: string): Promise<AgentWorkspace> {
    await this.ensure(owner);
    const [
      tasks,
      goals,
      monitors,
      routines,
      ideas,
      memories,
      artifacts,
      notifications,
      identity,
      model,
    ] = await Promise.all([
      this.db.list<AgentTask>(owner, "tasks"),
      this.db.list<Goal>(owner, "goals"),
      this.db.list<Monitor>(owner, "monitors"),
      this.db.list<Routine>(owner, "routines"),
      this.db.list<Idea>(owner, "ideas"),
      activeMemories(this.db, owner) as Promise<AgentMemory[]>,
      this.db.list<AgentArtifact>(owner, "agent-artifacts"),
      this.db.list<AgentNotification>(owner, "notifications"),
      this.db.get<AgentIdentity>(owner, "agent-settings", "identity"),
      this.modelSettings(owner),
    ]);
    const heartbeat = await this.db.get<{ lastTickAt: string }>("system", "worker-status", "tasks");
    return {
      tasks,
      goals: goals.map((goal) => ({ ...goal, description: withoutRefs(goal.description) })),
      monitors,
      routines,
      ideas: presentIdeas(ideas, Date.now()).map((idea) => ({
        ...idea,
        title: withoutRefs(idea.title),
        reason: withoutRefs(idea.reason),
      })),
      memories,
      artifacts,
      notifications,
      identity: identity ?? { name: "Corgi", tone: "warm" },
      model,
      fuzzies: await fuzzyList(this.db, owner),
      worker: {
        running:
          this.worker.running ||
          Boolean(heartbeat && Date.now() - Date.parse(heartbeat.lastTickAt) < 15000),
        lastTickAt: heartbeat?.lastTickAt ?? this.worker.lastTickAt,
      },
    };
  }
  async getTask(owner: string, id: string) {
    const task = await this.db.get<AgentTask>(owner, "tasks", id);
    if (!task) throw new AppError("Tarefa não encontrada", 404);
    return task;
  }
  async detail(owner: string, id: string) {
    const task = await this.getTask(owner, id);
    const files = (await this.db.list<Artifact>(owner, "files")).filter((file) =>
      task.artifactIds.includes(file.id),
    );
    const browsers = (await this.db.list<BrowserSession>(owner, "browsers")).filter((browser) =>
      [task.state.browserId, task.state.sessionId].includes(browser.id),
    );
    return {
      task,
      files: files.map((file) => this.files.signed(owner, file)),
      browsers: browsers.map((browser) => this.browser.decorate(owner, browser)),
      events: (await this.db.list<RunEvent>(owner, "run-events"))
        .filter((e) => e.taskId === id)
        .sort((a, b) => a.date.localeCompare(b.date)),
      artifacts: (await this.db.list<AgentArtifact>(owner, "agent-artifacts")).filter(
        (a) => a.taskId === id,
      ),
    };
  }
  async createTask(owner: string, raw: unknown, idempotencyKey?: string, held = false) {
    const input = createTaskSchema.parse(raw);
    if (input.goalId && !(await this.db.get(owner, "goals", input.goalId)))
      throw new AppError("Meta não encontrada", 404);
    const id = idempotencyKey ? hash(`task:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<AgentTask>(owner, "tasks", id);
    if (existing) return existing;
    if (
      (await this.db.list<AgentTask>(owner, "tasks")).filter((t) => !terminal.has(t.status))
        .length >= 100
    )
      throw new AppError("Finalize ou cancele algumas tarefas antes de adicionar mais", 409);
    const titles =
      input.kind === "document"
        ? [
            "Encontrar o documento",
            "Preencher uma cópia",
            "Preparar a resposta",
            "Esperar sua decisão",
            "Registrar o resultado",
          ]
        : input.kind === "monitor"
          ? ["Checar a fonte", "Comparar com a última checagem", "Avisar se mudou algo relevante"]
          : input.kind === "finance"
            ? ["Validar as transações", "Calcular o resumo", "Salvar o acompanhamento"]
            : [
                "Entender o que você quer",
                "Planejar",
                "Usar seus apps e ferramentas",
                "Entregar o resultado",
              ];
    const task: AgentTask = {
      id,
      title: input.title ?? shortTitle(input.prompt),
      prompt: input.prompt,
      kind: input.kind,
      goalId: input.goalId,
      status: held ? "paused" : "queued",
      plan: titles.map((title, i) => ({ id: String(i), title, status: "pending" })),
      evidence: [],
      input: input.input,
      state: {
        connectionId: (await this.workspace.connection(owner))?.id ?? null,
        ...(held && input.kind === "monitor" ? { initializingMonitor: true } : {}),
      },
      createdAt: date(),
      updatedAt: date(),
      attempts: 0,
      leaseId: null,
      leaseUntil: null,
      artifactIds: [],
    };
    await this.ensure(owner);
    await this.db.insertIfAbsent(owner, "tasks", task);
    return (await this.db.get<AgentTask>(owner, "tasks", id)) ?? task;
  }
  async control(owner: string, id: string, action: "pause" | "resume" | "cancel" | "retry") {
    const task = await this.getTask(owner, id);
    if (action === "cancel" && task.status === "succeeded")
      throw new AppError("Essa tarefa já está concluída", 409);
    if (action === "retry" && task.status !== "failed")
      throw new AppError("Só é possível repetir tarefas que falharam", 409);
    if (action === "resume" && task.status !== "paused")
      throw new AppError("Só é possível retomar tarefas pausadas", 409);
    if (action === "pause" && (terminal.has(task.status) || task.status === "paused")) return task;
    const status =
      action === "cancel"
        ? "cancelled"
        : action === "pause"
          ? "paused"
          : task.actionId
            ? "waiting_approval"
            : "queued";
    if (action === "retry" && task.actionId) {
      const a = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (a && a.status !== "succeeded")
        throw new AppError(
          "Confira a ação revisada antes de repetir; o resultado dela pode ser incerto. Inicie uma nova tarefa depois de reconciliar.",
          409,
        );
    }
    const updated = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: task.status, leaseId: task.leaseId ?? null },
      {
        status,
        leaseId: null,
        leaseUntil: null,
        error: null,
        updatedAt: date(),
        result:
          action === "cancel"
            ? "Parada por você."
            : action === "pause"
              ? "Pausada. Retome quando quiser."
              : "",
        ...(task.kind === "monitor" && action === "resume"
          ? { state: { ...task.state, failures: 0, notice: null } }
          : {}),
      },
    );
    if (!updated) throw new AppError("A tarefa mudou; atualize e tente de novo", 409);
    this.worker.abort(id);
    if (task.kind === "monitor")
      await this.db.compareAndSwap(
        owner,
        "monitors",
        String(task.input.monitorId),
        {},
        {
          status: action === "cancel" ? "stopped" : action === "pause" ? "paused" : "active",
          nextCheckAt: date(),
        },
      );
    if (action === "cancel" && task.actionId) {
      const proposal = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (proposal?.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
    }
    await this.db.put(owner, "run-events", {
      id: randomUUID(),
      taskId: id,
      kind: "status",
      date: date(),
      title: `Tarefa ${STATUS_PT[status] ?? status}`,
      detail: "Mudado por você",
    });
    return updated;
  }
  async answer(
    owner: string,
    id: string,
    answer: string,
    fields?: Record<string, string | boolean>,
  ) {
    const task = await this.getTask(owner, id);
    if (task.status !== "waiting_input")
      throw new AppError("Essa tarefa não está esperando uma resposta", 409);
    const record: FollowUp = {
      text: answer,
      at: date(),
      answer: true,
      ...(task.question ? { question: task.question } : {}),
    };
    const next = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: "waiting_input" },
      {
        status: "queued",
        question: null,
        input: { ...task.input, ...(fields ? { fields } : {}) },
        state: { ...task.state, answer, followUps: [...followUpsOf(task), record] },
        updatedAt: record.at,
      },
    );
    if (!next) throw new AppError("A tarefa mudou; atualize e tente de novo", 409);
    await this.db.put(owner, "run-events", {
      id: randomUUID(),
      taskId: id,
      kind: "status",
      date: record.at,
      title: "Sua resposta",
      detail: answer,
    });
    return next;
  }
  async createRoutine(owner: string, raw: unknown, id: string = randomUUID()) {
    const input = normalizeSchedule(routineInputSchema.parse(raw), timeZoneOf(this.config));
    const routine: Routine = {
      id,
      ...input,
      nextRunAt: (nextRun(input, new Date()) ?? new Date()).toISOString(),
      createdAt: date(),
    };
    await this.db.insertIfAbsent(owner, "routines", routine);
    return (await this.db.get<Routine>(owner, "routines", id)) ?? routine;
  }
  async updateRoutine(owner: string, id: string, raw: unknown) {
    const routine = await this.db.get<Routine>(owner, "routines", id);
    if (!routine) throw new AppError("Rotina não encontrada", 404);
    const parsed = routineInputSchema.partial().parse(raw);
    // Only what was sent: `partial()` still fills the defaults (days, frequency…) of missing keys,
    // and a pause toggle must not reset the schedule.
    const sent = new Set(Object.keys(raw as object));
    const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => sent.has(key)));
    const next = normalizeSchedule(mergeSchedule(routine, patch), routine.timeZone);
    next.nextRunAt = (nextRun(next, new Date()) ?? new Date()).toISOString();
    return this.db.put(owner, "routines", next);
  }
  async deleteRoutine(owner: string, id: string) {
    if (!(await this.db.take(owner, "routines", id)))
      throw new AppError("Rotina não encontrada", 404);
    return { ok: true };
  }
  /**
   * Starts a routine as a background task. On schedule (`due`), the run is claimed by moving
   * nextRunAt forward first, so two maintenance passes can never start it twice.
   */
  async runRoutine(owner: string, id: string, due = false) {
    const routine = await this.db.get<Routine>(owner, "routines", id);
    if (!routine) throw new AppError("Rotina não encontrada", 404);
    const scheduled = routine.nextRunAt;
    const upcoming = (
      nextRun(routine, new Date()) ?? new Date(Date.now() + 86_400_000)
    ).toISOString();
    if (due) {
      const claimed = await this.db.compareAndSwap<Routine>(
        owner,
        "routines",
        id,
        { nextRunAt: scheduled },
        { nextRunAt: upcoming },
      );
      if (!claimed) return routine;
    }
    // On schedule, a run never starts while the previous one is still going (or waiting on the
    // person): that one finishes first. "Rodar agora" always runs.
    if (due && routine.lastTaskId) {
      const last = await this.db.get<AgentTask>(owner, "tasks", routine.lastTaskId);
      if (last && ["queued", "running", "waiting_input", "waiting_approval"].includes(last.status))
        return routine;
    }
    const when = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: routine.timeZone,
    }).format(new Date());
    const task = await this.createTask(
      owner,
      {
        title: routine.title,
        prompt: `${routine.prompt}\n\n(Rotina "${routine.title}", ${when}. Entregue um resultado curto e útil para ler no celular: o que importa hoje primeiro. ${routine.autoApprove ? AUTO_APPROVE_NOTE : "Nada de enviar, criar ou comprar sem aprovação."})`,
        kind: "agent",
        // The run's task carries the routine's leave to act on its own (routines/auto-approve.ts).
        input: { routineId: id, ...(routine.autoApprove ? { autoApprove: true } : {}) },
      },
      `routine:${id}:${due ? scheduled : date()}`,
    );
    return this.db.put(owner, "routines", {
      ...((await this.db.get<Routine>(owner, "routines", id)) ?? routine),
      lastRunAt: date(),
      lastTaskId: task.id,
    });
  }
  async createGoal(owner: string, raw: unknown, id?: string) {
    const input = goalInputSchema.parse(raw);
    const goal: Goal = {
      id: id ?? randomUUID(),
      title: input.title,
      description: input.description,
      category: input.category,
      status: "active",
      milestones: input.milestones.map((title) => ({ id: randomUUID(), title, done: false })),
      createdAt: date(),
    };
    await this.db.insertIfAbsent(owner, "goals", goal);
    return (await this.db.get<Goal>(owner, "goals", goal.id)) ?? goal;
  }
  async updateGoal(
    owner: string,
    id: string,
    patch: { status?: Goal["status"]; milestones?: Goal["milestones"] },
  ) {
    const goal = await this.db.get<Goal>(owner, "goals", id);
    if (!goal) throw new AppError("Meta não encontrada", 404);
    const saved = await this.db.put(owner, "goals", { ...goal, ...patch });
    if (patch.status === "paused")
      for (const task of await this.db.list<AgentTask>(owner, "tasks"))
        if (task.goalId === id && !terminal.has(task.status) && task.status !== "paused")
          await this.control(owner, task.id, "pause");
    return saved;
  }
  async createMonitor(owner: string, raw: unknown, idempotencyKey?: string) {
    const input = monitorInputSchema.parse(raw);
    const url = new URL(input.url);
    if (url.protocol === "sample:" && this.config.mode !== "sample")
      throw new AppError("Fontes de exemplo não estão disponíveis em workspaces reais", 422);
    if (!["https:", "http:", "sample:"].includes(url.protocol) || url.username || url.password)
      throw new AppError("Use uma página pública HTTP(S)", 422);
    if (url.protocol === "sample:" && input.url !== "sample://availability")
      throw new AppError("Fonte de exemplo desconhecida", 422);
    const id = idempotencyKey ? hash(`monitor:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<Monitor>(owner, "monitors", id);
    if (existing) {
      await this.activateMonitor(owner, existing);
      return existing;
    }
    const task = await this.createTask(
      owner,
      {
        kind: "monitor",
        title: input.title,
        prompt: watchPrompt(input),
        input: { monitorId: id },
      },
      `monitor:${id}`,
      true,
    );
    const monitor: Monitor = {
      id,
      taskId: task.id,
      ...input,
      status: "active",
      nextCheckAt: date(),
      checks: 0,
    };
    await this.db.insertIfAbsent(owner, "monitors", monitor);
    await this.activateMonitor(owner, monitor);
    return monitor;
  }
  private async activateMonitor(owner: string, monitor: Monitor) {
    if (monitor.status !== "active") return;
    const task = await this.getTask(owner, monitor.taskId);
    if (task.status !== "paused" || !task.state.initializingMonitor) return;
    await this.db.compareAndSwap(
      owner,
      "tasks",
      task.id,
      { status: "paused", attempts: 0, state: { initializingMonitor: true } },
      {
        status: "queued",
        state: { ...task.state, initializingMonitor: false },
      },
    );
  }
  async controlMonitor(owner: string, id: string, action: "pause" | "resume" | "stop" | "check") {
    const monitor = await this.db.get<Monitor>(owner, "monitors", id);
    if (!monitor) throw new AppError("Monitor não encontrado", 404);
    if (monitor.status === "stopped" && action !== "stop")
      throw new AppError("Crie um novo monitoramento para reiniciar este monitor parado", 409);
    const status = action === "pause" ? "paused" : action === "stop" ? "stopped" : "active";
    const saved = await this.db.put(owner, "monitors", { ...monitor, status, nextCheckAt: date() });
    const task = await this.getTask(owner, monitor.taskId);
    if (action === "pause" || action === "stop")
      await this.control(owner, task.id, action === "pause" ? "pause" : "cancel");
    else {
      this.worker.abort(task.id);
      await this.db.compareAndSwap(
        owner,
        "tasks",
        task.id,
        { status: task.status, leaseId: task.leaseId ?? null },
        {
          status: "queued",
          nextRunAt: date(),
          leaseId: null,
          leaseUntil: null,
          error: null,
          state: { ...task.state, failures: 0, notice: null },
        },
      );
    }
    return saved;
  }
  async refreshIdeas(owner: string, force = false) {
    const w = await this.workspace.snapshot(owner);
    const sentIds = new Set(
      w.mail.filter((mail) => /^Sent\b/i.test(mail.label)).map((mail) => mail.id),
    );
    const completedSources = new Set(
      (await this.db.list<AgentTask>(owner, "tasks"))
        .filter((task) => task.status === "succeeded" && typeof task.input.messageId === "string")
        .map((task) => `${task.kind}:${task.input.messageId}`),
    );
    const obsolete = (kind: AgentTask["kind"], messageId: unknown) =>
      typeof messageId === "string" &&
      (sentIds.has(messageId) || completedSources.has(`${kind}:${messageId}`));
    // Retire earlier suggestions as well as preventing new duplicates. A concurrent
    // acceptance wins its own compare-and-swap and is never overwritten here.
    for (const idea of await this.db.list<Idea>(owner, "ideas")) {
      if (idea.status === "new" && obsolete(idea.kind, idea.input.messageId))
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          { status: "dismissed" },
        );
      // Nobody decided in time: out of the list (the app already shows it that way).
      else if (isExpired(idea, Date.now()))
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          { status: "expired" },
        );
    }
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("document", m.id) &&
          m.attachments.length &&
          /form|permission|complete|fill|sign/i.test(`${m.subject} ${m.body}`),
      )
      .slice(0, 5)) {
      const id = hash(`document:${mail.id}:${mail.body}`);
      const idea: Idea = {
        id,
        title: `Posso ajudar com ${mail.subject}`,
        reason: `${mail.sender} enviou um documento que pode precisar da sua atenção. Posso prepará-lo e uma resposta para você revisar.`,
        evidence: [this.mailEvidence(mail)],
        prompt: `Help complete the PDF from “${mail.subject}” and prepare a reply for review.`,
        kind: "document",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      };
      await this.db.insertIfAbsent(owner, "ideas", idea);
    }
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("agent", m.id) &&
          /coffee|meet|available|schedule/i.test(`${m.subject} ${m.body}`),
      )
      .slice(0, 5)) {
      await this.db.insertIfAbsent(owner, "ideas", {
        id: hash(`coordination:${mail.id}`),
        title: `Posso ajudar a organizar ${mail.subject}`,
        reason: `${mail.sender} mencionou se encontrar. Posso checar sua agenda e preparar uma resposta para você revisar.`,
        evidence: [this.mailEvidence(mail)],
        prompt: `Review the email “${mail.subject}”, check my calendar, and propose a next step. Ask me about missing preferences before preparing a reply.`,
        kind: "agent",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      } satisfies Idea);
    }
    // Offer a plan only for goals nothing is working on yet (not ones born from an idea's task).
    const tasked = new Set(
      (await this.db.list<AgentTask>(owner, "tasks")).map((task) => task.goalId).filter(Boolean),
    );
    // …and retire plan offers made before a task picked the goal up.
    for (const idea of await this.db.list<Idea>(owner, "ideas"))
      if (
        idea.status === "new" &&
        idea.kind === "plan" &&
        tasked.has(String(idea.input.goalId ?? ""))
      )
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          {
            status: "dismissed",
          },
        );
    for (const goal of await this.db.list<Goal>(owner, "goals"))
      if (goal.status === "active" && !goal.milestones.length && !tasked.has(goal.id)) {
        const id = hash(`goal:${goal.id}:${goal.description}`);
        await this.db.insertIfAbsent(owner, "ideas", {
          id,
          title: `Vamos montar um plano para ${goal.title}`,
          reason: "Essa meta ainda não tem marcos. Um plano concreto vai dar o próximo passo.",
          evidence: [{ id: goal.id, kind: "user", title: goal.title, excerpt: goal.description }],
          prompt: `Create an actionable plan for ${goal.title}. ${goal.description}`,
          kind: "plan",
          input: { goalId: goal.id },
          status: "new",
          createdAt: date(),
        } satisfies Idea);
      }
    await this.ensure(owner);
    await this.db.compareAndSwap(owner, "agent-settings", "identity", {}, { lastIdeasAt: date() });
    await this.smartIdeas(owner, force).catch(async (error) => {
      backgroundFailure("smart ideas", error);
      await this.db.compareAndSwap(
        owner,
        "agent-settings",
        "identity",
        {},
        {
          smartIdeasRun: {
            at: date(),
            error: error instanceof Error ? error.message : String(error),
          },
        },
      );
    });
    return this.db.list<Idea>(owner, "ideas");
  }
  /**
   * Ideas from the person's connected calendar and inbox, drafted by the chat model and
   * filtered by Jev (see ideas.ts). Runs at most every 3 hours unless forced; stale ones retire.
   */
  private async smartIdeas(owner: string, force: boolean) {
    const ask = jevClient();
    const apiKey = process.env.IMPOSSIBL_API_KEY;
    // Tests share the local owner id with a developer's real account: never read real apps there.
    if (!this.composio.enabled || !ask || !apiKey || process.env.NODE_TEST_CONTEXT) return;
    const settings = await this.db.get<{ lastSmartIdeasAt?: string; name?: string }>(
      owner,
      "agent-settings",
      "identity",
    );
    const last = settings?.lastSmartIdeasAt ? Date.parse(settings.lastSmartIdeasAt) : 0;
    if (!force && Date.now() - last < 3 * 3_600_000) return;
    await this.db.compareAndSwap(
      owner,
      "agent-settings",
      "identity",
      {},
      {
        lastSmartIdeasAt: date(),
      },
    );
    const ideas = await this.db.list<Idea>(owner, "ideas");
    // Suggestions about a meeting or an email go stale; retire unanswered ones after two days
    // (a snoozed one waits, and gets its two days again when it comes back).
    for (const idea of ideas)
      if (
        idea.status === "new" &&
        idea.input.source === "smart" &&
        ageOf(idea, Date.now()) > 2 * 86_400_000
      )
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          {
            status: "expired",
          },
        );
    const connections = await this.composio.connections(owner);
    const signals = await gatherSignals({
      run: (slug, args, account) => this.composio.execute(owner, slug, args, undefined, account),
      toolkits: new Set(connections.filter((c) => c.status === "ACTIVE").map((c) => c.toolkit)),
      accounts: connections.filter((c) => c.status === "ACTIVE"),
      sources: await loadIdeaSources(this.db, owner),
      memories: (await activeMemories(this.db, owner)) as AgentMemory[],
      goals: (await this.db.list<Goal>(owner, "goals")).filter((g) => g.status === "active"),
      now: new Date(),
    });
    // Snoozed ideas are still "new": listed as current, so they are not drafted again meanwhile.
    const current = ideas.filter((i) => i.status === "new").map((i) => i.title);
    const dismissed = ideas.filter((i) => i.status === "dismissed").map((i) => i.title);
    const expired = ideas.filter((i) => i.status === "expired").map((i) => i.title);
    const baseUrl = (this.config.impossiblBaseUrl ?? "https://api.impossibl.com/v1").replace(
      /\/+$/,
      "",
    );
    const drafts = await proposeIdeas(
      async (prompt) => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: await this.modelId(owner).catch(
              () => this.config.model ?? configuredImpossiblModel(),
            ),
            reasoning_effort: "none",
            max_tokens: 2000,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`Idea drafting failed (${response.status})`);
        const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        return body.choices?.[0]?.message?.content ?? "";
      },
      {
        signals,
        name: settings?.name ?? "Corgi",
        now: new Date(),
        timeZone: timeZoneOf(this.config),
        current,
        dismissed,
      },
    );
    const bySignal = new Map(signals.map((signal) => [signal.id, signal]));
    const verdicts: Record<string, unknown>[] = [];
    const kept = await filterIdeas(
      ask,
      drafts,
      signals,
      [...current, ...dismissed, ...expired],
      4,
      (v) => verdicts.push(v),
    );
    // What the last run saw and kept, so an empty Ideas tab can be explained.
    const count = (kind: string) => signals.filter((signal) => signal.kind === kind).length;
    await this.db.compareAndSwap(
      owner,
      "agent-settings",
      "identity",
      {},
      {
        smartIdeasRun: {
          at: date(),
          calendar: count("calendar"),
          mail: count("mail"),
          drafts: drafts.length,
          kept: kept.length,
          verdicts,
        },
      },
    );
    for (const idea of kept)
      await this.db.insertIfAbsent(owner, "ideas", {
        id: hash(`smart:${idea.title.toLowerCase()}`),
        title: idea.title,
        reason: idea.reason,
        evidence: idea.signals.flatMap((id) => {
          const signal = bySignal.get(id);
          return signal
            ? [
                {
                  id: `${signal.kind}:${id}`,
                  kind: signal.kind === "mail" ? ("mail" as const) : ("user" as const),
                  title: signal.title,
                  excerpt: signal.detail.slice(0, 300),
                },
              ]
            : [];
        }),
        prompt: idea.prompt,
        kind: "agent",
        input: { source: "smart", score: Math.round(idea.score * 100) / 100 },
        status: "new",
        createdAt: date(),
      } satisfies Idea);
  }
  /** "Agendar para depois": the idea leaves the list until `until`, then comes back as new. */
  async snoozeIdea(owner: string, id: string, until: string) {
    const idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("Ideia não encontrada", 404);
    const snoozedUntil = snoozeInstant(idea, until, Date.now());
    return (
      (await this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        { snoozedUntil },
      )) ?? this.db.get<Idea>(owner, "ideas", id)
    );
  }
  async archiveIdea(owner: string, id: string, archived = true) {
    const idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("Ideia não encontrada", 404);
    return this.db.put(owner, "ideas", { ...idea, archived });
  }
  /** Archives every taken idea whose task has finished, so Ideas shows only what's open. */
  async archiveDoneIdeas(owner: string) {
    const tasks = new Map(
      (await this.db.list<AgentTask>(owner, "tasks")).map((task) => [task.id, task.status]),
    );
    let count = 0;
    for (const idea of await this.db.list<Idea>(owner, "ideas"))
      if (
        idea.status === "accepted" &&
        !idea.archived &&
        idea.taskId &&
        terminal.has(tasks.get(idea.taskId) ?? "")
      ) {
        await this.db.put(owner, "ideas", { ...idea, archived: true });
        count++;
      }
    return { archived: count };
  }
  async decideIdea(
    owner: string,
    id: string,
    action: "accept" | "dismiss" | "restore",
    prompt?: string,
  ) {
    let idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("Ideia não encontrada", 404);
    // Back from the archive, with its days to be decided counted from now.
    if (action === "restore")
      return idea.status === "dismissed" || idea.status === "expired"
        ? this.db.put<Idea>(owner, "ideas", {
            ...idea,
            status: "new",
            snoozedUntil: undefined,
            createdAt: date(),
          })
        : idea;
    if (
      idea.status === "dismissed" ||
      idea.status === "expired" ||
      (idea.status === "accepted" && action === "dismiss")
    )
      return idea;
    if (action === "dismiss")
      return this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        { status: "dismissed" },
      );
    if (idea.status === "new") {
      const claimed = await this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        {
          status: "accepted",
          taskId: hash(`task:idea:${id}`),
          // Ideas saved before sources were attached still cite "m13"-style ids.
          prompt: withSources(
            prompt ?? idea.prompt,
            idea.prompt.includes("Fontes (dados")
              ? []
              : idea.evidence.map((e) => ({ id: e.id, title: e.title, detail: e.excerpt })),
          ),
        },
      );
      idea = claimed ?? (await this.db.get<Idea>(owner, "ideas", id));
      if (idea?.status !== "accepted") return idea;
    }
    // A plan becomes a goal to track; a one-off idea (reply, prepare, check) is just a task.
    const goal =
      idea.kind === "plan"
        ? await this.createGoal(
            owner,
            { title: idea.title, description: idea.reason },
            hash(`idea-goal:${id}`),
          )
        : undefined;
    const task = await this.createTask(
      owner,
      {
        title: idea.title,
        prompt: idea.prompt,
        kind: idea.kind,
        input: idea.input,
        goalId: goal?.id,
      },
      `idea:${id}`,
    );
    await this.db.compareAndSwap(
      owner,
      "ideas",
      id,
      { status: "new" },
      { status: "accepted", taskId: task.id },
    );
    return this.db.get<Idea>(owner, "ideas", id);
  }
  async notify(
    owner: string,
    title: string,
    body: string,
    taskId?: string,
    key?: string,
    card?: ResultCard,
    status?: AgentNotification["status"],
  ) {
    const value: AgentNotification = {
      id: key ? hash(key) : randomUUID(),
      taskId,
      title,
      body,
      ...(card ? { card } : {}),
      ...(status ? { status } : {}),
      createdAt: date(),
      read: false,
    };
    const inserted = await this.db.insertIfAbsent(owner, "notifications", value);
    // New news reaches the phone too (once: a repeated key is the same news).
    const push = inserted && this.push ? pushFor({ title, body, taskId, status, key }) : undefined;
    if (push)
      void this.push?.notify(owner, push).catch((error) => backgroundFailure("push", error));
  }
  /** Set by the app: sends the new notifications to the person's phone. */
  push?: PushService;
  /** Apify scrapers, when the person connected a token (apify/). */
  apify?: ApifyService;
  mailEvidence(mail: Mail): Evidence {
    return { id: mail.id, kind: "mail", title: mail.subject, excerpt: mail.body.slice(0, 400) };
  }
  async artifact(
    owner: string,
    task: AgentTask,
    kind: AgentArtifact["kind"],
    title: string,
    summary: string,
    data: Record<string, unknown>,
    key: string = kind,
  ) {
    const value: AgentArtifact = {
      id: hash(`${task.id}:${key}`),
      taskId: task.id,
      kind,
      title,
      summary,
      data,
      createdAt: date(),
    };
    await this.db.put(owner, "agent-artifacts", value);
    return value;
  }
  async prepare(
    owner: string,
    task: AgentTask,
    input: ProposalInput,
    key: string,
    context: TaskContext,
    guard?: GuardFlag,
    /** App actions the person may "always allow", and whether they already do for this one. */
    allow?: { alwaysAllowable: boolean; autoAllowed: () => Promise<boolean> },
  ) {
    await context.guard();
    // Only actions on the built-in Google connection depend on it; app actions (Composio: Slack,
    // Gmail, Calendar…) carry their own account. "No connection" is the same whether stored as
    // null or read as undefined (comparing the two failed every task action).
    const connection = await this.workspace.connection(owner);
    if (
      input.kind !== "app.action" &&
      (connection?.id ?? null) !== ((task.state.connectionId as string | null | undefined) ?? null)
    )
      throw new AppError(
        "A conexão com o Google mudou durante esta tarefa. Inicie uma nova tarefa usando a conta atual.",
        409,
      );
    const proposal = await this.actions.propose(owner, input, `${task.id}:${key}`, task.id, {
      guard,
      alwaysAllowable: allow?.alwaysAllowable,
    });
    // Already decided (a retry of this same step) or always allowed: the task keeps going.
    if (
      allow &&
      (proposal.status !== "awaiting_review" || (!proposal.guard && (await allow.autoAllowed())))
    ) {
      const done =
        proposal.status === "awaiting_review"
          ? await this.actions.decide(owner, proposal.id, proposal.hash, "approve")
          : proposal;
      await context.event(
        done.status === "succeeded" ? "result" : "error",
        done.title,
        done.status === "succeeded"
          ? "Feito sem perguntar: você sempre permite esta ação"
          : (done.error ?? "A ação não foi concluída"),
      );
      return done;
    }
    try {
      await context.checkpoint({ actionId: proposal.id });
    } catch (error) {
      if (proposal.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
      throw error;
    }
    await context.event(
      "approval",
      proposal.title,
      `Aprovação preparada para ${proposal.account ?? "a conta conectada"}`,
    );
    return proposal;
  }
  private async execute(
    owner: string,
    task: AgentTask,
    context: TaskContext,
  ): Promise<Partial<AgentTask>> {
    // Open-ended work runs as a side chat on the chat engine (see chat-task.ts).
    if (runsAsChat(this, task)) return executeChatTask(this, owner, task, context);
    await context.event(
      "status",
      task.attempts === 1 ? "Comecei" : "Retomei",
      followUpsOf(task).at(-1)?.text ?? task.prompt,
    );
    if (task.actionId) {
      const action = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (!action) throw new Error("A revisão vinculada não foi encontrada");
      if (action.status === "succeeded") {
        await context.event("result", "Ação aprovada executada", action.result);
        if (task.kind === "document")
          return this.finish(task, context, action.result ?? "Resposta concluída");
        task = await context.checkpoint({
          state: { ...task.state, approvalResult: action.result },
          actionId: null,
        });
      } else if (action.status !== "awaiting_review" && action.status !== "executing")
        throw new Error(
          `Ação revisada ${action.status}: ${action.error ?? "Nenhuma outra ação foi tomada"}`,
        );
      else return { status: "waiting_approval" };
    }
    if (task.kind === "document") return this.document(owner, task, context);
    if (task.kind === "monitor") {
      try {
        return await this.observe(owner, task, context);
      } catch (error) {
        if (error instanceof LostLeaseError || context.signal.aborted) throw error;
        await context.guard();
        const failures = Number(task.state.failures ?? 0) + 1;
        const detail = error instanceof Error ? error.message : "Falha ao checar a página";
        const nextCheckAt = new Date(
          Date.now() + Math.min(60, 2 ** failures) * 60000,
        ).toISOString();
        await this.db.compareAndSwap(
          owner,
          "monitors",
          String(task.input.monitorId),
          { status: "active" },
          {
            error: detail,
            nextCheckAt,
            ...(failures >= 5 ? { status: "paused" } : {}),
          },
        );
        await context.event(
          "error",
          failures >= 5
            ? "Acompanhamento pausado depois de várias falhas"
            : "A checagem falhou; vou tentar de novo",
          detail,
        );
        return {
          status: failures >= 5 ? "paused" : "scheduled",
          error: detail,
          nextRunAt: nextCheckAt,
          state: {
            ...task.state,
            failures,
            // A failed check retries on its own; only a paused watch needs the person.
            notice:
              failures >= 5
                ? {
                    title: `Pausei: ${task.title}`,
                    body: `Tentei ${failures} vezes e não consegui checar. Último erro: ${detail}`,
                    key: `watch-error:${task.id}:paused`,
                    status: "blocked",
                  }
                : null,
          },
        };
      }
    }
    if (task.kind === "finance") {
      await context.event("step", "Analisando as transações importadas");
      const csv = z.string().parse(task.input.csv);
      const data = analyzeSpending(csv);
      const artifact = await this.artifact(
        owner,
        task,
        "finance",
        "Controle de gastos",
        `${data.count} transações · ${data.spending.toFixed(2)} gastos`,
        data,
      );
      task = await context.checkpoint({
        artifactIds: [artifact.id],
        evidence: [
          {
            id: task.id,
            kind: "user",
            title: "Seu CSV de transações",
            excerpt: `${data.count} rows; ${data.period.from} through ${data.period.to}`,
          },
        ],
      });
      return this.finish(task, context, artifact.summary);
    }
    return executeModelTask(this, owner, task, context);
  }
  async finish(task: AgentTask, context: TaskContext, result: string) {
    await context.guard();
    await context.event("result", "Concluí", result);
    return {
      status: "succeeded" as const,
      result,
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" as const })),
    };
  }
  private async publishOutcome(owner: string, saved: AgentTask) {
    const task = await this.getTask(owner, saved.id);
    // A task's newest state replaces what it said before ("para revisar" once it was approved).
    if (["succeeded", "failed", "waiting_input", "waiting_approval"].includes(task.status))
      for (const old of await this.db.list<AgentNotification>(owner, "notifications"))
        if (old.taskId === task.id && !old.read)
          await this.db.put(owner, "notifications", { ...old, read: true });
    // A helper's round reports through report_finding (quiet rounds stay quiet).
    if (task.status === "succeeded" && task.input.fuzzyId) {
      /* nothing to announce */
    } else if (task.status === "succeeded") {
      await this.notify(
        owner,
        task.title,
        task.result ?? "Concluído",
        task.id,
        // Each completion is news (a task continues and finishes again after an approval).
        `task-done:${task.id}:${hash(task.result ?? "")}`,
        task.state.card as ResultCard | undefined,
        "done",
      );
      if (task.goalId) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const goal = await this.db.get<Goal>(owner, "goals", task.goalId);
          if (!goal || goal.milestones.some((m) => m.id === task.id)) break;
          if (
            await this.db.compareAndSwap(
              owner,
              "goals",
              goal.id,
              { milestones: goal.milestones },
              {
                milestones: [...goal.milestones, { id: task.id, title: task.title, done: true }],
              },
            )
          )
            break;
        }
      }
    } else if (task.status === "failed") {
      await this.notify(
        owner,
        `Não terminei: ${task.title}`,
        task.error ?? "A tarefa parou com um erro. Abra para ver e tentar de novo.",
        task.id,
        `task-error:${task.id}:${task.attempts}`,
        undefined,
        "blocked",
      );
    } else if (task.status === "waiting_input") {
      await this.notify(
        owner,
        `Preciso de você: ${task.title}`,
        task.question ?? task.title,
        task.id,
        `input:${task.id}:${hash(task.question ?? "")}`,
        undefined,
        "attention",
      );
    } else if (task.status === "waiting_approval") {
      await this.notify(
        owner,
        `Para revisar: ${task.title}`,
        "Preparei algo que precisa da sua aprovação antes de seguir.",
        task.id,
        `review:${task.actionId}`,
        undefined,
        "attention",
      );
    }
    const notice = z
      .object({
        title: z.string(),
        body: z.string(),
        key: z.string(),
        status: z.enum(["done", "attention", "blocked", "update"]).default("update"),
      })
      .safeParse(task.state.notice);
    if ((task.status === "scheduled" || (task.status === "paused" && task.error)) && notice.success)
      await this.notify(
        owner,
        notice.data.title,
        notice.data.body,
        task.id,
        notice.data.key,
        undefined,
        notice.data.status,
      );
  }
  private async document(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    let source = task.state.source as { mail: Mail; fileId: string } | undefined;
    if (!source) {
      const w = await this.workspace.snapshot(owner);
      const mail = w.mail.find((m) => m.id === task.input.messageId);
      if (!mail)
        throw new Error("Escolha um e-mail atual com um anexo PDF para iniciar esta tarefa");
      const ref = mail.attachments[0];
      if (!ref) throw new Error("Este e-mail não tem anexo em PDF");
      await ctx.guard();
      let file: Artifact;
      try {
        file = await this.files.get(owner, ref);
      } catch (error) {
        if (!(error instanceof AppError && error.status === 404)) throw error;
        file = await this.workspace.importAttachment(owner, ref);
      }
      source = { mail, fileId: file.id };
      task = await ctx.checkpoint({
        state: { ...task.state, source },
        evidence: [this.mailEvidence(mail)],
        plan: task.plan.map((s, i) => ({ ...s, status: i === 0 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "Encontrei o documento", file.name);
    }
    const fields = z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .optional()
      .parse(task.input.fields);
    if (!fields || !Object.keys(fields).length) {
      const file = await this.files.get(owner, source.fileId);
      const names = file.fields
        ?.filter((f) => f.type !== "unsupported")
        .map((f) => f.name)
        .join(", ");
      if (!names)
        throw new Error(
          "Este PDF não tem campos preenchíveis suportados. Abra em Arquivos para revisar.",
        );
      return {
        status: "waiting_input",
        question: `Informe os valores do formulário que você quer usar. Campos suportados: ${names}. O PDF original ficará intacto.`,
        state: {
          ...task.state,
          source,
          missingFields: file.fields?.filter((f) => f.type !== "unsupported"),
        },
      };
    }
    let filledId = typeof task.state.filledId === "string" ? task.state.filledId : undefined;
    if (!filledId) {
      await ctx.guard();
      const filled = await this.files.fill(owner, source.fileId, fields);
      filledId = filled.id;
      task = await ctx.checkpoint({
        state: { ...task.state, source, filledId },
        artifactIds: [filledId],
        plan: task.plan.map((s, i) => ({ ...s, status: i <= 1 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "Salvei uma cópia preenchida", filled.name);
    }
    const input: ProposalInput = {
      kind: "email.send",
      data: {
        to: [source.mail.from],
        cc: [],
        bcc: [],
        subject: /^re:/i.test(source.mail.subject)
          ? source.mail.subject
          : `Re: ${source.mail.subject}`,
        body:
          typeof task.input.reply === "string"
            ? task.input.reply
            : "Olá,\n\nSegue em anexo o formulário preenchido.\n\nObrigado.",
        attachmentIds: [filledId],
        threadId: source.mail.threadId,
        replyToMessageId: source.mail.id,
      },
    };
    const proposal = await this.prepare(owner, task, input, "document-reply", ctx);
    return {
      status: "waiting_approval",
      actionId: proposal.id,
      plan: task.plan.map((s, i) => ({
        ...s,
        status: i < 3 ? "succeeded" : i === 3 ? "waiting" : "pending",
      })),
    };
  }
  private async observe(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    const monitor = await this.db.get<Monitor>(owner, "monitors", String(task.input.monitorId));
    if (!monitor) throw new Error("Monitor não encontrado");
    if (monitor.status !== "active")
      return { status: monitor.status === "paused" ? "paused" : "cancelled" };
    let observation: { url: string; title: string; text: string; sessionId?: string };
    if (monitor.url === "sample://availability") {
      if (this.config.mode !== "sample") throw new Error("Fonte de exemplo indisponível");
      const page = await this.db.get<{ text: string }>(owner, "sample-pages", "availability");
      observation = {
        url: monitor.url,
        title: "Disponibilidade de jantar (exemplo)",
        text: page?.text ?? "Sem mesas disponíveis. Confira de novo mais tarde.",
      };
    } else {
      await ctx.guard();
      observation = await this.browser.observe(
        owner,
        monitor.url,
        typeof task.state.sessionId === "string" ? task.state.sessionId : undefined,
      );
      // A watch reads once per interval: close its browser now (profile and cookies are kept).
      if (observation.sessionId)
        await this.browser.close(owner, observation.sessionId).catch(() => undefined);
    }
    const text = observation.text.replace(/\s+/g, " ").trim();
    const currentHash = hash(text);
    const previousHash = monitor.lastHash;
    const matched =
      monitor.condition === "change"
        ? Boolean(previousHash && previousHash !== currentHash)
        : monitor.condition === "contains"
          ? text.toLowerCase().includes(monitor.value.toLowerCase())
          : this.matchesPrice(text, Number(monitor.value));
    const previouslyMatched = Boolean(task.state.matched);
    const shouldNotify = matched && (monitor.condition === "change" || !previouslyMatched);
    const nextCheckAt = new Date(Date.now() + monitor.intervalMinutes * 60000).toISOString();
    await ctx.guard();
    // Worker lease is checked before each publication; monitor control also invalidates that lease.
    const savedMonitor = await this.db.compareAndSwap(
      owner,
      "monitors",
      monitor.id,
      { status: "active" },
      {
        checks: monitor.checks + 1,
        lastCheckedAt: date(),
        lastHash: currentHash,
        lastValue: text.slice(0, 1000),
        nextCheckAt,
        error: null,
      },
    );
    if (!savedMonitor) throw new LostLeaseError();
    await ctx.event(
      "observation",
      previousHash ? "Chequei se mudou" : "Guardei a primeira checagem",
      text.slice(0, 1000),
    );
    if (shouldNotify) {
      await ctx.guard();
      await ctx.event("result", "Encontrei uma mudança relevante", text.slice(0, 500));
    }
    return {
      status: "scheduled",
      nextRunAt: nextCheckAt,
      result: shouldNotify ? "Mudou algo. Te avisei." : "Acompanhando. Checo de novo no horário.",
      state: {
        ...task.state,
        sessionId: observation.sessionId,
        matched,
        failures: 0,
        notice: shouldNotify
          ? {
              title: monitor.title,
              body: `${monitor.condition === "change" ? "Mudou" : "Condição atingida"} em ${observation.url}: ${text.slice(0, 240)}`,
              key: `monitor:${monitor.id}:${currentHash}`,
              status: "update",
            }
          : null,
      },
      error: null,
      evidence: [
        {
          id: monitor.id,
          kind: "web",
          title: observation.title,
          url: observation.url,
          excerpt: text.slice(0, 600),
        },
      ],
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" })),
    };
  }
  private matchesPrice(text: string, threshold: number) {
    const price = mainPrice(text);
    return price !== undefined && price < threshold;
  }
}
