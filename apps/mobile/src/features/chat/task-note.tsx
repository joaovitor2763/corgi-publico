// A task's side chat: the header naming the task and where it stands, and the worker's own
// messages (start, "aprovada e executada…") shown as small notes instead of the person's words.
import { CornerDownRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { Fuzzy } from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { statusLabel } from "../../shared/format";
import { colors, s } from "../../shared/ui";
import { noteText } from "./task-note-text";
import { planProgress } from "./todo-progress";

export { TASK_NOTE } from "./task-note-text";

export function TaskNote({ text }: { text: string }) {
  return (
    <View style={[s.row, { gap: 6, alignSelf: "center", maxWidth: "92%", paddingVertical: 2 }]}>
      <CornerDownRight size={13} color={colors.muted} />
      <Text numberOfLines={4} style={[s.small, { flexShrink: 1, textAlign: "center" }]}>
        {noteText(text)}
      </Text>
    </View>
  );
}

const ACTIVE = new Set(["queued", "running", "scheduled", "waiting_input", "waiting_approval"]);

/** Above a helper's chat: who it is and what it does; the current round, if any. */
function FuzzyThreadHeader({ fuzzy }: { fuzzy: Fuzzy }) {
  const { data } = useAgentWorkspace();
  const last = data?.tasks.find((item) => item.id === fuzzy.lastTaskId);
  const working = last && ACTIVE.has(last.status);
  return (
    <View style={{ alignItems: "center", gap: 2, marginBottom: 8, paddingHorizontal: 12 }}>
      <Text
        numberOfLines={1}
        style={[s.small, { fontWeight: "600", color: colors.text, maxWidth: "100%" }]}
      >
        {fuzzy.emoji} {fuzzy.name} · ajudante
      </Text>
      <Text numberOfLines={1} style={[s.small, { maxWidth: "100%" }]}>
        {working ? statusLabel(last.status) : fuzzy.mission}
      </Text>
    </View>
  );
}

/** Above a task's side chat: which task, its state, and a way to stop it. */
export function TaskThreadHeader({ threadId }: { threadId: string }) {
  const { data, mutate } = useAgentWorkspace();
  const fuzzy = data?.fuzzies?.find((item) => item.threadId === threadId);
  const task = data?.tasks.find((item) => item.state.threadId === threadId);
  if (fuzzy) return <FuzzyThreadHeader fuzzy={fuzzy} />;
  if (!task) return null;
  const progress = planProgress(task.plan);
  const tone =
    task.status === "waiting_input" || task.status === "waiting_approval"
      ? "#B7791F"
      : task.status === "failed"
        ? colors.danger
        : task.status === "succeeded"
          ? "#3E8E5E"
          : colors.blueDark;
  return (
    // Fits the screen: every line shrinks within the width, the current step on its own line.
    <View style={{ alignItems: "center", gap: 2, marginBottom: 8, paddingHorizontal: 12 }}>
      <Text
        numberOfLines={1}
        style={[s.small, { fontWeight: "600", color: colors.text, maxWidth: "100%" }]}
      >
        Tarefa · {task.title}
      </Text>
      <View style={[s.row, { gap: 12, maxWidth: "100%" }]}>
        <Text numberOfLines={1} style={[s.small, { color: tone, flexShrink: 1 }]}>
          {statusLabel(task.status)}
          {progress.total > 0 ? ` · ${progress.done}/${progress.total} etapas` : ""}
        </Text>
        {!ACTIVE.has(task.status) && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() =>
              void mutate(`/tasks/${task.id}/archive`, { archived: !task.archivedAt }).catch(
                () => {},
              )
            }
          >
            <Text style={[s.small, { fontWeight: "600" }]}>
              {task.archivedAt ? "Restaurar" : "Arquivar"}
            </Text>
          </Pressable>
        )}
        {ACTIVE.has(task.status) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Parar esta tarefa"
            hitSlop={8}
            onPress={() =>
              void mutate(`/tasks/${task.id}/control`, { action: "cancel" }).catch(() => {})
            }
          >
            <Text style={[s.small, { fontWeight: "600" }]}>Parar</Text>
          </Pressable>
        )}
      </View>
      {!!progress.current && (
        <Text numberOfLines={1} style={[s.small, { maxWidth: "100%" }]}>
          Agora: {progress.current}
        </Text>
      )}
    </View>
  );
}
