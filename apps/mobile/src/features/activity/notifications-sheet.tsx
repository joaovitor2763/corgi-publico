import { Bell, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText, stamp } from "../../shared/format";
import { Card, colors, Empty, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { isWaiting, resultAtAGlance, waitingTasks } from "../chat/action-summary";
import { StatusDot, WaitingApprovals } from "../chat/action-timeline";

export function NotificationsSheet() {
  const { data, mutate } = useAgentWorkspace();
  const { workspace, close, open } = useWorkspace();
  const [error, setError] = useState("");
  async function read(id: string, taskId?: string) {
    try {
      await mutate(`/notifications/${id}/read`, {});
      if (taskId) open({ type: "task", taskId });
    } catch (e) {
      setError(errorText(e));
    }
  }
  // Same sources as the bell's count: pending reviews, tasks waiting on you, then notifications.
  const now = Date.now();
  const reviews = workspace.actions.filter((a) => isWaiting(a, now));
  const tasks = waitingTasks(data?.tasks || [], workspace.actions, now);
  const notifications = data?.notifications || [];
  return (
    <Sheet
      title="Notificações"
      subtitle="Resultados e decisões que precisam de você."
      onClose={close}
    >
      <View style={{ gap: 16 }}>
        <ErrorNotice error={error} />
        <WaitingApprovals actions={reviews} />
        {tasks.map((task) => (
          <Pressable
            key={task.id}
            accessibilityRole="button"
            onPress={() => open({ type: "task", taskId: task.id })}
          >
            <Card style={{ padding: 14, gap: 2, borderRadius: 18, backgroundColor: "#FFFBF4" }}>
              <View style={[s.row, { gap: 10 }]}>
                <StatusDot tone="waiting" />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text numberOfLines={2} style={[s.text, { fontSize: 14, fontWeight: "500" }]}>
                    {task.question || task.title}
                  </Text>
                  <Text style={s.small}>
                    {task.status === "waiting_approval"
                      ? "Precisa da sua revisão"
                      : "Precisa de você"}{" "}
                    · {task.title}
                  </Text>
                </View>
                <ChevronRight size={14} color={colors.muted} />
              </View>
            </Card>
          </Pressable>
        ))}
        {!!notifications.length && (
          <View style={{ gap: 2 }}>
            {(reviews.length > 0 || tasks.length > 0) && (
              <Text style={[s.label, { fontSize: 9, marginBottom: 4 }]}>Atualizações</Text>
            )}
            {notifications.map((item, i) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => void read(item.id, item.taskId)}
                style={({ pressed }) => [
                  s.row,
                  {
                    gap: 10,
                    paddingVertical: 10,
                    alignItems: "flex-start",
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.line,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={{ paddingTop: 7 }}>
                  <StatusDot tone={item.read ? "muted" : "running"} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  {/* Task results lead with their answer; the task name is secondary. */}
                  <Text
                    numberOfLines={2}
                    style={[s.text, { fontSize: 14, fontWeight: item.read ? "400" : "600" }]}
                  >
                    {item.taskId ? resultAtAGlance(item).headline : item.title}
                  </Text>
                  <Text numberOfLines={1} style={[s.muted, { fontSize: 13, lineHeight: 19 }]}>
                    {item.taskId ? resultAtAGlance(item).subject : item.body}
                  </Text>
                  <Text style={s.small}>
                    {stamp(item.createdAt)}
                    {item.taskId ? " · Ver tarefa" : item.read ? "" : " · Marcar como lida"}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        {!notifications.length && !reviews.length && !tasks.length && (
          <Empty
            icon={Bell}
            title="Tudo em dia"
            detail="Resultados, mudanças importantes e pedidos para você vão aparecer aqui."
          />
        )}
      </View>
    </Sheet>
  );
}
/** The assistant's name and personality; opened from the header's name pill or from Apps. */
