import { ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { ActionProposal } from "../../../../../packages/domain/src";
import { s } from "../../shared/ui";

/**
 * The trust guard's reason to check an action (server: apps/server/src/trust/guard.ts), shown on
 * every approval surface. "high" (looks like phishing or an attack) is a clear red box. "check"
 * is only a heads-up: one quiet line; "Por quê?" shows the reason and where it came from.
 */
export function GuardNotice({ action }: { action: ActionProposal }) {
  const guard = action.guard;
  const [open, setOpen] = useState(false);
  if (!guard) return null;
  if (guard.risk !== "high")
    return (
      <View style={{ gap: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Por que conferir esta ação"
          onPress={() => setOpen(!open)}
          hitSlop={6}
          style={[s.row, { gap: 6 }]}
        >
          <ShieldCheck size={14} color="#8A6D3B" />
          <Text style={[s.small, { color: "#8A6D3B" }]}>
            Vale conferir antes de permitir ·{" "}
            <Text style={{ fontWeight: "600" }}>{open ? "Ocultar" : "Por quê?"}</Text>
          </Text>
        </Pressable>
        {open && (
          <Text style={[s.small, { marginLeft: 20 }]}>
            {guard.reason}
            {guard.source ? ` Origem: ${guard.source}.` : ""}
          </Text>
        )}
      </View>
    );
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
        padding: 12,
        borderRadius: 14,
        backgroundColor: "#FDECEC",
      }}
    >
      <ShieldAlert size={18} color="#A33A30" style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: "#A33A30" }}>Parece suspeito</Text>
        <Text style={[s.small, { color: "#3B3F44" }]}>{guard.reason}</Text>
        {guard.source ? (
          <Text numberOfLines={1} style={s.small}>
            Origem: {guard.source}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * High-risk actions take two taps: the first arms the button and says why, the second approves
 * with `acknowledgeRisk` (the server refuses the approval without it).
 */
export function useRiskGate(action: ActionProposal | undefined) {
  const [armed, setArmed] = useState(false);
  const high = action?.guard?.risk === "high";
  return {
    high,
    armed,
    /** False on the first tap of a high-risk approval: the caller should stop there. */
    pass() {
      if (!high || armed) return true;
      setArmed(true);
      return false;
    },
    extra: high ? { acknowledgeRisk: true } : {},
    label: (normal: string) => (high && armed ? "Sim, permitir" : normal),
    hint: high && armed ? "Toque de novo só se você reconhece e quer isso." : undefined,
  };
}
