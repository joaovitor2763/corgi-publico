// Notifications on the phone: one clear state at a time (install, turn on, blocked, on) and,
// once on, what Corgi calls about. Asked for on a tap, never out of the blue.
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  CircleAlert,
  ListChecks,
  MessageCircleQuestion,
  PlusSquare,
  Share,
  ShieldCheck,
  Smartphone,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { disablePush, enablePush, type PushState, pushState } from "../../shared/push";
import { colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

type Prefs = { approvals: boolean; questions: boolean; done: boolean; problems: boolean };

const KINDS: { key: keyof Prefs; icon: typeof Bell; title: string; detail: string }[] = [
  {
    key: "approvals",
    icon: ShieldCheck,
    title: "Aprovações",
    detail: "Quando algo espera o seu Permitir",
  },
  {
    key: "questions",
    icon: MessageCircleQuestion,
    title: "Perguntas",
    detail: "Quando uma tarefa precisa de uma resposta sua",
  },
  {
    key: "done",
    icon: ListChecks,
    title: "Tarefas concluídas",
    detail: "Quando um trabalho em segundo plano termina",
  },
  {
    key: "problems",
    icon: CircleAlert,
    title: "Problemas",
    detail: "Quando algo não deu certo e precisa de você",
  },
];

const HERO: Record<PushState, { icon: typeof Bell; title: string; body: string; tone: string }> = {
  on: {
    icon: BellRing,
    title: "Ativadas neste aparelho",
    body: "O Corgi te chama quando algo precisa de você. Tocar abre direto o que importa.",
    tone: "#3E8E5E",
  },
  off: {
    icon: Bell,
    title: "Receba o Corgi no seu celular",
    body: "Aprovações, perguntas e tarefas prontas chegam como notificação, mesmo com o app fechado.",
    tone: colors.blueDark,
  },
  "needs-install": {
    icon: Smartphone,
    title: "Primeiro, adicione à tela de início",
    body: "No iPhone, as notificações funcionam no Corgi instalado na tela de início.",
    tone: colors.blueDark,
  },
  denied: {
    icon: BellOff,
    title: "Notificações bloqueadas",
    body: "O iPhone está bloqueando os avisos do Corgi. Libere em Ajustes para ativar.",
    tone: "#B7791F",
  },
  unsupported: {
    icon: BellOff,
    title: "Este navegador não recebe notificações",
    body: "Use o Corgi instalado na tela de início do iPhone (iOS 16.4 ou mais novo).",
    tone: colors.muted,
  },
};

function Step({ n, icon: Icon, children }: { n: number; icon: typeof Bell; children: ReactNode }) {
  return (
    <View style={[s.row, { gap: 12, alignItems: "center" }]}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontWeight: "700", color: colors.blueDark }}>{n}</Text>
      </View>
      <Text style={[s.text, { flex: 1, fontSize: 15 }]}>{children}</Text>
      <Icon size={18} color={colors.blueDark} />
    </View>
  );
}

