// Memória: what Corgi knows about the person and why, who is who, how it serves them, what it
// thought at night, and what it forgot (restorable for 30 days). Everything here is editable.
import {
  Brain,
  Check,
  HelpCircle,
  Moon,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type {
  AgentMemory,
  MemoryDream,
  MemoryPerson,
  MemorySynthesis,
} from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText } from "../../shared/format";
import { kit, Panel, Row, Segments, since } from "../../shared/kit";
import { Button, colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { tagLabel } from "./memory-card";

type Tab = "you" | "people" | "style" | "diary" | "forgotten";
type Book = {
  memories: AgentMemory[];
  alignment: MemorySynthesis | null;
  people: MemoryPerson[];
  dreams: MemoryDream[];
};
type Why = {
  how: string;
  since?: string;
  evidence: { conversation: string; messages?: string; words?: string }[];
  replaced?: string[];
};

const ORIGIN: Record<string, string> = {
  owner: "você adicionou",
  chat: "você disse no chat",
  review: "percebido numa conversa",
  reflection: "reflexão da noite",
};
const RESTORE_DAYS = 30;
/** Memories saved before origins existed carry an English source line. */
const LEGACY: Record<string, string> = {
  "You added in Apps": "você adicionou",
  "User confirmed in chat": "você disse no chat",
  "Updated in chat": "atualizado no chat",
  "Corrected in chat": "corrigido no chat",
  You: "você adicionou",
};
const originOf = (memory: AgentMemory) =>
  memory.origin ? ORIGIN[memory.origin] : memory.source && (LEGACY[memory.source] ?? memory.source);

export function MemorySheet({ onClose }: { onClose: () => void }) {
  const { api } = useWorkspace();
  const { refresh } = useAgentWorkspace();
  const [book, setBook] = useState<Book>();
  const [tab, setTab] = useState<Tab>("you");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .request<Book>("/api/agent/memory")
        .then(setBook)
        .catch((e) => setError(errorText(e))),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  /** Runs a change, then reloads this screen and the app's snapshot. */
  const act = useCallback(
    async (path: string, body: unknown = {}, method?: string) => {
      setError("");
      try {
        await api.request(`/api/agent${path}`, body, method);
        await Promise.all([load(), refresh()]);
      } catch (e) {
        setError(errorText(e));
        throw e;
      }
    },
    [api, load, refresh],
  );
  const active = (book?.memories ?? []).filter((m) => (m.status ?? "active") === "active");
  const forgotten = (book?.memories ?? []).filter((m) => m.status === "retracted");
  return (
    <Sheet title="Memória" subtitle="O que o Corgi sabe e como te atende" onClose={onClose}>
      <View style={{ gap: 16 }}>
        <Segments<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "you", label: "Você" },
            { value: "people", label: "Pessoas" },
            { value: "style", label: "Estilo" },
            { value: "diary", label: "Diário" },
            { value: "forgotten", label: "Esquecido" },
          ]}
        />
        {(tab === "you" || tab === "people") && (
          <TextInput
            accessibilityLabel="Buscar na memória"
            value={query}
            onChangeText={setQuery}
            placeholder={tab === "you" ? "Buscar no que sei" : "Buscar pessoa"}
            placeholderTextColor={colors.muted}
            style={[s.input, { minHeight: 40, paddingVertical: 8, fontSize: 14 }]}
          />
        )}
        <ErrorNotice error={error} />
        {!book ? (
          <ActivityIndicator color={colors.muted} style={{ marginVertical: 30 }} />
        ) : tab === "you" ? (
          <AboutYou memories={active} query={query} act={act} />
        ) : tab === "people" ? (
          <People people={book.people} query={query} act={act} />
        ) : tab === "style" ? (
          <Style alignment={book.alignment} act={act} />
        ) : tab === "diary" ? (
          <Diary dreams={book.dreams} act={act} />
        ) : (
          <Forgotten memories={forgotten} act={act} />
        )}
      </View>
    </Sheet>
  );
}

type Act = (path: string, body?: unknown, method?: string) => Promise<void>;

const matches = (text: string, query: string) =>
  !query.trim() ||
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .includes(query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim());

