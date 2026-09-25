// What you can do with a message: copy, share, and for the latest turn, try again or edit.
// Long-press any bubble for the menu; the latest answer also shows copy and try-again under it.
import * as Clipboard from "expo-clipboard";
import { Copy, Pencil, RotateCcw, Share2 } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, Share, Text, View } from "react-native";
import { success, tap } from "../../shared/haptics";
import { colors } from "../../shared/ui";

export async function copyText(text: string) {
  await Clipboard.setStringAsync(text);
  success();
}

export type MessageMenuTarget = {
  text: string;
  /** Latest answer: can be asked again. */
  retry?: () => void;
  /** Latest message of the person: back into the composer to change and resend. */
  edit?: () => void;
};

export function MessageMenu({
  target,
  onClose,
}: {
  target?: MessageMenuTarget;
  onClose: () => void;
}) {
  const options = target
    ? [
        { label: "Copiar", icon: Copy, run: () => void copyText(target.text) },
        {
          label: "Compartilhar",
          icon: Share2,
          run: () => void Share.share({ message: target.text }).catch(() => {}),
        },
        ...(target.retry ? [{ label: "Tentar de novo", icon: RotateCcw, run: target.retry }] : []),
        ...(target.edit ? [{ label: "Editar e reenviar", icon: Pencil, run: target.edit }] : []),
      ]
    : [];
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Fechar menu"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "#0B1A2433", justifyContent: "flex-end", padding: 12 }}
      >
        <View style={{ backgroundColor: "#FFF", borderRadius: 24, padding: 8, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 13, padding: 12 }}>
            {target?.text}
          </Text>
          {options.map(({ label, icon: Icon, run }) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                run();
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 14,
                borderRadius: 16,
                backgroundColor: pressed ? colors.sky : "transparent",
              })}
            >
              <Icon size={19} color={colors.text} />
              <Text style={{ fontSize: 16, color: colors.text }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

/** Under the latest answer: copy it, or ask again for a different one. */
export function AnswerActions({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const button = (label: string, Icon: typeof Copy, run: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tap();
        run();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: pressed ? colors.sky : "transparent",
      })}
    >
      <Icon size={15} color={colors.muted} />
      <Text style={{ fontSize: 13, color: colors.muted }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", gap: 2, marginTop: -4, marginLeft: 4 }}>
      {button(copied ? "Copiado" : "Copiar", Copy, () => {
        void copyText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      })}
      {onRetry && button("Tentar de novo", RotateCcw, onRetry)}
    </View>
  );
}
