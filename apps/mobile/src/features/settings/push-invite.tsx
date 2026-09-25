// A quiet invitation to turn notifications on (until they are on, or it's dismissed).
import { BellRing, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { pushState } from "../../shared/push";
import { colors, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

const DISMISSED = "corgi.pushInvite.dismissed";

export function PushInvite() {
  const { open } = useWorkspace();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = globalThis.localStorage?.getItem(DISMISSED) === "1";
    } catch {}
    if (dismissed) return;
    void pushState().then((state) => setShow(state === "off" || state === "needs-install"));
  }, []);
  if (!show) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => open({ type: "push" })}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: 20,
        backgroundColor: colors.sky,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BellRing size={19} color={colors.blueDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
          Receba as aprovações no celular
        </Text>
        <Text style={s.small}>Ative as notificações e não perca nada que espera por você</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Agora não"
        hitSlop={10}
        onPress={() => {
          try {
            globalThis.localStorage?.setItem(DISMISSED, "1");
          } catch {}
          setShow(false);
        }}
      >
        <X size={16} color={colors.muted} />
      </Pressable>
    </Pressable>
  );
}
