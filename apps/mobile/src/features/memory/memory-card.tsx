import { Brain, Undo2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { colors, s } from "../../shared/ui";

const TAG_LABELS: Record<string, string> = {
  preference: "preferência",
  person: "pessoa",
  place: "lugar",
  routine: "rotina",
  work: "trabalho",
  health: "saúde",
  finance: "finanças",
  other: "outro",
};
export const tagLabel = (tag?: string) => (tag ? (TAG_LABELS[tag] ?? tag) : undefined);

const resultSchema = z.object({
  saved: z.boolean().optional(),
  reason: z.string().optional(),
  id: z.string().optional(),
  text: z.string().optional(),
  tag: z.string().optional(),
  previous: z.string().optional(),
  forgotten: z.string().optional(),
  error: z.string().optional(),
});

function parse(result: unknown) {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  const parsed = resultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** What the agent remembered, corrected or forgot, with a one-tap undo. */
export function MemoryCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { mutate } = useAgentWorkspace();
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const value = parse(result);
  if (loading || !value) return null;
  const refused = value.saved === false || !!value.error;
  const title = value.forgotten
    ? "Esqueci"
    : refused
      ? "Não guardei"
      : value.previous
        ? "Atualizei"
        : "Lembrei";
  const body = value.forgotten ?? (refused ? (value.reason ?? value.error) : value.text);
  const canUndo = !refused && !value.forgotten && !!value.id && !undone;
  async function undo() {
    if (!value?.id) return;
    setBusy(true);
    try {
      // Undo restores the earlier version of a correction, or forgets a new memory.
      await (value.previous
        ? mutate(`/memories/${value.id}`, { text: value.previous })
        : mutate(`/memories/${value.id}/forget`, {}));
      setUndone(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={[
        s.row,
        {
          alignSelf: "flex-start",
          maxWidth: 440,
          gap: 10,
          paddingHorizontal: 13,
          paddingVertical: 10,
          borderRadius: 16,
          backgroundColor: refused ? "#F4F5F6" : "#F1EEFB",
        },
      ]}
    >
      <Brain size={16} color={refused ? colors.muted : "#6E5BB8"} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ fontSize: 12, fontWeight: "600", color: refused ? colors.muted : "#6E5BB8" }}
        >
          {undone ? "Desfeito" : title}
          {!refused && tagLabel(value.tag) ? ` · ${tagLabel(value.tag)}` : ""}
        </Text>
        {!!body && (
          <Text
            style={{
              fontSize: 14,
              color: colors.text,
              textDecorationLine: undone ? "line-through" : "none",
            }}
          >
            {body}
          </Text>
        )}
      </View>
      {canUndo && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Desfazer"
          disabled={busy}
          onPress={() => void undo()}
          hitSlop={8}
          style={[s.row, { gap: 4, opacity: busy ? 0.5 : 1 }]}
        >
          <Undo2 size={14} color={colors.muted} />
          <Text style={{ fontSize: 12, color: colors.muted }}>Desfazer</Text>
        </Pressable>
      )}
    </View>
  );
}
