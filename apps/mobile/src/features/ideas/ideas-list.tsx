import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Instagram,
  Lightbulb,
  type LucideIcon,
  Mail,
  MessageSquare,
  Target,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { Idea } from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import DateTimeEditor from "../../shared/DateTimeEditor";
import { errorText } from "../../shared/format";
import { kit, Panel, Row, Status, type Tone } from "../../shared/kit";
import { Button, colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { resultAtAGlance, taskName } from "../chat/action-summary";
import {
  archiveLabel,
  humanizeExcerpt,
  type SnoozeOption,
  type SourceApp,
  snoozeOptions,
  sourceChips,
  whyLine,
} from "./idea-summary";

const SHOWN = 4;
const ARCHIVE_SHOWN = 12;

/** Where an idea comes from, as a small icon: a message, mail, the calendar, a goal, or Corgi. */
const APP_ICONS: Record<SourceApp, { icon: LucideIcon; tint: string; color: string }> = {
  slack: { icon: MessageSquare, tint: "#F3EEFA", color: "#6B3FA0" },
  instagram: { icon: Instagram, tint: "#FDEEF3", color: "#C13584" },
  mail: { icon: Mail, tint: "#FDF1EC", color: "#C4553A" },
  calendar: { icon: CalendarDays, tint: "#EEF1FD", color: "#4458C9" },
  goal: { icon: Target, tint: "#EAF6EE", color: "#2F8A57" },
  memory: { icon: Lightbulb, tint: "#FFF6DC", color: "#A77B0C" },
  other: { icon: Lightbulb, tint: "#FFF6DC", color: "#A77B0C" },
};

/**
 * Open ideas, scannable: full title, one line on why, where it came from. Tap to see the
 * evidence and edit the instructions. The decision sits at the bottom of each card: Executar,
 * Agendar para depois (it hides until then), Ignorar. Ignored and expired ones wait in the archive.
 */
export function IdeasList() {
  const { data } = useAgentWorkspace();
  const [all, setAll] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const ideas = data?.ideas.filter((idea) => idea.status === "new") ?? [];
  const archived = (data?.ideas ?? [])
    .filter((idea) => idea.status === "dismissed" || idea.status === "expired")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const shown = all ? ideas : ideas.slice(0, SHOWN);
  const agent = data?.identity.name || "Corgi";
  return (
    <View>
      {!!notice && (
        <View style={[s.row, { gap: 6, paddingTop: 12, paddingBottom: 2 }]}>
          <Clock size={13} color={kit.muted} />
          <Text style={[s.small, { fontSize: 12.5 }]}>{notice}</Text>
        </View>
      )}
      {shown.map((idea, index) => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          first={index === 0 && !notice}
          onSnoozed={(label) => setNotice(`Adiada até ${label}. Ela volta para cá na hora.`)}
        />
      ))}
      {!ideas.length && (
        <Row
          first
          muted
          icon={Lightbulb}
          title={`Nada agora. O ${agent} olha suas fontes algumas vezes por dia.`}
        />
      )}
      {ideas.length > SHOWN && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAll(!all)}
          style={{ paddingVertical: 12 }}
        >
          <Text style={[s.small, { color: kit.accent, fontSize: 13, fontWeight: "600" }]}>
            {all ? "Mostrar menos" : `Ver mais ${ideas.length - SHOWN}`}
          </Text>
        </Pressable>
      )}
      {archived.length > 0 && <ArchivedIdeas ideas={archived} />}
    </View>
  );
}

