// The app's list language, shared by Activity, Ideas and Goals so the tabs look like one app:
// white panels, one row shape (icon tile · title · muted line · trailing), one accent color.
import { ChevronRight, type LucideIcon, Plus } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "./ui";

export const kit = {
  panel: "#FFFFFF",
  line: "#EEF0F2",
  tile: "#F3F5F7",
  icon: "#5B6167",
  accent: "#2F6FE4",
  muted: "#8A9095",
};

export type Tone = "neutral" | "active" | "done" | "attention" | "failed";
const TONES: Record<Tone, { dot: string; text: string }> = {
  neutral: { dot: "#C4C8CB", text: kit.muted },
  active: { dot: kit.accent, text: kit.accent },
  done: { dot: "#3F9C61", text: "#2D6B43" },
  attention: { dot: "#E2A23B", text: "#8A5A12" },
  failed: { dot: colors.danger, text: colors.danger },
};

/** A titled white panel; the optional action sits top-right as a small blue link. */
export function Panel({
  title,
  action,
  actionIcon: ActionIcon = Plus,
  onAction,
  children,
}: {
  title?: string;
  action?: string;
  /** Defaults to "+"; pass another icon for actions that don't add. */
  actionIcon?: LucideIcon;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {(title || action) && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{title}</Text>
          {action && onAction && (
            <Pressable
              accessibilityRole="button"
              onPress={onAction}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <ActionIcon size={14} color={kit.accent} />
              <Text style={{ fontSize: 14, fontWeight: "600", color: kit.accent }}>{action}</Text>
            </Pressable>
          )}
        </View>
      )}
      <View
        style={{
          backgroundColor: kit.panel,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: kit.line,
          paddingHorizontal: 14,
          paddingVertical: 4,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** One list row. Put rows directly in a Panel; `first` drops the divider above. */
export function Row({
  icon: Icon,
  title,
  detail,
  trailing,
  onPress,
  first,
  label,
  muted,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  label?: string;
  /** For "add" rows and placeholders. */
  muted?: boolean;
  children?: ReactNode;
}) {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          backgroundColor: kit.tile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={16} color={muted ? kit.muted : kit.icon} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={2}
          style={{
            fontSize: 15,
            lineHeight: 20,
            color: muted ? kit.muted : colors.text,
            fontWeight: muted ? "400" : "500",
          }}
        >
          {title}
        </Text>
        {!!detail && (
          <Text numberOfLines={1} style={{ fontSize: 13, color: kit.muted }}>
            {detail}
          </Text>
        )}
        {children}
      </View>
      {trailing ?? (onPress ? <ChevronRight size={16} color="#B3B8BC" /> : null)}
    </View>
  );
  const style = {
    paddingVertical: 11,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: kit.line,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

/** A small status label with a dot, for a row's trailing side. */
export function Status({ tone, label }: { tone: Tone; label: string }) {
  const t = TONES[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.dot }} />
      <Text style={{ fontSize: 12, fontWeight: "600", color: t.text }}>{label}</Text>
    </View>
  );
}

/** A thin progress bar under a row's text. */
export function Progress({ value }: { value: number }) {
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: kit.line, marginTop: 5 }}>
      <View
        style={{
          width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
          height: 3,
          borderRadius: 2,
          backgroundColor: kit.accent,
        }}
      />
    </View>
  );
}

/** Segmented filter: a light track with the selected option raised. */
export function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: "#F0F2F4",
        borderRadius: 12,
        padding: 3,
        alignSelf: "flex-start",
        // Never wider than its container: options shrink and their text fits (4+ on a phone).
        maxWidth: "100%",
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{
              flexShrink: 1,
              paddingHorizontal: options.length > 3 ? 9 : 12,
              paddingVertical: 6,
              borderRadius: 9,
              backgroundColor: active ? "#FFFFFF" : "transparent",
              shadowColor: "#000",
              shadowOpacity: active ? 0.06 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{
                fontSize: 13,
                fontWeight: active ? "600" : "500",
                color: active ? colors.text : kit.muted,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Ver mais 3" / "Mostrar menos" under a panel. */
export function More({
  hidden,
  expanded,
  onPress,
}: {
  hidden: number;
  expanded: boolean;
  onPress: () => void;
}) {
  if (!hidden && !expanded) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        paddingVertical: 10,
        alignItems: "center",
        borderTopWidth: 1,
        borderTopColor: kit.line,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "600", color: kit.accent }}>
        {expanded ? "Mostrar menos" : `Ver mais ${hidden}`}
      </Text>
    </Pressable>
  );
}

/** "agora", "há 14 min", "há 3 h", "ontem", "12 set". */
export function since(iso: string, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60) return `há ${Math.round(minutes / 60)} h`;
  if (minutes < 48 * 60) return "ontem";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}
