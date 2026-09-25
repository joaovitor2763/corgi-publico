// Apify in Apps: connected with the person's own API token (the server lists it like any other
// app). Once on, Corgi can use ready-made scrapers for public data at scale; each run is capped
// by the dollar limit chosen here.
import { KeyRound, Unplug } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View } from "react-native";
import { errorText } from "../../shared/format";
import { Button, colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

type Status = { connected: boolean; username?: string; maxUsd: number };

const LIMITS = [0.25, 0.5, 1, 2, 5];
const TOKEN_PAGE = "https://console.apify.com/settings/integrations";
const usd = (value: number) => `US$ ${value.toFixed(2).replace(".", ",")}`;

/** Apify's screen, opened from its row in Apps: loads where it stands, then key and limit. */
export function ApifyConnect({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** After connecting, disconnecting or a new limit: the Apps list reloads. */
  onChanged: () => void;
}) {
  const { api, notify } = useWorkspace();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .request<Status>("/api/apify")
      .then(setStatus)
      .catch((e) => setError(errorText(e)));
  }, [api]);
  if (!status)
    return (
      <Sheet title="Apify" onClose={onClose}>
        {error ? <ErrorNotice error={error} /> : <ActivityIndicator color={colors.muted} />}
      </Sheet>
    );
  return (
    <ApifySheet
      status={status}
      onChange={(next, message) => {
        setStatus(next);
        if (message) notify(message);
        onChanged();
      }}
      onClose={onClose}
    />
  );
}

function ApifySheet({
  status,
  onChange,
  onClose,
}: {
  status: Status;
  onChange: (status: Status, message?: string) => void;
  onClose: () => void;
}) {
  const { api } = useWorkspace();
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState(status.maxUsd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(path: string, body: unknown, message: string, method?: string) {
    setBusy(true);
    setError("");
    try {
      onChange(await api.request<Status>(path, body, method), message);
      setToken("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function pick(value: number) {
    setLimit(value);
    if (status.connected)
      void act("/api/apify/limit", { maxUsd: value }, `Limite: ${usd(value)} por coleta`, "PUT");
  }
  return (
    <Sheet
      title="Apify"
      subtitle={
        status.connected ? `Conectado${status.username ? ` · ${status.username}` : ""}` : undefined
      }
      onClose={onClose}
    >
      <View style={{ gap: 18 }}>
        <Text style={s.muted}>
          Com o Apify, o Corgi usa coletores prontos para buscar dados públicos em escala: lugares
          do Google Maps, perfis e posts do Instagram, anúncios de lojas, avaliações. Ele escolhe o
          coletor, roda e te mostra o resultado.
        </Text>
        {!status.connected && (
          <View style={{ gap: 8 }}>
            <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
              Sua chave de API
            </Text>
            <TextInput
              accessibilityLabel="Chave de API do Apify"
              value={token}
              onChangeText={setToken}
              placeholder="apify_api_…"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={s.input}
            />
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(TOKEN_PAGE)}>
              <Text style={[s.small, { color: colors.blueDark }]}>
                Onde encontro? Apify › Settings › API & Integrations
              </Text>
            </Pressable>
          </View>
        )}
        <View style={{ gap: 8 }}>
          <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
            Gasto máximo por coleta
          </Text>
          <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
            {LIMITS.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: limit === value }}
                disabled={busy}
                onPress={() => pick(value)}
                style={{
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 11,
                  backgroundColor: limit === value ? colors.sky : "#F1F3F4",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: limit === value ? colors.blueDark : colors.text,
                    fontWeight: limit === value ? "600" : "400",
                  }}
                >
                  {usd(value)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.small}>
            O Apify para a coleta ao chegar nesse valor. O custo sai dos seus créditos no Apify.
          </Text>
        </View>
        <ErrorNotice error={error} />
        {status.connected ? (
          <Button
            busy={busy}
            danger
            icon={Unplug}
            onPress={() => void act("/api/apify/disconnect", {}, "Apify desconectado")}
          >
            Desconectar Apify
          </Button>
        ) : (
          <Button
            busy={busy}
            primary
            icon={KeyRound}
            disabled={token.trim().length < 10}
            onPress={() =>
              void act(
                "/api/apify/connect",
                { token: token.trim(), maxUsd: limit },
                "Apify conectado",
              )
            }
          >
            Conectar
          </Button>
        )}
      </View>
    </Sheet>
  );
}