function IdeaCard({
  idea,
  first,
  onSnoozed,
}: {
  idea: Idea;
  first: boolean;
  onSnoozed: (label: string) => void;
}) {
  const { mutate, data } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState(idea.prompt);
  const [busy, setBusy] = useState<"accept" | "dismiss" | "snooze">();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const chips = sourceChips(idea);
  const look = APP_ICONS[idea.kind === "plan" ? "goal" : (chips[0]?.app ?? "other")];
  const Icon = look.icon;
  const why = whyLine(idea.reason);
  async function act(action: "accept" | "dismiss") {
    setBusy(action);
    setError("");
    try {
      const result = await mutate<Idea>(`/ideas/${idea.id}`, { action, prompt });
      if (result.taskId && action === "accept") open({ type: "task", taskId: result.taskId });
    } catch (e) {
      setError(errorText(e));
      setBusy(undefined);
    }
  }
  async function snooze(until: Date, label: string) {
    setPicking(false);
    setBusy("snooze");
    setError("");
    try {
      await mutate<Idea>(`/ideas/${idea.id}/snooze`, { until: until.toISOString() });
      onSnoozed(label);
    } catch (e) {
      setError(errorText(e));
      setBusy(undefined);
    }
  }
  return (
    <View
      style={{
        paddingTop: 14,
        paddingBottom: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: kit.line,
        gap: 10,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Recolher" : "Ver detalhes"}: ${idea.title}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => [
          s.row,
          { gap: 12, alignItems: "flex-start" },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: look.tint,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 1,
          }}
        >
          <Icon size={16} color={look.color} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            numberOfLines={expanded ? undefined : 2}
            style={{ color: colors.text, fontSize: 15, fontWeight: "600", lineHeight: 20 }}
          >
            {idea.title}
          </Text>
          {!!why && !expanded && (
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>
              {why}
            </Text>
          )}
          {chips.length > 0 && !expanded && (
            <View style={[s.row, { flexWrap: "wrap", gap: 6, marginTop: 2 }]}>
              {chips.map((chip) => (
                <SourceChip key={chip.label} label={chip.label} app={chip.app} />
              ))}
            </View>
          )}
        </View>
        {expanded ? (
          <ChevronUp size={16} color="#B3B8BC" style={{ marginTop: 2 }} />
        ) : (
          <ChevronDown size={16} color="#B3B8BC" style={{ marginTop: 2 }} />
        )}
      </Pressable>
      {expanded && (
        <View style={{ marginLeft: 44, gap: 10 }}>
          <Text style={{ color: colors.muted, fontSize: 13.5, lineHeight: 19 }}>{idea.reason}</Text>
          {idea.evidence.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>Fontes</Text>
              {idea.evidence.slice(0, 4).map((item) => (
                <View
                  key={item.id}
                  style={{ backgroundColor: kit.tile, borderRadius: 10, padding: 10, gap: 2 }}
                >
                  <Text
                    numberOfLines={2}
                    style={{ color: colors.text, fontSize: 13, fontWeight: "600", lineHeight: 18 }}
                  >
                    {item.title}
                  </Text>
                  {!!item.excerpt && (
                    <Text numberOfLines={3} style={[s.small, { fontSize: 12, lineHeight: 17 }]}>
                      {humanizeExcerpt(item.excerpt)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
          <Text style={s.label}>O que o {data?.identity.name || "Corgi"} vai fazer</Text>
          <TextInput
            accessibilityLabel="O que o assistente vai fazer"
            value={prompt}
            onChangeText={setPrompt}
            multiline
            style={{
              backgroundColor: "#FFF",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#E6E8EA",
              padding: 10,
              fontSize: 13.5,
              lineHeight: 19,
              color: colors.text,
              minHeight: 70,
              textAlignVertical: "top",
            }}
          />
        </View>
      )}
      {/* Fits one row on a 390px phone; on narrower screens "Ignorar" wraps under the pills. */}
      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
        <Pill
          label="Executar"
          primary
          busy={busy === "accept"}
          disabled={!!busy || !prompt.trim()}
          hint={idea.title}
          onPress={() => void act("accept")}
        />
        <Pill
          label="Agendar para depois"
          icon={Clock}
          busy={busy === "snooze"}
          disabled={!!busy}
          hint={idea.title}
          onPress={() => setPicking(true)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ignorar: ${idea.title}`}
          disabled={!!busy}
          onPress={() => void act("dismiss")}
          hitSlop={10}
          style={({ pressed }) => [
            s.row,
            { gap: 4, height: 34, marginLeft: "auto", opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {busy === "dismiss" && <ActivityIndicator size="small" color={kit.muted} />}
          <Text style={{ color: kit.muted, fontSize: 13, fontWeight: "600" }}>Ignorar</Text>
        </Pressable>
      </View>
      <ErrorNotice error={error} />
      {picking && (
        <SnoozeSheet title={idea.title} onClose={() => setPicking(false)} onPick={snooze} />
      )}
    </View>
  );
}

function SourceChip({ label, app }: { label: string; app: SourceApp }) {
  const look = APP_ICONS[app];
  const Icon = look.icon;
  return (
    <View
      style={[
        s.row,
        {
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 12,
          backgroundColor: kit.tile,
          // A long channel or name shortens inside the card instead of spilling out of it.
          maxWidth: "100%",
          alignSelf: "flex-start",
        },
      ]}
    >
      <Icon size={11} color={look.color} />
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 11, fontWeight: "600", color: "#5B6167" }}
      >
        {label}
      </Text>
    </View>
  );
}

/** One decision at the bottom of a card: a compact pill, filled for the main one. */
function Pill({
  label,
  icon: Icon,
  primary,
  busy,
  disabled,
  hint,
  onPress,
}: {
  label: string;
  icon?: LucideIcon;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  hint: string;
  onPress: () => void;
}) {
  const color = primary ? "#FFF" : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${hint}`}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          height: 34,
          paddingHorizontal: Icon ? 10 : 13,
          borderRadius: 17,
          gap: 4,
          backgroundColor: primary ? kit.accent : kit.tile,
          opacity: pressed ? 0.7 : disabled && !busy ? 0.5 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : Icon ? (
        <Icon size={13} color={color} />
      ) : null}
      <Text style={{ color, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** "Agendar para depois": tonight, tomorrow morning, next week, or a date and time. */
function SnoozeSheet({
  title,
  onClose,
  onPick,
}: {
  title: string;
  onClose: () => void;
  onPick: (until: Date, label: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [instant, setInstant] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  });
  const options = snoozeOptions();
  const pick = (option: SnoozeOption) => onPick(option.until, option.detail);
  const customDate = new Date(instant);
  const customValid = !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now();
  return (
    <Sheet title="Agendar para depois" subtitle={taskName(title)} onClose={onClose}>
      <View style={{ gap: 4 }}>
        {options.map((option, index) => (
          <Row
            key={option.choice}
            first={index === 0}
            icon={Clock}
            title={option.label}
            detail={option.detail}
            onPress={() => pick(option)}
          />
        ))}
        <Row
          icon={CalendarDays}
          title="Escolher data e hora"
          detail={custom ? undefined : "Outro dia, outro horário"}
          onPress={() => setCustom(!custom)}
        />
        {custom && (
          <View style={{ paddingTop: 8 }}>
            <DateTimeEditor
              label="Voltar"
              value={instant}
              timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
              allDay={false}
              onChange={setInstant}
            />
            <Button
              primary
              icon={Check}
              disabled={!customValid}
              onPress={() =>
                onPick(
                  customDate,
                  customDate.toLocaleString("pt-BR", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                )
              }
            >
              Agendar
            </Button>
          </View>
        )}
      </View>
    </Sheet>
  );
}

/** Ignored and expired ideas, folded under the list: out of the way, one tap to bring one back. */
function ArchivedIdeas({ ideas }: { ideas: Idea[] }) {
  const { mutate } = useAgentWorkspace();
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function restore(id: string) {
    setBusy(id);
    setError("");
    try {
      await mutate(`/ideas/${id}`, { action: "restore" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
        onPress={() => setShown(!shown)}
        style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: kit.line }}
      >
        <Text style={{ fontSize: 12.5, color: kit.muted, textAlign: "center" }}>
          {shown ? "Esconder arquivadas" : `Ver arquivadas (${ideas.length})`}
        </Text>
      </Pressable>
      {shown &&
        ideas.slice(0, ARCHIVE_SHOWN).map((idea) => (
          <Row
            key={idea.id}
            icon={Archive}
            muted
            title={taskName(idea.title)}
            detail={archiveLabel(idea)}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Restaurar: ${idea.title}`}
                disabled={busy === idea.id}
                onPress={() => void restore(idea.id)}
                hitSlop={8}
                style={({ pressed }) => [
                  s.row,
                  { gap: 4, opacity: pressed || busy === idea.id ? 0.5 : 1 },
                ]}
              >
                <ArchiveRestore size={13} color={kit.accent} />
                <Text style={{ fontSize: 12.5, fontWeight: "600", color: kit.accent }}>
                  Restaurar
                </Text>
              </Pressable>
            }
          />
        ))}
      {shown && ideas.length > ARCHIVE_SHOWN && (
        <Text style={[s.small, { textAlign: "center", paddingVertical: 8 }]}>
          e mais {ideas.length - ARCHIVE_SHOWN} antigas
        </Text>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

const FINISHED = new Set(["succeeded", "failed", "cancelled"]);

/** Ideas already taken, either still being worked on or finished (with archive). */
export function TakenIdeas({ finished }: { finished: boolean }) {
  const { data, mutate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState("");
  const taken = (data?.ideas ?? [])
    .filter((idea) => idea.status === "accepted")
    .filter((idea) => {
      const status = data?.tasks.find((t) => t.id === idea.taskId)?.status ?? "";
      return finished ? FINISHED.has(status) : !FINISHED.has(status);
    })
    .reverse();
  const archived = taken.filter((idea) => idea.archived);
  const shown = taken.filter((idea) => showArchived || !idea.archived);
  async function archive(id: string, value: boolean) {
    setBusy(id);
    try {
      await mutate(id === "all" ? "/ideas/archive-done" : `/ideas/${id}/archive`, {
        archived: value,
      });
    } finally {
      setBusy("");
    }
  }
  return (
    <Panel
      title={finished ? "Feitas" : "Em andamento"}
      action={finished && shown.some((i) => !i.archived) ? "Arquivar todas" : undefined}
      actionIcon={Archive}
      onAction={() => void archive("all", true)}
    >
      {shown.map((idea, index) => {
        const task = data?.tasks.find((t) => t.id === idea.taskId);
        const notification = data?.notifications.find((n) => n.taskId === idea.taskId);
        const done = task?.status === "succeeded";
        const status: { tone: Tone; label: string } = done
          ? { tone: "done", label: "Pronto" }
          : task?.status === "failed"
            ? { tone: "failed", label: "Falhou" }
            : task?.status === "cancelled"
              ? { tone: "neutral", label: "Cancelada" }
              : task?.status === "waiting_approval" || task?.status === "waiting_input"
                ? { tone: "attention", label: "Esperando você" }
                : { tone: "active", label: "Trabalhando" };
        return (
          <Row
            key={idea.id}
            first={index === 0}
            icon={idea.archived ? Archive : Lightbulb}
            muted={idea.archived}
            title={
              done && notification ? resultAtAGlance(notification).headline : taskName(idea.title)
            }
            detail={done && notification ? taskName(idea.title) : undefined}
            onPress={() => idea.taskId && open({ type: "task", taskId: idea.taskId })}
            trailing={
              finished ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={idea.archived ? "Desarquivar" : "Arquivar"}
                  onPress={() => void archive(idea.id, !idea.archived)}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#F1F3F4",
                    opacity: pressed || busy === idea.id ? 0.5 : 1,
                  })}
                >
                  {idea.archived ? (
                    <ArchiveRestore size={15} color={colors.muted} />
                  ) : (
                    <Archive size={15} color={colors.muted} />
                  )}
                </Pressable>
              ) : (
                <Status {...status} />
              )
            }
          />
        );
      })}
      {!shown.length && (
        <Row
          first
          muted
          icon={finished ? Archive : Lightbulb}
          title={
            finished
              ? archived.length
                ? "Tudo arquivado"
                : "Nada concluído ainda"
              : "Nenhuma ideia em andamento. Toque em Executar em uma ideia."
          }
        />
      )}
      {finished && archived.length > 0 && (
        <Pressable onPress={() => setShowArchived(!showArchived)} style={{ paddingVertical: 10 }}>
          <Text style={{ fontSize: 12.5, color: colors.muted, textAlign: "center" }}>
            {showArchived ? "Esconder arquivadas" : `${archived.length} arquivadas · mostrar`}
          </Text>
        </Pressable>
      )}
    </Panel>
  );
}
