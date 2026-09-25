import { ArrowRight, CircleDollarSign, Eye, Heart, Plus, Target, Users } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import type { Goal, Monitor } from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText, stamp, statusLabel } from "../../shared/format";
import { More, Panel, Progress, Row } from "../../shared/kit";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  colors,
  ErrorNotice,
  Field,
  Sheet,
  s,
} from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { TaskCard } from "../activity/tasks";
import { taskName } from "../chat/action-summary";
import { RoutinesSection } from "../routines/routines";

function TaskLink({ taskId, onOpen }: { taskId: string; onOpen?: () => void }) {
  const { open } = useWorkspace();
  return (
    <Button
      small
      icon={ArrowRight}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId });
      }}
    >
      Ver tarefa
    </Button>
  );
}
export function GoalsScreen() {
  const { data } = useAgentWorkspace();
  const { open } = useWorkspace();
  const fuzzies = data?.fuzzies ?? [];
  const [adding, setAdding] = useState<string>();
  const [selectedGoal, setSelectedGoal] = useState<string>();
  const [selectedMonitor, setSelectedMonitor] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const goal = data?.goals.find((item) => item.id === selectedGoal);
  const monitor = data?.monitors.find((item) => item.id === selectedMonitor);
  const monitors = data?.monitors || [];
  return (
    <View style={{ gap: 26 }}>
      <Panel
        title="Ajudantes"
        action="Abrir"
        actionIcon={Users}
        onAction={() => open({ type: "fuzzies" })}
      >
        {fuzzies.map((fuzzy, index) => (
          <Row
            key={fuzzy.id}
            first={index === 0}
            icon={Users}
            title={`${fuzzy.emoji} ${fuzzy.name}`}
            detail={
              fuzzy.status === "paused" ? "Pausado" : (fuzzy.lastFinding?.headline ?? fuzzy.mission)
            }
            onPress={() => open({ type: "fuzzies" })}
          />
        ))}
        {!fuzzies.length && (
          <Row
            first
            muted
            icon={Users}
            title="Crie um ajudante"
            detail="Radar, Preparador de reuniões, Concorrentes…"
            onPress={() => open({ type: "fuzzies" })}
          />
        )}
      </Panel>
      <RoutinesSection />
      <Panel title="Acompanhando" action="Nova" onAction={() => setAdding("Tracking")}>
        {(showAll ? monitors : monitors.slice(0, 4)).map((item, index) => (
          <Row
            key={item.id}
            first={index === 0}
            icon={Eye}
            title={item.title}
            label={`Abrir acompanhamento: ${item.title}`}
            detail={
              item.status === "active"
                ? `Verificando a cada ${item.intervalMinutes} min`
                : statusLabel(item.status)
            }
            onPress={() => setSelectedMonitor(item.id)}
          />
        ))}
        {!monitors.length && (
          <Row
            first
            muted
            icon={Eye}
            title="Um preço, um ingresso ou uma página para vigiar"
            onPress={() => setAdding("Tracking")}
          />
        )}
        <More
          hidden={monitors.length - Math.min(monitors.length, 4)}
          expanded={showAll}
          onPress={() => setShowAll(!showAll)}
        />
      </Panel>
      <Panel title="Metas" action="Nova" onAction={() => setAdding("Something else")}>
        {data?.goals.map((item, index) => {
          const done = item.milestones.filter((m) => m.done).length;
          return (
            <Row
              key={item.id}
              first={index === 0}
              icon={Target}
              title={taskName(item.title)}
              label={`Abrir meta: ${item.title}`}
              detail={
                item.status === "completed"
                  ? "Concluída"
                  : item.milestones.length
                    ? `${done} de ${item.milestones.length} passos`
                    : "Sem plano ainda"
              }
              onPress={() => setSelectedGoal(item.id)}
            >
              {item.milestones.length > 0 && item.status !== "completed" && (
                <Progress value={done / item.milestones.length} />
              )}
            </Row>
          );
        })}
        {[
          { name: "Health", label: "Uma meta de saúde", icon: Heart },
          { name: "Finances", label: "Uma meta de finanças", icon: CircleDollarSign },
        ]
          .filter(() => (data?.goals.length ?? 0) < 3)
          .map((item, index) => (
            <Row
              key={item.name}
              first={!data?.goals.length && index === 0}
              muted
              icon={item.icon}
              title={item.label}
              label={`Criar ${item.label.toLowerCase()}`}
              onPress={() => setAdding(item.name)}
              trailing={<Plus size={16} color="#B3B8BC" />}
            />
          ))}
      </Panel>
      {adding && (
        <Sheet
          title={adding === "Tracking" ? "Acompanhar algo" : "Criar meta"}
          onClose={() => setAdding(undefined)}
        >
          {adding === "Tracking" ? (
            <MonitorForm onDone={() => setAdding(undefined)} />
          ) : (
            <GoalForm category={adding} onDone={() => setAdding(undefined)} />
          )}
        </Sheet>
      )}
      {goal && (
        <Sheet title={goal.title} onClose={() => setSelectedGoal(undefined)}>
          <GoalCard goal={goal} onOpenTask={() => setSelectedGoal(undefined)} />
        </Sheet>
      )}
      {monitor && (
        <Sheet title={monitor.title} onClose={() => setSelectedMonitor(undefined)}>
          <MonitorCard monitor={monitor} onOpenTask={() => setSelectedMonitor(undefined)} />
        </Sheet>
      )}
    </View>
  );
}
function GoalForm({ onDone, category }: { onDone: () => void; category?: string }) {
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("/goals", {
        title: title.trim(),
        category,
        description,
        milestones: milestones
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="Sua meta"
        value={title}
        onChangeText={setTitle}
        placeholder="Juntar uma reserva de três meses"
      />
      <Field
        label="Como vai ser quando der certo?"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Field
        label="Passos (um por linha)"
        value={milestones}
        onChangeText={setMilestones}
        multiline
      />
      <ErrorNotice error={error} />
      <Button primary disabled={!title.trim()} busy={busy} onPress={() => void save()}>
        Criar meta
      </Button>
    </Card>
  );
}
function GoalCard({ goal, onOpenTask }: { goal: Goal; onOpenTask?: () => void }) {
  const { data, mutate, delegate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = goal.milestones.filter((item) => item.done).length;
  async function update(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/goals/${goal.id}`, body);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function plan() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        title: `Plano: ${goal.title}`,
        prompt: `Monte um plano prático para esta meta: ${goal.title}. ${goal.description}`,
        kind: "plan",
        goalId: goal.id,
        input: {},
      });
      onOpenTask?.();
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{goal.title}</Text>
        <Chip tint={goal.status === "completed" ? colors.green : colors.sky}>
          {statusLabel(goal.status)}
        </Chip>
      </View>
      <Text style={s.muted}>{goal.description}</Text>
      <Text style={s.small}>
        {done} de {goal.milestones.length} passos
      </Text>
      {goal.milestones.map((milestone) => (
        <CheckRow
          key={milestone.id}
          checked={milestone.done}
          label={milestone.title}
          onPress={() => {
            if (!busy)
              void update({
                milestones: goal.milestones.map((item) =>
                  item.id === milestone.id ? { ...item, done: !item.done } : item,
                ),
              });
          }}
        />
      ))}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          busy={busy}
          onPress={() => void update({ status: goal.status === "active" ? "paused" : "active" })}
        >
          {goal.status === "active" ? "Pausar" : "Retomar"}
        </Button>
        {goal.status !== "completed" && (
          <Button small busy={busy} onPress={() => void update({ status: "completed" })}>
            Concluir meta
          </Button>
        )}
        <Button small primary busy={busy} onPress={() => void plan()}>
          Planejar próximos passos
        </Button>
      </View>
      {data?.tasks
        .filter((task) => task.goalId === goal.id)
        .map((task) => (
          <TaskCard key={task.id} task={task} compact onOpen={onOpenTask} />
        ))}
    </Card>
  );
}
function MonitorForm({ onDone }: { onDone: () => void }) {
  const { workspace } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [condition, setCondition] = useState<Monitor["condition"]>("change");
  const [value, setValue] = useState("");
  const [interval, setInterval] = useState(360);
  const [sample, setSample] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const minutes = interval;
      if (!sample && !/^https?:\/\//i.test(url.trim()))
        throw new Error("Informe um endereço http ou https de uma página pública.");
      await mutate("/monitors", {
        title: title.trim(),
        url: sample ? "sample://availability" : url.trim(),
        condition,
        value,
        intervalMinutes: minutes,
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="O que você quer acompanhar?"
        value={title}
        onChangeText={setTitle}
        placeholder="Uma mesa no meu restaurante favorito"
      />
      {workspace.mode === "sample" && workspace.runtime.sampleData !== false && (
        <CheckRow
          checked={sample}
          label="Testar com a página de exemplo"
          onPress={() => setSample(!sample)}
        />
      )}
      {!sample && (
        <Field
          label="URL da página pública"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          placeholder="https://exemplo.com/produto"
        />
      )}
      <Text style={[s.small, { marginBottom: 10 }]}>Me avise quando</Text>
      <View style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}>
        {(["change", "contains", "price_below"] as const).map((item) => (
          <Button small primary={condition === item} key={item} onPress={() => setCondition(item)}>
            {item === "change"
              ? "A página mudar"
              : item === "contains"
                ? "Um texto aparecer"
                : "O preço cair abaixo de"}
          </Button>
        ))}
      </View>
      {condition !== "change" && (
        <Field
          label={condition === "contains" ? "Texto a procurar" : "Preço-alvo"}
          value={value}
          onChangeText={setValue}
        />
      )}
      <Text style={[s.small, { marginBottom: 10 }]}>Olhar a página</Text>
      <View style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}>
        {(
          [
            [60, "A cada hora"],
            [360, "A cada 6 horas"],
            [1440, "Uma vez por dia"],
          ] as const
        ).map(([minutes, label]) => (
          <Button
            small
            primary={interval === minutes}
            key={minutes}
            onPress={() => setInterval(minutes)}
          >
            {label}
          </Button>
        ))}
      </View>
      <Text style={[s.small, { marginBottom: 14 }]}>
        {sample
          ? "As mudanças nesta página de exemplo ficam no seu espaço."
          : "O Corgi verifica esta página no servidor e guarda as mudanças importantes em Notificações."}
      </Text>
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !title.trim() || (!sample && !url.trim()) || (condition !== "change" && !value.trim())
        }
        onPress={() => void save()}
      >
        Começar a acompanhar
      </Button>
    </Card>
  );
}
function MonitorCard({ monitor, onOpenTask }: { monitor: Monitor; onOpenTask?: () => void }) {
  const { mutate } = useAgentWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/monitors/${monitor.id}/control`, { action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeSample() {
    setBusy(true);
    setError("");
    try {
      await mutate("/sample-page", {
        text: `Disponibilidade: há uma mesa livre. Atualizado em ${new Date().toISOString()}`,
      });
      await mutate(`/monitors/${monitor.id}/control`, { action: "check" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 13 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{monitor.title}</Text>
        <Chip tint={colors.sky}>{statusLabel(monitor.status)}</Chip>
      </View>
      <Text selectable style={s.small}>
        {monitor.url.startsWith("sample:") ? "Página de exemplo" : monitor.url}
      </Text>
      <Text style={s.text}>
        {monitor.condition === "change"
          ? "Avisa quando a página mudar"
          : monitor.condition === "contains"
            ? `Avisa quando aparecer “${monitor.value}”`
            : `Preço abaixo de ${monitor.value}`}
      </Text>
      <Text style={s.small}>
        A cada {monitor.intervalMinutes} min · {monitor.checks} verificações
      </Text>
      <Text style={s.small}>
        Última verificação: {stamp(monitor.lastCheckedAt)}
        {monitor.status === "active" ? `\nPróxima: ${stamp(monitor.nextCheckAt)}` : ""}
      </Text>
      {monitor.lastValue && (
        <Text selectable numberOfLines={5} style={s.muted}>
          {monitor.lastValue}
        </Text>
      )}
      <ErrorNotice error={error || monitor.error} />
      {monitor.status !== "stopped" && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button
            small
            busy={busy}
            onPress={() => void act(monitor.status === "active" ? "pause" : "resume")}
          >
            {monitor.status === "active" ? "Pausar" : "Retomar"}
          </Button>
          <Button small busy={busy} onPress={() => void act("check")}>
            Verificar agora
          </Button>
          <Button small danger busy={busy} onPress={() => void act("stop")}>
            Parar de acompanhar
          </Button>
        </View>
      )}
      {monitor.url.startsWith("sample:") && monitor.status !== "stopped" && (
        <Button small busy={busy} onPress={() => void changeSample()}>
          Mudar disponibilidade
        </Button>
      )}
      <TaskLink taskId={monitor.taskId} onOpen={onOpenTask} />
    </Card>
  );
}
