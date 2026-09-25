// How files look wherever they appear: a type badge, a thumbnail, a compact document card, the
// photo grid under a message and the full-screen photo viewer. Rules (kind, size, names) live in
// shared/file-kind.ts.

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  X,
} from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Artifact } from "../../../../../packages/domain/src";
import {
  fileKind,
  formatSize,
  KIND_COLORS,
  middleEllipsis,
  typeLabel,
} from "../../shared/file-kind";
import { kit } from "../../shared/kit";
import RemoteImage from "../../shared/RemoteImage";
import { colors } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

export const isImage = (f: { name: string; mimeType?: string }) =>
  fileKind(f.name, f.mimeType) === "image";

/**
 * The signed URL of a server file. Signatures expire after 15 minutes: the first failure refreshes
 * the workspace (new signatures) and only a second failure gives up.
 */
export function useFileUrl(file?: Pick<Artifact, "url">) {
  return useSignedUri(file?.url || undefined);
}

/**
 * Any signed URL (a file, its thumbnail) with the same refresh-once-on-failure rule. The link
 * is loaded from the API in use (the server may name itself differently).
 */
export function useSignedUri(uri?: string) {
  const { api, refresh } = useWorkspace();
  // One refresh per link: a link that fails again after it was reissued is given up.
  const retriedFor = useRef<string>(undefined);
  const [failed, setFailed] = useState<string>();
  return {
    uri: uri && failed !== uri ? api.url(uri) : undefined,
    onError: () => {
      if (retriedFor.current !== uri) {
        retriedFor.current = uri;
        void refresh().catch(() => setFailed(uri));
      } else setFailed(uri);
    },
  };
}

/** The colored type square: "PDF" on red, "XLSX" on green, "DOCX" on blue… */
export function FileBadge({
  name,
  mimeType,
  width = 36,
  height = 42,
}: {
  name: string;
  mimeType?: string;
  width?: number;
  height?: number;
}) {
  const { solid } = KIND_COLORS[fileKind(name, mimeType)];
  const label = typeLabel(name, mimeType);
  return (
    <View
      style={{
        width,
        height,
        borderRadius: Math.round(width / 4),
        backgroundColor: solid,
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: Math.round(height / 6),
        overflow: "hidden",
      }}
    >
      {/* The folded corner that makes it read as a page. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: width / 3,
          height: width / 3,
          borderBottomLeftRadius: 4,
          backgroundColor: "rgba(255,255,255,0.35)",
        }}
      />
      <Text
        numberOfLines={1}
        style={{
          color: "#FFF",
          fontSize: label.length > 4 ? width / 5 : width / 3.6,
          fontWeight: "800",
          letterSpacing: 0.2,
        }}
      >
        {label.length > 5 ? label.slice(0, 4) : label}
      </Text>
    </View>
  );
}

/** A square thumbnail: the photo itself, or the type badge on its tint. */
export function FileThumb({
  file,
  size,
  radius = 14,
}: {
  file: Artifact;
  size: number;
  radius?: number;
}) {
  const { uri, onError } = useFileUrl(file);
  if (isImage(file) && uri)
    return (
      <RemoteImage
        uri={uri}
        label={file.name}
        width={size}
        height={size}
        radius={radius}
        onError={onError}
      />
    );
  const kind = fileKind(file.name, file.mimeType);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: KIND_COLORS[kind].tint,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {kind === "image" ? (
        <ImageIcon size={size / 3} color={KIND_COLORS.image.solid} />
      ) : (
        <FileBadge
          name={file.name}
          mimeType={file.mimeType}
          width={size * 0.42}
          height={size * 0.5}
        />
      )}
    </View>
  );
}

/**
 * A PDF's first page in miniature, with its type badge on the corner: the composer's and a
 * sent message's small preview. Falls back to the plain badge while there is no picture.
 */
export function PageThumb({
  file,
  width,
  height,
}: {
  file: Pick<Artifact, "name" | "mimeType" | "thumbnailUrl">;
  width: number;
  height: number;
}) {
  const { uri, onError } = useSignedUri(file.thumbnailUrl);
  const { solid } = KIND_COLORS[fileKind(file.name, file.mimeType)];
  if (!uri)
    return <FileBadge name={file.name} mimeType={file.mimeType} width={width} height={height} />;
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: "#E1E4E7",
        backgroundColor: "#FFF",
        overflow: "hidden",
      }}
    >
      <RemoteImage
        uri={uri}
        label={file.name}
        width={width - 2}
        height={height - 2}
        onError={onError}
      />
      <View
        style={{
          position: "absolute",
          left: 3,
          bottom: 3,
          paddingHorizontal: 3,
          paddingVertical: 1,
          borderRadius: 3,
          backgroundColor: solid,
        }}
      >
        <Text style={{ color: "#FFF", fontSize: 7.5, fontWeight: "800", letterSpacing: 0.2 }}>
          {typeLabel(file.name, file.mimeType).slice(0, 4)}
        </Text>
      </View>
    </View>
  );
}

