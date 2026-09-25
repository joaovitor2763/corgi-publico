import { Platform } from "react-native";
import type { Artifact } from "../../../../packages/domain/src";
import { resolveApiUrl } from "./signed-url";

/** Web served by the API itself (Mac mini + Tailscale): talk to the same origin. */
const sameOrigin =
  Platform.OS === "web" &&
  typeof location !== "undefined" &&
  location.port !== "8081" &&
  location.origin.startsWith("http")
    ? location.origin
    : undefined;

export const DEFAULT_API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  sameOrigin ||
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787")
).replace(/\/$/, "");

/**
 * The Corgi server in use. The native app lets the person change it on the sign-in screen
 * (this Mac today, the Mac mini or a VPS tomorrow) without a new build. A live binding:
 * importers always read the current value.
 */
export let API_URL = DEFAULT_API_URL;
export function setApiUrl(url: string) {
  API_URL = url.trim().replace(/\/+$/, "") || DEFAULT_API_URL;
}

export class MuseApi {
  /** `onExpired` runs on a 401 so the app can reopen the session with the saved key. */
  constructor(
    readonly token: string,
    private readonly onExpired?: () => void,
  ) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    if (response.status === 401) this.onExpired?.();
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`,
      );
    return payload;
  }
  /**
   * A snapshot that changes rarely, polled often: sends the version it has (?v=) and gets 204
   * (nothing new, no body to parse or re-render) or the new snapshot with its version.
   */
  async poll<T>(path: string, version?: string): Promise<{ version?: string; data?: T }> {
    const separator = path.includes("?") ? "&" : "?";
    const response = await fetch(
      `${API_URL}${path}${version ? `${separator}v=${encodeURIComponent(version)}` : ""}`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (response.status === 401) this.onExpired?.();
    if (response.status === 204) return { version };
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`,
      );
    return { version: response.headers.get("X-Version") ?? undefined, data: payload };
  }
  /** A server path or link as this app should load it (see `resolveApiUrl`). */
  url(path: string) {
    return resolveApiUrl(path, API_URL);
  }
  /** A file with links signed just now (the ones the app kept may have expired). */
  file(id: string) {
    return this.request<Artifact>(`/api/files/${encodeURIComponent(id)}`);
  }
}

export async function createSession(
  accessKey?: string,
): Promise<{ token: string; mode: "sample" | "live" }> {
  const response = await fetch(`${API_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  const payload = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(payload.error || "Não consegui abrir seu espaço."), {
      status: response.status,
    });
  return payload;
}
