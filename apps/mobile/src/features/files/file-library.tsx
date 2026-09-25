// The file library: search, kind filters, photos as a grid and documents as rows. The Arquivos
// screen browses it (tap opens); the composer's Biblioteca sheet selects from it to attach.
import { Check, ChevronRight, FolderOpen, Search, SearchX, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Artifact } from "../../../../../packages/domain/src";
import {
  fileKind,
  filterFiles,
  inFilter,
  LIBRARY_FILTERS,
  type LibraryFilter,
  middleEllipsis,
} from "../../shared/file-kind";
import { kit, since } from "../../shared/kit";
import { Button, colors, Empty, Sheet } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { FileBadge, FileThumb, fileMeta, ImageViewer, isImage } from "./file-views";

// The search field sits in its own grey pill; drop the browser's focus ring inside it.
if (Platform.OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = 'input[aria-label="Buscar arquivos"]:focus{outline:none;box-shadow:none}';
  document.head.appendChild(style);
}

const PAGE_PHOTOS = 12;
const PAGE_DOCS = 20;

/** A round selection mark: an empty ring, or the accent disc with a check. */
function SelectMark({ on, light }: { on: boolean; light?: boolean }) {
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: on ? 0 : 2,
        borderColor: light ? "#FFF" : "#C9CED2",
        backgroundColor: on ? kit.accent : light ? "rgba(17,25,28,0.18)" : "#FFF",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <Check size={14} strokeWidth={3} color="#FFF" />}
    </View>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, paddingHorizontal: 2 }}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{title}</Text>
      <Text style={{ fontSize: 13, color: kit.muted }}>{count}</Text>
    </View>
  );
}

function ShowMore({ hidden, onPress }: { hidden: number; onPress: () => void }) {
  return hidden > 0 ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 18,
        backgroundColor: pressed ? colors.sky : "#F3F5F7",
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: "600", color: kit.accent }}>Ver mais {hidden}</Text>
    </Pressable>
  ) : null;
}

