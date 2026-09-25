import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { Artifact } from "../../../../packages/domain/src";
import { API_URL, type MuseApi } from "./api";

/** What the server accepts (apps/server/src/platform/file-formats.ts). */
export const UPLOAD_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/csv",
  "text/tab-separated-values",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

type Picked = { uri: string; name: string; mimeType?: string; file?: File };

/** Opens Photos (images) or Files (any supported type); resolves to what was chosen. */
async function pick(source: "photo" | "file"): Promise<Picked[]> {
  // On web the system picker already offers Photos, Camera and Files for an image type.
  if (source === "photo" && Platform.OS !== "web") {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
      // HEIC isn't readable by the model: iOS converts the photo to JPEG for us.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return [];
    return result.assets.map((a, i) => ({
      uri: a.uri,
      name: a.fileName ?? `foto-${Date.now()}-${i + 1}.jpg`,
      mimeType: a.mimeType ?? "image/jpeg",
    }));
  }
  const result = await DocumentPicker.getDocumentAsync({
    type: source === "photo" ? ["image/*"] : UPLOAD_TYPES,
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType,
    file: a.file,
  }));
}

async function send(api: MuseApi, file: Picked): Promise<Artifact> {
  if (Platform.OS === "web") {
    if (!file.file) throw new Error("Não consegui ler o arquivo escolhido. Tente de novo.");
    const form = new FormData();
    form.append("file", file.file, file.name);
    return api.request<Artifact>("/api/files", form);
  }
  const result = await FileSystem.uploadAsync(`${API_URL}/api/files`, file.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType,
    parameters: {},
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const payload = JSON.parse(result.body);
  if (result.status < 200 || result.status >= 300)
    throw new Error(payload.error || `Não consegui enviar ${file.name}.`);
  return payload;
}

/** A chosen file before it reaches the server: `uri` previews it locally. */
export type PickedFile = { uri: string; name: string; mimeType?: string };

/**
 * Pick and upload. Files upload one by one; a failure names the file and keeps the ones that
 * already went up. `onStart` lists what is on the way (placeholders with a local preview) and
 * `onDone` reports each one as it lands (`file` is missing when it failed).
 */
export async function pickAndUpload(
  api: MuseApi,
  source: "photo" | "file",
  events: {
    onStart?: (chosen: PickedFile[]) => void;
    onDone?: (index: number, file?: Artifact) => void;
  } = {},
) {
  const chosen = await pick(source);
  events.onStart?.(chosen.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })));
  const uploaded: Artifact[] = [];
  const failures: string[] = [];
  for (const [index, file] of chosen.entries()) {
    try {
      const artifact = await send(api, file);
      uploaded.push(artifact);
      events.onDone?.(index, artifact);
    } catch (error) {
      failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      events.onDone?.(index);
    }
  }
  return { uploaded, failures };
}
