import { Check, ExternalLink, ShieldCheck, X } from "lucide-react-native";
import { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import type { ActionProposal } from "../../../../../packages/domain/src";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { colors, ErrorNotice, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { actionPhrase, appName, resultLink } from "../chat/action-summary";
import { ChatSendContext } from "../chat/chat-context";
import { GuardNotice, useRiskGate } from "./guard-notice";

const resultSchema = z.object({ status: z.string(), actionId: z.string() });

/** The approval behind a use_app_tool call, if that call prepared a change. */
export function approvalOf(result: unknown) {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  const parsed = resultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Calendar arguments as "qui, 24 set · 09:00–09:30". */
function when(args: Record<string, unknown>) {
  const start = typeof args.start_datetime === "string" ? new Date(args.start_datetime) : undefined;
  if (!start || Number.isNaN(start.getTime())) return undefined;
  const minutes =
    typeof args.event_duration_minutes === "number"
      ? args.event_duration_minutes
      : typeof args.event_duration_hour === "number"
        ? args.event_duration_hour * 60
        : undefined;
  const day = start.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const end = minutes ? new Date(start.getTime() + minutes * 60_000) : undefined;
  return `${day} · ${time(start)}${end ? `–${time(end)}` : ""}`;
}

/**
 * A change the agent prepared in a connected app, approved right in the chat. Rendered from the
 * stored proposal (never from model text). "Sempre permitir" (offered only when the server says
 * the action qualifies: no sends/deletes, nothing the trust guard flagged) lets it run on this
 * account for 30 days; it can be revoked in Apps.
 */
export function ApprovalCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { workspace, api, refresh } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [busy, setBusy] = useState<"approve" | "deny">();
  const [always, setAlways] = useState(false);
  const [error, setError] = useState("");
  // "Instruir outra coisa": decline this and tell the agent what to do instead.
  const send = useContext(ChatSendContext);
  const [instead, setInstead] = useState<string>();
  const name = data?.identity.name || "Corgi";
  const value = approvalOf(result);
  const known = !!value && workspace.actions.some((item) => item.id === value.actionId);
  const gate = useRiskGate(value && workspace.actions.find((item) => item.id === value.actionId));
  // The proposal was just created on the server; fetch it instead of waiting for the next poll.
  useEffect(() => {
    if (value && !known) void refresh();
  }, [value?.actionId, known, refresh]);
  if (loading)
    return (
      <View style={[s.row, { gap: 8, padding: 12 }]}>
        <ActivityIndicator size="small" color={colors.blueDark} />
        <Text style={s.small}>Preparando para sua aprovação…</Text>
      </View>
    );
  const action = value && workspace.actions.find((item) => item.id === value.actionId);
  if (action?.kind !== "app.action") return null;
  const input = action.data as {
    toolkit: string;
    tool: string;
    summary: string;
    arguments: Record<string, unknown>;
    /** Set only when the app has several connected accounts. */
    account?: string;
  };
  const app = appName(input.toolkit);
  const details = [
    typeof input.arguments.summary === "string" ? input.arguments.summary : undefined,
    when(input.arguments),
    typeof input.arguments.subject === "string" ? input.arguments.subject : undefined,
    typeof input.arguments.recipient_email === "string"
      ? `para ${input.arguments.recipient_email}`
      : undefined,
  ].filter(Boolean);
  const link = resultLink(action.result);

  async function decide(decision: "approve" | "deny", current: ActionProposal) {
    if (decision === "approve" && !gate.pass()) return;
    setBusy(decision);
    setError("");
    try {
      await api.request(`/api/actions/${current.id}/decide`, {
        decision,
        hash: current.hash,
        always: decision === "approve" && always && !!current.alwaysAllowable,
        ...(decision === "approve" ? gate.extra : {}),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function instruct(current: ActionProposal, text: string) {
    const words = text.trim();
    if (!words) return;
    setBusy("deny");
    setError("");
    try {
      await api.request(`/api/actions/${current.id}/decide`, {
        decision: "deny",
        hash: current.hash,
      });
      const message = `Não faça "${current.title}". Em vez disso: ${words}`;
      // A task's action: the task gets it (with the denial) and continues on its own; never a
      // second run in the same thread from the chat.
      if (current.taskId)
        await api.request(`/api/agent/tasks/${current.taskId}/follow-up`, { text: message });
      else send?.(message);
      setInstead(undefined);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }
  const done = action.status === "succeeded";
  // A review left open too long can no longer run; the server marks it expired lazily.
  const expired =
    action.status === "expired" ||
    (action.status === "awaiting_review" && Date.parse(action.expiresAt) <= Date.now());
  const pending = action.status === "awaiting_review" && !expired;
  const failed = ["failed", "outcome_unknown"].includes(action.status);
  return (
    <View
      style={{
        maxWidth: 440,
        width: "100%",
        backgroundColor: "#FFF",
        borderRadius: 22,
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: "#ECEEF0",
      }}
    >
      <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
        <ShieldCheck size={20} color={colors.text} style={{ marginTop: 2 }} />
        <Text style={[s.text, { flex: 1, fontWeight: "600" }]}>
          {name} quer {actionPhrase(input.tool).replace(/s$/, "")} no {app}
          {input.account ? ` em ${input.account}` : ""}
        </Text>
      </View>
      <View style={{ backgroundColor: "#F7F8F9", borderRadius: 14, padding: 12, gap: 3 }}>
        <Text style={[s.text, { fontSize: 15 }]}>{input.summary}</Text>
        {details.map((line) => (
          <Text key={String(line)} style={s.small}>
            {String(line)}
          </Text>
        ))}
      </View>
      <GuardNotice action={action} />
      <ErrorNotice error={error} />
      {pending ? (
        <>
          {action.alwaysAllowable && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: always }}
              onPress={() => setAlways(!always)}
              style={[s.row, { gap: 10 }]}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  borderWidth: 1.5,
                  borderColor: always ? "#2F6FE4" : "#C9CDD1",
                  backgroundColor: always ? "#2F6FE4" : "#FFF",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {always && <Check size={14} color="#FFF" />}
              </View>
              <Text style={[s.small, { flex: 1, color: colors.text }]}>
                Sempre permitir {name} {actionPhrase(input.tool)} no {app}
                {input.account ? ` em ${input.account}` : ""} por 30 dias
              </Text>
            </Pressable>
          )}
          {gate.hint ? <Text style={[s.small, { color: "#A33A30" }]}>{gate.hint}</Text> : null}
          <View style={[s.row, { gap: 10 }]}>
            {(["deny", "approve"] as const).map((decision) => (
              <Pressable
                key={decision}
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => void decide(decision, action)}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 13,
                  borderRadius: 16,
                  backgroundColor:
                    decision === "approve" ? (gate.high ? "#A33A30" : "#2F6FE4") : "#F1F3F4",
                  opacity: pressed || busy ? 0.7 : 1,
                })}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: decision === "approve" ? "#FFF" : colors.text,
                  }}
                >
                  {busy === decision
                    ? "…"
                    : decision === "approve"
                      ? gate.label("Permitir")
                      : "Negar"}
                </Text>
              </Pressable>
            ))}
          </View>
          {(send || action.taskId) &&
            (instead === undefined ? (
              <Pressable
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => setInstead("")}
                hitSlop={8}
                style={{ alignSelf: "center" }}
              >
                <Text style={[s.small, { fontWeight: "600", color: colors.blueDark }]}>
                  Instruir outra coisa
                </Text>
              </Pressable>
            ) : (
              <View style={[s.row, { gap: 8 }]}>
                <TextInput
                  autoFocus
                  value={instead}
                  onChangeText={setInstead}
                  placeholder="O que fazer em vez disso?"
                  placeholderTextColor="#949B9F"
                  onSubmitEditing={() => void instruct(action, instead)}
                  style={{
                    flex: 1,
                    fontSize: 15,
                    color: colors.text,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 14,
                    backgroundColor: "#F4F6F7",
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Enviar instrução"
                  disabled={!!busy || !instead.trim()}
                  onPress={() => void instruct(action, instead)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 14,
                    backgroundColor: instead.trim() ? "#2F6FE4" : "#E3E7EA",
                  }}
                >
                  <Text style={{ color: "#FFF", fontWeight: "600" }}>Enviar</Text>
                </Pressable>
              </View>
            ))}
        </>
      ) : (
        <View style={[s.row, { gap: 8 }]}>
          {done ? (
            <Check size={16} color="#3E8E5E" />
          ) : failed || expired || action.status === "denied" ? (
            <X size={16} color={failed ? "#B4493F" : colors.muted} />
          ) : (
            <ActivityIndicator size="small" color={colors.blueDark} />
          )}
          <Text style={[s.small, { flex: 1, color: failed ? "#B4493F" : colors.text }]}>
            {done
              ? "Feito"
              : action.status === "denied"
                ? "Negado · nada foi alterado"
                : expired
                  ? "Expirou sem resposta · peça de novo se ainda quiser"
                  : failed
                    ? action.error || "Não deu certo"
                    : "Executando…"}
          </Text>
          {done && link && (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(link)}
              style={[s.row, { gap: 4 }]}
            >
              <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
                Abrir no {app}
              </Text>
              <ExternalLink size={13} color={colors.blueDark} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
