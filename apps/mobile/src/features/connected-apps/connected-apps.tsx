import { ChevronRight, MoreHorizontal, Plus } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Card, colors, ErrorNotice, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { actionPhrase, appName } from "../chat/action-summary";
import { ApifyConnect } from "./apify-card";

interface Connection {
  id: string;
  native?: string;
  toolkit: string;
  status: string;
  name?: string;
  logo?: string;
  permission?: "ask" | "read" | "off";
  /** Who it signs in as (email or "user @ workspace"), once the server has found out. */
  account?: string;
  /** The person's own name for it ("Trabalho", "Pessoal"). */
  label?: string;
  /** Used when the agent isn't told which account; one per app. */
  isDefault?: boolean;
  duplicate?: boolean;
}
/** An action the person chose to always allow from a chat approval card. */
interface AlwaysAllowed {
  id: string; // TOOL_SLUG@account-id
  tool: string;
  toolkit: string;
  title?: string;
  account?: string;
  expiresAt: string;
}
interface Toolkit {
  slug: string;
  /** Connected by Corgi itself (Apify, with the person's key), not through Composio. */
  native?: string;
  name: string;
  logo?: string;
  description?: string;
  /** From the server's curated catalog. */
  category?: string;
  pitch?: string;
  oneTap?: boolean;
  note?: string;
}

/** Catalog groups (server catalog.ts), in display order; "sugestoes" is a short starting set. */
const GROUPS: { id: string; label: string }[] = [
  { id: "sugestoes", label: "Sugestões" },
  { id: "comunicacao", label: "Comunicação" },
  { id: "documentos", label: "Documentos" },
  { id: "redes", label: "Redes sociais" },
  { id: "marketing", label: "Marketing" },
  { id: "vendas", label: "Vendas" },
  { id: "projetos", label: "Projetos" },
  { id: "lugares", label: "Lugares" },
  { id: "dados", label: "Dados" },
];
const SUGGESTED = [
  "googledrive",
  "googlesheets",
  "googledocs",
  "notion",
  "google_maps",
  "linkedin",
  "instagram",
  "googleads",
  "hubspot",
];

