import { Archive, MoreHorizontal, Pencil, Pin, Plus, Settings2, Trash2 } from "lucide-react-native";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

function newThreadId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export type Selection = { id: string; existing: boolean };
/** Main chat id in local mode; its messages live in the "default" conversation. */
export const LOCAL_MAIN = "local-main";
const ThreadContext = createContext<{
  selection: Selection;
  visited: Selection[];
  select: (selection: Selection) => void;
  start: () => void;
  claimPrompt: (id: number) => boolean;
} | null>(null);
export function ThreadsProvider({ children }: { children: ReactNode }) {
  const { navigate } = useWorkspace();
  const handledPrompt = useRef(0);
  const localMain = { id: LOCAL_MAIN, existing: true };
  const [selection, setSelection] = useState<Selection>(localMain);
  const [visited, setVisited] = useState<Selection[]>([localMain]);
  function select(next: Selection) {
    setSelection(next);
    setVisited((items) => (items.some((item) => item.id === next.id) ? items : [...items, next]));
    navigate("chat");
  }
  return (
    <ThreadContext.Provider
      value={{
        claimPrompt: (id) => {
          if (handledPrompt.current === id) return false;
          handledPrompt.current = id;
          return true;
        },
        visited,
        selection,
        select,
        start: () => select({ id: newThreadId(), existing: false }),
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
}
export function useMuseThread() {
  const context = useContext(ThreadContext);
  if (!context) throw new Error("Threads provider is unavailable");
  return context;
}
export function ThreadsSheet({ onClose }: { onClose: () => void }) {
  const { selection, select, start } = useMuseThread();
  const { workspace, navigate } = useWorkspace();
  return (
    <Sheet
      title="Conversas"
      subtitle={workspace.mode === "sample" ? "Seu espaço" : workspace.profile.name}
      onClose={onClose}
    >
      <View style={{ gap: 14 }}>
        <LocalThreads
          selection={selection}
          onSelect={(next) => {
            select(next);
            onClose();
          }}
          onStart={() => {
            start();
            onClose();
          }}
        />
        <View style={s.divider} />
        <LinkRow
          icon={Settings2}
          title="Ajustes"
          detail="Apps, ajudantes, memória, notificações e modelo"
          onPress={() => {
            onClose();
            navigate("apps");
          }}
        />
      </View>
    </Sheet>
  );
}

type LocalThread = {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  updatedAt: string;
};

function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Side chats stored by this OpenMuse server (no CopilotKit Intelligence needed). */
function LocalThreads({
  selection,
  onSelect,
  onStart,
}: {
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onStart: () => void;
}) {
  const { api } = useWorkspace();
  const [threads, setThreads] = useState<LocalThread[]>();
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setThreads((await api.request<{ threads: LocalThread[] }>("/api/threads")).threads);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  async function change(id: string, action: () => Promise<unknown>) {
    setError("");
    setMenu(undefined);
    try {
      await action();
      setRenaming(undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return id;
  }
  const shown = (threads ?? []).filter((thread) => thread.archived === archived);
  const row = (active: boolean) => ({
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: active ? colors.sky : "#F3F4F5",
  });
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: selection.id === LOCAL_MAIN }}
        onPress={() => onSelect({ id: LOCAL_MAIN, existing: true })}
        style={row(selection.id === LOCAL_MAIN)}
      >
        <Text style={[s.text, { fontWeight: "500" }]}>Conversa principal</Text>
      </Pressable>
      <View style={[s.between, { marginTop: 10, paddingHorizontal: 4 }]}>
        <Text style={s.muted}>{archived ? "Conversas arquivadas" : "Conversas paralelas"}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Nova conversa paralela"
          hitSlop={10}
          onPress={onStart}
        >
          <Plus size={20} color={colors.text} />
        </Pressable>
      </View>
      <ErrorNotice error={error} />
      {!threads && !error && <ActivityIndicator color={colors.blueDark} />}
      {shown.map((thread) => (
        <View key={thread.id} style={{ gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Abrir ${thread.title}`}
            accessibilityState={{ selected: selection.id === thread.id }}
            onPress={() => onSelect({ id: thread.id, existing: true })}
            style={[s.row, row(selection.id === thread.id), { gap: 10 }]}
          >
            {thread.pinned && <Pin size={14} color={colors.muted} />}
            <Text numberOfLines={1} style={[s.text, { flex: 1, fontWeight: "500" }]}>
              {thread.title}
            </Text>
            <Text style={s.small}>{ago(thread.updatedAt)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Opções de ${thread.title}`}
              hitSlop={10}
              onPress={() => setMenu(menu === thread.id ? undefined : thread.id)}
            >
              <MoreHorizontal size={18} color={colors.muted} />
            </Pressable>
          </Pressable>
          {renaming === thread.id && (
            <View style={[s.row, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Field label="Nome" value={name} onChangeText={setName} />
              </View>
              <Button
                small
                disabled={!name.trim()}
                onPress={() =>
                  void change(thread.id, () =>
                    api.request(`/api/threads/${thread.id}`, { title: name.trim() }, "PATCH"),
                  )
                }
              >
                Salvar
              </Button>
            </View>
          )}
          {menu === thread.id && (
            <View
              style={{
                alignSelf: "flex-end",
                width: 190,
                backgroundColor: "#FFF",
                borderRadius: 16,
                paddingVertical: 4,
                boxShadow: "0 8px 24px rgba(17, 25, 28, 0.14)",
              }}
            >
              {[
                {
                  label: thread.pinned ? "Desafixar" : "Fixar",
                  icon: Pin,
                  run: () =>
                    change(thread.id, () =>
                      api.request(`/api/threads/${thread.id}`, { pinned: !thread.pinned }, "PATCH"),
                    ),
                },
                {
                  label: "Renomear",
                  icon: Pencil,
                  run: () => {
                    setMenu(undefined);
                    setRenaming(thread.id);
                    setName(thread.title);
                  },
                },
                {
                  label: thread.archived ? "Restaurar" : "Arquivar",
                  icon: Archive,
                  run: () =>
                    change(thread.id, () =>
                      api.request(
                        `/api/threads/${thread.id}`,
                        { archived: !thread.archived },
                        "PATCH",
                      ),
                    ),
                },
                {
                  label: "Excluir",
                  icon: Trash2,
                  danger: true,
                  run: () =>
                    change(thread.id, async () => {
                      await api.request(`/api/threads/${thread.id}`, undefined, "DELETE");
                      if (selection.id === thread.id) onSelect({ id: LOCAL_MAIN, existing: true });
                    }),
                },
              ].map((option) => (
                <Pressable
                  key={option.label}
                  accessibilityRole="menuitem"
                  onPress={() => void option.run()}
                  style={({ pressed }) => [
                    s.row,
                    {
                      gap: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <option.icon size={17} color={option.danger ? "#C2413A" : colors.text} />
                  <Text style={{ fontSize: 15, color: option.danger ? "#C2413A" : colors.text }}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ))}
      {threads && !shown.length && (
        <Text style={[s.small, { paddingHorizontal: 4 }]}>
          {archived
            ? "Nenhuma conversa arquivada."
            : "Abra uma conversa paralela para outro assunto. A memória é compartilhada entre elas."}
        </Text>
      )}
      <Button small style={{ alignSelf: "flex-start" }} onPress={() => setArchived(!archived)}>
        {archived ? "Ver conversas paralelas" : "Arquivadas"}
      </Button>
    </View>
  );
}
