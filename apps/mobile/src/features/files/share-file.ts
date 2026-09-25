// Saving or sharing a server file. The web opens a freshly signed link in a new tab (Safari
// shows the picture or PDF with its own share button; other files download); the app downloads
// it with the session and opens the system share sheet.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { Artifact } from "../../../../../packages/domain/src";
import type { MuseApi } from "../../shared/api";
import { isIosBrowser, withDownload } from "../../shared/signed-url";

export type ShareableFile = Pick<Artifact, "id" | "name" | "mimeType" | "url">;

/**
 * The link to open now. The links the app keeps (a chat card, an open sheet, the workspace it
 * loaded a while ago) expire after a few minutes; asking the server first never opens a dead one.
 */
export async function freshFileUrl(api: MuseApi, file: ShareableFile) {
  const fresh = await api.file(file.id).catch(() => undefined);
  return api.url(fresh?.url || file.url || `/api/files/${file.id}/content`);
}

/**
 * Whether the web should download the file rather than show it. Pictures and PDFs are shown
 * (the browser can save them from there); on iOS every file is shown, since a forced download
 * in Safari or a home-screen app lands nowhere useful, while a shown file has a share sheet.
 */
export function wantsDownload(
  mode: "open" | "download",
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  maxTouchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
) {
  if (mode === "open" || isIosBrowser(userAgent, maxTouchPoints)) return false;
  return true;
}

/** Files already fetched for the iOS share sheet (a second tap shares at once). */
const ready = new Map<string, File>();

/**
 * iOS (Safari or the home-screen app): the system share sheet (Salvar em Arquivos, Abrir no
 * Pages, AirDrop…). Opening the file instead shows it inside the home-screen app with no way
 * back. The sheet needs the tap itself: if fetching took too long, the file is kept ready and
 * the next tap shares it immediately.
 */
async function shareOnIos(api: MuseApi, file: ShareableFile) {
  let shared = ready.get(file.id);
  if (!shared) {
    const response = await fetch(await freshFileUrl(api, file));
    if (!response.ok) throw new Error("Não consegui baixar o arquivo. Tente de novo em instantes.");
    const blob = await response.blob();
    shared = new File([blob], file.name, { type: file.mimeType || blob.type });
    ready.set(file.id, shared);
  }
  try {
    await navigator.share({ files: [shared], title: file.name });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return; // closed the sheet
    if (error instanceof Error && error.name === "NotAllowedError")
      throw new Error("Arquivo pronto: toque de novo para salvar ou compartilhar.");
    throw error;
  }
}

export async function shareFile(
  api: MuseApi,
  file: ShareableFile,
  mode: "open" | "download" = "open",
) {
  if (
    Platform.OS === "web" &&
    isIosBrowser(navigator.userAgent, navigator.maxTouchPoints) &&
    typeof navigator.canShare === "function"
  )
    return shareOnIos(api, file);
  if (Platform.OS === "web") {
    // Safari only opens a tab during the tap itself: open it now, point it at the file once the
    // fresh link is here. (A blank tab for a moment, never a blocked one.)
    const tab = window.open("", "_blank");
    try {
      const url = await freshFileUrl(api, file);
      const target = wantsDownload(mode) ? withDownload(url) : url;
      if (tab) tab.location.replace(target);
      else window.open(target, "_blank", "noopener");
    } catch (error) {
      tab?.close();
      throw error;
    }
    return;
  }
  const url = await freshFileUrl(api, file);
  const target = `${FileSystem.cacheDirectory}${file.name.replace(/[^\w.\- ]/g, "_")}`;
  const download = await FileSystem.downloadAsync(url, target, {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  if (download.status !== 200)
    throw new Error("Não consegui baixar o arquivo. Tente de novo em instantes.");
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Compartilhar não está disponível neste aparelho.");
  await Sharing.shareAsync(target, {
    mimeType: file.mimeType,
    ...(file.mimeType === "application/pdf" ? { UTI: "com.adobe.pdf" } : {}),
  });
}