function AboutYou({ memories, query, act }: { memories: AgentMemory[]; query: string; act: Act }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string>();
  const groups = useMemo(() => {
    const shown = memories.filter((m) => matches(`${m.text} ${tagLabel(m.tag) ?? ""}`, query));
    const byTag = new Map<string, AgentMemory[]>();
    for (const m of shown) byTag.set(m.tag ?? "other", [...(byTag.get(m.tag ?? "other") ?? []), m]);
    return [...byTag.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [memories, query]);
  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await act("/memories", { text: draft.trim() });
      setDraft("");
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <View style={[s.row, { gap: 6 }]}>
        <TextInput
          accessibilityLabel="Contar algo ao Corgi"
          value={draft}
          onChangeText={setDraft}
          placeholder="Prefiro reuniões de manhã"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          style={[s.input, { flex: 1, minHeight: 40, paddingVertical: 8, fontSize: 14 }]}
        />
        <Button
          small
          primary
          icon={Plus}
          busy={busy}
          disabled={!draft.trim()}
          onPress={() => void add()}
        >
          Lembrar
        </Button>
      </View>
      {!memories.length && (
        <Empty
          icon={Brain}
          text="Nada ainda. Conte o que prefere enquanto conversa; o Corgi também percebe sozinho e anota aqui."
        />
      )}
      {groups.map(([tag, items]) => (
        <Panel key={tag} title={`${capitalize(tagLabel(tag) ?? "outro")} · ${items.length}`}>
          {items.map((memory, index) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              first={index === 0}
              open={open === memory.id}
              onToggle={() => setOpen(open === memory.id ? undefined : memory.id)}
              act={act}
            />
          ))}
        </Panel>
      ))}
      {!!memories.length && !groups.length && <Empty icon={Brain} text="Nada com esse termo." />}
    </View>
  );
}

function MemoryRow({
  memory,
  first,
  open,
  onToggle,
  act,
}: {
  memory: AgentMemory;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  act: Act;
}) {
  const { api } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [why, setWhy] = useState<Why>();
  const [busy, setBusy] = useState(false);
  const detail = [originOf(memory), memory.createdAt && since(memory.createdAt)]
    .filter(Boolean)
    .join(" · ");
  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    try {
      await job();
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: kit.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({ paddingVertical: 11, gap: 2, opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={{ fontSize: 15, lineHeight: 21, color: colors.text }}>{memory.text}</Text>
        <Text style={{ fontSize: 12, color: kit.muted }}>{detail}</Text>
      </Pressable>
      {open && (
        <View style={{ gap: 10, paddingBottom: 12 }}>
          {editing ? (
            <View style={[s.row, { gap: 6 }]}>
              <TextInput
                accessibilityLabel="Corrigir memória"
                autoFocus
                value={text}
                onChangeText={setText}
                style={[s.input, { flex: 1, minHeight: 38, paddingVertical: 7, fontSize: 14 }]}
              />
              <Small
                icon={Check}
                label="Salvar"
                disabled={!text.trim() || busy}
                onPress={() =>
                  void run(async () => {
                    await act(`/memories/${memory.id}`, { text: text.trim() });
                    setEditing(false);
                  })
                }
              />
              <Small
                icon={X}
                label="Cancelar"
                onPress={() => {
                  setText(memory.text);
                  setEditing(false);
                }}
              />
            </View>
          ) : (
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              <Chip icon={Pencil} label="Corrigir" onPress={() => setEditing(true)} />
              <Chip
                icon={HelpCircle}
                label="Por quê?"
                onPress={() =>
                  void run(async () =>
                    setWhy(await api.request<Why>(`/api/agent/memories/${memory.id}/why`)),
                  )
                }
              />
              <Chip
                icon={Trash2}
                label="Esquecer"
                danger
                onPress={() => void run(() => act(`/memories/${memory.id}/forget`))}
              />
              {busy && <ActivityIndicator size="small" color={kit.muted} />}
            </View>
          )}
          {why && <WhyCard why={why} />}
        </View>
      )}
    </View>
  );
}

function WhyCard({ why }: { why: Why }) {
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: kit.tile }}>
      <Text style={{ fontSize: 13, color: colors.text, fontWeight: "600" }}>
        {capitalize(why.how)}
        {why.since ? ` · ${new Date(why.since).toLocaleDateString("pt-BR")}` : ""}
      </Text>
      {why.evidence.map((e) => (
        <View key={`${e.conversation}-${e.messages}`} style={{ gap: 2 }}>
          {!!e.words && (
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text, fontStyle: "italic" }}>
              “{e.words}”
            </Text>
          )}
          <Text style={{ fontSize: 12, color: kit.muted }}>
            {e.conversation === "chat principal" ? "No chat principal" : "Numa conversa paralela"}
            {e.messages ? ` · mensagem ${e.messages}` : ""}
          </Text>
        </View>
      ))}
      {!why.evidence.length && (
        <Text style={{ fontSize: 12, color: kit.muted }}>
          Guardado antes de o Corgi anotar a origem.
        </Text>
      )}
      {!!why.replaced?.length && (
        <Text style={{ fontSize: 12, color: kit.muted }}>Antes: {why.replaced.join(" → ")}</Text>
      )}
    </View>
  );
}