/** Composio-backed connectors. Sign-in happens on Composio; OpenMuse only keeps the user ID. */
export function ConnectedApps({ query }: { query: string }) {
  const { api } = useWorkspace();
  const [enabled, setEnabled] = useState<boolean>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string>();
  const [always, setAlways] = useState<AlwaysAllowed[]>([]);
  const [group, setGroup] = useState("sugestoes");
  const [explain, setExplain] = useState<string>();
  const [nativeOpen, setNativeOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const status = await api.request<{
        enabled: boolean;
        connections: Connection[];
        alwaysAllowed?: AlwaysAllowed[];
      }>("/api/apps");
      setEnabled(status.enabled);
      setAlways(status.alwaysAllowed ?? []);
      // An abandoned sign-in tab leaves an INITIATED record; only settled states matter here.
      setConnections(
        status.connections.filter((c) => !["INITIATED", "INITIALIZING"].includes(c.status)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
    // Returning from the Composio sign-in tab is the moment a new connection appears.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => sub.remove();
  }, [load]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      api
        .request<{ toolkits: Toolkit[] }>(`/api/apps/toolkits?q=${encodeURIComponent(query)}`)
        .then((result) => setToolkits(result.toolkits))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [api, enabled, query]);
  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  if (enabled === undefined) return null;
  if (!enabled)
    return (
      <Card style={{ gap: 8 }}>
        <Text style={s.heading}>Conecte seus apps</Text>
        <Text style={s.muted}>
          Adicione COMPOSIO_API_KEY ao .env do servidor e reinicie para conectar Gmail, Agenda,
          Slack e centenas de outros.
        </Text>
      </Card>
    );
  const active = new Set(connections.filter((c) => c.status === "ACTIVE").map((c) => c.toolkit));
  // One entry per app; its accounts listed default first, then oldest.
  const byApp = new Map<string, Connection[]>();
  for (const c of connections) byApp.set(c.toolkit, [...(byApp.get(c.toolkit) ?? []), c]);
  // Searching: the connected apps that match come first; the rest of the list steps aside.
  const q = query.trim().toLowerCase();
  const apps = [...byApp.values()]
    .map((list) => [...list].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault)))
    .filter(
      ([first]) => !q || `${first?.name ?? ""} ${first?.toolkit ?? ""}`.toLowerCase().includes(q),
    );
  const unconnected = toolkits.filter((t) => !active.has(t.slug));
  const available = query
    ? unconnected.slice(0, 30)
    : group === "sugestoes"
      ? SUGGESTED.map((slug) => unconnected.find((t) => t.slug === slug)).filter(
          (t): t is Toolkit => !!t,
        )
      : unconnected.filter((t) => t.category === group);
  return (
    <View style={{ gap: 18 }}>
      <ErrorNotice error={error} />
      {apps.length > 0 && (
        <Group label="Conectados">
          {apps.map((accounts, index) => {
            const [first] = accounts;
            if (!first) return null;
            const key = first.toolkit;
            const live = accounts.filter((c) => c.status === "ACTIVE");
            const permission = first.permission ?? "ask";
            return (
              <View key={key}>
                <Row
                  logo={first.logo}
                  name={first.name ?? first.toolkit}
                  detail={
                    live.length > 1
                      ? `${live.length} contas · ${live.map(accountTitle).join(", ")}`
                      : live[0]
                        ? accountTitle(live[0])
                        : undefined
                  }
                  last={index === apps.length - 1 && open !== key}
                  onPress={() =>
                    first.native ? setNativeOpen(true) : setOpen(open === key ? undefined : key)
                  }
                  trailing={
                    live.length ? (
                      <ChevronRight
                        size={18}
                        color="#A4A7AA"
                        style={{ transform: [{ rotate: open === key ? "90deg" : "0deg" }] }}
                      />
                    ) : (
                      <Text style={{ fontSize: 13, color: "#B4552F" }}>Reconectar</Text>
                    )
                  }
                />
                {open === key && (
                  <View style={{ gap: 12, paddingBottom: 16 }}>
                    <View
                      style={{
                        backgroundColor: "#FFF",
                        borderRadius: 16,
                        paddingHorizontal: 12,
                        borderWidth: 1,
                        borderColor: "#ECEEF0",
                      }}
                    >
                      {accounts.map((c) => (
                        <AccountLine
                          key={c.id}
                          connection={c}
                          several={live.length > 1}
                          busy={busy}
                          onAction={(id, action) => void run(id, action)}
                          api={api}
                          reload={load}
                        />
                      ))}
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy === `${key}:add`}
                        onPress={() =>
                          void run(`${key}:add`, async () => {
                            const { redirectUrl } = await api.request<{ redirectUrl: string }>(
                              "/api/apps/connect",
                              { toolkit: key },
                            );
                            await Linking.openURL(redirectUrl);
                          })
                        }
                        style={({ pressed }) => [
                          s.row,
                          { gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : 1 },
                        ]}
                      >
                        <View
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            borderWidth: 1.5,
                            borderStyle: "dashed",
                            borderColor: "#C9CDD1",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {busy === `${key}:add` ? (
                            <ActivityIndicator size="small" color={colors.blueDark} />
                          ) : (
                            <Plus size={16} color={colors.blueDark} />
                          )}
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.blueDark }}>
                          {live.length ? "Adicionar outra conta" : "Conectar de novo"}
                        </Text>
                      </Pressable>
                    </View>
                    {live.length > 0 && (
                      <View style={{ gap: 8 }}>
                        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
                          O que o Corgi pode fazer
                        </Text>
                        <View
                          style={[
                            s.row,
                            { backgroundColor: "#E8EAEC", borderRadius: 12, padding: 3, gap: 3 },
                          ]}
                        >
                          {(
                            [
                              ["ask", "Com aprovação"],
                              ["read", "Só ler"],
                              ["off", "Desligado"],
                            ] as const
                          ).map(([level, label]) => {
                            const selected = permission === level;
                            return (
                              <Pressable
                                key={level}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                onPress={() =>
                                  void run(`${key}:${level}`, async () => {
                                    await api.request("/api/apps/permissions", {
                                      toolkit: key,
                                      level,
                                    });
                                    await load();
                                  })
                                }
                                style={{
                                  flex: 1,
                                  alignItems: "center",
                                  paddingVertical: 8,
                                  borderRadius: 9,
                                  backgroundColor: selected ? "#FFF" : "transparent",
                                }}
                              >
                                <Text
                                  numberOfLines={1}
                                  style={{
                                    fontSize: 12,
                                    fontWeight: selected ? "600" : "400",
                                    color: selected ? colors.text : colors.muted,
                                  }}
                                >
                                  {label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text style={s.small}>
                          {permission === "off"
                            ? "O Corgi não usa este app."
                            : permission === "read"
                              ? "O Corgi lê, mas nunca muda nada aqui."
                              : "O Corgi lê livremente; enviar, criar ou apagar sempre espera sua aprovação."}
                          {live.length > 1
                            ? " Com várias contas, ele diz qual está usando e pergunta antes de mexer na conta errada."
                            : ""}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </Group>
      )}
      {!query && always.length > 0 && (
        <Group label="Sempre permitidos">
          {always.map((rule, index) => (
            <Row
              key={rule.id}
              logo={connections.find((c) => c.toolkit === rule.toolkit)?.logo}
              name={`${appName(rule.toolkit)} · ${actionPhrase(rule.tool)}`}
              detail={`${rule.account ? `${rule.account} · ` : ""}Roda sem perguntar até ${new Date(
                rule.expiresAt,
              ).toLocaleDateString("pt-BR", {
                day: "numeric",
                month: "short",
              })}. Remova para voltar a pedir aprovação.`}
              last={index === always.length - 1}
              onPress={() =>
                void run(rule.id, async () => {
                  await api.request(
                    `/api/apps/always/${encodeURIComponent(rule.id)}`,
                    undefined,
                    "DELETE",
                  );
                  await load();
                })
              }
              trailing={
                busy === rule.id ? (
                  <ActivityIndicator size="small" color={colors.blueDark} />
                ) : (
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#B4493F" }}>Remover</Text>
                )
              }
            />
          ))}
        </Group>
      )}
      {!query && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
        >
          {GROUPS.map((item) => {
            const selected = group === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setGroup(item.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.text : "#EEF0F2",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: selected ? "#FFF" : colors.text,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {/* Searching, an empty group says nothing: it goes away, unless nothing matched at all. */}
      {!(query && !available.length && apps.length) && (
        <Group label={query ? "Para conectar" : "Disponíveis"}>
          {available.map((t, index) => {
            const setup = t.oneTap === false;
            return (
              <View key={t.slug}>
                <Row
                  logo={t.logo}
                  name={t.name}
                  detail={t.pitch ?? t.description}
                  last={index === available.length - 1 && explain !== t.slug}
                  onPress={() =>
                    t.native
                      ? setNativeOpen(true)
                      : setup
                        ? setExplain(explain === t.slug ? undefined : t.slug)
                        : void run(t.slug, async () => {
                            const { redirectUrl } = await api.request<{ redirectUrl: string }>(
                              "/api/apps/connect",
                              { toolkit: t.slug },
                            );
                            await Linking.openURL(redirectUrl);
                          })
                  }
                  trailing={
                    busy === t.slug ? (
                      <ActivityIndicator size="small" color={colors.blueDark} />
                    ) : (
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: "600",
                          color: setup ? colors.muted : colors.blueDark,
                        }}
                      >
                        {setup ? "Como conectar" : "Conectar"}
                      </Text>
                    )
                  }
                />
                {setup && explain === t.slug && (
                  <Text style={[s.small, { paddingBottom: 12, paddingLeft: 44, lineHeight: 18 }]}>
                    {t.note}
                  </Text>
                )}
              </View>
            );
          })}
          {!available.length && (
            <Text style={[s.muted, { paddingVertical: 16 }]}>
              {query ? "Nenhum app encontrado." : "Tudo daqui já está conectado."}
            </Text>
          )}
        </Group>
      )}
      {nativeOpen && (
        <ApifyConnect
          onClose={() => setNativeOpen(false)}
          onChanged={() => {
            void load();
            setToolkits((list) => list.filter((t) => !t.native));
          }}
        />
      )}
    </View>
  );
}

/** "Trabalho · voce@empresa.com", or whichever part is known. */
function accountTitle(c: Connection) {
  return [c.label, c.account].filter(Boolean).join(" · ") || "Conta conectada";
}

const AVATAR_COLORS = ["#E7F0FF", "#FDEBD8", "#E3F4E8", "#F2E8FB", "#FCE4E4", "#E6F3F6"];
const avatarColor = (seed: string) =>
  AVATAR_COLORS[[...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];

/**
 * One account of an app: an initial, its name and address, the default badge, and its actions
 * (make default, rename, disconnect) tucked behind "⋯" so the row stays clean.
 */
function AccountLine({
  connection: c,
  several,
  busy,
  onAction,
  api,
  reload,
}: {
  connection: Connection;
  several: boolean;
  busy: string;
  onAction: (id: string, action: () => Promise<void>) => void;
  api: ReturnType<typeof useWorkspace>["api"];
  reload: () => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState(c.label ?? "");
  const live = c.status === "ACTIVE";
  const title = c.label || c.account || "Conectado";
  const save = () =>
    onAction(`${c.id}:label`, async () => {
      await api.request(`/api/apps/connections/${c.id}`, { label: label.trim() || null }, "PATCH");
      setEditing(false);
      setMenu(false);
      await reload();
    });
  const action = (
    text: string,
    id: string,
    run: () => void,
    tone: "normal" | "danger" = "normal",
  ) => (
    <Pressable
      accessibilityRole="button"
      onPress={run}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: tone === "danger" ? "#FCEDEC" : "#F1F4F7",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {busy === id ? (
        <ActivityIndicator size="small" color={colors.blueDark} />
      ) : (
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: tone === "danger" ? "#B4493F" : colors.text,
          }}
        >
          {text}
        </Text>
      )}
    </Pressable>
  );
  return (
    <View
      style={{ paddingVertical: 11, gap: 10, borderBottomWidth: 1, borderBottomColor: "#EEF0F2" }}
    >
      <View style={[s.row, { gap: 12 }]}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: live ? avatarColor(c.account ?? c.id) : "#F1F1F1",
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>
            {title.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <View style={[s.row, { gap: 6 }]}>
            <Text
              style={[s.text, { fontSize: 15, fontWeight: "600", flexShrink: 1 }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {live && c.duplicate && (
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 7,
                  backgroundColor: "#FFF3DC",
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#8A5A00" }}>
                  Repetida · pode remover
                </Text>
              </View>
            )}
            {live && several && c.isDefault && (
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 7,
                  backgroundColor: "#E7F0FF",
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.blueDark }}>
                  Padrão
                </Text>
              </View>
            )}
          </View>
          {!!c.label && !!c.account && (
            <Text style={[s.small, { fontSize: 12 }]} numberOfLines={1}>
              {c.account}
            </Text>
          )}
          {!live && (
            <Text style={[s.small, { fontSize: 12, color: "#B4552F" }]}>
              Desconectada · conecte de novo para restaurar
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Opções de ${title}`}
          accessibilityState={{ expanded: menu }}
          onPress={() => {
            setMenu(!menu);
            setConfirming(false);
            setEditing(false);
          }}
          hitSlop={8}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: menu ? "#EEF1F4" : "transparent",
          }}
        >
          <MoreHorizontal size={18} color={colors.muted} />
        </Pressable>
      </View>
      {menu &&
        (editing ? (
          <View style={[s.row, { gap: 8, paddingLeft: 46 }]}>
            <TextInput
              value={label}
              onChangeText={setLabel}
              onSubmitEditing={save}
              autoFocus
              maxLength={40}
              placeholder="Ex.: Trabalho, Pessoal"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Nome da conta"
              style={[s.input, { flex: 1, minHeight: 36, paddingVertical: 6, fontSize: 14 }]}
            />
            {action("Salvar", `${c.id}:label`, save)}
          </View>
        ) : (
          <View style={[s.row, { gap: 8, flexWrap: "wrap", paddingLeft: 46 }]}>
            {live &&
              several &&
              !c.isDefault &&
              action("Tornar padrão", `${c.id}:default`, () =>
                onAction(`${c.id}:default`, async () => {
                  await api.request(`/api/apps/connections/${c.id}`, { isDefault: true }, "PATCH");
                  setMenu(false);
                  await reload();
                }),
              )}
            {live && action("Renomear", `${c.id}:rename`, () => setEditing(true))}
            {action(
              confirming ? "Confirmar desconexão" : "Desconectar",
              c.id,
              () =>
                confirming
                  ? onAction(c.id, async () => {
                      await api.request(`/api/apps/connections/${c.id}`, undefined, "DELETE");
                      await reload();
                    })
                  : setConfirming(true),
              "danger",
            )}
          </View>
        ))}
    </View>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.small, { marginLeft: 12 }]}>{label}</Text>
      <View style={{ paddingHorizontal: 16, borderRadius: 23, backgroundColor: "#F3F4F5" }}>
        {children}
      </View>
    </View>
  );
}

function Row({
  logo,
  name,
  detail,
  last,
  trailing,
  onPress,
}: {
  logo?: string;
  name: string;
  detail?: string;
  last: boolean;
  trailing: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          gap: 14,
          minHeight: 61,
          paddingVertical: 10,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: "#E5E7E9",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          backgroundColor: "#FFF",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {logo ? (
          <Image source={{ uri: logo }} style={{ width: 22, height: 22 }} resizeMode="contain" />
        ) : (
          <Text style={{ fontWeight: "700", color: colors.muted }}>{name.charAt(0)}</Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.text}>{name}</Text>
        {!!detail && (
          <Text numberOfLines={1} style={[s.small, { fontSize: 12 }]}>
            {detail}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}
