// Ajudantes: small assistants Corgi calls, each with a mission, its own chat, only the apps you
// allow and an optional schedule. Cards show how each one is doing; tap to talk, run or adjust.
import { MessageCircle, Pause, Play, Plus, Settings2, Trash2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import type { Fuzzy } from "../../../../../packages/domain/src/agent";
import { describeRoutineSchedule } from "../../../../../packages/domain/src/routine";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText } from "../../shared/format";
import { kit, since } from "../../shared/kit";
import { Button, colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { useMuseThread } from "../chat/threads";

type Template = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  pitch: string;
  mission: string;
  instructions: string;
  apps: string[];
  web: boolean;
  schedule?: { days: number[]; time: string };
};
type Draft = {
  id?: string;
  name: string;
  emoji: string;
  color: string;
  mission: string;
  instructions: string;
  apps: string[];
  web: boolean;
  when: When;
  time: string;
  maxRunsPerDay: number;
  template?: string;
};
type When = "called" | "weekdays" | "daily" | "monday";

const WHEN: { value: When; label: string; days?: number[] }[] = [
  { value: "called", label: "Só quando chamado" },
  { value: "weekdays", label: "Dias úteis", days: [1, 2, 3, 4, 5] },
  { value: "daily", label: "Todo dia", days: [0, 1, 2, 3, 4, 5, 6] },
  { value: "monday", label: "Toda segunda", days: [1] },
];
const EMOJIS = ["🐾", "📡", "🗂️", "🔭", "📌", "🧭", "📈", "✉️", "🛒", "🧾"];
const COLORS = ["#CFE3F7", "#E6DDF6", "#DDF0E2", "#FBE3C8", "#F6D9DE", "#F1EBC9"];
const ACTIVE = new Set(["queued", "running", "waiting_input", "waiting_approval"]);

const whenOf = (fuzzy?: { schedule?: { days: number[] } }): When => {
  const days = fuzzy?.schedule?.days?.join(",");
  if (!days) return "called";
  return WHEN.find((w) => w.days?.join(",") === days)?.value ?? "weekdays";
};

