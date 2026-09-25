// Ajustes: the assistant (helpers, memory, notifications, how it thinks, name and tone), its
// computer and files, then the apps it can use.
import {
  Bell,
  Brain,
  BrainCircuit,
  CalendarDays,
  FileText,
  Globe2,
  Mail,
  Sparkles,
  Users,
} from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { statusLabel } from "../../shared/format";
import { Panel, Row } from "../../shared/kit";
import { Field } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { AssistantSheet } from "../settings/assistant-sheet";
import { ConnectedApps } from "./connected-apps";
import { ConnectionsScreen } from "./connections-screen";

export function AppsScreen() {
  const { navigate, open, workspace } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const memories = data?.memories.length ?? 0;
  const fuzzies = data?.fuzzies ?? [];
  const model = data?.model?.options.find((o) => o.id === data.model?.selectedId);
  // The built-in Google mailbox (or sample data) has its own screens; connected Gmail and
  // Calendar live in the chat instead.
  const builtInGoogle = workspace.connections.some(
    (c) => c.id === "google" && (c.status === "connected" || c.status === "sample"),
  );
  return (
    <View style={{ gap: 24 }}>
      {/* Searching apps: the rest steps aside so the results sit right under the field. */}
      {!query && (
        <Panel title="Seu assistente">
          <Row
            first
            icon={Users}
            title="Ajudantes"
            detail={
              fuzzies.length
                ? fuzzies.map((f) => `${f.emoji} ${f.name}`).join(" · ")
                : "Pequenos assistentes que o Corgi chama"
            }
            onPress={() => open({ type: "fuzzies" })}
          />
          <Row
            icon={Brain}
            title="Memória"
            detail={
              memories
                ? `${memories} ${memories === 1 ? "coisa" : "coisas"} que sei sobre você`
                : "O que o Corgi sabe e como te atende"
            }
            onPress={() => open({ type: "memory" })}
          />
          <Row
            icon={Bell}
            title="Notificações"
            detail="O Corgi te chama no celular"
            onPress={() => open({ type: "push" })}
          />
          {!!data?.model && (
            <Row
              icon={BrainCircuit}
              title="Como o Corgi pensa"
              detail={model?.name ?? "Automático"}
              onPress={() => open({ type: "model" })}
            />
          )}
          <Row
            icon={Sparkles}
            title="Nome e personalidade"
            detail={`${data?.identity.name || "Corgi"} · ${statusLabel(data?.identity.tone || "warm")}`}
            onPress={() => setSettings(true)}
          />
        </Panel>
      )}
      {!query && (
        <Panel title="No computador dele">
          <Row
            first
            icon={Globe2}
            title="Navegador"
            detail="Sessões e logins que ficam salvos"
            onPress={() => open({ type: "computer" })}
          />
          <Row
            icon={FileText}
            title="Arquivos"
            detail="PDFs, fotos e documentos"
            onPress={() => navigate("files")}
          />
          {builtInGoogle && (
            <>
              <Row
                icon={Mail}
                title="E-mail"
                detail="Caixa de entrada do Google"
                onPress={() => navigate("mail")}
              />
              <Row
                icon={CalendarDays}
                title="Agenda"
                detail="Eventos do Google"
                onPress={() => navigate("calendar")}
              />
            </>
          )}
        </Panel>
      )}
      <View style={{ gap: 12 }}>
        <Field label="Apps" value={query} onChangeText={setQuery} placeholder="Buscar apps" />
        <ConnectionsScreen query={query} />
        <ConnectedApps query={query} />
      </View>
      {settings && <AssistantSheet onClose={() => setSettings(false)} />}
    </View>
  );
}