function People({ people, query, act }: { people: MemoryPerson[]; query: string; act: Act }) {
  const [open, setOpen] = useState<string>();
  const shown = people.filter((p) =>
    matches(`${p.name} ${p.aliases.join(" ")} ${p.relation ?? ""}`, query),
  );
  if (!people.length)
    return (
      <Empty
        icon={UserRound}
        text="Quem é quem na sua vida e no trabalho aparece aqui: o Corgi monta isso à noite, a partir do que você conta."
      />
    );
  return (
    <Panel>
      {shown.map((person, index) => (
        <View key={person.id}>
          <Row
            first={index === 0}
            icon={UserRound}
            title={person.name}
            detail={[person.relation, person.howToAddress].filter(Boolean).join(" · ") || undefined}
            onPress={() => setOpen(open === person.id ? undefined : person.id)}
          />
          {open === person.id && (
            <View style={{ gap: 6, paddingLeft: 46, paddingBottom: 12 }}>
              {!!person.aliases.length && (
                <Text style={{ fontSize: 12, color: kit.muted }}>
                  Também: {person.aliases.join(", ")}
                </Text>
              )}
              {person.notes.map((note) => (
                <Text key={note} style={{ fontSize: 14, lineHeight: 20, color: colors.text }}>
                  • {note}
                </Text>
              ))}
              <View style={{ alignSelf: "flex-start" }}>
                <Chip
                  icon={Trash2}
                  label="Esquecer pessoa"
                  danger
                  onPress={() =>
                    void act(`/memory/people/${person.id}/forget`).catch(() => undefined)
                  }
                />
              </View>
            </View>
          )}
        </View>
      ))}
      {!shown.length && <Row first icon={UserRound} title="Ninguém com esse nome" muted />}
    </Panel>
  );
}

function Style({ alignment, act }: { alignment: MemorySynthesis | null; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ reply: "", limits: "", friction: "", week: "" });
  const [busy, setBusy] = useState(false);
  function edit() {
    setDraft({
      reply: alignment?.reply ?? "",
      limits: alignment?.limits ?? "",
      friction: (alignment?.friction ?? []).join("\n"),
      week: alignment?.week ?? "",
    });
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    try {
      await act(
        "/memory/alignment",
        {
          reply: draft.reply,
          limits: draft.limits,
          friction: draft.friction
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean)
            .slice(0, 5),
          week: draft.week,
        },
        "PUT",
      );
      setEditing(false);
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <View style={{ gap: 12 }}>
        {(
          [
            ["reply", "Como responder", "Curto e direto, com a recomendação primeiro."],
            ["limits", "Nunca sem perguntar", "Enviar e-mails, marcar reuniões."],
            ["friction", "Atritos em aberto (um por linha)", ""],
            ["week", "Esta semana", "Fechamento do trimestre."],
          ] as const
        ).map(([key, label, placeholder]) => (
          <View key={key} style={{ gap: 5 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              multiline
              value={draft[key]}
              onChangeText={(value) => setDraft({ ...draft, [key]: value })}
              placeholder={placeholder}
              placeholderTextColor={colors.muted}
              style={[s.input, { minHeight: 64, fontSize: 14, textAlignVertical: "top" }]}
            />
          </View>
        ))}
        <Text style={s.small}>
          Ao salvar, fica do seu jeito: o Corgi para de reescrever à noite.
        </Text>
        <View style={[s.row, { gap: 8 }]}>
          <Button primary icon={Check} busy={busy} onPress={() => void save()}>
            Salvar
          </Button>
          <Button onPress={() => setEditing(false)}>Cancelar</Button>
        </View>
      </View>
    );
  if (!alignment)
    return (
      <View style={{ gap: 14 }}>
        <Empty
          icon={Sparkles}
          text="Depois de algumas conversas, o Corgi escreve aqui como gosta de ser atendido: tom, limites e o que está na sua semana. Você pode ajustar."
        />
        <Button icon={Pencil} onPress={edit}>
          Escrever eu mesmo
        </Button>
      </View>
    );
  const sections: [string, string][] = [
    ["Como responder", alignment.reply],
    ["Nunca sem perguntar", alignment.limits],
    ["Atritos em aberto", alignment.friction.join(" · ")],
    ["Esta semana", alignment.week],
  ];
  return (
    <View style={{ gap: 14 }}>
      <Panel>
        {sections
          .filter(([, value]) => value.trim())
          .map(([label, value], index) => (
            <View
              key={label}
              style={{
                gap: 3,
                paddingVertical: 11,
                borderTopWidth: index ? 1 : 0,
                borderTopColor: kit.line,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: kit.muted }}>{label}</Text>
              <Text style={{ fontSize: 15, lineHeight: 21, color: colors.text }}>{value}</Text>
            </View>
          ))}
      </Panel>
      <Text style={s.small}>
        {alignment.pinned
          ? "Do seu jeito: o Corgi não reescreve."
          : `O Corgi reescreve à noite a partir das conversas · ${since(alignment.updatedAt)}`}
      </Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button small icon={Pencil} onPress={edit}>
          Ajustar
        </Button>
        {alignment.pinned && (
          <Button
            small
            icon={Pin}
            onPress={() => void act("/memory/alignment/unpin").catch(() => undefined)}
          >
            Deixar o Corgi atualizar
          </Button>
        )}
      </View>
    </View>
  );
}

function Diary({ dreams, act }: { dreams: MemoryDream[]; act: Act }) {
  const [busy, setBusy] = useState(false);
  async function reflect() {
    setBusy(true);
    try {
      await act("/memory/reflect");
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 14 }}>
      <Text style={s.small}>
        Toda noite, às 3h, o Corgi relê o que sabe: junta repetições, atualiza o que mudou e escreve
        este diário. O diário não entra nas respostas.
      </Text>
      {!dreams.length && <Empty icon={Moon} text="A primeira reflexão acontece esta noite." />}
      {dreams.map((dream) => {
        const changes = [
          dream.merged && `${dream.merged} ${dream.merged === 1 ? "juntada" : "juntadas"}`,
          dream.superseded &&
            `${dream.superseded} ${dream.superseded === 1 ? "atualizada" : "atualizadas"}`,
          dream.retired && `${dream.retired} ${dream.retired === 1 ? "aposentada" : "aposentadas"}`,
        ].filter(Boolean);
        return (
          <Panel key={dream.id} title={dayLabel(dream.id)}>
            <View style={{ gap: 6, paddingVertical: 11 }}>
              <Text style={{ fontSize: 15, lineHeight: 22, color: colors.text }}>
                {dream.diary}
              </Text>
              {!!changes.length && (
                <Text style={{ fontSize: 12, color: kit.muted }}>{changes.join(" · ")}</Text>
              )}
            </View>
          </Panel>
        );
      })}
      <Button icon={Moon} busy={busy} onPress={() => void reflect()}>
        Refletir agora
      </Button>
    </View>
  );
}

