// A file as the answer: a large preview on top (the first page of a PDF, the photo, a mini page
// with a document's first lines or a tiny table for spreadsheets) and an identity row below it
// (type badge · name · type and size · ⋯). Used for files the agent sends in the chat and for
// documents on the person's own messages. Preview rules: shared/file-preview.ts.
import { LinearGradient } from "expo-linear-gradient";
import { Download, ExternalLink, Library, MoreHorizontal, Share2 } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { type LayoutChangeEvent, Platform, Pressable, Text, View } from "react-native";
import type { Artifact } from "../../../../../packages/domain/src";
import { middleEllipsis } from "../../shared/file-kind";
import { columnWeights, type ExcerptTable, numeric, previewOf } from "../../shared/file-preview";
import { kit } from "../../shared/kit";
import RemoteImage from "../../shared/RemoteImage";
import { colors, ErrorNotice } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { FileBadge, fileMeta, useSignedUri } from "./file-views";
import { shareFile } from "./share-file";

/** What a card needs; a send_file result has these, a library file has more. */
export type CardFile = Pick<Artifact, "id" | "name" | "mimeType" | "size" | "pageCount" | "url"> &
  Partial<Pick<Artifact, "thumbnailUrl" | "excerpt" | "createdAt" | "source">>;

const STAGE = "#F3F4F6";

/**
 * Files a script produced that the agent didn't show as a card: a quiet row of small chips
 * that open each one. The card is the agent's answer; these are the leftovers.
 */
