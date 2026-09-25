// The composer's mic: idle, recording (red, with the time) or transcribing (spinner).
import { Mic, Square } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { colors } from "../../shared/ui";

export function VoiceControl({
  recording,
  transcribing,
  seconds,
  disabled,
  onPress,
}: {
  recording: boolean;
  transcribing: boolean;
  seconds: number;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? "Parar e transcrever" : "Ditar mensagem"}
      disabled={disabled || transcribing}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 44,
        minWidth: 44,
        paddingHorizontal: recording ? 12 : 0,
        flexDirection: "row",
        gap: 6,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 24,
        backgroundColor: recording ? "#FDE8E8" : pressed ? colors.sky : "transparent",
      })}
    >
      {transcribing ? (
        <ActivityIndicator size="small" color={colors.blueDark} />
      ) : recording ? (
        <>
          <Square size={14} fill={colors.danger} strokeWidth={0} />
          <Text style={{ color: colors.danger, fontSize: 14, fontVariant: ["tabular-nums"] }}>
            {`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
          </Text>
        </>
      ) : (
        <Mic size={21} color={disabled ? "#9CB5C5" : colors.text} />
      )}
    </Pressable>
  );
}
