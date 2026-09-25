import {
  CalendarDays,
  ChevronRight,
  Instagram,
  type LucideIcon,
  Mail,
  Plus,
  Slack,
  X,
} from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText } from "../../shared/format";
import { kit } from "../../shared/kit";
import { Button, colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import {
  type AppChoice,
  addChannel,
  type IdeaSource,
  type IdeaSourcesResponse,
  type SourceApp,
  type SourcesState,
  setAccount,
  setApp,
  toSources,
  toState,
  update,
} from "./idea-sources";

const ICONS: Record<SourceApp, LucideIcon> = {
  googlecalendar: CalendarDays,
  gmail: Mail,
  slack: Slack,
  instagram: Instagram,
};

/** Loads what Ideas reads (GET /api/agent/idea-sources); `reload` after a save. */
export function useIdeaSources() {
  const { api } = useWorkspace();
  const [data, setData] = useState<IdeaSourcesResponse>();
  const [error, setError] = useState("");
  async function reload() {
    try {
      setData(await api.request<IdeaSourcesResponse>("/api/agent/idea-sources"));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    void reload();
  }, [api]);
  return { data, error, reload, setData };
}

/** "O que o Corgi observa: Agenda, Gmail · Ajustar", above the ideas. */
export function SourcesLine({ names, onPress }: { names?: string[]; onPress: () => void }) {
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "Corgi";
  const list = names === undefined ? "…" : names.length ? names.join(", ") : "nada ainda";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Fontes das ideias: ${list}. Ajustar`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        s.row,
        { gap: 6, paddingHorizontal: 4, flexWrap: "wrap", opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, color: kit.muted, flexShrink: 1 }}>
        O que o {agent} observa:{" "}
        <Text style={{ color: colors.text, fontWeight: "500" }}>{list}</Text>
        <Text style={{ color: kit.muted }}> · </Text>
        <Text style={{ color: kit.accent, fontWeight: "600" }}>Ajustar</Text>
      </Text>
    </Pressable>
  );
}

export function SourcesSheet({
  initial,
  onClose,
  onSaved,
}: {
  initial?: IdeaSourcesResponse;
  onClose: () => void;
  onSaved: (sources: IdeaSource[]) => void;
}) {
  const { api, navigate } = useWorkspace();
  const [state, setState] = useState<SourcesState | undefined>(
    initial ? toState(initial.apps, initial.sources) : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (state) return;
    api
      .request<IdeaSourcesResponse>("/api/agent/idea-sources")
      .then((result) => setState(toState(result.apps, result.sources)))
      .catch((e) => setError(errorText(e)));
  }, [api, state]);
  async function save() {
    if (!state) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ sources: IdeaSource[] }>(
        "/api/agent/idea-sources",
        { sources: toSources(state) },
        "PUT",
      );
      onSaved(result.sources);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Fontes das ideias"
      subtitle="O que é lido para sugerir próximos passos."
      onClose={onClose}
      footer={
        <View style={{ gap: 10, paddingBottom: 4 }}>
          <ErrorNotice error={state ? error : ""} />
          <Text style={[s.small, { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 }]}>
            As ideias usam só o que estiver ligado aqui, além das suas memórias e metas.
          </Text>
          <Button primary busy={busy} disabled={!state} onPress={() => void save()}>
            Salvar
          </Button>
        </View>
      }
    >
      {!state ? (
        error ? (
          <ErrorNotice error={error} />
        ) : (
          <ActivityIndicator color={colors.blueDark} style={{ marginVertical: 30 }} />
        )
      ) : (
        <View style={{ gap: 12 }}>
          {state.map((choice) => (
            <AppCard
              key={choice.info.app}
              choice={choice}
              onChange={setState}
              state={state}
              onConnect={() => {
                onClose();
                navigate("apps");
              }}
            />
          ))}
        </View>
      )}
    </Sheet>
  );
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onChange}
      trackColor={{ false: "#E3E6E9", true: kit.accent }}
      thumbColor="#FFFFFF"
      {...({ activeThumbColor: "#FFFFFF" } as object)}
    />
  );
}

/** A labelled line inside a card: text on the left, a switch (or anything) on the right. */
function Line({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <View
      style={[s.row, { gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: kit.line }]}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, color: colors.text }}>
          {title}
        </Text>
        {!!detail && <Text style={{ fontSize: 12, color: kit.muted }}>{detail}</Text>}
      </View>
      {children}
    </View>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 12, lineHeight: 17, color: kit.muted }}>{children}</Text>;
}

function AppCard({
  choice,
  state,
  onChange,
  onConnect,
}: {
  choice: AppChoice;
  state: SourcesState;
  onChange: (state: SourcesState) => void;
  onConnect: () => void;
}) {
  const { info } = choice;
  const Icon = ICONS[info.app];
  const many = info.accounts.length > 1;
  const head = (
    <>
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
        <Icon size={16} color={info.connected ? kit.icon : kit.muted} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 20,
            fontWeight: "500",
            color: info.connected ? colors.text : kit.muted,
          }}
        >
          {info.name}
        </Text>
        <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 16, color: kit.muted }}>
          {!info.connected
            ? info.app === "instagram"
              ? "Conecte em Ajustes · só contas Business ou Creator"
              : "Conecte em Ajustes"
            : many && choice.on
              ? choice.chosen.length === info.accounts.length
                ? `Todas as ${info.accounts.length} contas`
                : `${choice.chosen.length} de ${info.accounts.length} contas`
              : info.detail}
        </Text>
      </View>
      {info.connected ? (
        <Toggle
          label={`Usar ${info.name}`}
          value={choice.on}
          onChange={(on) => onChange(setApp(state, info.app, on))}
        />
      ) : (
        <ChevronRight size={16} color="#B3B8BC" />
      )}
    </>
  );
  return (
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
      {info.connected ? (
        <View style={[s.row, { gap: 12, paddingVertical: 11 }]}>{head}</View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${info.name}: conecte em Ajustes`}
          onPress={onConnect}
          style={({ pressed }) => [
            s.row,
            { gap: 12, paddingVertical: 11, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {head}
        </Pressable>
      )}
      {info.connected && choice.on && (
        <View style={{ paddingBottom: 6 }}>
          {many &&
            info.accounts.map((account) => (
              <Line key={account.id} title={account.label}>
                <Toggle
                  label={`Usar ${account.label}`}
                  value={choice.chosen.includes(account.id)}
                  onChange={(value) => onChange(setAccount(state, info.app, account.id, value))}
                />
              </Line>
            ))}
          {info.app === "gmail" && (
            <View
              style={{
                gap: 7,
                paddingTop: 12,
                paddingBottom: 8,
                borderTopWidth: 1,
                borderTopColor: kit.line,
              }}
            >
              <Describe
                app="gmail"
                note={choice.note}
                placeholder="Ex.: e-mails de clientes e do financeiro que pedem resposta, sem newsletters"
                onResult={(result) =>
                  onChange(update(state, "gmail", { note: result.note, query: result.query ?? "" }))
                }
                onNote={(note) => onChange(update(state, "gmail", { note }))}
              />
              <GmailFilter
                query={choice.query}
                onChange={(query) => onChange(update(state, "gmail", { query }))}
              />
            </View>
          )}
          {info.app === "slack" && (
            <SlackOptions choice={choice} state={state} onChange={onChange} />
          )}
          {info.app === "instagram" && (
            <View
              style={{
                paddingTop: 10,
                paddingBottom: 6,
                borderTopWidth: 1,
                borderTopColor: kit.line,
              }}
            >
              <Hint>Só contas Business ou Creator.</Hint>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function SlackOptions({
  choice,
  state,
  onChange,
}: {
  choice: AppChoice;
  state: SourcesState;
  onChange: (state: SourcesState) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    onChange(update(state, "slack", { channels: addChannel(choice.channels, draft) }));
    setDraft("");
  };
  return (
    <View>
      <View
        style={{ paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: kit.line }}
      >
        <Describe
          app="slack"
          note={choice.note}
          placeholder="Ex.: o que for de vendas e da diretoria, e quando me marcarem"
          onResult={(result) =>
            onChange(
              update(state, "slack", {
                note: result.note,
                channels: result.channels ?? [],
                mentions: result.mentions ?? true,
                dms: result.dms ?? true,
              }),
            )
          }
          onNote={(note) => onChange(update(state, "slack", { note }))}
        />
      </View>
      <Line title="Menções a você">
        <Toggle
          label="Menções a você"
          value={choice.mentions}
          onChange={(mentions) => onChange(update(state, "slack", { mentions }))}
        />
      </Line>
      <Line title="Mensagens diretas">
        <Toggle
          label="Mensagens diretas"
          value={choice.dms}
          onChange={(dms) => onChange(update(state, "slack", { dms }))}
        />
      </Line>
      <View
        style={{
          gap: 9,
          paddingTop: 12,
          paddingBottom: 8,
          borderTopWidth: 1,
          borderTopColor: kit.line,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>Canais</Text>
        {choice.channels.length > 0 && (
          <View style={[s.row, { flexWrap: "wrap", gap: 6 }]}>
            {choice.channels.map((channel) => (
              <View
                key={channel}
                style={[
                  s.row,
                  {
                    gap: 2,
                    paddingLeft: 11,
                    paddingRight: 4,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: kit.tile,
                  },
                ]}
              >
                <Text style={{ fontSize: 13, color: colors.text }}>#{channel}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remover #${channel}`}
                  hitSlop={6}
                  onPress={() =>
                    onChange(
                      update(state, "slack", {
                        channels: choice.channels.filter((c) => c !== channel),
                      }),
                    )
                  }
                  style={({ pressed }) => ({
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? "#E3E6E9" : "transparent",
                  })}
                >
                  <X size={13} color={kit.icon} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={[s.row, { gap: 8 }]}>
          <TextInput
            accessibilityLabel="Nome do canal"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            submitBehavior="submit"
            returnKeyType="done"
            placeholder="#nome-do-canal"
            placeholderTextColor={kit.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              s.input,
              { flex: 1, minWidth: 0, minHeight: 42, paddingVertical: 10, borderRadius: 14 },
            ]}
          />
          <Button small icon={Plus} disabled={!draft.trim().replace(/^#+/, "")} onPress={add}>
            Adicionar
          </Button>
        </View>
      </View>
    </View>
  );
}

type Interpreted = {
  note: string;
  query?: string;
  channels?: string[];
  mentions?: boolean;
  dms?: boolean;
};

/**
 * "O que observar" in the person's own words; "Ajustar" asks the server to turn it into the
 * real filter (a Gmail search, or Slack channels picked from the workspace) and fills it in.
 */
function Describe({
  app,
  note,
  placeholder,
  onResult,
  onNote,
}: {
  app: "gmail" | "slack";
  note: string;
  placeholder: string;
  onResult: (result: Interpreted) => void;
  onNote: (note: string) => void;
}) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function interpret() {
    const text = note.trim();
    if (text.length < 3) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<Omit<Interpreted, "note">>(
        "/api/agent/idea-sources/interpret",
        { app, text },
      );
      onResult({ ...result, note: text });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>O que observar</Text>
      <View style={[s.row, { gap: 8, alignItems: "flex-end" }]}>
        <TextInput
          accessibilityLabel={`O que observar no ${app === "gmail" ? "Gmail" : "Slack"}`}
          value={note}
          onChangeText={onNote}
          onSubmitEditing={() => void interpret()}
          placeholder={placeholder}
          placeholderTextColor={kit.muted}
          multiline
          style={[
            s.input,
            { flex: 1, minHeight: 42, paddingVertical: 10, borderRadius: 14, fontSize: 14 },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajustar o filtro com IA"
          disabled={busy || note.trim().length < 3}
          onPress={() => void interpret()}
          style={({ pressed }) => ({
            height: 42,
            paddingHorizontal: 14,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: note.trim().length < 3 ? "#F1F3F5" : colors.blue,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>Ajustar</Text>
          )}
        </Pressable>
      </View>
      <Hint>Escreva do seu jeito; eu monto o filtro e você confere antes de salvar.</Hint>
      <ErrorNotice error={error} />
    </View>
  );
}

/** The Gmail search in use, readable; "Editar" opens the raw field for fine-tuning. */
function GmailFilter({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <View style={[s.row, { gap: 8 }]}>
        <Text style={[s.small, { flex: 1 }]} numberOfLines={editing ? undefined : 2}>
          Filtro:{" "}
          <Text style={{ color: colors.text }}>{query || "in:inbox newer_than:4d (padrão)"}</Text>
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setEditing(!editing)} hitSlop={6}>
          <Text style={[s.small, { fontWeight: "600", color: colors.blueDark }]}>
            {editing ? "Pronto" : "Editar"}
          </Text>
        </Pressable>
      </View>
      {editing && (
        <TextInput
          accessibilityLabel="Busca do Gmail"
          value={query}
          onChangeText={onChange}
          placeholder="in:inbox newer_than:4d"
          placeholderTextColor={kit.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[s.input, { minHeight: 42, paddingVertical: 10, borderRadius: 14, fontSize: 13 }]}
        />
      )}
    </View>
  );
}
