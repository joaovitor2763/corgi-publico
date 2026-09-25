import { RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText } from "../../shared/format";
import { Panel, Segments } from "../../shared/kit";
import { ErrorNotice } from "../../shared/ui";

import { toState, watching } from "./idea-sources";
import { IdeasList, TakenIdeas } from "./ideas-list";
import { SourcesLine, SourcesSheet, useIdeaSources } from "./sources-sheet";

export function IdeasScreen() {
  const { data, mutate } = useAgentWorkspace();
  const [view, setView] = useState<"new" | "active" | "done">("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingSources, setEditingSources] = useState(false);
  const sources = useIdeaSources();
  const names = sources.data && watching(toState(sources.data.apps, sources.data.sources));
  async function refreshIdeas() {
    setBusy(true);
    setError("");
    try {
      await mutate("/ideas/refresh", {});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const ideas = data?.ideas.filter((idea) => idea.status === "new") || [];
  return (
    <View style={{ gap: 20 }}>
      <Segments
        value={view}
        onChange={setView}
        options={[
          { value: "new", label: `Para você${ideas.length ? ` · ${ideas.length}` : ""}` },
          { value: "active", label: "Em andamento" },
          { value: "done", label: "Feitas" },
        ]}
      />
      {view === "new" && (
        <View style={{ gap: 12 }}>
          <SourcesLine names={names} onPress={() => setEditingSources(true)} />
          <Panel
            title="Para você"
            action={busy ? "Buscando…" : "Buscar ideias"}
            actionIcon={RefreshCw}
            onAction={() => void refreshIdeas()}
          >
            <IdeasList />
          </Panel>
        </View>
      )}
      {view !== "new" && <TakenIdeas finished={view === "done"} />}
      <ErrorNotice error={error} />
      {editingSources && (
        <SourcesSheet
          initial={sources.data}
          onClose={() => setEditingSources(false)}
          onSaved={(saved) =>
            sources.data && sources.setData({ ...sources.data, sources: saved, custom: true })
          }
        />
      )}
    </View>
  );
}