export function FileLibrary({
  selected,
  onToggle,
}: {
  /** Selection mode (the composer's sheet): tapping toggles instead of opening. */
  selected?: string[];
  onToggle?: (file: Artifact) => void;
}) {
  const { workspace: w, open } = useWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [photoLimit, setPhotoLimit] = useState(PAGE_PHOTOS);
  const [docLimit, setDocLimit] = useState(PAGE_DOCS);
  const [gridWidth, setGridWidth] = useState(0);
  const [viewing, setViewing] = useState<number>();
  const selecting = !!onToggle;

  const results = useMemo(() => filterFiles(w.files, query, filter), [w.files, query, filter]);
  const counts = useMemo(() => {
    const kinds = w.files.map((f) => fileKind(f.name, f.mimeType));
    return Object.fromEntries(
      LIBRARY_FILTERS.map((f) => [f.value, kinds.filter((k) => inFilter(k, f.value)).length]),
    ) as Record<LibraryFilter, number>;
  }, [w.files]);
  const photos = results.filter(isImage);
  const docs = results.filter((f) => !isImage(f));
  const shownPhotos = photos.slice(0, filter === "photos" ? photoLimit * 2 : photoLimit);
  const shownDocs = docs.slice(0, docLimit);

  const columns = gridWidth >= 560 ? 5 : gridWidth >= 420 ? 4 : 3;
  const gap = 4;
  const tile = gridWidth ? Math.floor((gridWidth - gap * (columns - 1)) / columns) : 0;
  const isOn = (f: Artifact) => !!selected?.includes(f.id);
  const setSearch = (value: string) => {
    setQuery(value);
    setPhotoLimit(PAGE_PHOTOS);
    setDocLimit(PAGE_DOCS);
  };

  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 42,
          paddingHorizontal: 13,
          borderRadius: 14,
          backgroundColor: "#F0F2F4",
        }}
      >
        <Search size={17} color={kit.muted} />
        <TextInput
          accessibilityLabel="Buscar arquivos"
          value={query}
          onChangeText={setSearch}
          placeholder="Buscar pelo nome"
          placeholderTextColor={kit.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={{
            flex: 1,
            height: 42,
            fontSize: 16,
            color: colors.text,
            outlineWidth: Platform.OS === "web" ? 0 : undefined,
          }}
        />
        {!!query && (
          <Pressable accessibilityLabel="Limpar busca" hitSlop={10} onPress={() => setSearch("")}>
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: "#B7BDC2",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={12} strokeWidth={3} color="#FFF" />
            </View>
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -20, flexGrow: 0 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
      >
        {LIBRARY_FILTERS.map((option) => {
          const active = option.value === filter;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(option.value)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                height: 34,
                paddingHorizontal: 14,
                borderRadius: 17,
                backgroundColor: active ? colors.text : pressed ? colors.sky : "#FFF",
                borderWidth: 1,
                borderColor: active ? colors.text : kit.line,
              })}
            >
              <Text
                style={{ fontSize: 14, fontWeight: "600", color: active ? "#FFF" : colors.text }}
              >
                {option.label}
              </Text>
              {counts[option.value] > 0 && (
                <Text
                  style={{ fontSize: 12, color: active ? "rgba(255,255,255,0.65)" : kit.muted }}
                >
                  {counts[option.value]}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {!w.files.length ? (
        <Empty
          icon={FolderOpen}
          title="Sua biblioteca está vazia"
          detail="Fotos, PDFs, planilhas e documentos que você enviar ou anexar numa conversa ficam guardados aqui."
        />
      ) : !results.length ? (
        <Empty
          icon={SearchX}
          title="Nada encontrado"
          detail={
            query
              ? `Nenhum arquivo com “${query}”${filter === "all" ? "" : " neste filtro"}.`
              : "Nenhum arquivo deste tipo ainda."
          }
        />
      ) : null}

      {photos.length > 0 && (
        <View style={{ gap: 10 }}>
          {filter === "all" && <SectionTitle title="Fotos" count={photos.length} />}
          <View
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
            style={{ flexDirection: "row", flexWrap: "wrap", gap }}
          >
            {tile > 0 &&
              shownPhotos.map((f, i) => (
                <Pressable
                  key={f.id}
                  accessibilityRole={selecting ? "checkbox" : "imagebutton"}
                  accessibilityState={selecting ? { checked: isOn(f) } : undefined}
                  accessibilityLabel={f.name}
                  onPress={() => (selecting ? onToggle(f) : setViewing(i))}
                  style={({ pressed }) => ({
                    width: tile,
                    height: tile,
                    borderRadius: 12,
                    overflow: "hidden",
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <FileThumb file={f} size={tile} radius={12} />
                  {selecting && (
                    <>
                      {isOn(f) && (
                        <View
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            borderRadius: 12,
                            borderWidth: 3,
                            borderColor: kit.accent,
                            backgroundColor: "rgba(255,255,255,0.18)",
                          }}
                        />
                      )}
                      <View style={{ position: "absolute", top: 7, right: 7 }}>
                        <SelectMark on={isOn(f)} light />
                      </View>
                    </>
                  )}
                </Pressable>
              ))}
          </View>
          <ShowMore
            hidden={photos.length - shownPhotos.length}
            onPress={() => setPhotoLimit(photoLimit + PAGE_PHOTOS * 2)}
          />
        </View>
      )}

      {docs.length > 0 && (
        <View style={{ gap: 10 }}>
          {filter === "all" && photos.length > 0 && (
            <SectionTitle title="Documentos" count={docs.length} />
          )}
          <View
            style={{
              backgroundColor: kit.panel,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: kit.line,
              paddingHorizontal: 12,
            }}
          >
            {shownDocs.map((f, i) => (
              <Pressable
                key={f.id}
                accessibilityRole={selecting ? "checkbox" : "button"}
                accessibilityState={selecting ? { checked: isOn(f) } : undefined}
                accessibilityLabel={f.name}
                onPress={() => (selecting ? onToggle(f) : open({ type: "file", file: f }))}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 11,
                  borderTopWidth: i ? 1 : 0,
                  borderTopColor: kit.line,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <FileBadge name={f.name} mimeType={f.mimeType} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 15, fontWeight: "500", color: colors.text }}
                  >
                    {middleEllipsis(f.name, 28)}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: kit.muted }}>
                    {fileMeta(f)} · {since(f.createdAt)}
                  </Text>
                </View>
                {selecting ? (
                  <SelectMark on={isOn(f)} />
                ) : (
                  <ChevronRight size={16} color="#B3B8BC" />
                )}
              </Pressable>
            ))}
          </View>
          <ShowMore
            hidden={docs.length - shownDocs.length}
            onPress={() => setDocLimit(docLimit + PAGE_DOCS)}
          />
        </View>
      )}

      {viewing !== undefined && (
        <ImageViewer files={shownPhotos} index={viewing} onClose={() => setViewing(undefined)} />
      )}
    </View>
  );
}

/** The composer's "Biblioteca": pick several files, then "Anexar (n)". */
export function LibrarySheet({
  attached,
  onAttach,
  onClose,
}: {
  attached: Artifact[];
  onAttach: (files: Artifact[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Artifact[]>(attached);
  const ids = picked.map((f) => f.id);
  const changed =
    picked.length !== attached.length || picked.some((f) => !attached.some((a) => a.id === f.id));
  return (
    <Sheet title="Biblioteca" subtitle="Escolha o que anexar à mensagem" onClose={onClose} plain>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ padding: 20 }}
      >
        <FileLibrary
          selected={ids}
          onToggle={(file) =>
            setPicked((list) =>
              list.some((f) => f.id === file.id)
                ? list.filter((f) => f.id !== file.id)
                : [...list, file],
            )
          }
        />
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 20,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: kit.line,
          backgroundColor: colors.canvas,
        }}
      >
        {picked.length > 0 && <Button onPress={() => setPicked([])}>Limpar</Button>}
        <Button
          primary
          disabled={!picked.length && !changed}
          style={{ flex: 1 }}
          onPress={() => {
            onAttach(picked);
            onClose();
          }}
        >
          {picked.length ? `Anexar (${picked.length})` : changed ? "Remover anexos" : "Anexar"}
        </Button>
      </View>
    </Sheet>
  );
}
