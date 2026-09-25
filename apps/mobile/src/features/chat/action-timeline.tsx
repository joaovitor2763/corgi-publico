import { Check, ChevronDown, ChevronRight, Clock3, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { ActionProposal } from "../../../../../packages/domain/src";
import { Button, Card, colors, Empty, ErrorNotice, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import {
  type ActionState,
  actionApp,
  actionParts,
  actionState,
  actionSummary,
  groupByDay,
  isWaiting,
  relativeTime,
  statusState,
  stepDetail,
  type TimelineItem,
  type Tone,
  timelineItems,
} from "./action-summary";

export const toneColors: Record<Tone, { dot: string; tint: string; text: string }> = {
  waiting: { dot: "#E2A23B", tint: colors.orange, text: "#8A5A12" },
  running: { dot: colors.blueDark, tint: colors.sky, text: colors.blueDark },
  done: { dot: "#3F9C61", tint: colors.green, text: "#2D6B43" },
  declined: { dot: "#A6ACB0", tint: "#F1F2F3", text: colors.muted },
  failed: { dot: colors.danger, tint: "#FBEFED", text: colors.danger },
  muted: { dot: "#C4C8CB", tint: "#F1F2F3", text: colors.muted },
};
export function StatusDot({ tone, size = 7 }: { tone: Tone; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: toneColors[tone].dot,
      }}
    />
  );
}
export function StatusPill({ state }: { state: ActionState }) {
  const tone = toneColors[state.tone];
  return (
    <View
      style={[
        s.row,
        {
          gap: 6,
          paddingHorizontal: 9,
          paddingVertical: 4,
          borderRadius: 20,
          alignSelf: "flex-start",
          backgroundColor: tone.tint,
        },
      ]}
    >
      <StatusDot tone={state.tone} size={6} />
      <Text style={{ fontSize: 11, fontWeight: "600", color: tone.text }}>{state.label}</Text>
    </View>
  );
}
const PAGE = 8;
/** Every reviewed action as one row in its current state, grouped by day. */
export function ActionTimeline() {
  const { workspace: w } = useWorkspace();
  const [filter, setFilter] = useState<"all" | "waiting">("all");
  const [limit, setLimit] = useState(PAGE);
  const now = Date.now();
  const waiting = w.actions.filter((a) => isWaiting(a, now)).length;
  const all = timelineItems(w.actions, w.activity).filter(
    (item) => filter === "all" || (item.action && isWaiting(item.action, now)),
  );
  const shown = all.slice(0, limit);
  return (
    <Card style={{ padding: 16, gap: 2 }}>
      <View style={[s.between, { marginBottom: 6 }]}>
        <Text style={[s.heading, { fontSize: 15 }]}>Histórico</Text>
        <View style={[s.row, { gap: 6 }]}>
          <FilterChip label="Tudo" active={filter === "all"} onPress={() => setFilter("all")} />
          <FilterChip
            label={`Aguardando · ${waiting}`}
            active={filter === "waiting"}
            onPress={() => setFilter("waiting")}
          />
        </View>
      </View>
      {groupByDay(shown).map((group) => (
        <View key={group.label}>
          <Text style={[s.label, { fontSize: 9, marginTop: 10, marginBottom: 2 }]}>
            {group.label}
          </Text>
          {group.items.map((item) => (
            <TimelineRow key={item.id} item={item} now={now} />
          ))}
        </View>
      ))}
      {all.length > limit && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setLimit((n) => n + PAGE)}
          style={{ paddingTop: 10, alignSelf: "center" }}
        >
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            Mostrar mais {Math.min(PAGE, all.length - limit)}
          </Text>
        </Pressable>
      )}
      {!all.length && (
        <Empty
          icon={Clock3}
          title={filter === "all" ? "O começo de uma rotina mais leve" : "Tudo em dia por aqui"}
          detail={
            filter === "all"
              ? "Suas ações e os resultados delas vão aparecer aqui."
              : "Quando um e-mail, evento ou mudança em um app precisar da sua aprovação, vai aparecer aqui."
          }
        />
      )}
    </Card>
  );
}
function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 10,
        backgroundColor: active ? colors.sky : "#F1F3F4",
      }}
    >
      <Text
        style={{
          fontSize: 11,
          color: active ? colors.blueDark : colors.muted,
          fontWeight: active ? "600" : "400",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function TimelineRow({ item, now }: { item: TimelineItem; now: number }) {
  const { open } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const { action, entry } = item;
  const state = action ? actionState(action, now) : statusState(entry?.status || "");
  const parts = action ? actionParts(action) : { title: entry?.title || "", detail: "" };
  const meta = action
    ? [actionApp(action), parts.detail].filter(Boolean).join(" · ")
    : entry
      ? stepDetail(entry)
      : "";
  // Loose entries have nothing to open; their full detail unfolds in place when it is long.
  const expandable = !action && !!entry && entry.detail.length > 60 && !/^[[{]/.test(entry.detail);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${parts.title}, ${state.label}`}
      disabled={!action && !expandable}
      onPress={() => (action ? open({ type: "review", action }) : setExpanded((v) => !v))}
      style={({ pressed }) => [
        { paddingVertical: 8, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.row, { gap: 10 }]}>
        <StatusDot tone={state.tone} />
        <View style={{ flex: 1, gap: 1 }}>
          <View style={[s.row, { gap: 8 }]}>
            <Text
              numberOfLines={1}
              style={{ flex: 1, fontSize: 14, color: colors.text, fontWeight: "500" }}
            >
              {parts.title}
            </Text>
            <Text style={s.small}>{relativeTime(item.date, now)}</Text>
          </View>
          <View style={[s.row, { gap: 8 }]}>
            <Text numberOfLines={1} style={[s.small, { flex: 1 }]}>
              {meta}
            </Text>
            <Text style={{ fontSize: 11, fontWeight: "600", color: toneColors[state.tone].text }}>
              {state.label}
            </Text>
          </View>
        </View>
        {action ? (
          <ChevronRight size={14} color={colors.muted} />
        ) : expandable ? (
          <ChevronDown size={14} color={colors.muted} />
        ) : (
          <View style={{ width: 14 }} />
        )}
      </View>
      {expanded && entry && (
        <Text style={[s.small, { marginLeft: 17, marginTop: 4 }]}>{entry.detail}</Text>
      )}
    </Pressable>
  );
}
/** Pending reviews with Permitir/Recusar in place; tapping the text opens the full review. */
export function WaitingApprovals({ actions }: { actions: ActionProposal[] }) {
  const { api, refresh, open } = useWorkspace();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function decide(action: ActionProposal, decision: "approve" | "deny") {
    setBusy(`${action.id}:${decision}`);
    setError("");
    try {
      await api.request<ActionProposal>(`/api/actions/${action.id}/decide`, {
        decision,
        hash: action.hash,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  if (!actions.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.label, { fontSize: 9 }]}>Aguardando você</Text>
      <ErrorNotice error={error} />
      {actions.map((action) => (
        <Card
          key={action.id}
          style={{ padding: 14, gap: 10, borderRadius: 18, backgroundColor: "#FFFBF4" }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Revisar ${action.title}`}
            onPress={() => open({ type: "review", action })}
            style={[s.row, { gap: 10 }]}
          >
            <StatusDot tone="waiting" />
            <View style={{ flex: 1, gap: 1 }}>
              <Text
                numberOfLines={2}
                style={{ fontSize: 14, color: colors.text, fontWeight: "500" }}
              >
                {actionSummary(action)}
              </Text>
              <Text style={s.small}>
                {actionApp(action)} · expira {relativeUntil(action.expiresAt)}
              </Text>
              {action.guard ? (
                <Text
                  numberOfLines={2}
                  style={[s.small, { color: action.guard.risk === "high" ? "#A33A30" : "#8A5A00" }]}
                >
                  ⚠ {action.guard.reason}
                </Text>
              ) : null}
            </View>
            <ChevronRight size={14} color={colors.muted} />
          </Pressable>
          <View style={[s.row, { gap: 8, marginLeft: 17 }]}>
            <Button
              small
              primary
              icon={Check}
              busy={busy === `${action.id}:approve`}
              disabled={!!busy}
              onPress={() =>
                // Suspicious actions are approved only from the full review, with the warning.
                action.guard?.risk === "high"
                  ? open({ type: "review", action })
                  : void decide(action, "approve")
              }
            >
              {action.guard?.risk === "high" ? "Revisar" : "Permitir"}
            </Button>
            <Button
              small
              icon={X}
              busy={busy === `${action.id}:deny`}
              disabled={!!busy}
              onPress={() => void decide(action, "deny")}
            >
              Recusar
            </Button>
          </View>
        </Card>
      ))}
    </View>
  );
}
function relativeUntil(value: string) {
  const minutes = Math.max(1, Math.round((Date.parse(value) - Date.now()) / 60_000));
  return minutes < 60 ? `em ${minutes} min` : `em ${Math.round(minutes / 60)} h`;
}
