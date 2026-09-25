import { ShoppingCart } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { z } from "zod";
import type { ActionProposal } from "../../../../../packages/domain/src";
import { statusLabel } from "../../shared/format";
import { colors, ErrorNotice, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { GuardNotice, useRiskGate } from "./guard-notice";

const resultSchema = z.object({
  status: z.string(),
  actionId: z.string().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
  total: z.string().optional(),
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

/**
 * The order approval, rendered by the app from the stored proposal (never from model
 * text), so a web page cannot fake it. Allow places the order only if the page is unchanged.
 */
export function CheckoutCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { workspace, api, refresh } = useWorkspace();
  const [busy, setBusy] = useState<"approve" | "deny">();
  const [error, setError] = useState("");
  const value = parse(result);
  const gate = useRiskGate(
    value?.actionId ? workspace.actions.find((item) => item.id === value.actionId) : undefined,
  );
  if (loading)
    return (
      <View style={[s.row, { gap: 8, padding: 12 }]}>
        <ActivityIndicator size="small" color={colors.blueDark} />
        <Text style={s.small}>Preparando o pedido para sua aprovação…</Text>
      </View>
    );
  if (!value) return null;
  if (value.status === "refused" || value.error)
    return <ErrorNotice error={`Pedido não preparado: ${value.reason ?? value.error}`} />;
  const action = workspace.actions.find((item) => item.id === value.actionId);
  if (!action) return null;
  const data = action.data as {
    merchant: string;
    total?: string;
    summary: string;
    button: string;
    screenshot?: string;
  };
  const pending = action.status === "awaiting_review";
  async function decide(decision: "approve" | "deny", current: ActionProposal) {
    if (decision === "approve" && !gate.pass()) return;
    setBusy(decision);
    setError("");
    try {
      await api.request(`/api/actions/${current.id}/decide`, {
        decision,
        hash: current.hash,
        ...(decision === "approve" ? gate.extra : {}),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }
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
      <View style={[s.row, { gap: 10 }]}>
        <ShoppingCart size={20} color={colors.text} />
        <Text style={[s.text, { flex: 1, fontWeight: "600" }]}>
          Corgi quer finalizar um pedido em {data.merchant}
        </Text>
      </View>
      <Text style={s.small}>
        Confira os itens, o endereço e o pagamento na tela da loja antes de permitir.
      </Text>
      {data.screenshot ? (
        <Image
          accessibilityLabel={`Tela final do pedido em ${data.merchant}`}
          source={{ uri: data.screenshot }}
          style={{ width: "100%", aspectRatio: 1.6, borderRadius: 14, backgroundColor: "#F7F8F9" }}
          resizeMode="contain"
        />
      ) : null}
      <Text style={[s.text, { fontSize: 15 }]}>{data.summary}</Text>
      <View style={[s.between, { paddingVertical: 4 }]}>
        <Text style={s.muted}>Total estimado</Text>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          {data.total ?? "—"}
        </Text>
      </View>
      <GuardNotice action={action} />
      {gate.hint ? <Text style={[s.small, { color: "#A33A30" }]}>{gate.hint}</Text> : null}
      <ErrorNotice error={error} />
      {pending ? (
        <View style={[s.row, { gap: 10 }]}>
          <Pressable
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() => void decide("deny", action)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              paddingVertical: 13,
              borderRadius: 16,
              backgroundColor: "#F1F3F4",
              opacity: pressed || busy ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
              {busy === "deny" ? "…" : "Negar"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() => void decide("approve", action)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              paddingVertical: 13,
              borderRadius: 16,
              backgroundColor: "#2F6FE4",
              opacity: pressed || busy ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#FFF" }}>
              {busy === "approve" ? "Finalizando…" : gate.label("Permitir")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text
          style={[s.small, { color: action.status === "succeeded" ? "#2E7A55" : colors.muted }]}
        >
          {action.status === "succeeded"
            ? `Pedido enviado. ${action.result?.slice(0, 160) ?? ""}`
            : action.status === "denied"
              ? "Você negou. Nada foi comprado."
              : action.status === "expired"
                ? "A aprovação expirou. Nada foi comprado."
                : action.status === "failed"
                  ? `Não finalizou: ${action.error ?? "erro"}. Confira o pedido na loja.`
                  : statusLabel(action.status)}
        </Text>
      )}
    </View>
  );
}