export function PushSheet({ onClose }: { onClose: () => void }) {
  const { api } = useWorkspace();
  const [state, setState] = useState<PushState>();
  const [prefs, setPrefs] = useState<Prefs>();
  const [busy, setBusy] = useState<"enable" | "disable" | "test">();
  const [error, setError] = useState("");
  const [tested, setTested] = useState(false);
  const load = useCallback(async () => {
    setState(await pushState().catch(() => "unsupported" as const));
    const info = await api.request<{ prefs: Prefs }>("/api/push").catch(() => undefined);
    if (info) setPrefs(info.prefs);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  async function run(kind: "enable" | "disable" | "test") {
    setBusy(kind);
    setError("");
    try {
      if (kind === "enable") setState(await enablePush(api));
      if (kind === "disable") {
        await disablePush(api);
        setState("off");
      }
      if (kind === "test") {
        await api.request("/api/push/test", {});
        setTested(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function toggle(key: keyof Prefs, value: boolean) {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: value });
    try {
      setPrefs(await api.request<Prefs>("/api/push/prefs", { [key]: value }, "PUT"));
    } catch (e) {
      setPrefs({ ...prefs, [key]: !value });
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const hero = HERO[state ?? "off"];
  const Icon = hero.icon;
  return (
    <Sheet
      title="Notificações"
      subtitle="O Corgi te chama quando algo precisa de você."
      onClose={onClose}
    >
      {!state ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : (
        <View style={{ gap: 22 }}>
          <View style={{ backgroundColor: colors.sky, borderRadius: 24, padding: 20, gap: 14 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: "#FFFFFF",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={26} color={hero.tone} />
              {state === "on" && (
                <View
                  style={{
                    position: "absolute",
                    right: -2,
                    bottom: -2,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: "#3E8E5E",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: colors.sky,
                  }}
                >
                  <Check size={11} color="#FFFFFF" strokeWidth={3} />
                </View>
              )}
            </View>
            <View style={{ gap: 4 }}>
              <Text
                style={{ fontSize: 20, fontWeight: "700", color: colors.text, letterSpacing: -0.3 }}
              >
                {hero.title}
              </Text>
              <Text style={[s.muted, { lineHeight: 21 }]}>{hero.body}</Text>
            </View>
            {state === "needs-install" && (
              <View style={{ gap: 10, marginTop: 4 }}>
                <Step n={1} icon={Share}>
                  Toque em Compartilhar no Safari
                </Step>
                <Step n={2} icon={PlusSquare}>
                  Escolha “Adicionar à Tela de Início”
                </Step>
                <Step n={3} icon={Smartphone}>
                  Abra o Corgi pelo ícone e volte aqui
                </Step>
              </View>
            )}
            {state === "denied" && (
              <Text style={[s.text, { fontSize: 15 }]}>
                Ajustes › Notificações › Corgi › Permitir Notificações
              </Text>
            )}
            {state === "off" && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void run("enable")}
                disabled={!!busy}
                style={({ pressed }) => ({
                  marginTop: 4,
                  alignItems: "center",
                  paddingVertical: 15,
                  borderRadius: 18,
                  backgroundColor: colors.blueDark,
                  opacity: pressed || busy ? 0.8 : 1,
                })}
              >
                {busy === "enable" ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
                    Ativar notificações
                  </Text>
                )}
              </Pressable>
            )}
            {state === "on" && (
              <View style={[s.row, { gap: 16, marginTop: 2 }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void run("test")}
                  disabled={!!busy}
                  style={({ pressed }) => ({
                    paddingVertical: 11,
                    paddingHorizontal: 16,
                    borderRadius: 16,
                    backgroundColor: "#FFFFFF",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontWeight: "600", color: colors.text }}>
                    {busy === "test" ? "Enviando…" : tested ? "Enviado ✓" : "Enviar um teste"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void run("disable")}
                  disabled={!!busy}
                  hitSlop={8}
                >
                  <Text style={[s.small, { fontWeight: "600" }]}>Desativar neste aparelho</Text>
                </Pressable>
              </View>
            )}
          </View>
          <ErrorNotice error={error} />
          {state === "on" && prefs && (
            <View style={{ gap: 4 }}>
              <Text style={[s.heading, { marginBottom: 6 }]}>O que te avisa</Text>
              {KINDS.map(({ key, icon: KindIcon, title, detail }, index) => (
                <View
                  key={key}
                  style={[
                    s.row,
                    {
                      gap: 12,
                      paddingVertical: 12,
                      borderTopWidth: index ? 1 : 0,
                      borderTopColor: colors.line,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      backgroundColor: "#F2F5F7",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <KindIcon size={18} color={colors.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
                      {title}
                    </Text>
                    <Text style={s.small}>{detail}</Text>
                  </View>
                  <Switch
                    accessibilityLabel={title}
                    value={prefs[key]}
                    onValueChange={(value) => void toggle(key, value)}
                  />
                </View>
              ))}
              <Text style={[s.small, { marginTop: 8 }]}>
                O número no ícone do Corgi mostra quantas coisas esperam por você.
              </Text>
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}
