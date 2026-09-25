import { ArrowUpRight, Globe2, Plus, X } from "lucide-react-native";
import { useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import type { BrowserSession } from "../../../../../packages/domain/src";
import { statusLabel } from "../../shared/format";
import { Button, Card, Chip, colors, Empty, ErrorNotice, SectionHeading, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

export function BrowserScreen() {
  const { workspace: w, api, refresh, open } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState("");
  // Open browsers first; closed ones keep their profile (cookies) and reopen on demand.
  const browsers = [...w.browsers].sort(
    (a, b) =>
      Number(b.status === "active") - Number(a.status === "active") ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  const open_ = browsers.filter((b) => b.status === "active").length;
  async function close(id: string) {
    setError("");
    setClosing(id);
    try {
      await api.request(id === "all" ? "/api/browsers/close-all" : `/api/browsers/${id}/close`, {});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClosing("");
    }
  }
  async function create() {
    setError("");
    setBusy(true);
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", { url });
      await refresh();
      setUrl("");
      open({ type: "browser", browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 22 }}>
      <Card style={{ backgroundColor: colors.sky }}>
        <View style={[s.row, { gap: 12, marginBottom: 15 }]}>
          <Globe2 size={22} color={colors.blueDark} />
          <View>
            <Text style={s.heading}>Um lugar para suas abas abertas</Text>
            <Text style={s.muted}>Navegue numa sessão privada que fica salva.</Text>
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <TextInput
            accessibilityLabel="Endereço do site"
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={() => void create()}
            autoCapitalize="none"
            placeholder="https://example.com"
            placeholderTextColor={colors.muted}
            style={[s.input, { flex: 1 }]}
          />
          <Button
            primary
            icon={Plus}
            busy={busy}
            disabled={!url.trim()}
            onPress={() => void create()}
          >
            Abrir sessão
          </Button>
        </View>
        <ErrorNotice error={error} />
      </Card>
      <Card>
        <SectionHeading
          title="Sessões do navegador"
          action={open_ > 1 ? (closing === "all" ? "Fechando…" : "Fechar todas") : undefined}
          onPress={() => void close("all")}
        />
        <Text style={[s.muted, { marginBottom: 8 }]}>
          {open_ ? `${open_} aberta${open_ > 1 ? "s" : ""} agora. ` : ""}
          Navegadores parados fecham sozinhos em 10 min e reabrem com o mesmo login.
        </Text>
        {browsers.length ? (
          browsers.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => open({ type: "browser", browser: b })}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.line,
                paddingVertical: 20,
                gap: 12,
              }}
            >
              <View style={[s.row, { gap: 14 }]}>
                <View style={s.iconBox}>
                  <Globe2 size={20} color={colors.blueDark} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.heading}>{b.title || "Sessão do navegador"}</Text>
                  <Text style={s.muted} numberOfLines={1}>
                    {b.url}
                  </Text>
                </View>
                <Chip tint={b.status === "active" ? colors.green : colors.canvas}>
                  {statusLabel(b.status)}
                </Chip>
                {b.status === "active" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Fechar este navegador"
                    hitSlop={8}
                    disabled={!!closing}
                    onPress={() => void close(b.id)}
                    style={({ pressed }) => ({ padding: 4, opacity: pressed || closing ? 0.5 : 1 })}
                  >
                    <X size={18} color={colors.muted} />
                  </Pressable>
                ) : (
                  <ArrowUpRight size={17} color={colors.muted} />
                )}
              </View>
              {b.status === "active" && b.previewUrl && (
                <Image
                  source={{ uri: api.url(b.previewUrl) }}
                  resizeMode="cover"
                  style={{
                    height: 180,
                    width: "100%",
                    borderRadius: 12,
                    backgroundColor: colors.canvas,
                  }}
                />
              )}
            </Pressable>
          ))
        ) : (
          <Empty
            icon={Globe2}
            title="Comece por um site"
            detail="Abra uma sessão acima para manter sua navegação num lugar só. As prévias ao vivo aparecem quando o navegador remoto estiver configurado."
          />
        )}
      </Card>
    </View>
  );
}
