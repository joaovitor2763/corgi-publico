import { Upload } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button, ErrorNotice, s } from "../../shared/ui";
import { pickAndUpload } from "../../shared/upload";
import { useWorkspace } from "../../shared/workspace";
import { FileLibrary } from "./file-library";

export function FilesScreen() {
  const { workspace: w, api, refresh, open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    setError("");
    setBusy(true);
    try {
      const { uploaded, failures } = await pickAndUpload(api, "file");
      if (uploaded.length) await refresh();
      if (failures.length) setError(failures.join("\n"));
      if (uploaded.length === 1) open({ type: "file", file: uploaded[0] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <View style={s.between}>
        <Text style={[s.muted, { flex: 1, marginRight: 15 }]}>
          {w.files.length
            ? `${w.files.length} ${w.files.length === 1 ? "arquivo" : "arquivos"} · fotos, PDFs e planilhas`
            : "Seus documentos, com espaço para trabalhar."}
        </Text>
        <Button primary small icon={Upload} busy={busy} onPress={() => void upload()}>
          Enviar
        </Button>
      </View>
      <ErrorNotice error={error} />
      <FileLibrary />
    </View>
  );
}
