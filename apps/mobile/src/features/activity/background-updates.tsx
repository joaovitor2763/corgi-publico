import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  XCircle,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { AgentNotification } from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { MarkdownText } from "../../shared/markdown";
import { colors, ErrorNotice, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { ApprovalCard } from "../approvals/approval-card";
import { resultAtAGlance } from "../chat/action-summary";
import { aboutTask } from "../chat/attachments";

/** Older reports use "• " lines and blank-line padding; make them real, tight list items. */
const tidy = (text: string) =>
  text
    .replace(/^\s*•\s*/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** "agora", "há 14 min", "há 3 h", "ontem", "12 set". */
function since(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60) return `há ${Math.round(minutes / 60)} h`;
  if (minutes < 48 * 60) return "ontem";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

const STATUS = {
  done: { icon: CheckCircle2, color: "#3E8E5E", label: "Terminou" },
  attention: { icon: AlertCircle, color: "#B7791F", label: "Precisa de você" },
  blocked: { icon: XCircle, color: "#B4493F", label: "Não consegui terminar" },
  update: { icon: BellRing, color: colors.blueDark, label: "Novidade" },
} as const;

/**
 * The newest finished background task, announced in the chat as a small closed card: what
 * finished, then "Ver aqui" (opens the result right in the chat) or "Ignorar" (leaves the chat;
 * it stays in Activity). Never the full report by default, so results don't take over the thread.
 */
export function BackgroundUpdates({ onAsk }: { onAsk?: (text: string) => void }) {
  const { data, mutate } = useAgentWorkspace();
  const updates = data?.notifications.filter((item) => !item.read && item.taskId) || [];
  const update = updates[0];
  if (!update || data?.identity.showChatUpdates === false) return null;
  return (
    <TaskUpdateCard
      key={update.id}
      notification={update}
      more={updates.length - 1}
      onDismiss={() => mutate(`/notifications/${update.id}/read`, {})}
      onAsk={onAsk}
    />
  );
}

function TaskUpdateCard({
  notification,
  more,
  onDismiss,
  onAsk,
}: {
  notification: AgentNotification;
  more: number;
  onDismiss: () => Promise<unknown>;
  onAsk?: (text: string) => void;
}) {
  const { open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const result = resultAtAGlance(notification);
  const task = data?.tasks.find((item) => item.id === notification.taskId);
  // Still waiting on this card's question or approval (the task hasn't moved on since).
  const approval = task?.status === "waiting_approval" && task.actionId ? task.actionId : undefined;
  const asking = task?.status === "waiting_input";
  const taskTitle = task?.title || result.subject || notification.title;
  const status = STATUS[result.status] ?? STATUS.done;
  const Icon = status.icon;
  async function dismiss() {
    try {
      await onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const link = { fontSize: 13, color: colors.blueDark, fontWeight: "600" as const };
  return (
    <View
      style={{
        alignSelf: "flex-start",
        width: "95%",
        maxWidth: 520,
        backgroundColor: "#FFF",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "#ECEEF0",
        paddingHorizontal: 14,
        paddingVertical: 11,
        gap: 6,
      }}
    >
      <View style={[s.row, { gap: 7 }]}>
        <Icon size={15} color={status.color} />
        <Text style={[s.small, { flex: 1, color: status.color, fontWeight: "600" }]}>
          {status.label}
          <Text style={{ color: colors.muted, fontWeight: "400" }}>
            {" "}
            · {since(notification.createdAt)}
          </Text>
        </Text>
      </View>
      <Text
        numberOfLines={expanded ? undefined : 2}
        style={{ fontSize: 15, fontWeight: "600", color: colors.text }}
      >
        {result.headline}
      </Text>
      {/* Approve or deny right here; the task continues on its own afterwards. */}
      {approval && (
        <ApprovalCard result={{ status: "waiting_approval", actionId: approval }} loading={false} />
      )}
      {expanded && (
        <>
          {!!result.subject && <Text style={s.small}>{result.subject}</Text>}
          {result.highlights.map((line) => (
            <View key={line} style={[s.row, { gap: 7, alignItems: "flex-start" }]}>
              <Text style={[s.small, { color: colors.text }]}>•</Text>
              <Text style={[s.small, { flex: 1, color: colors.text, lineHeight: 19 }]}>{line}</Text>
            </View>
          ))}
          {!!result.details && (
            <ScrollView
              style={{ maxHeight: 220, backgroundColor: "#F7F8F9", borderRadius: 12 }}
              contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
              nestedScrollEnabled
            >
              <MarkdownText compact>{tidy(result.details)}</MarkdownText>
            </ScrollView>
          )}
          {result.next.length > 0 && onAsk && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
              {result.next.map((step) => (
                <Pressable
                  key={step}
                  accessibilityRole="button"
                  accessibilityHint="Pede isso no chat, sobre esta tarefa"
                  // The task travels with the words, so the chat steers this task instead of
                  // guessing from a one-line summary.
                  onPress={() =>
                    onAsk(
                      notification.taskId
                        ? aboutTask(step, { title: taskTitle, id: notification.taskId })
                        : `${step} (sobre: ${result.subject})`,
                    )
                  }
                  style={({ pressed }) => ({
                    maxWidth: "100%",
                    flexShrink: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 16,
                    backgroundColor: pressed ? "#DEE9FA" : "#EEF4FD",
                  })}
                >
                  <Text numberOfLines={2} style={[link, { lineHeight: 18 }]}>
                    {step}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
      <View style={[s.row, { gap: 18, marginTop: 2 }]}>
        {notification.taskId && (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              notification.taskId && open({ type: "task", taskId: notification.taskId })
            }
            hitSlop={6}
          >
            <Text style={link}>{asking ? "Responder" : "Abrir conversa"}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          style={[s.row, { gap: 3 }]}
          hitSlop={6}
        >
          <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
            {expanded ? "Fechar" : "Ver aqui"}
          </Text>
          {expanded ? (
            <ChevronUp size={14} color={colors.text} />
          ) : (
            <ChevronDown size={14} color={colors.text} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ignorar por enquanto; continua em Atividade"
          onPress={() => void dismiss()}
          hitSlop={6}
        >
          <Text style={[s.small, { fontWeight: "600" }]}>Ignorar</Text>
        </Pressable>
        {more > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => open({ type: "notifications" })}
            hitSlop={6}
          >
            <Text style={s.small}>+{more}</Text>
          </Pressable>
        )}
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}
