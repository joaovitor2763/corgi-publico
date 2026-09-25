import {
  CalendarDays,
  Lightbulb,
  ListChecks,
  Mail,
  Repeat,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
} from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import type { ActionProposal } from "../../../../../packages/domain/src";
import type { AgentTask } from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { kit, More, Panel, Row, Segments, Status, since, type Tone } from "../../shared/kit";
import { useWorkspace } from "../../shared/workspace";
import {
  actionApp,
  actionParts,
  isWaiting,
  resultAtAGlance,
  taskName,
} from "../chat/action-summary";
import { PushInvite } from "../settings/push-invite";

type Filter = "all" | "active" | "done" | "archived";
const ACTIVE = new Set(["queued", "running", "waiting_approval", "waiting_input", "paused"]);

function taskStatus(task: AgentTask): { tone: Tone; label: string } {
  switch (task.status) {
    case "succeeded":
      return { tone: "done", label: "Pronto" };
    case "failed":
      return { tone: "failed", label: "Falhou" };
    case "waiting_approval":
    case "waiting_input":
      return { tone: "attention", label: "Esperando você" };
    case "running":
    case "queued":
      return { tone: "active", label: "Trabalhando" };
    default:
      return { tone: "neutral", label: task.status === "paused" ? "Pausada" : "Cancelada" };
  }
}

function actionStatus(action: ActionProposal, now: number): { tone: Tone; label: string } {
  if (action.status === "awaiting_review")
    return isWaiting(action, now)
      ? { tone: "attention", label: "Aprovar" }
      : { tone: "neutral", label: "Expirou" };
  if (action.status === "succeeded") return { tone: "done", label: "Feito" };
  if (action.status === "denied") return { tone: "neutral", label: "Negado" };
  if (action.status === "executing") return { tone: "active", label: "Executando" };
  if (action.status === "cancelled") return { tone: "neutral", label: "Cancelado" };
  return { tone: "failed", label: "Falhou" };
}

function actionIcon(action: ActionProposal) {
  if (action.kind === "browser.checkout") return ShoppingCart;
  const app = actionApp(action);
  return /calendar/i.test(app) ? CalendarDays : /gmail|mail/i.test(app) ? Mail : ShieldCheck;
}

/**
 * What Corgi did and is doing: what needs you first, then tasks (each led by its result's
 * headline), then changes in your apps. Expired reviews stay folded away.
 */