export function GeneratedFiles({
  files,
}: {
  files: { id: string; name: string; mimeType: string; size: number }[];
}) {
  const { workspace, open } = useWorkspace();
  return (
    <View style={{ gap: 6, alignSelf: "flex-start", maxWidth: "95%" }}>
      <Text style={{ fontSize: 12, color: kit.muted, paddingHorizontal: 4 }}>Arquivos gerados</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {files.map((f) => {
          const saved = workspace.files.find((item) => item.id === f.id);
          return (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              accessibilityLabel={`Abrir ${f.name}`}
              onPress={() =>
                open({
                  type: "file",
                  file: saved ?? {
                    ...f,
                    pageCount: 0,
                    url: "",
                    createdAt: new Date().toISOString(),
                    source: "Corgi",
                  },
                })
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                maxWidth: "100%",
                paddingLeft: 6,
                paddingRight: 11,
                paddingVertical: 5,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: kit.line,
                backgroundColor: pressed ? "#F3F5F7" : "#FFF",
              })}
            >
              <FileBadge name={f.name} mimeType={f.mimeType} width={18} height={22} />
              <Text
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 13, fontWeight: "500", color: colors.text }}
              >
                {middleEllipsis(f.name, 26)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The newest copy of a file: the workspace snapshot carries fresh signed URLs by id, while a
 * tool result's URLs expire after ~15 minutes.
 */
function useFreshFile(file: CardFile): Artifact {
  const { workspace } = useWorkspace();
  const saved = workspace.files.find((f) => f.id === file.id);
  if (saved) return { ...saved, excerpt: saved.excerpt ?? file.excerpt };
  return { createdAt: new Date().toISOString(), source: "Corgi", ...file };
}

export function FileCard({
  file: given,
  caption,
  small,
}: {
  file: CardFile;
  caption?: string;
  /** A sent message's document: a shorter preview, right-aligned. */
  small?: boolean;
}) {
  const { api, open, navigate } = useWorkspace();
  const file = useFreshFile(given);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");
  const preview = previewOf(file);
  const openFile = () => open({ type: "file", file });
  const share = () =>
    void shareFile(api, file, "download").catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  const options = [
    { label: "Abrir", icon: ExternalLink, run: openFile },
    Platform.OS === "web"
      ? { label: "Baixar", icon: Download, run: share }
      : { label: "Compartilhar", icon: Share2, run: share },
    { label: "Ver na biblioteca", icon: Library, run: () => navigate("files") },
  ];
  return (
    <View style={{ gap: 8, alignItems: small ? "flex-end" : "flex-start" }}>
      {!!caption && (
        <Text style={{ fontSize: 16, lineHeight: 24, color: colors.text, paddingHorizontal: 4 }}>
          {caption}
        </Text>
      )}
      <View
        style={{
          width: "100%",
          maxWidth: small ? 250 : 360,
          borderRadius: small ? 18 : 22,
          backgroundColor: "#FFF",
          borderWidth: 1,
          borderColor: kit.line,
          boxShadow: "0 2px 10px rgba(24, 56, 75, 0.07)",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir ${file.name}`}
          onPress={() => (menu ? setMenu(false) : openFile())}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          {preview.kind !== "none" && (
            <View
              style={{
                borderTopLeftRadius: small ? 17 : 21,
                borderTopRightRadius: small ? 17 : 21,
                overflow: "hidden",
                backgroundColor: STAGE,
                borderBottomWidth: 1,
                borderBottomColor: kit.line,
              }}
            >
              {preview.kind === "image" ? (
                <ImagePreview uri={preview.uri} label={file.name} max={small ? 200 : 260} />
              ) : (
                <Paper max={small ? 150 : 220}>
                  {preview.kind === "page" ? (
                    <PagePicture uri={preview.uri} label={file.name} />
                  ) : preview.kind === "table" ? (
                    <MiniTable table={preview.table} />
                  ) : (
                    <MiniText text={preview.text} />
                  )}
                </Paper>
              )}
            </View>
          )}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 11,
              paddingVertical: small ? 9 : 11,
              paddingLeft: small ? 10 : 12,
              paddingRight: 44,
            }}
          >
            <FileBadge
              name={file.name}
              mimeType={file.mimeType}
              width={small ? 26 : 30}
              height={small ? 31 : 36}
            />
            <View style={{ flexShrink: 1, gap: 1 }}>
              <Text
                numberOfLines={1}
                style={{ fontSize: small ? 13.5 : 14.5, fontWeight: "600", color: colors.text }}
              >
                {middleEllipsis(file.name, small ? 20 : 30)}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: kit.muted }}>
                {fileMeta(file)}
              </Text>
            </View>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mais opções para ${file.name}`}
          accessibilityState={{ expanded: menu }}
          hitSlop={8}
          onPress={() => setMenu(!menu)}
          style={({ pressed }) => ({
            position: "absolute",
            right: 8,
            bottom: small ? 11 : 14,
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: menu || pressed ? "#EEF0F2" : "transparent",
          })}
        >
          <MoreHorizontal size={18} color={colors.text} />
        </Pressable>
        {menu && (
          <View
            accessibilityRole="menu"
            style={{
              position: "absolute",
              right: 8,
              bottom: small ? 48 : 54,
              minWidth: 196,
              backgroundColor: "#FFF",
              borderRadius: 14,
              paddingVertical: 4,
              boxShadow: "0 8px 28px rgba(17, 25, 28, 0.18)",
              zIndex: 5,
            }}
          >
            {options.map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="menuitem"
                onPress={() => {
                  setMenu(false);
                  option.run();
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  backgroundColor: pressed ? "#F3F5F7" : "transparent",
                })}
              >
                <option.icon size={16} color={colors.text} />
                <Text style={{ fontSize: 14, color: colors.text }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}

/** A white page on the grey stage, top part visible; a long page fades out at the bottom. */
function Paper({ max, children }: { max: number; children: ReactNode }) {
  const [height, setHeight] = useState(0);
  const cut = height > max - 14;
  return (
    <View style={{ height: Math.min(max, Math.max(height + 14, 96)), paddingTop: 14 }}>
      <View
        style={{
          marginHorizontal: 18,
          backgroundColor: "#FFF",
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          borderBottomLeftRadius: cut ? 0 : 6,
          borderBottomRightRadius: cut ? 0 : 6,
          borderWidth: 1,
          borderColor: "#E3E6E9",
          boxShadow: "0 1px 4px rgba(17, 25, 28, 0.06)",
          overflow: "hidden",
          alignSelf: "stretch",
        }}
        onLayout={(event: LayoutChangeEvent) => {
          const next = Math.round(event.nativeEvent.layout.height);
          if (next !== height) setHeight(next);
        }}
      >
        {children}
      </View>
      {cut && (
        <LinearGradient
          pointerEvents="none"
          colors={[`${STAGE}00`, STAGE]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 56 }}
        />
      )}
    </View>
  );
}

/** A PDF's first page (a rendered PNG), at its own proportions. */
function PagePicture({ uri: given, label }: { uri: string; label: string }) {
  const { uri, onError } = useSignedUri(given);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(Math.SQRT2); // A4
  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}
    >
      {uri && width > 0 ? (
        <RemoteImage
          uri={uri}
          label={label}
          width={width}
          height={Math.round(width * ratio)}
          fit="contain"
          onSize={(w, h) => setRatio(h / w)}
          onError={onError}
        />
      ) : (
        <View style={{ height: Math.round((width || 300) * ratio), backgroundColor: "#FFF" }} />
      )}
    </View>
  );
}

/** A photo, whole: its shape within limits (not too tall, not a sliver). */
function ImagePreview({ uri: given, label, max }: { uri: string; label: string; max: number }) {
  const { uri, onError } = useSignedUri(given);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(0.75);
  const height = Math.round(Math.min(max, Math.max(120, width * ratio)));
  return (
    <View
      style={{ height, alignItems: "center", justifyContent: "center" }}
      onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}
    >
      {uri && width > 0 && (
        <RemoteImage
          uri={uri}
          label={label}
          width={width}
          height={height}
          // A tall photo is shown whole on the stage rather than cropped.
          fit={width * ratio > max ? "contain" : "cover"}
          onSize={(w, h) => setRatio(h / w)}
          onError={onError}
        />
      )}
    </View>
  );
}

/** The document's first lines in small type, like a printed page seen from a distance. */
function MiniText({ text }: { text: string }) {
  // Lines are static and may repeat, so each is keyed by where it starts in the text.
  let offset = 0;
  const lines = text.split("\n").map((line) => {
    const start = offset;
    offset += line.length + 1;
    return { line, key: String(start) };
  });
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 3 }}>
      {lines.map(({ line, key }, i) => {
        const heading = /^#{1,6}\s+/.test(line);
        const clean = line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");
        if (!clean.trim()) return <View key={key} style={{ height: 4 }} />;
        return (
          <Text
            key={key}
            style={{
              fontSize: heading || (i === 0 && clean.length < 60) ? 11 : 9,
              lineHeight: heading || i === 0 ? 15 : 13,
              fontWeight: heading || (i === 0 && clean.length < 60) ? "700" : "400",
              color: "#3A4247",
            }}
          >
            {clean}
          </Text>
        );
      })}
    </View>
  );
}

/** The first rows of a spreadsheet as a tiny grid, header shaded. */
function MiniTable({ table }: { table: ExcerptTable }) {
  const weights = columnWeights(table);
  const cell = {
    paddingHorizontal: 5,
    paddingVertical: 4,
    fontSize: 9,
    color: "#3A4247",
  } as const;
  return (
    <View>
      {!!table.sheet && (
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: 8,
            paddingTop: 7,
            paddingBottom: 5,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontSize: 9,
              fontWeight: "700",
              color: "#1E8A4F",
              backgroundColor: "#E3F3E8",
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            {table.sheet}
          </Text>
        </View>
      )}
      {[table.header, ...table.rows].map((row, r) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are static
          key={r}
          style={{
            flexDirection: "row",
            backgroundColor: r === 0 ? "#F4F6F8" : "#FFF",
            borderTopWidth: 1,
            borderTopColor: "#ECEEF0",
          }}
        >
          {row.map((value, c) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are static
              key={c}
              numberOfLines={1}
              style={[
                cell,
                {
                  fontWeight: r === 0 ? "700" : "400",
                  borderLeftWidth: c ? 1 : 0,
                  borderLeftColor: "#ECEEF0",
                  flex: weights[c],
                  textAlign: r > 0 && numeric(value) ? "right" : "left",
                },
              ]}
            >
              {value}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
