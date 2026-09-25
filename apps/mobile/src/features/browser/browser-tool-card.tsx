import { Check, Globe2, Hand, RotateCw, ShieldCheck } from "lucide-react-native";
import { createContext, useContext, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Image, Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import type { BrowserSession } from "../../../../../packages/domain/src";
import { Button, Card, colors, ErrorNotice, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { ChatSendContext } from "../chat/chat-context";
import { ResultCarousel, type ResultItem, resultItemSchema } from "../chat/result-cards";

export const BrowserRunContext = createContext({ running: false, active: false });

const taskSchema = z.object({
  status: z.string(),
  steps: z.array(z.object({ action: z.string().nullable() })),
  loginRequest: z.object({ id: z.string(), origin: z.string(), expiresAt: z.string() }).optional(),
});
const statusText: Record<string, string> = {
  done: "Pronto",
  goal_achieved: "Pronto",
  stuck: "Travou",
  max_steps: "Parou no limite de etapas",
  timeout: "O tempo acabou",
  needs_login: "Precisa que você entre na conta",
  needs_human: "Precisa de você: verificação anti-robô",
  ready_to_checkout: "Pronto para sua aprovação",
  error: "Deu erro",
};

const observationSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  url: z.url(),
});

function resultValue(result: unknown) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function siteLabel(url: unknown) {
  if (typeof url !== "string") return "Abrindo uma página";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Abrindo uma página";
  }
}