export function ActivityScreen() {
  const { data } = useAgentWorkspace();
  const { workspace, open, navigate } = useWorkspace();
  const [filter, setFilter] = useState<Filter>("all");
  const [allTasks, setAllTasks] = useState(false);
  const [allActions, setAllActions] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const now = Date.now();

  const waiting = workspace.actions.filter((a) => isWaiting(a, now));
  const tasks = [...(data?.tasks ?? [])]
    // Finished and old tasks are put away (automatically after a few days, or by hand).
    .filter((t) => (filter === "archived" ? !!t.archivedAt : !t.archivedAt))
    .filter(
      (t) =>
        filter === "all" ||
        filter === "archived" ||
        (filter === "active" ? ACTIVE.has(t.status) : !ACTIVE.has(t.status)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const history = [...workspace.actions]
    .filter((a) => !isWaiting(a, now))
    .filter((a) => filter !== "active" || a.status === "executing")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const expired = history.filter((a) => a.status === "awaiting_review" || a.status === "expired");
  const actions = showExpired ? history : history.filter((a) => !expired.includes(a));
  const shownTasks = allTasks ? tasks : tasks.slice(0, 5);
  const shownActions = allActions ? actions : actions.slice(0, 5);

  const ideas = (data?.ideas ?? []).filter((idea) => idea.status === "new");
  return (
    <View style={{ gap: 22 }}>
      {/* Ideas live here: what Corgi offers to do, one tap away. */}
      <Panel>
        <Row
          first
          icon={Lightbulb}
          title={
            ideas.length
              ? `${ideas.length} ${ideas.length === 1 ? "ideia" : "ideias"} para você`
              : "Ideias"
          }
          detail={
            ideas.length
              ? ideas
                  .slice(0, 2)
                  .map((idea) => idea.title)
                  .join(" · ")
              : "O que o Corgi oferece fazer, a partir dos seus apps"
          }
          onPress={() => navigate("ideas")}
        />
      </Panel>
      <Segments
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "Tudo" },
          { value: "active", label: "Ativas" },
          { value: "done", label: "Concluídas" },
          { value: "archived", label: "Arquivo" },
        ]}
      />
      <PushInvite />
      {waiting.length > 0 && filter !== "archived" && (
        <Panel title="Precisa de você">
          {waiting.map((action, index) => {
            const parts = actionParts(action);
            return (
              <Row
                key={action.id}
                first={index === 0}
                icon={actionIcon(action)}
                title={parts.title}
                detail={[actionApp(action), parts.detail].filter(Boolean).join(" · ")}
                trailing={<Status {...actionStatus(action, now)} />}
                onPress={() => open({ type: "review", action })}
              />
            );
          })}
        </Panel>
      )}
      <Panel title="Tarefas">
        {shownTasks.map((task, index) => {
          const note = data?.notifications.find((n) => n.taskId === task.id);
          const result = task.status === "succeeded" && note ? resultAtAGlance(note) : undefined;
          const routine = typeof task.input.routineId === "string";
          const idea = data?.ideas.some((i) => i.taskId === task.id);
          return (
            <Row
              key={task.id}
              first={index === 0}
              icon={routine ? Repeat : idea ? Lightbulb : ListChecks}
              title={result?.headline ?? taskName(task.title)}
              detail={`${result ? `${taskName(task.title)} · ` : ""}${since(task.updatedAt, now)}`}
              trailing={<Status {...taskStatus(task)} />}
              onPress={() => open({ type: "task", taskId: task.id })}
            />
          );
        })}
        {!tasks.length && (
          <Row
            first
            muted
            icon={Sparkles}
            title={
              filter === "active"
                ? "Nada em andamento agora"
                : filter === "done"
                  ? "Nada concluído ainda"
                  : filter === "archived"
                    ? "Nada arquivado. Tarefas terminadas vêm para cá depois de 3 dias"
                    : "Peça algo no chat e o trabalho aparece aqui"
            }
          />
        )}
        <More
          hidden={tasks.length - shownTasks.length}
          expanded={allTasks}
          onPress={() => setAllTasks(!allTasks)}
        />
      </Panel>
      {(actions.length > 0 || expired.length > 0) &&
        filter !== "active" &&
        filter !== "archived" && (
          <Panel title="Nos seus apps">
            {shownActions.map((action, index) => {
              const parts = actionParts(action);
              return (
                <Row
                  key={action.id}
                  first={index === 0}
                  icon={actionIcon(action)}
                  title={parts.title}
                  detail={[actionApp(action), since(action.createdAt, now)].join(" · ")}
                  trailing={<Status {...actionStatus(action, now)} />}
                  onPress={() => open({ type: "review", action })}
                />
              );
            })}
            {!actions.length && (
              <Row first muted icon={ShieldCheck} title="Nenhuma mudança nos seus apps ainda" />
            )}
            <More
              hidden={actions.length - shownActions.length}
              expanded={allActions}
              onPress={() => setAllActions(!allActions)}
            />
            {expired.length > 0 && (
              <Text
                accessibilityRole="button"
                onPress={() => setShowExpired(!showExpired)}
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: kit.accent,
                  textAlign: "center",
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderTopColor: kit.line,
                }}
              >
                {showExpired
                  ? "Esconder expiradas"
                  : `${expired.length} ${expired.length === 1 ? "pedido expirou" : "pedidos expiraram"} sem resposta · mostrar`}
              </Text>
            )}
          </Panel>
        )}
    </View>
  );
}
