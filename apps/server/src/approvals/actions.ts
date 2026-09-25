import { createHash, randomUUID } from "node:crypto";
import {
  type ActionProposal,
  type CalendarEvent,
  type GuardFlag,
  type ProposalInput,
  proposalSchema,
  usesGoogle,
} from "../../../../packages/domain/src/index.ts";
import { checkoutRefusal } from "../commerce/checkout-policy.ts";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";

interface Options {
  execute: (
    owner: string,
    input: ProposalInput,
    connectionId?: string,
    targetVersion?: string,
  ) => Promise<string>;
  prepare?: (
    owner: string,
    input: ProposalInput,
    connectionId?: string,
  ) => Promise<{
    input: ProposalInput;
    target?: CalendarEvent;
    targetVersion?: string;
  }>;
  connected: (owner: string) => Promise<boolean>;
  connection?: (owner: string) => Promise<{ id: string; account: string } | null>;
  now?: () => number;
}
export class ActionService {
  private readonly now: () => number;
  constructor(
    private readonly db: Store,
    private readonly options: Options,
  ) {
    this.now = options.now ?? Date.now;
  }
  async propose(
    owner: string,
    raw: unknown,
    idempotencyKey?: string,
    taskId?: string,
    review: { guard?: GuardFlag; alwaysAllowable?: boolean } = {},
  ): Promise<ActionProposal> {
    const id =
      idempotencyKey === undefined
        ? randomUUID()
        : createHash("sha256").update(idempotencyKey).digest("hex");
    if (idempotencyKey !== undefined) {
      const existing = await this.db.get<ActionProposal>(owner, "actions", id);
      if (existing) return existing;
    }
    const parsed = proposalSchema.parse(raw);
    // The spending guardrail lives here, not only in the chat tool, so no caller can skip it.
    if (parsed.kind === "browser.checkout") {
      const refusal = checkoutRefusal(parsed.data);
      if (refusal) throw new AppError(refusal, 422);
    }
    // App actions and checkouts do not run through the owner's Google connection.
    const google = usesGoogle(parsed.kind);
    const connection = google ? await this.options.connection?.(owner) : undefined;
    if (google && this.options.connection && !connection)
      throw new AppError("Conecte o Google antes de preparar uma ação", 409);
    const prepared = google
      ? await this.options.prepare?.(owner, parsed, connection?.id)
      : undefined;
    const input = proposalSchema.parse(prepared?.input ?? parsed);
    const title =
      input.kind === "app.action"
        ? input.data.summary
        : input.kind === "browser.checkout"
          ? `Pedido em ${input.data.merchant}${input.data.total ? ` · ${input.data.total}` : ""}`
          : input.kind === "email.send"
            ? `Enviar “${input.data.subject}”`
            : input.kind === "calendar.delete"
              ? `Excluir ${input.data.title}`
              : `${input.kind === "calendar.create" ? "Criar" : "Atualizar"} ${input.data.title}`;
    const createdAt = new Date(this.now()).toISOString();
    const proposal: ActionProposal = {
      id,
      taskId,
      ...(review.guard ? { guard: review.guard } : {}),
      ...(input.kind === "app.action"
        ? { alwaysAllowable: !review.guard && !!review.alwaysAllowable }
        : {}),
      title,
      kind: input.kind,
      data: input.data,
      account: connection?.account,
      connectionId: connection?.id,
      target: prepared?.target,
      targetVersion: prepared?.targetVersion,
      status: "awaiting_review",
      hash: createHash("sha256")
        .update(
          JSON.stringify({
            input,
            connection,
            target: prepared?.target,
            targetVersion: prepared?.targetVersion,
          }),
        )
        .digest("hex"),
      createdAt,
      expiresAt: new Date(this.now() + 30 * 60 * 1000).toISOString(),
    };
    const saved =
      idempotencyKey === undefined
        ? await this.db.put(owner, "actions", proposal)
        : await this.db.insertIfAbsent(owner, "actions", proposal);
    if (!saved) {
      const existing = await this.db.get<ActionProposal>(owner, "actions", id);
      if (!existing) throw new AppError("Não deu para carregar a ação preparada", 409);
      return existing;
    }
    await this.record(owner, saved, "Pronta para sua revisão");
    return saved;
  }
  async decide(
    owner: string,
    id: string,
    hash: string,
    decision: "approve" | "deny",
    options: { acknowledgeRisk?: boolean } = {},
  ): Promise<ActionProposal> {
    const proposal = await this.db.get<ActionProposal>(owner, "actions", id);
    if (!proposal) throw new AppError("Ação não encontrada", 404);
    if (proposal.hash !== hash)
      throw new AppError("Esta proposta mudou. Abra a revisão mais recente antes de decidir.", 409);
    if (proposal.status !== "awaiting_review") return proposal;
    // Looks malicious: one tap is not enough; the person must confirm the warning itself.
    if (decision === "approve" && proposal.guard?.risk === "high" && !options.acknowledgeRisk)
      throw new AppError(
        "Esta ação foi marcada como suspeita. Confirme o alerta para permitir mesmo assim.",
        409,
      );
    if (decision === "approve" && proposal.taskId) {
      const task = await this.db.get<{ status: string }>(owner, "tasks", proposal.taskId);
      // A task that was stopped never acts; one that is waiting, done or chatting may.
      if (!task || ["cancelled", "paused"].includes(task.status))
        throw new AppError(
          "Retome a tarefa antes de aprovar esta ação. Tarefas canceladas não executam.",
          409,
        );
    }
    if (Date.parse(proposal.expiresAt) <= this.now()) {
      const expired = await this.db.compareAndSwap<ActionProposal>(
        owner,
        "actions",
        id,
        { status: "awaiting_review", hash, expiresAt: proposal.expiresAt },
        { status: "expired" },
      );
      if (!expired) {
        const current = await this.db.get<ActionProposal>(owner, "actions", id);
        if (!current) throw new AppError("Ação não encontrada", 404);
        return current;
      }
      throw new AppError("Esta revisão expirou. Crie uma nova proposta.", 409);
    }
    const google = usesGoogle(proposal.kind);
    if (decision === "approve" && google && !(await this.options.connected(owner)))
      throw new AppError("Google está desconectado. Reconecte antes de aprovar esta ação.", 409);
    if (decision === "approve" && google && this.options.connection) {
      const connection = await this.options.connection(owner);
      if (
        !connection ||
        connection.id !== proposal.connectionId ||
        connection.account !== proposal.account
      )
        throw new AppError(
          "A conta ou conexão do Google mudou. Prepare uma nova ação para a conta conectada.",
          409,
        );
    }
    const claimed = await this.db.claim<ActionProposal>(
      owner,
      id,
      decision === "deny" ? "denied" : "executing",
      new Date(this.now()).toISOString(),
    );
    if (!claimed) {
      const current = await this.db.get<ActionProposal>(owner, "actions", id);
      if (!current) throw new AppError("Ação não encontrada", 404);
      return current;
    }
    await this.record(
      owner,
      claimed,
      decision === "deny" ? "Recusada; nenhuma mudança feita" : "Aprovada; execução iniciada",
    );
    if (decision === "deny") return claimed;
    let finished: ActionProposal;
    try {
      const input = proposalSchema.parse({ kind: claimed.kind, data: claimed.data });
      const result = await this.options.execute(
        owner,
        input,
        claimed.connectionId,
        claimed.targetVersion,
      );
      finished = { ...claimed, status: "succeeded", result };
    } catch (error) {
      const unknown =
        error instanceof Error &&
        (("outcomeUnknown" in error && error.outcomeUnknown === true) ||
          ("code" in error && error.code === "outcome_unknown"));
      finished = {
        ...claimed,
        status: unknown ? "outcome_unknown" : "failed",
        error: error instanceof Error ? error.message : "Falha na execução",
      };
    }
    await this.db.put(owner, "actions", finished);
    await this.record(owner, finished, finished.result ?? finished.error ?? finished.status);
    return finished;
  }
  private async record(owner: string, action: ActionProposal, detail: string) {
    await this.db.put(owner, "activity", {
      id: randomUUID(),
      actionId: action.id,
      title: action.title,
      detail,
      date: new Date(this.now()).toISOString(),
      status: action.status,
    });
  }
}
