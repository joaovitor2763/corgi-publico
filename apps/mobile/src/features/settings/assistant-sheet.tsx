import { useState } from "react";
import { View } from "react-native";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText, statusLabel } from "../../shared/format";
import { Button, CheckRow, ErrorNotice, Field, Sheet, s } from "../../shared/ui";

export function AssistantSheet({ onClose }: { onClose: () => void }) {
  const { data, mutate } = useAgentWorkspace();
  const [name, setName] = useState(data?.identity.name || "Corgi");
  const [tone, setTone] = useState(data?.identity.tone || "warm");
  const [showChatUpdates, setShowChatUpdates] = useState(data?.identity.showChatUpdates !== false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("/identity", {
        name: name.trim(),
        tone,
        avatar: data?.identity.avatar,
        showChatUpdates,
      });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Seu assistente" subtitle="Como ele se chama e como fala." onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Field label="Nome" value={name} onChangeText={setName} placeholder="Corgi" />
        <View style={[s.row, { gap: 8 }]}>
          {(["warm", "concise", "thoughtful"] as const).map((item) => (
            <Button key={item} small primary={tone === item} onPress={() => setTone(item)}>
              {statusLabel(item)}
            </Button>
          ))}
        </View>
        <CheckRow
          label="Mostrar atualizações em segundo plano no chat"
          checked={showChatUpdates}
          onPress={() => setShowChatUpdates(!showChatUpdates)}
        />
        <ErrorNotice error={error} />
        <Button primary busy={busy} disabled={!name.trim()} onPress={() => void save()}>
          Salvar
        </Button>
      </View>
    </Sheet>
  );
}
