import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Check,
  type LucideIcon,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  Repeat,
  Settings2,
  X,
} from "lucide-react-native";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import { AgentActivityScreen } from "./src/features/activity/tasks";
import { BrowserScreen } from "./src/features/browser/browser-screen";
import { CalendarScreen } from "./src/features/calendar/calendar-screen";
import { attentionCount } from "./src/features/chat/action-summary";
import { ChatScreen, WorkspaceTools } from "./src/features/chat/chat";
import { LiveStatusProvider, useLiveStatus } from "./src/features/chat/live-status";
import { TaskThreadHeader } from "./src/features/chat/task-note";
import {
  LOCAL_MAIN,
  ThreadsProvider,
  ThreadsSheet,
  useMuseThread,
} from "./src/features/chat/threads";
import { ComputerEntry } from "./src/features/computer/computer";
import { ComputerDraftProvider } from "./src/features/computer/computer-drafts";
import { AppsScreen } from "./src/features/connected-apps/apps-screen";
import { FilesScreen } from "./src/features/files/files-screen";
import { GoalsScreen } from "./src/features/goals/goals-screen";
import { IdeasScreen } from "./src/features/ideas/ideas-screen";
import { MailScreen } from "./src/features/mail/mail-screen";
import { AssistantSheet } from "./src/features/settings/assistant-sheet";
import { AgentAvatar } from "./src/mascot/agent-avatar";
import { RegiClipPlayer } from "./src/mascot/RegiClipPlayer";
import { Details } from "./src/screens/details";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/shared/agent-workspace";
import { API_URL, createSession, MuseApi, setApiUrl } from "./src/shared/api";
import { useComposerFocused } from "./src/shared/composer-focus";
import { startPush } from "./src/shared/push";
import { clearKey, loadKey, loadServer, saveKey, saveServer } from "./src/shared/saved-key";
import { Button, Card, colors, ErrorNotice, Field, IconButton, Mascot, s } from "./src/shared/ui";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/shared/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "activity", label: "Atividade", icon: PanelsTopLeft },
  { id: "goals", label: "Rotinas", icon: Repeat },
  { id: "apps", label: "Ajustes", icon: Settings2 },
];
/** Screens opened from a tab, with the way back: Ideias from Atividade, the rest from Ajustes. */
const parentOf: Partial<Record<Section, { tab: Section; label: string }>> = {
  ideas: { tab: "activity", label: "Voltar para Atividade" },
  mail: { tab: "apps", label: "Voltar para Ajustes" },
  calendar: { tab: "apps", label: "Voltar para Ajustes" },
  browser: { tab: "apps", label: "Voltar para Ajustes" },
  files: { tab: "apps", label: "Voltar para Ajustes" },
};
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: "Atividade", subtitle: "Planos, progresso, decisões e resultados." },
  ideas: { title: "Ideias", subtitle: "Próximos passos úteis, a partir do seu mundo." },
  goals: {
    title: "Rotinas",
    subtitle: "O que o Corgi faz sozinho, o que acompanha e suas metas.",
  },
  apps: {
    title: "Ajustes",
    subtitle: "Seu assistente, o computador dele e os apps.",
  },
  connections: { title: "Apps", subtitle: "Conexões e recursos." },
  mail: { title: "E-mail", subtitle: "As conversas por trás do seu trabalho." },
  calendar: { title: "Agenda", subtitle: "Tempo para o que importa." },
  browser: { title: "Navegador", subtitle: "Suas sessões de navegação conectadas." },
  files: { title: "Arquivos", subtitle: "Documentos, formulários e cópias preenchidas." },
};
// Design-review pages, loaded only on their own routes: /regi shows every mood of the mascot.
const ElementsGallery = lazy(() =>
  import("./src/features/chat/elements-gallery").then((m) => ({ default: m.ElementsGallery })),
);
const RegiGallery = lazy(() =>
  import("./src/mascot/RegiGallery").then((m) => ({ default: m.RegiGallery })),
);
const regiGallery =
  Platform.OS === "web" && typeof location !== "undefined" && location.pathname === "/regi";
// /elements renders every structured answer element with fixture data (design review).
const elementsGallery =
  Platform.OS === "web" && typeof location !== "undefined" && location.pathname === "/elements";

export default function App() {
  if (regiGallery)
    return (
      <Suspense fallback={null}>
        <RegiGallery />
      </Suspense>
    );
  if (elementsGallery)
    return (
      <SafeAreaProvider>
        <Suspense fallback={null}>
          <ElementsGallery />
        </Suspense>
      </SafeAreaProvider>
    );
  return <WorkspaceRoot />;
}

