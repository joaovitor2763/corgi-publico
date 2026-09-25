import {
  AlertCircle,
  AppWindow,
  Check,
  ChevronDown,
  MessageSquare,
  Search,
  Terminal,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { colors, s } from "../../shared/ui";

export type TraceEntry =
  | { kind: "note"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: string;
      state: "running" | "done" | "failed" | "stopped";
    };

function parse(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** "GOOGLECALENDAR_EVENTS_LIST" -> "Googlecalendar · events list" */
function appTool(slug: unknown) {
  if (typeof slug !== "string" || !slug) return "um app";
  const [app = "", ...rest] = slug.toLowerCase().split("_");
  return `${app.charAt(0).toUpperCase()}${app.slice(1)} · ${rest.join(" ")}`;
}

export function describeTool(name: string, rawArgs: string) {
  const args = parse(rawArgs);
  const text = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  switch (name) {
    case "find_app_tools":
      return { icon: Search, label: "Procurei ferramentas nos apps", chip: text("query") };
    case "use_app_tool":
      return { icon: AppWindow, label: "Usei", chip: appTool(args.tool) };
    case "run_computer_command":
      return { icon: Terminal, label: "Executei", chip: text("command"), mono: true };
    case "read_computer_file":
    case "write_computer_file":
    case "list_computer_files":
      return {
        icon: Terminal,
        label: name.startsWith("read") ? "Li" : name.startsWith("write") ? "Escrevi" : "Listei",
        chip: text("path"),
        mono: true,
      };
    default:
      return {
        icon: Terminal,
        label: name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
        chip: "",
      };
  }
}

const started = new Map<string, number>();
const finished = new Map<string, number>();

/**
 * One collapsible block for the intermediate work of a turn: short progress notes and
 * tools without a card of their own. Open while working, folded once the answer lands.
 */
export function WorkTrace({
  id,
  entries,
  running,
}: {
  id: string;
  entries: TraceEntry[];
  running: boolean;
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [, tick] = useState(0);
  const wasRunning = useRef(running);
  if (running && !started.has(id)) started.set(id, Date.now());
  if (!running && wasRunning.current && started.has(id) && !finished.has(id))
    finished.set(id, Date.now());
  wasRunning.current = running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const begin = started.get(id);
  const seconds = begin
    ? Math.max(1, Math.round(((finished.get(id) ?? Date.now()) - begin) / 1000))
    : undefined;
  const steps = entries.filter((entry) => entry.kind === "tool").length;
  const expanded = open ?? running;
  return (
    <View style={{ alignSelf: "flex-start", width: "95%", gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setOpen(!expanded)}
        style={({ pressed }) => [
          s.row,
          { gap: 7, paddingVertical: 6, paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        {running && <ActivityIndicator size="small" color={colors.muted} />}
        <Text style={{ fontSize: 14, color: colors.muted }}>
          {running
            ? `Trabalhando${seconds ? ` · ${seconds} s` : "…"}`
            : `Trabalhei${seconds ? ` ${seconds} s` : ""}${steps ? ` · ${steps} ${steps === 1 ? "etapa" : "etapas"}` : ""}`}
        </Text>
        <ChevronDown
          size={14}
          color={colors.muted}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>
      {expanded && (
        <View
          style={{
            marginLeft: 10,
            paddingLeft: 12,
            borderLeftWidth: 1,
            borderLeftColor: "#E1E4E6",
            gap: 6,
            paddingVertical: 2,
          }}
        >
          {entries.map((entry) =>
            entry.kind === "note" ? (
              <View key={entry.id} style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
                <MessageSquare size={14} color={colors.muted} style={{ marginTop: 3 }} />
                <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: colors.muted }}>
                  {entry.text}
                </Text>
              </View>
            ) : (
              <TraceRow key={entry.id} entry={entry} />
            ),
          )}
        </View>
      )}
    </View>
  );
}

function TraceRow({ entry }: { entry: Extract<TraceEntry, { kind: "tool" }> }) {
  const { icon: Icon, label, chip, mono } = describeTool(entry.name, entry.args);
  return (
    <View style={[s.row, { gap: 8 }]}>
      {entry.state === "running" ? (
        <ActivityIndicator size="small" color={colors.muted} />
      ) : entry.state === "failed" ? (
        <AlertCircle size={14} color="#C2413A" />
      ) : entry.state === "done" ? (
        <Check size={14} color="#47896C" />
      ) : (
        <Icon size={14} color={colors.muted} />
      )}
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{label}</Text>
      {!!chip && (
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: 12,
            color: colors.muted,
            backgroundColor: "#F0F2F3",
            borderRadius: 6,
            paddingHorizontal: 6,
            paddingVertical: 2,
            fontFamily: mono ? "monospace" : undefined,
          }}
        >
          {chip}
        </Text>
      )}
    </View>
  );
}
