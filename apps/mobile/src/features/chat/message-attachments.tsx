// Attachments in the conversation: the composer's tiles before sending and the photos/documents
// on the person's sent message.
import { X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { Artifact } from "../../../../../packages/domain/src";
import { fileKind, middleEllipsis } from "../../shared/file-kind";
import { previewOf } from "../../shared/file-preview";
import { kit } from "../../shared/kit";
import RemoteImage from "../../shared/RemoteImage";
import { colors } from "../../shared/ui";
import type { PickedFile } from "../../shared/upload";
import { useWorkspace } from "../../shared/workspace";
import { FileCard } from "../files/file-card";
import {
  DocumentCard,
  FileBadge,
  FileThumb,
  ImageViewer,
  isImage,
  MessageImages,
} from "../files/file-views";

const TILE = 60;

/** The dark × on a tile's corner. */
function RemoveBadge({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remover anexo: ${name}`}
      hitSlop={8}
      onPress={onPress}
      style={{
        position: "absolute",
        top: -7,
        right: -7,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.text,
        borderWidth: 2,
        borderColor: "#FFF",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <X size={11} strokeWidth={3} color="#FFF" />
    </Pressable>
  );
}

/** A file still uploading: its local preview (photos) or badge, dimmed, with a spinner. */
function UploadingTile({ file }: { file: PickedFile }) {
  const photo = fileKind(file.name, file.mimeType) === "image";
  const spinner = (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.55)",
      }}
    >
      <ActivityIndicator size="small" color={colors.blueDark} />
    </View>
  );
  if (photo)
    return (
      <View
        accessibilityLabel={`Enviando ${file.name}`}
        style={{ width: TILE, height: TILE, borderRadius: 14, overflow: "hidden" }}
      >
        {file.uri ? (
          <RemoteImage uri={file.uri} width={TILE} height={TILE} />
        ) : (
          <View style={{ width: TILE, height: TILE, backgroundColor: "#EEF0F2" }} />
        )}
        {spinner}
      </View>
    );
  return (
    <View
      accessibilityLabel={`Enviando ${file.name}`}
      style={{
        height: TILE,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 9,
        paddingRight: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: kit.line,
        backgroundColor: "#FFF",
      }}
    >
      <View style={{ opacity: 0.4 }}>
        <FileBadge name={file.name} mimeType={file.mimeType} width={32} height={38} />
      </View>
      <View style={{ gap: 2, maxWidth: 130 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
          {middleEllipsis(file.name, 18)}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <ActivityIndicator
            size="small"
            color={colors.blueDark}
            style={{ transform: [{ scale: 0.7 }] }}
          />
          <Text style={{ fontSize: 12, color: kit.muted }}>Enviando…</Text>
        </View>
      </View>
    </View>
  );
}

/** The row above the composer's text field: thumbnails and document cards, each removable. */
export function ComposerAttachments({
  attachments,
  uploading,
  onRemove,
}: {
  attachments: Artifact[];
  uploading: (PickedFile & { key: string })[];
  onRemove: (id: string) => void;
}) {
  const { open } = useWorkspace();
  const [viewing, setViewing] = useState<number>();
  const photos = attachments.filter(isImage);
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0 }}
        // Room for the × badges, which sit outside each tile.
        contentContainerStyle={{ gap: 10, paddingTop: 10, paddingBottom: 6, paddingHorizontal: 8 }}
      >
        {attachments.map((f) => (
          <View key={f.id}>
            {isImage(f) ? (
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={`Ver ${f.name}`}
                onPress={() => setViewing(photos.indexOf(f))}
              >
                <FileThumb file={f} size={TILE} />
              </Pressable>
            ) : (
              <DocumentCard
                compact
                name={f.name}
                file={f}
                onPress={() => open({ type: "file", file: f })}
                style={{ height: TILE, maxWidth: 210 }}
              />
            )}
            <RemoveBadge name={f.name} onPress={() => onRemove(f.id)} />
          </View>
        ))}
        {uploading.map((file) => (
          <UploadingTile key={file.key} file={file} />
        ))}
      </ScrollView>
      {viewing !== undefined && (
        <ImageViewer files={photos} index={viewing} onClose={() => setViewing(undefined)} />
      )}
    </>
  );
}

/** A sent message's files: photos as a right-aligned grid, documents as cards below it. */
export function MessageAttachments({ files }: { files: { name: string; id: string }[] }) {
  const { workspace, open } = useWorkspace();
  const [viewing, setViewing] = useState<number>();
  const resolved = files.map((file) => ({
    ...file,
    file: workspace.files.find((f) => f.id === file.id),
  }));
  const photos = resolved.filter((f) => isImage(f.file ?? { name: f.name }));
  const docs = resolved.filter((f) => !photos.includes(f));
  const viewable = photos.flatMap((p) => (p.file ? [p.file] : []));
  return (
    <View style={{ gap: 6, alignItems: "flex-end", maxWidth: "85%" }}>
      {photos.length > 0 && (
        <MessageImages
          files={photos}
          onOpen={(i) => {
            const file = photos[i].file;
            if (file) setViewing(viewable.indexOf(file));
          }}
        />
      )}
      {docs.map((doc) =>
        // A document with something to show (a PDF's first page, a sheet's first rows) gets
        // the same card as the files the agent sends, smaller; the rest stay compact.
        doc.file && previewOf(doc.file).kind !== "none" ? (
          <View key={doc.id} style={{ width: 250, maxWidth: "100%" }}>
            <FileCard file={doc.file} small />
          </View>
        ) : (
          <DocumentCard
            key={doc.id}
            name={doc.name}
            file={doc.file}
            onPress={
              doc.file ? () => doc.file && open({ type: "file", file: doc.file }) : undefined
            }
            style={{ maxWidth: 280 }}
          />
        ),
      )}
      {viewing !== undefined && (
        <ImageViewer files={viewable} index={viewing} onClose={() => setViewing(undefined)} />
      )}
    </View>
  );
}