function WorkspaceRoot() {
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [server, setServer] = useState(API_URL);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  /** `manual`: the person pressed Entrar, so the server on screen wins over the saved one. */
  const connect = useCallback(async (typed?: string, manual = false) => {
    setBusy(true);
    setError("");
    // The server chosen on this device (native), then the key typed now or the saved one.
    const savedServer = Platform.OS === "web" ? undefined : await loadServer();
    if (!manual && savedServer) setApiUrl(savedServer);
    setServer(API_URL);
    const saved = typed ? undefined : await loadKey();
    const key = typed ?? saved;
    try {
      const session = await createSession(key);
      if (key) await saveKey(key);
      if (Platform.OS !== "web") await saveServer(API_URL);
      setToken(session.token);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // 401 = wrong or missing key (by status: the message text is translated).
      if ((e as { status?: number }).status === 401) {
        if (saved) await clearKey();
        // First open, or the saved key stopped working: just ask for it.
        setError(key ? "Chave de acesso incorreta." : "");
      } else setError(`Não consegui falar com o Corgi em ${API_URL}. ${message}`);
      setToken("");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void connect();
  }, [connect]);
  // Sessions last 24 h; when one expires mid-use, reopen it quietly with the saved key.
  // Several polls can hit the expiry at once: reconnect once.
  const reconnecting = useRef(false);
  const reconnect = useCallback(() => {
    if (reconnecting.current) return;
    reconnecting.current = true;
    void connect().finally(() => {
      reconnecting.current = false;
    });
  }, [connect]);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} onExpired={reconnect} />
        </CopilotKitProvider>
      ) : (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            {/* Regi reacts on the way in: thinks while connecting, smiles at a typed key, droops on errors. */}
            <View>
              <RegiClipPlayer
                size={150}
                target={busy ? "think" : error ? "lookDown" : accessKey ? "smile" : "neutral"}
              />
              {/* The clips are head and shoulders: fade the cut edge into the page. */}
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(252,252,252,0)", colors.canvas]}
                style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 44 }}
              />
            </View>
            <Text
              style={{ fontSize: 32, color: colors.text, letterSpacing: -1, fontWeight: "500" }}
            >
              Corgi
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>
              Seu assistente, de qualquer lugar.
            </Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Card style={{ width: "100%" }}>
                <ErrorNotice error={error} />
                <Field
                  label="Chave de acesso"
                  value={accessKey}
                  onChangeText={setAccessKey}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Cole a chave do servidor"
                />
                {Platform.OS !== "web" && (
                  <Field
                    label="Servidor"
                    value={server}
                    onChangeText={setServer}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder="https://seu-mac.tailnet.ts.net"
                  />
                )}
                <Button
                  primary
                  onPress={() => {
                    setApiUrl(server);
                    void connect(accessKey || undefined, true);
                  }}
                >
                  Entrar
                </Button>
                <Text style={[s.small, { marginTop: 15 }]}>
                  Chave e servidor ficam guardados neste aparelho.
                  {Platform.OS === "web" ? ` Servidor: ${API_URL}` : ""}
                </Text>
              </Card>
            )}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({ token, onExpired }: { token: string; onExpired: () => void }) {
  const api = useMemo(() => new MuseApi(token, onExpired), [token, onExpired]);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch((e) => setError(String(e)));
    });
    return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>
              Tentar de novo
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>Abrindo seu espaço…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{ workspace, api, section, navigate, refresh, open, close, notify: setToast, ask }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={token}>
          <ThreadsProvider>
            <LiveStatusProvider>
              <WorkspaceShell
                detail={detail}
                toast={toast}
                clearToast={() => setToast("")}
                error={error}
                prompt={prompt}
              />
            </LiveStatusProvider>
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  const { workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const { selection, visited, select } = useMuseThread();
  const composerFocused = useComposerFocused();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<Section>();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const typing = composerFocused && section === "chat" && !desktop;
  const pending = attentionCount(workspace.actions, data?.tasks || [], data?.notifications || []);
  // What the pill talks about: work under way first, then the newest thing waiting on the person
  // from the last day (an old question stays in Atividade instead of tinting the header forever).
  const activeTask =
    data?.tasks.find((task) => task.status === "running" && !task.archivedAt) ||
    data?.tasks
      .filter(
        (task) =>
          (task.status === "waiting_approval" || task.status === "waiting_input") &&
          !task.archivedAt &&
          Date.now() - Date.parse(task.updatedAt) < 24 * 60 * 60 * 1000,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const agentName = data?.identity.name || "Corgi";
  const [assistantOpen, setAssistantOpen] = useState(false);
  // A tap on Regi is a hello: she smiles for a moment. Nothing moves, no screen changes.
  const [poked, setPoked] = useState(false);
  const pokeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setPoked(true);
    clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => setPoked(false), 2500);
  }, []);
  const live = useLiveStatus().label;
  // What the name pill says besides the name: nothing when idle, a short live status otherwise.
  const status: { text: string; tone: "working" | "waiting" } | undefined = live
    ? { text: live, tone: "working" }
    : activeTask
      ? activeTask.status === "waiting_approval"
        ? { text: "Para revisar", tone: "waiting" }
        : activeTask.status === "waiting_input"
          ? { text: "Aguardando você", tone: "waiting" }
          : {
              text:
                activeTask.plan.find((step) => step.status === "running")?.title ||
                activeTask.title,
              tone: "working",
            }
      : data?.tasks.some((task) => task.status === "queued")
        ? { text: "Começando…", tone: "working" }
        : undefined;
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : AppsScreen;
  // A tapped notification opens what it is about ("/?open=task:…"), at launch or while open.
  useEffect(
    () =>
      startPush((url) => {
        const target = new URL(url, "https://corgi.local").searchParams.get("open") ?? "";
        const [kind, id] = target.split(":");
        if (kind === "task" && id) open({ type: "task", taskId: id });
      }),
    [open],
  );
  const parent = parentOf[section];
  // Swipe right from the left half of the screen opens the menu (like the ☰ button). Only a
  // clearly horizontal drag counts, and only if no child (a table or carousel) took it first.
  const openMenuSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.x0 < width * 0.5 && gesture.dx > 24 && Math.abs(gesture.dy) < gesture.dx * 0.5,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > 70 && Math.abs(gesture.dy) < gesture.dx * 0.6) setThreadsOpen(true);
        },
      }),
    [width],
  );
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        // With the keyboard up the home-indicator inset is under the keyboard: no gap above it.
        edges={typing ? ["top"] : ["top", "bottom"]}
        {...openMenuSwipe.panHandlers}
      >
        <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View
            style={{
              minHeight: desktop ? 130 : 106,
              paddingTop: desktop ? 16 : 8,
              paddingBottom: 6,
              marginHorizontal: 20,
            }}
          >
            <View style={{ position: "absolute", left: 0, top: 16, zIndex: 10, elevation: 10 }}>
              <IconButton
                icon={Menu}
                label="Abrir conversas e menu"
                text={width >= 520 ? "Menu" : undefined}
                expanded={threadsOpen}
                onPress={() => setThreadsOpen(true)}
              />
            </View>
            <View style={{ alignItems: "center", gap: 1 }}>
              <View
                style={{
                  position: "absolute",
                  top: desktop ? 18 : 14,
                  left: "50%",
                  marginLeft: desktop ? 40 : 36,
                  zIndex: 5,
                }}
              >
                <ComputerEntry />
              </View>
              {assistantOpen && <AssistantSheet onClose={() => setAssistantOpen(false)} />}
              <View style={{ alignItems: "center", maxWidth: "70%" }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${agentName}`}
                  onPress={poke}
                  hitSlop={4}
                >
                  <AgentAvatar size={desktop ? 80 : 72} poked={poked} />
                </Pressable>
                {/* Name pill tucked over Regi's chest. It grows only while Corgi is doing
                    something (a pulsing dot + a short status); tap opens that work, or renames
                    when idle. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    status ? `${agentName}: ${status.text}. Abrir` : `${agentName}. Mudar o nome`
                  }
                  onPress={() =>
                    !status
                      ? setAssistantOpen(true)
                      : activeTask
                        ? open({ type: "task", taskId: activeTask.id })
                        : navigate("activity")
                  }
                  style={[
                    s.row,
                    {
                      gap: 7,
                      maxWidth: 260,
                      marginTop: desktop ? -20 : -18,
                      paddingHorizontal: 14,
                      paddingVertical: 5,
                      borderRadius: 999,
                      backgroundColor: "#FFFFFF",
                      shadowColor: "#1B2A33",
                      shadowOpacity: 0.1,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: 3,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: colors.text,
                      letterSpacing: -0.3,
                    }}
                  >
                    {agentName}
                  </Text>
                  {status && (
                    <>
                      <StatusPulse tone={status.tone} />
                      <Text
                        numberOfLines={1}
                        style={{ flexShrink: 1, fontSize: 13, color: colors.muted }}
                      >
                        {status.text}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
            <View style={{ position: "absolute", right: 0, top: 16, zIndex: 10, elevation: 10 }}>
              <IconButton
                icon={Bell}
                label={`Notificações, ${pending} pendentes`}
                onPress={() => open({ type: "notifications" })}
              />
              {pending > 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 4,
                    position: "absolute",
                    top: 7,
                    right: 9,
                    backgroundColor: colors.blueDark,
                  }}
                />
              )}
            </View>
          </View>
          <View style={{ flex: 1, minHeight: 0 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: desktop ? 42 : 22, paddingBottom: 28 }}
                keyboardShouldPersistTaps="handled"
              >
                {parent && (
                  <Button
                    small
                    style={{ alignSelf: "flex-start", marginBottom: 18 }}
                    onPress={() => navigate(parent.tab)}
                  >
                    {parent.label}
                  </Button>
                )}
                <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                <ErrorNotice error={error} />
                <Screen />
              </ScrollView>
            )}
            <View
              style={{
                display: section === "chat" ? "flex" : "none",
                flex: 1,
                paddingHorizontal: desktop ? 42 : 17,
              }}
            >
              {selection.id !== LOCAL_MAIN &&
                (data?.tasks.some((task) => task.state.threadId === selection.id) ||
                data?.fuzzies?.some((f) => f.threadId === selection.id) ? (
                  <TaskThreadHeader threadId={selection.id} />
                ) : (
                  <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                    Conversa paralela
                  </Text>
                ))}
              {visited.map((thread) => (
                <View
                  key={thread.id}
                  style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                >
                  <ChatScreen
                    thread={thread}
                    active={section === "chat" && selection.id === thread.id}
                    prompt={selection.id === thread.id ? prompt : undefined}
                  />
                </View>
              ))}
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: typing ? 0 : 8,
              paddingBottom: desktop ? 18 : typing ? 4 : 6,
              alignItems: "center",
            }}
          >
            <View
              accessibilityRole="tablist"
              style={{
                // Typing on a phone: the tabs step aside for the keyboard and the conversation.
                display: typing ? "none" : "flex",
                flexDirection: "row",
                width: "100%",
                maxWidth: 400,
                paddingVertical: 6,
                paddingHorizontal: 6,
                backgroundColor: "rgba(255, 255, 255, 0.92)",
                borderRadius: 24,
                boxShadow: "0 1px 2px rgba(17, 25, 28, 0.04), 0 6px 20px rgba(17, 25, 28, 0.06)",
              }}
            >
              {nav.map((item) => {
                const active = section === item.id || parent?.tab === item.id;
                const hovered = hoveredTab === item.id && !active;
                const tint = active ? colors.blueDark : hovered ? "#6FA3C7" : colors.muted;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      // Chat again while in the chat: back to the main conversation, or from
                      // there, the list of conversations.
                      if (item.id === "chat" && section === "chat") {
                        if (selection.id !== LOCAL_MAIN) select({ id: LOCAL_MAIN, existing: true });
                        else setThreadsOpen(true);
                        return;
                      }
                      navigate(item.id);
                    }}
                    onHoverIn={() => setHoveredTab(item.id)}
                    onHoverOut={() => setHoveredTab((id) => (id === item.id ? undefined : id))}
                    style={({ pressed }) => ({
                      flex: 1,
                      minWidth: 0,
                      height: 50,
                      gap: 4,
                      alignItems: "center",
                      justifyContent: "center",
                      transform: [{ scale: pressed ? 0.96 : hovered ? 1.06 : 1 }],
                      transitionDuration: "140ms",
                    })}
                  >
                    <item.icon size={21} strokeWidth={active ? 2.2 : 1.8} color={tint} />
                    <Text
                      numberOfLines={1}
                      style={{
                        color: tint,
                        fontSize: width < 390 ? 10 : 11,
                        lineHeight: 13,
                        fontWeight: active ? "600" : "500",
                      }}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        {!!toast && (
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", bottom: 94, left: 20, right: 20, alignItems: "center" }}
          >
            <View
              style={[
                s.row,
                {
                  gap: 10,
                  padding: 14,
                  backgroundColor: colors.text,
                  borderRadius: 20,
                  maxWidth: 560,
                },
              ]}
            >
              <Check size={16} color={colors.blue} />
              <Text style={{ color: "#FFF", fontSize: 13, flexShrink: 1 }}>{toast}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dispensar notificação"
                onPress={clearToast}
              >
                <X size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
        {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
      </SafeAreaView>
    </>
  );
}

/** A small dot in the name pill: blue and breathing while working, amber and still when waiting. */
function StatusPulse({ tone }: { tone: "working" | "waiting" }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (tone !== "working") {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tone, opacity]);
  return (
    <Animated.View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        opacity,
        backgroundColor: tone === "working" ? colors.blueDark : "#D08A1B",
      }}
    />
  );
}