function Forgotten({ memories, act }: { memories: AgentMemory[]; act: Act }) {
  if (!memories.length)
    return (
      <Empty
        icon={Trash2}
        text={`O que você pede para esquecer fica aqui por ${RESTORE_DAYS} dias, fora de todas as respostas. O Corgi não aprende de novo a partir das conversas antigas.`}
      />
    );
  return (
    <Panel>
      {memories.map((memory, index) => {
        const left = memory.retractedAt
          ? Math.max(
              0,
              RESTORE_DAYS - Math.floor((Date.now() - Date.parse(memory.retractedAt)) / 86400000),
            )
          : RESTORE_DAYS;
        return (
          <Row
            key={memory.id}
            first={index === 0}
            icon={Trash2}
            muted
            title={memory.text}
            detail={`Some de vez em ${left} ${left === 1 ? "dia" : "dias"}`}
            trailing={
              <Chip
                icon={RotateCcw}
                label="Restaurar"
                onPress={() => void act(`/memories/${memory.id}/restore`).catch(() => undefined)}
              />
            }
          />
        );
      })}
    </Panel>
  );
}

function Chip({
  icon: Icon,
  label,
  onPress,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        backgroundColor: pressed ? kit.line : kit.tile,
      })}
    >
      <Icon size={13} color={danger ? colors.danger : kit.icon} />
      <Text style={{ fontSize: 13, color: danger ? colors.danger : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function Small({
  icon: Icon,
  label,
  onPress,
  disabled,
}: {
  icon: typeof Pencil;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon size={16} color={kit.icon} />
    </Pressable>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Pencil; text: string }) {
  return (
    <View style={{ alignItems: "center", gap: 10, paddingVertical: 26, paddingHorizontal: 16 }}>
      <Icon size={22} color={kit.muted} />
      <Text style={[s.muted, { textAlign: "center", fontSize: 14 }]}>{text}</Text>
    </View>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function dayLabel(day: string) {
  const date = new Date(`${day}T12:00:00`);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return "Esta noite";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" });
}