/** "PDF · 3 páginas · 240 KB". */
export function fileMeta(file: Pick<Artifact, "name" | "mimeType" | "size" | "pageCount">) {
  const kind = fileKind(file.name, file.mimeType);
  return [
    typeLabel(file.name, file.mimeType),
    kind === "pdf" && file.pageCount > 0
      ? `${file.pageCount} ${file.pageCount === 1 ? "página" : "páginas"}`
      : "",
    formatSize(file.size),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A compact document card: badge, name (shortened in the middle), type and size. */
export function DocumentCard({
  name,
  file,
  onPress,
  style,
  compact,
}: {
  name: string;
  file?: Artifact;
  onPress?: () => void;
  style?: ViewStyle;
  /** The composer's smaller variant. */
  compact?: boolean;
}) {
  // A PDF with a rendered first page shows it instead of the plain badge.
  const paged = !!file?.thumbnailUrl && fileKind(name, file.mimeType) === "pdf";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${name}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: compact ? 9 : 11,
          padding: paged ? 5 : compact ? 9 : 10,
          paddingRight: compact ? 12 : 14,
          borderRadius: compact ? 16 : 18,
          backgroundColor: "#FFF",
          borderWidth: 1,
          borderColor: kit.line,
          boxShadow: "0 2px 8px rgba(24, 56, 75, 0.06)",
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {paged && file ? (
        <PageThumb file={file} width={compact ? 40 : 42} height={compact ? 48 : 52} />
      ) : (
        <FileBadge
          name={name}
          mimeType={file?.mimeType}
          width={compact ? 32 : 36}
          height={compact ? 38 : 42}
        />
      )}
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: compact ? 13 : 14, fontWeight: "600", color: colors.text }}
        >
          {middleEllipsis(name, compact ? 20 : 28)}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: kit.muted }}>
          {file ? fileMeta(file) : `${typeLabel(name)} · indisponível`}
        </Text>
      </View>
    </Pressable>
  );
}

/** One tile of a message's photo grid. */
function GridPhoto({
  file,
  width,
  height,
  onPress,
  onSize,
  more,
}: {
  file?: Artifact;
  width: number;
  height: number;
  onPress: () => void;
  onSize?: (w: number, h: number) => void;
  more?: number;
}) {
  const { uri, onError } = useFileUrl(file);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={file ? `Ver ${file.name}` : "Imagem indisponível"}
      disabled={!uri}
      onPress={onPress}
      style={({ pressed }) => ({ width, height, opacity: pressed ? 0.85 : 1 })}
    >
      {uri ? (
        <RemoteImage
          uri={uri}
          label={file?.name}
          width={width}
          height={height}
          onSize={onSize}
          onError={onError}
        />
      ) : (
        <View
          style={{
            width,
            height,
            backgroundColor: "#EEF0F2",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ImageIcon size={22} color={kit.muted} />
        </View>
      )}
      {!!more && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(17,25,28,0.45)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#FFF", fontSize: 22, fontWeight: "700" }}>+{more}</Text>
        </View>
      )}
    </Pressable>
  );
}

const GRID = 236;
const GAP = 3;

/**
 * The photos of a message, right-aligned like a chat app: one photo keeps its shape (within
 * limits), two sit side by side, three put one wide on top, four or more make a 2×2 grid.
 */