/** A server tool result stays with the request that produced it, including on replay. */
export function BrowserToolCard({
  url,
  goal,
  result,
  loading,
}: {
  url: unknown;
  goal?: unknown;
  result: unknown;
  loading: boolean;
}) {
  const { api, workspace, open } = useWorkspace();
  const { running, active } = useContext(BrowserRunContext);
  const working = loading && active;
  const value = resultValue(result);
  const observation = observationSchema.safeParse(value);
  const toolError = z.object({ error: z.string() }).safeParse(value);
  const task = taskSchema.safeParse(value);
  const acting = typeof goal === "string";
  const sessionId = observation.success ? observation.data.sessionId : undefined;
  const current = workspace.browsers.find((browser) => browser.id === sessionId);
  const [browser, setBrowser] = useState<BrowserSession>();
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showPage, setShowPage] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    async function connect() {
      setError("");
      setPreviewFailed(false);
      try {
        const session = await api.request<BrowserSession>(
          `/api/browsers/${encodeURIComponent(sessionId || "")}`,
        );
        if (active) setBrowser(session);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void connect();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void connect();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [api, sessionId, current?.updatedAt, retry]);

  const visited = observation.success ? observation.data : undefined;
  // A later turn can reuse the same browser. Never label that new page as an old source.
  const preview =
    browser?.status === "active" && browser.url === visited?.url && !previewFailed
      ? browser.previewUrl
      : undefined;
  const failure = toolError.success
    ? toolError.data.error
    : !loading && !visited
      ? "O navegador não retornou nenhuma página. Tente pedir de novo."
      : "";
  // Listings are only worth showing when the task reached its goal; a stuck page is noise.
  const items =
    task.success && ["done", "goal_achieved", "ready_to_checkout"].includes(task.data.status)
      ? itemsOf(value).filter((item) => item.image)
      : [];
  const stepsTaken = task.success ? task.data.steps.filter((step) => step.action).length : 0;
  return (
    <View style={{ gap: 10, width: "100%" }}>
      <Card style={{ padding: 12, backgroundColor: "#EEEEF0", gap: 10, maxWidth: 520 }}>
        <View style={[s.row, { gap: 10 }]}>
          <View style={[s.iconBox, { width: 34, height: 34, borderRadius: 10 }]}>
            <Globe2 size={19} color={colors.blueDark} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text numberOfLines={1} style={[s.text, { fontWeight: "600", fontSize: 15 }]}>
              {working
                ? acting
                  ? "Trabalhando no navegador"
                  : "Lendo a página"
                : visited?.title || siteLabel(visited?.url ?? url)}
            </Text>
            <Text numberOfLines={1} style={[s.small, { fontSize: 12 }]}>
              {working
                ? acting
                  ? String(goal)
                  : siteLabel(url)
                : loading
                  ? "Pausado"
                  : failure
                    ? "Não consegui terminar"
                    : [
                        siteLabel(visited?.url),
                        task.success ? statusText[task.data.status] : undefined,
                        stepsTaken
                          ? `${stepsTaken} ${stepsTaken === 1 ? "etapa" : "etapas"}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
            </Text>
          </View>
          {working ? (
            <ActivityIndicator size="small" color={colors.blueDark} />
          ) : preview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showPage ? "Ocultar prévia da página" : "Mostrar prévia da página"
              }
              onPress={() => setShowPage(!showPage)}
            >
              <Image
                source={{ uri: api.url(preview) }}
                style={{ width: 64, height: 40, borderRadius: 7, backgroundColor: "#FFF" }}
                resizeMode="cover"
                onError={() => setPreviewFailed(true)}
              />
            </Pressable>
          ) : visited ? (
            <Check size={17} color="#47896C" accessibilityLabel="Pronto" />
          ) : null}
        </View>
        {showPage && preview && (
          <Image
            accessibilityLabel={`Prévia do navegador: ${visited?.title}`}
            source={{ uri: api.url(preview) }}
            style={{ width: "100%", aspectRatio: 1.6, borderRadius: 12, backgroundColor: "#FFF" }}
            resizeMode="contain"
            onError={() => setPreviewFailed(true)}
          />
        )}
        {task.success && task.data.loginRequest && sessionId && (
          <LoginCard sessionId={sessionId} request={task.data.loginRequest} />
        )}
        <ErrorNotice error={failure || error} />
        {!loading && visited && (
          <View style={[s.row, { gap: 8 }]}>
            <Button
              small
              icon={Hand}
              disabled={!browser || running}
              onPress={() => browser && open({ type: "browser", browser })}
            >
              {task.success && task.data.status === "needs_human"
                ? "Assumir o controle para continuar"
                : "Assumir o controle"}
            </Button>
            {!!error && (
              <Button small icon={RotateCw} onPress={() => setRetry((attempt) => attempt + 1)}>
                Reconectar
              </Button>
            )}
          </View>
        )}
      </Card>
      {items.length > 0 && <ResultCarousel items={items} />}
    </View>
  );
}

function itemsOf(value: unknown): ResultItem[] {
  const parsed = z.object({ items: z.array(z.unknown()) }).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.items.flatMap((item) => {
    const one = resultItemSchema.safeParse(item);
    return one.success ? [one.data] : [];
  });
}

/**
 * Private sign-in: values go from this form to the browser worker, which fills the page.
 * They are cleared here immediately and never enter the chat or the model's context.
 */
function LoginCard({
  sessionId,
  request,
}: {
  sessionId: string;
  request: { id: string; origin: string; expiresAt: string };
}) {
  const { api } = useWorkspace();
  const send = useContext(ChatSendContext);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"open" | "done" | "cancelled">("open");
  const [error, setError] = useState("");
  const host = siteLabel(request.origin);
  async function respond(action: "submit" | "cancel") {
    const body = { requestId: request.id, action, username, password };
    setUsername("");
    setPassword("");
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ ok: boolean; cancelled?: boolean }>(
        `/api/browsers/${encodeURIComponent(sessionId)}/login`,
        action === "submit" ? body : { requestId: request.id, action },
      );
      if (action === "cancel") {
        setState("cancelled");
        send?.(`Cancelei o login em ${host}.`);
      } else if (result.ok) {
        setState("done");
        send?.(`Entrei na conta em ${host}. Confira se deu certo e continue a tarefa.`);
      } else setError("O login não funcionou. Confira os dados ou assuma o controle.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      body.username = "";
      body.password = "";
      setBusy(false);
    }
  }
  if (state !== "open")
    return (
      <Text style={s.small}>
        {state === "done" ? `Login feito em ${host}.` : `Login em ${host} cancelado.`}
      </Text>
    );
  const input = {
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  } as const;
  return (
    <View style={{ backgroundColor: "#FAFAFB", borderRadius: 16, padding: 16, gap: 10 }}>
      <View style={[s.row, { gap: 10 }]}>
        <ShieldCheck size={20} color={colors.blueDark} />
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>Login seguro</Text>
          <Text style={s.small}>{host} · não é compartilhado com o assistente</Text>
        </View>
      </View>
      <TextInput
        accessibilityLabel={`Usuário em ${host}`}
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect={false}
        placeholder="E-mail ou usuário"
        placeholderTextColor="#949B9F"
        value={username}
        onChangeText={setUsername}
        style={input}
      />
      <TextInput
        accessibilityLabel={`Senha em ${host}`}
        autoCapitalize="none"
        autoComplete="current-password"
        secureTextEntry
        placeholder="Senha"
        placeholderTextColor="#949B9F"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => username && password && void respond("submit")}
        style={input}
      />
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={!username || !password}
        onPress={() => void respond("submit")}
      >
        Entrar
      </Button>
      <Button small disabled={busy} onPress={() => void respond("cancel")}>
        Cancelar
      </Button>
    </View>
  );
}
