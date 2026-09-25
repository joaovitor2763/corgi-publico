import { ArrowUpRight, Check, ChevronRight, type LucideIcon, X } from "lucide-react-native";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
export const colors = {
  canvas: "#FCFCFC",
  card: "#FFFFFF",
  text: "#11191C",
  muted: "#697176",
  line: "#EEEEF0",
  blue: "#C8E7FF",
  blueDark: "#1473C8",
  sky: "#EDF7FD",
  green: "#E3F3E8",
  lavender: "#F0EEFA",
  orange: "#FDF0DF",
  danger: "#AA4A45",
};
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  text: { color: colors.text, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: { color: colors.text, fontSize: 23, fontWeight: "600", letterSpacing: -0.7 },
  heading: { color: colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.25 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 23,
    borderWidth: 0,
    borderColor: colors.line,
    padding: 20,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 19,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    backgroundColor: "#FFF",
    minHeight: 45,
  },
  field: { gap: 7, marginBottom: 16 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 17,
    minHeight: 42,
    paddingVertical: 10,
    borderRadius: 24,
  },
  primary: { backgroundColor: colors.blue },
  secondary: { backgroundColor: "#F1F2F3" },
  buttonText: { fontSize: 14, fontWeight: "600" },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
    backgroundColor: colors.canvas,
  },
  chipText: { fontSize: 10, fontWeight: "600", color: colors.muted },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.sky,
  },
  error: { padding: 16, borderRadius: 14, backgroundColor: "#FBEFED", marginVertical: 10, gap: 4 },
  modalShade: {
    flex: 1,
    backgroundColor: "rgba(35,48,44,0.25)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderRadius: 26,
    width: "100%",
    maxWidth: 790,
    maxHeight: "94%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
});
export function Button({
  children,
  onPress,
  icon: Icon,
  primary,
  disabled,
  busy,
  small,
  danger,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  icon?: LucideIcon;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  style?: ViewStyle;
}) {
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary ? s.primary : s.secondary,
        small && { minHeight: 38, paddingVertical: 7, paddingHorizontal: 13 },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : Icon ? (
        <Icon size={15} color={color} />
      ) : null}
      <Text style={[s.buttonText, { color }]}>{children}</Text>
    </Pressable>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  text,
  expanded,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  text?: string;
  expanded?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minWidth: 44,
          height: 44,
          paddingHorizontal: text ? 15 : 0,
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 22,
          borderWidth: 1,
          borderColor: expanded ? "#C5DDEB" : colors.line,
          backgroundColor: pressed || expanded ? colors.sky : "#FFFFFF",
          boxShadow: "0 2px 10px rgba(17, 25, 28, 0.05)",
        },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Icon size={20} strokeWidth={2} color={colors.text} />
      {text && <Text style={[s.buttonText, { color: colors.text }]}>{text}</Text>}
    </Pressable>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Chip({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <View style={[s.chip, tint ? { backgroundColor: tint } : null]}>
      <Text style={s.chipText}>{children}</Text>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 120, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", padding: 40, gap: 13 }}>
      <View style={[s.iconBox, { width: 55, height: 55, borderRadius: 18 }]}>
        <Icon size={24} color={colors.blueDark} />
      </View>
      <Text style={s.heading}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center", maxWidth: 360 }]}>{detail}</Text>
      {children}
    </View>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <View accessibilityRole="alert" style={s.error}>
      <Text style={[s.text, { color: colors.danger }]}>{error}</Text>
    </View>
  ) : null;
}
export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  wide,
  plain,
  footer,
  scrollRef,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** The content scrolls itself (a table with its own pinned column and zoom, say). */
  plain?: boolean;
  /** Pinned under the content (a composer): it stays put while the content scrolls. */
  footer?: ReactNode;
  /** To scroll the content from outside (to the newest entry after sending, say). */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 600;
  // On the web the sheet animates out before it unmounts. Removing it in the same frame as a
  // tap right after scrolling can leave iOS Safari showing the old frame, so the X looks dead.
  const [shown, setShown] = useState(true);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onClose();
  };
  const close = () => {
    if (Platform.OS !== "web") return onClose();
    setShown(false);
    setTimeout(finish, 450); // in case the browser never reports the animation end
  };
  return (
    <Modal
      transparent
      animationType={compact ? "slide" : "fade"}
      visible={shown}
      onDismiss={Platform.OS === "web" ? finish : undefined}
      onRequestClose={close}
    >
      <View
        style={[
          s.modalShade,
          compact && { padding: 0, justifyContent: "flex-end" },
          // Web: the visible area above the keyboard (keyboard-fit.web.ts), not the whole screen.
          Platform.OS === "web" &&
            ({ maxHeight: "var(--visible-height, 100%)" } as unknown as ViewStyle),
        ]}
      >
        <View
          accessibilityViewIsModal
          style={[
            s.sheet,
            wide && { maxWidth: 1050 },
            compact && {
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingBottom: Math.max(insets.bottom, 12),
              maxHeight: "94%",
            },
          ]}
        >
          {compact && (
            <View
              style={{
                alignSelf: "center",
                width: 34,
                height: 4,
                borderRadius: 3,
                backgroundColor: "#D8DBDE",
                marginTop: 10,
              }}
            />
          )}
          {/* The X keeps its place at the top right whatever the title's length: the title
              wraps (two lines at most) in the room that is left, never under the button. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              padding: compact ? 20 : 24,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
            }}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 4, paddingTop: 7 }}>
              <Text numberOfLines={2} style={[s.title, { lineHeight: 30 }]}>
                {title}
              </Text>
              {subtitle && (
                <Text numberOfLines={2} style={s.muted}>
                  {subtitle}
                </Text>
              )}
            </View>
            <View style={{ flexShrink: 0 }}>
              <IconButton icon={X} label="Fechar detalhes" onPress={close} />
            </View>
          </View>
          {plain ? (
            <View style={{ flexShrink: 1, minHeight: 0 }}>{children}</View>
          ) : (
            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: compact ? 20 : 24 }}
            >
              {children}
            </ScrollView>
          )}
          {footer && (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.line,
                paddingHorizontal: compact ? 14 : 20,
                paddingTop: 10,
                paddingBottom: compact ? 0 : 14,
              }}
            >
              {footer}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
export function CheckRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[s.row, { gap: 10, paddingVertical: 9 }]}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: checked ? colors.text : colors.line,
          backgroundColor: checked ? colors.text : "#FFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={13} color="#FFF" />}
      </View>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}
export function SectionHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[s.between, { marginBottom: 19 }]}>
      <Text style={s.heading}>{title}</Text>
      {action && onPress && (
        <Pressable accessibilityRole="button" onPress={onPress} style={[s.row, { gap: 5 }]}>
          <Text style={[s.small, { color: colors.text }]}>{action}</Text>
          <ArrowUpRight size={13} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function LinkRow({
  title,
  detail,
  onPress,
  icon: Icon,
  tint,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  icon: LucideIcon;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { paddingVertical: 13, gap: 14, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: tint || colors.sky }]}>
        <Icon size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.text, { fontWeight: "500" }]}>{title}</Text>
        {detail && <Text style={s.small}>{detail}</Text>}
      </View>
      <ChevronRight size={15} color={colors.muted} />
    </Pressable>
  );
}
/** Regi the corgi, still, for places that don't animate (sign-in, empty states, settings). */
export function Mascot({
  size = 42,
  busy = false,
}: {
  size?: number;
  /** Kept for older callers; Regi has one look. */
  variant?: "sky" | "sand" | "lilac";
  /** Breathes gently while the agent works. */
  busy?: boolean;
}) {
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!busy) {
      breath.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1.05, duration: 700, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, breath]);
  return (
    <Animated.View
      accessibilityLabel={busy ? "Regi, trabalhando" : "Regi"}
      style={{ width: size, height: size, transform: [{ scale: breath }] }}
    >
      <Image
        source={require("../../assets/regi/sit.png")}
        resizeMode="contain"
        style={{ width: size, height: size }}
        accessible={false}
      />
    </Animated.View>
  );
}
export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("pt-BR", options || { month: "short", day: "numeric" });
}
export function timeLabel(value: string, timeZone?: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone });
}
export function relativeDate(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  return diff < 60_000
    ? "Agora mesmo"
    : diff < 3600_000
      ? `há ${Math.floor(diff / 60_000)} min`
      : diff < 86400_000
        ? `há ${Math.floor(diff / 3600_000)} h`
        : dateLabel(value);
}

export function resultSummary(value: string) {
  return /^Saved to (?:sample|local) sent mail(?: · .+)?$/.test(value)
    ? "Resposta salva nos seus Enviados locais."
    : value;
}