export function MessageImages({
  files,
  onOpen,
}: {
  files: { id: string; name: string; file?: Artifact }[];
  onOpen: (index: number) => void;
}) {
  const [ratio, setRatio] = useState(0.75);
  const half = (GRID - GAP) / 2;
  const tile = (i: number, width: number, height: number, extra?: Partial<{ more: number }>) => (
    <GridPhoto
      key={files[i].id}
      file={files[i].file}
      width={width}
      height={height}
      onPress={() => onOpen(i)}
      onSize={files.length === 1 ? (w, h) => setRatio(h / w) : undefined}
      {...extra}
    />
  );
  let body: ReactNode;
  if (files.length === 1) {
    body = tile(0, GRID, Math.round(GRID * Math.min(1.35, Math.max(0.6, ratio))));
  } else if (files.length === 2) {
    body = (
      <View style={{ flexDirection: "row", gap: GAP }}>
        {tile(0, half, 150)}
        {tile(1, half, 150)}
      </View>
    );
  } else if (files.length === 3) {
    body = (
      <View style={{ gap: GAP }}>
        {tile(0, GRID, 150)}
        <View style={{ flexDirection: "row", gap: GAP }}>
          {tile(1, half, half)}
          {tile(2, half, half)}
        </View>
      </View>
    );
  } else {
    body = (
      <View style={{ gap: GAP }}>
        <View style={{ flexDirection: "row", gap: GAP }}>
          {tile(0, half, half)}
          {tile(1, half, half)}
        </View>
        <View style={{ flexDirection: "row", gap: GAP }}>
          {tile(2, half, half)}
          {tile(3, half, half, { more: files.length - 4 })}
        </View>
      </View>
    );
  }
  return (
    <View
      style={{
        alignSelf: "flex-end",
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: colors.canvas,
      }}
    >
      {body}
    </View>
  );
}

/** Full-screen photos on black: swipe (or arrows on wide screens), tap × to close. */
export function ImageViewer({
  files,
  index: start,
  onClose,
}: {
  files: Artifact[];
  index: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { api, open } = useWorkspace();
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState(start);
  const current = files[index] ?? files[0];
  const top = Math.max(insets.top, 12);
  const bottom = Math.max(insets.bottom, 16);
  const pageHeight = height - top - bottom - 110;
  useEffect(() => {
    // contentOffset isn't honored on the web; jump once the pager has laid out.
    const timer = setTimeout(() => pager.current?.scrollTo({ x: start * width, animated: false }));
    return () => clearTimeout(timer);
  }, [start, width]);
  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(files.length - 1, next));
    pager.current?.scrollTo({ x: clamped * width, animated: true });
    setIndex(clamped);
  };
  const round = {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: "#0B0F11" }}>
        <View
          style={{
            paddingTop: top,
            paddingHorizontal: 16,
            height: top + 56,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            hitSlop={8}
            style={round}
          >
            <X size={20} color="#FFF" />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text numberOfLines={1} style={{ color: "#FFF", fontSize: 15, fontWeight: "600" }}>
              {middleEllipsis(current?.name ?? "", 30)}
            </Text>
            {files.length > 1 && (
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                {index + 1} de {files.length}
              </Text>
            )}
          </View>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / width);
            if (next !== index && next >= 0 && next < files.length) setIndex(next);
          }}
          style={{ flex: 1 }}
        >
          {files.map((file) => (
            <View
              key={file.id}
              style={{ width, height: pageHeight, alignItems: "center", justifyContent: "center" }}
            >
              {file.url ? (
                <RemoteImage
                  uri={api.url(file.url)}
                  label={file.name}
                  width={width}
                  height={pageHeight}
                  fit="contain"
                />
              ) : (
                <ImageIcon size={32} color="rgba(255,255,255,0.5)" />
              )}
            </View>
          ))}
        </ScrollView>
        <View
          style={{
            paddingBottom: bottom,
            paddingTop: 12,
            paddingHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          {files.length > 1 && Platform.OS === "web" && width >= 600 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Anterior"
              disabled={index === 0}
              onPress={() => go(index - 1)}
              style={[round, { opacity: index === 0 ? 0.35 : 1 }]}
            >
              <ChevronLeft size={20} color="#FFF" />
            </Pressable>
          )}
          {current && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onClose();
                open({ type: "file", file: current });
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                paddingHorizontal: 16,
                height: 40,
                borderRadius: 20,
                backgroundColor: pressed ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.16)",
              })}
            >
              <ExternalLink size={15} color="#FFF" />
              <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "600" }}>
                Detalhes e compartilhar
              </Text>
            </Pressable>
          )}
          {files.length > 1 && Platform.OS === "web" && width >= 600 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Próxima"
              disabled={index === files.length - 1}
              onPress={() => go(index + 1)}
              style={[round, { opacity: index === files.length - 1 ? 0.35 : 1 }]}
            >
              <ChevronRight size={20} color="#FFF" />
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}
