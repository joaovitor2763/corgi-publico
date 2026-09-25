import {
  ArrowDownToLine,
  CalendarDays,
  ChevronRight,
  Globe2,
  Link2,
  Mail,
} from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Button, Chip, colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

export function ConnectionsScreen({ query = "" }: { query?: string }) {
  const { workspace: w, api, refresh, notify, open } = useWorkspace();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect(capability: "read" | "write") {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ url: string | null; connected?: boolean }>(
        "/api/google/connect",
        { capability },
      );
      if (result.url) {
        await Linking.openURL(result.url);
        notify("Termine a conexão no navegador e depois atualize o app.");
      } else {
        await refresh();
        notify("Os dados locais do Google estão prontos.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api.request("/api/google/disconnect", {});
      await refresh();
      notify("Google desconectado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const google = w.connections.find((c) => c.id === "google");
  const connected = google?.status === "connected" || google?.status === "sample";
  const rows = [
    { id: "gmail", name: "Gmail", icon: Mail, color: "#EA5B4D", connected, group: "google" },
    {
      id: "calendar",
      name: "Google Calendar",
      icon: CalendarDays,
      color: "#4285F4",
      connected,
      group: "google",
    },
    {
      id: "browser",
      name: "Computador do assistente",
      icon: Globe2,
      color: "#1987CF",
      connected: w.connections.some((c) => c.id === "browser" && c.status === "connected"),
      group: "browser",
    },
  ]
    // Only real connectors: no fictional sample Google, and the
    // agent computer already has its own entry under Apps.
    .filter((row) => row.group !== "google" || w.runtime.sampleData !== false || w.mode === "live")
    .filter((row) => row.group !== "browser")
    .filter((row) => `${row.name} ${row.group}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <View style={{ gap: 22 }}>
      {[true, false].map((isConnected) => {
        const group = rows.filter((row) => row.connected === isConnected);
        if (!group.length) return null;
        return (
          <View key={String(isConnected)} style={{ gap: 8 }}>
            <Text style={[s.small, { marginLeft: 12 }]}>
              {isConnected
                ? w.mode === "sample"
                  ? "Suas conexões"
                  : "Conectados"
                : "Integrações disponíveis"}
            </Text>
            <View style={{ paddingHorizontal: 16, borderRadius: 23, backgroundColor: "#F3F4F5" }}>
              {group.map((row, index) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Gerenciar ${row.name}`}
                  onPress={() =>
                    row.group === "browser" ? open({ type: "computer" }) : setSelected(row.group)
                  }
                  style={[
                    s.row,
                    {
                      gap: 14,
                      minHeight: 61,
                      borderBottomWidth: index < group.length - 1 ? 1 : 0,
                      borderBottomColor: "#E5E7E9",
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 29,
                      height: 29,
                      borderRadius: 7,
                      backgroundColor: "#FFF",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <row.icon size={23} color={row.color} />
                  </View>
                  <Text style={[s.text, { flex: 1 }]}>{row.name}</Text>
                  {row.connected && row.group === "google" && w.mode === "sample" && (
                    <Text style={s.small}>Dados locais</Text>
                  )}
                  {row.connected ? (
                    <ChevronRight size={18} color="#A4A7AA" />
                  ) : (
                    <Text
                      style={{
                        fontSize: 13,
                        color: row.group === "google" ? colors.blueDark : colors.muted,
                      }}
                    >
                      {row.group === "google" ? "Conectar" : "Configurar"}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {selected && (
        <Sheet
          title="Conexões do Google"
          subtitle={google?.account}
          onClose={() => setSelected(undefined)}
        >
          <View style={{ gap: 18 }}>
            <Text style={s.muted}>
              Traga o Gmail e o Google Agenda para as suas conversas. Comece com acesso de leitura e
              libere envio e edição quando precisar.
            </Text>
            <View style={[s.row, { gap: 7, flexWrap: "wrap" }]}>
              {google?.capabilities.map((cap) => (
                <Chip key={cap}>{capabilityLabel(cap)}</Chip>
              ))}
            </View>
            <ErrorNotice error={error} />
            <Button busy={busy} primary icon={Link2} onPress={() => void connect("read")}>
              Conectar Google
            </Button>
            <Button busy={busy} onPress={() => void connect("write")}>
              Permitir envio e edição
            </Button>
            {connected && (
              <Button busy={busy} danger onPress={() => void disconnect()}>
                Desconectar Google
              </Button>
            )}
            <SettingsLine
              label="Ambiente"
              value={w.mode === "sample" ? "Local · dados de exemplo" : "Ambiente real"}
            />
            <SettingsLine
              label="Assistente"
              value={
                w.runtime.provider === "sample"
                  ? "Fluxos guiados"
                  : w.runtime.configured
                    ? "Modelo conectado"
                    : "Modelo não configurado"
              }
            />
            <Button
              small
              icon={ArrowDownToLine}
              onPress={() => void refresh().catch((e) => setError(String(e)))}
            >
              Atualizar conexões
            </Button>
          </View>
        </Sheet>
      )}
    </View>
  );
}
function SettingsLine({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={[
        s.between,
        { gap: 15, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
      ]}
    >
      <Text style={s.muted}>{label}</Text>
      <Text style={[s.text, { fontSize: 12, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

function capabilityLabel(value: string) {
  const scope = value.split("/").at(-1) || value;
  const names: Record<string, string> = {
    "gmail.readonly": "Ler Gmail",
    "gmail.send": "Enviar pelo Gmail",
    "calendar.events.readonly": "Ler eventos da agenda",
    "calendar.calendarlist.readonly": "Ler lista de agendas",
    "calendar.events": "Gerenciar eventos da agenda",
    "calendar.readonly": "Ler agendas",
  };
  return names[scope] || scope;
}
