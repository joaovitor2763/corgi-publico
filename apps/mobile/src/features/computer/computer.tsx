import {
  FileText,
  FolderOpen,
  Globe2,
  Monitor,
  Plus,
  RefreshCw,
  Terminal,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Image, Pressable, Text, View } from "react-native";
import type { BrowserSession } from "../../../../../packages/domain/src";
import { Button, Card, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { browserAddress } from "../browser/browser-address";
import { useComputerDraft } from "./computer-drafts";
import { LinuxWorkspace } from "./computer-workspace";

const TAB_LABELS = { Browser: "Navegador", Terminal: "Terminal", Files: "Arquivos" } as const;

export function ComputerEntry() {
  const { workspace, open } = useWorkspace();
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  const active = workspace.browsers.filter((b) => b.status === "active").length;
  const label = active ? "assumir o controle" : available ? "pronto" : "offline";
  // A small badge beside the agent's avatar; the full controls open in a sheet.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Computador do assistente, ${label}`}
      onPress={() => open({ type: "computer" })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hovered || pressed ? "#E7EAEC" : "#F1F3F4",
      })}
    >
      <Monitor size={15} color={colors.text} />
      <View
        style={{
          position: "absolute",
          top: 5,
          right: 5,
          width: 7,
          height: 7,
          borderRadius: 4,
          borderWidth: 1.5,
          borderColor: "#F1F3F4",
          backgroundColor: active ? colors.blueDark : available ? "#57AD85" : "#ACB0B5",
        }}
      />
    </Pressable>
  );
}
export function BrowserThreadCard({ browser }: { browser: BrowserSession }) {
  const { api, open } = useWorkspace();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [browser.previewUrl, browser.updatedAt]);
  return (
    <Card
      style={{ padding: 13, backgroundColor: "#EEEEF0", gap: 12, maxWidth: 440, width: "100%" }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 9 }]}>
          <Globe2 size={21} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>Navegador</Text>
          <Text numberOfLines={1} style={s.small}>
            {browser.status === "closed"
              ? "Sessão salva"
              : browser.status === "error"
                ? "Precisa de atenção"
                : browser.title}
          </Text>
        </View>
      </View>
      {browser.previewUrl && browser.status === "active" && !failed ? (
        <Image
          accessibilityLabel={`Prévia do navegador: ${browser.title}`}
          source={{ uri: api.url(browser.previewUrl) }}
          style={{ width: "100%", aspectRatio: 1.6, borderRadius: 11, backgroundColor: "#FFF" }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={{
            padding: 24,
            borderRadius: 12,
            backgroundColor: "#FFF",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Globe2 size={30} color={colors.muted} />
          <Text numberOfLines={2} style={[s.muted, { textAlign: "center" }]}>
            {failed ? "Prévia indisponível. Abra o navegador para reconectar." : browser.url}
          </Text>
        </View>
      )}
      <Button onPress={() => open({ type: "browser", browser })}>
        {browser.status === "closed"
          ? "Reabrir navegador"
          : browser.status === "error"
            ? "Reconectar navegador"
            : "Assumir o controle"}
      </Button>
    </Card>
  );
}
export function ComputerSheet() {
  const { workspace, api, refresh, close, open, navigate } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useComputerDraft("tab");
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void refresh().catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function create() {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", {
        url: browserAddress(url),
      });
      await refresh();
      open({ type: "browser", browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Computador do assistente"
      subtitle="Seu assistente trabalha aqui. Entre quando precisar."
      onClose={close}
    >
      <View style={{ gap: 20 }}>
        {tab === "Browser" && (
          <View
            style={[s.row, { gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.sky }]}
          >
            <Monitor size={28} color={colors.blueDark} />
            <View style={{ flex: 1 }}>
              <Text style={s.heading}>
                {available ? "Navegador conectado" : "Navegador offline"}
              </Text>
              <Text style={s.muted}>
                {available
                  ? "O navegador e os documentos do seu assistente, num lugar só."
                  : "Inicie o navegador remoto para conectar este computador."}
              </Text>
            </View>
          </View>
        )}
        <View style={[s.row, { gap: 8 }]}>
          {(["Browser", "Terminal", "Files"] as const).map((item) => (
            <Button
              key={item}
              primary={tab === item}
              icon={item === "Browser" ? Globe2 : item === "Terminal" ? Terminal : FolderOpen}
              onPress={() => setTab(item)}
            >
              {TAB_LABELS[item]}
            </Button>
          ))}
        </View>
        <View style={{ display: tab === "Browser" ? "none" : "flex" }}>
          <LinuxWorkspace tab={tab === "Files" ? "Files" : "Terminal"} />
        </View>
        <ErrorNotice error={error} />
        {tab === "Browser" ? (
          <>
            <View>
              <Field
                label="Endereço do site"
                value={url}
                onChangeText={setUrl}
                placeholder="https://example.com"
                autoCapitalize="none"
                keyboardType="url"
                onSubmitEditing={() => void create()}
              />
              <Button
                primary
                icon={Plus}
                busy={busy}
                disabled={!available || !url.trim()}
                onPress={() => void create()}
              >
                Abrir sessão no navegador
              </Button>
            </View>
            {[...workspace.browsers]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((browser) => (
                <BrowserThreadCard key={browser.id} browser={browser} />
              ))}
            {!workspace.browsers.length && (
              <Text style={s.muted}>
                Abra uma página aqui ou peça ao assistente para pesquisar algo. As sessões de
                navegação dele aparecem aqui.
              </Text>
            )}
            <Text style={s.small}>
              Cada sessão guarda seus próprios logins e downloads. Abra uma para assumir o controle
              e depois volte para a conversa.
            </Text>
          </>
        ) : tab === "Files" ? (
          <>
            <Text style={s.heading}>Documentos</Text>
            <Text style={s.small}>
              PDFs salvos de e-mails, downloads do navegador e seus envios.
            </Text>
            {workspace.files.map((file) => (
              <LinkRow
                key={file.id}
                icon={FileText}
                title={file.name}
                detail={`${file.pageCount} ${file.pageCount === 1 ? "página" : "páginas"} · PDF`}
                onPress={() => open({ type: "file", file })}
              />
            ))}
            <Button
              icon={Plus}
              onPress={() => {
                close();
                navigate("files");
              }}
            >
              Importar documento
            </Button>
          </>
        ) : null}
        <Button
          small
          icon={RefreshCw}
          onPress={() =>
            void refresh()
              .then(() => setError(""))
              .catch((e) => setError(String(e)))
          }
        >
          Atualizar computador
        </Button>
      </View>
    </Sheet>
  );
}