export function FuzziesSheet({ onClose }: { onClose: () => void }) {
  const { api, navigate } = useWorkspace();
  const { data, refresh } = useAgentWorkspace();
  const { select } = useMuseThread();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [apps, setApps] = useState<{ toolkit: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const fuzzies = data?.fuzzies ?? [];
  useEffect(() => {
    void api
      .request<{ templates: Template[] }>("/api/fuzzies")
      .then((r) => setTemplates(r.templates))
      .catch(() => undefined);
    void api
      .request<{ connections: { toolkit: string; name?: string; status: string }[] }>("/api/apps")
      .then((r) =>
        setApps(
          [
            ...new Map(
              r.connections.filter((c) => c.status === "ACTIVE").map((c) => [c.toolkit, c]),
            ).values(),
          ].map((c) => ({ toolkit: c.toolkit, name: c.name ?? c.toolkit })),
        ),
      )
      .catch(() => undefined);
  }, [api]);
  async function act(id: string, job: () => Promise<unknown>) {
    setBusy(id);
    setError("");
    try {
      await job();
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  }
  function talk(fuzzy: Fuzzy) {
    onClose();
    select({ id: fuzzy.threadId, existing: true });
    navigate("chat");
  }
  const fromTemplate = (t: Template): Draft => ({
    name: t.name,
    emoji: t.emoji,
    color: t.color,
    mission: t.mission,
    instructions: t.instructions,
    // Kept as the template says; saving keeps only the ones you have connected.
    apps: t.apps,
    web: t.web,
    when: whenOf(t),
    time: t.schedule?.time ?? "09:00",
    maxRunsPerDay: 4,
    template: t.id,
  });
  if (draft)
    return (
      <Editor
        draft={draft}
        apps={apps}
        fuzzy={fuzzies.find((f) => f.id === draft.id)}
        onClose={() => setDraft(undefined)}
        onSaved={async () => {
          setDraft(undefined);
          await refresh();
        }}
      />
    );
  return (
    <Sheet title="Ajudantes" subtitle="Pequenos assistentes que o Corgi chama" onClose={onClose}>
      <View style={{ gap: 18 }}>
        <ErrorNotice error={error} />
        {fuzzies.map((fuzzy) => {
          const last = data?.tasks.find((t) => t.id === fuzzy.lastTaskId);
          const working = last && ACTIVE.has(last.status);
          const status =
            fuzzy.status === "paused"
              ? "Pausado"
              : working
                ? last?.status === "running" || last?.status === "queued"
                  ? "Trabalhando…"
                  : "Esperando você"
                : fuzzy.lastFinding
                  ? `${fuzzy.lastFinding.notified ? "Achou" : "Olhou"} ${since(fuzzy.lastFinding.at)}: ${fuzzy.lastFinding.headline}`
                  : fuzzy.schedule
                    ? `Começa ${describeRoutineSchedule(fuzzy.schedule).toLowerCase()}`
                    : "Pronto para ser chamado";
          const expanded = open === fuzzy.id;
          return (
            <View
              key={fuzzy.id}
              style={{
                borderRadius: 20,
                borderWidth: 1,
                borderColor: kit.line,
                backgroundColor: kit.panel,
                padding: 14,
                gap: 12,
                opacity: fuzzy.status === "paused" ? 0.7 : 1,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpen(expanded ? undefined : fuzzy.id)}
                style={[s.row, { gap: 12 }]}
              >
                <Avatar fuzzy={fuzzy} working={Boolean(working)} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
                    {fuzzy.name}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{ fontSize: 13, lineHeight: 18, color: kit.muted }}
                  >
                    {status}
                  </Text>
                </View>
              </Pressable>
              {expanded && (
                <View style={{ gap: 12 }}>
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text }}>
                    {fuzzy.mission}
                  </Text>
                  <Text style={{ fontSize: 12, color: kit.muted }}>
                    {[
                      fuzzy.schedule
                        ? describeRoutineSchedule(fuzzy.schedule)
                        : "Só quando chamado",
                      fuzzy.apps.length ? fuzzy.apps.join(", ") : "sem apps",
                      fuzzy.web ? "web" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                    <Button small primary icon={MessageCircle} onPress={() => talk(fuzzy)}>
                      Conversar
                    </Button>
                    <Button
                      small
                      icon={Play}
                      busy={busy === `run:${fuzzy.id}`}
                      disabled={Boolean(working) || fuzzy.status === "paused"}
                      onPress={() =>
                        void act(`run:${fuzzy.id}`, async () => {
                          const r = await api.request<{ started: boolean; reason?: string }>(
                            `/api/fuzzies/${fuzzy.id}/run`,
                            {},
                          );
                          if (!r.started) throw new Error(`Não rodou: ${r.reason}.`);
                        })
                      }
                    >
                      Rodar agora
                    </Button>
                    <Button
                      small
                      icon={fuzzy.status === "paused" ? Play : Pause}
                      onPress={() =>
                        void act(fuzzy.id, () =>
                          api.request(`/api/fuzzies/${fuzzy.id}`, {
                            status: fuzzy.status === "paused" ? "active" : "paused",
                          }),
                        )
                      }
                    >
                      {fuzzy.status === "paused" ? "Retomar" : "Pausar"}
                    </Button>
                    <Button
                      small
                      icon={Settings2}
                      onPress={() =>
                        setDraft({
                          id: fuzzy.id,
                          name: fuzzy.name,
                          emoji: fuzzy.emoji,
                          color: fuzzy.color,
                          mission: fuzzy.mission,
                          instructions: fuzzy.instructions,
                          apps: fuzzy.apps,
                          web: fuzzy.web,
                          when: whenOf(fuzzy),
                          time: fuzzy.schedule?.time ?? "09:00",
                          maxRunsPerDay: fuzzy.maxRunsPerDay,
                        })
                      }
                    >
                      Ajustar
                    </Button>
                  </View>
                </View>
              )}
            </View>
          );
        })}
        {!fuzzies.length && (
          <Text style={[s.muted, { fontSize: 14 }]}>
            Cada ajudante cuida de uma coisa por você: olha seus apps no horário certo, conversa com
            você no chat dele e só te chama quando acha algo. Nunca envia, apaga ou compra sem a sua
            aprovação.
          </Text>
        )}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>Novo ajudante</Text>
          {templates.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Criar ${t.name}`}
              onPress={() => setDraft(fromTemplate(t))}
              style={({ pressed }) => [
                s.row,
                {
                  gap: 12,
                  padding: 12,
                  borderRadius: 16,
                  backgroundColor: pressed ? kit.line : kit.tile,
                },
              ]}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: t.color,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 19 }}>{t.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>
                  {t.name}
                </Text>
                <Text style={{ fontSize: 12, lineHeight: 17, color: kit.muted }}>{t.pitch}</Text>
              </View>
            </Pressable>
          ))}
          <Button
            icon={Plus}
            onPress={() =>
              setDraft({
                name: "",
                emoji: "🐾",
                color: COLORS[0] as string,
                mission: "",
                instructions: "",
                apps: [],
                web: true,
                when: "called",
                time: "09:00",
                maxRunsPerDay: 4,
              })
            }
          >
            Criar do zero
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

function Avatar({ fuzzy, working }: { fuzzy: Fuzzy; working: boolean }) {
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: fuzzy.color,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: working ? 2 : 0,
        borderColor: kit.accent,
      }}
    >
      <Text style={{ fontSize: 24 }}>{fuzzy.emoji}</Text>
    </View>
  );
}

function Editor({
  draft: initial,
  apps,
  fuzzy,
  onClose,
  onSaved,
}: {
  draft: Draft;
  apps: { toolkit: string; name: string }[];
  fuzzy?: Fuzzy;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = useWorkspace();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [learned, setLearned] = useState(fuzzy?.learned ?? []);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const valid =
    draft.name.trim() &&
    draft.mission.trim() &&
    (draft.when === "called" || /^\d{2}:\d{2}$/.test(draft.time));
  async function save() {
    setBusy(true);
    setError("");
    try {
      const days = WHEN.find((w) => w.value === draft.when)?.days;
      const body = {
        name: draft.name.trim(),
        emoji: draft.emoji,
        color: draft.color,
        mission: draft.mission.trim(),
        instructions: draft.instructions.trim(),
        apps: apps.length
          ? draft.apps.filter((a) => apps.some((c) => c.toolkit.toLowerCase() === a))
          : draft.apps,
        web: draft.web,
        schedule: days ? { days, time: draft.time } : null,
        maxRunsPerDay: draft.maxRunsPerDay,
        ...(draft.template && !draft.id ? { template: draft.template } : {}),
      };
      await api.request(draft.id ? `/api/fuzzies/${draft.id}` : "/api/fuzzies", body);
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!draft.id) return;
    setBusy(true);
    try {
      await api.request(`/api/fuzzies/${draft.id}`, undefined, "DELETE");
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    multiline = false,
  ) => (
    <View style={{ gap: 5 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[
          s.input,
          multiline && { minHeight: 76, textAlignVertical: "top" },
          { fontSize: 14 },
        ]}
      />
    </View>
  );
  return (
    <Sheet
      title={draft.id ? `Ajustar ${initial.name}` : "Novo ajudante"}
      subtitle="Ele só usa os apps que você marcar aqui"
      onClose={onClose}
    >
      <View style={{ gap: 16 }}>
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {EMOJIS.map((e) => (
            <Choice key={e} on={draft.emoji === e} onPress={() => set({ emoji: e })}>
              {e}
            </Choice>
          ))}
        </View>
        <View style={[s.row, { gap: 8 }]}>
          {COLORS.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`Cor ${c}`}
              onPress={() => set({ color: c })}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: c,
                borderWidth: draft.color === c ? 2 : 0,
                borderColor: colors.text,
              }}
            />
          ))}
        </View>
        {field("Nome", draft.name, (name) => set({ name }), "Radar")}
        {field(
          "Missão",
          draft.mission,
          (mission) => set({ mission }),
          "O que ele cuida por você",
          true,
        )}
        {field(
          "Como trabalhar",
          draft.instructions,
          (instructions) => set({ instructions }),
          "Onde olhar, o que importa, como te avisar",
          true,
        )}
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
            Apps que ele pode usar
          </Text>
          <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
            {apps.map((a) => {
              const key = a.toolkit.toLowerCase();
              const on = draft.apps.includes(key);
              return (
                <Choice
                  key={key}
                  on={on}
                  onPress={() =>
                    set({ apps: on ? draft.apps.filter((x) => x !== key) : [...draft.apps, key] })
                  }
                >
                  {a.name}
                </Choice>
              );
            })}
            {!apps.length && <Text style={s.small}>Nenhum app conectado ainda (Apps).</Text>}
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <Switch
            trackColor={{ false: "#D5D9DC", true: kit.accent }}
            thumbColor="#FFFFFF"
            {...{ activeThumbColor: "#FFFFFF" }}
            accessibilityLabel="Pode navegar na web"
            value={draft.web}
            onValueChange={(web) => set({ web })}
          />
          <Text style={{ fontSize: 14, color: colors.text, flex: 1 }}>Pode pesquisar na web</Text>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
            Quando trabalha sozinho
          </Text>
          <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
            {WHEN.map((w) => (
              <Choice
                key={w.value}
                on={draft.when === w.value}
                onPress={() => set({ when: w.value })}
              >
                {w.label}
              </Choice>
            ))}
          </View>
          {draft.when !== "called" && (
            <View style={[s.row, { gap: 8 }]}>
              <Text style={{ fontSize: 14, color: colors.text }}>Às</Text>
              <TextInput
                accessibilityLabel="Horário"
                value={draft.time}
                onChangeText={(time) => set({ time })}
                maxLength={5}
                placeholder="09:00"
                style={[
                  s.input,
                  { width: 80, textAlign: "center", minHeight: 38, paddingVertical: 6 },
                ]}
              />
            </View>
          )}
          <Text style={s.small}>
            Você e o Corgi podem chamá-lo a qualquer hora, até {draft.maxRunsPerDay} vezes por dia.
          </Text>
        </View>
        {!!learned.length && (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
              O que ele aprendeu
            </Text>
            {learned.map((l) => (
              <View key={l.text} style={[s.row, { gap: 8 }]}>
                <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: colors.text }}>
                  {l.text}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Esquecer: ${l.text}`}
                  hitSlop={6}
                  onPress={() =>
                    void api
                      .request<Fuzzy>(`/api/fuzzies/${draft.id}/unlearn`, { text: l.text })
                      .then((f) => setLearned(f.learned))
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  <X size={15} color={kit.muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <ErrorNotice error={error} />
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button primary busy={busy} disabled={!valid} onPress={() => void save()}>
            {draft.id ? "Salvar" : "Criar ajudante"}
          </Button>
          <Button onPress={onClose}>Cancelar</Button>
          {draft.id && (
            <Button danger icon={Trash2} busy={busy} onPress={() => void remove()}>
              Apagar
            </Button>
          )}
        </View>
        {busy && <ActivityIndicator color={kit.muted} />}
      </View>
    </Sheet>
  );
}

function Choice({ on, onPress, children }: { on: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 11,
        backgroundColor: on ? colors.sky : "#F1F3F4",
        borderWidth: 1,
        borderColor: on ? kit.accent : "transparent",
      }}
    >
      <Text
        style={{
          fontSize: 14,
          color: on ? colors.blueDark : colors.text,
          fontWeight: on ? "600" : "400",
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
