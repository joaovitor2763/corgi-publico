// Native builds get notifications another way (APNs, not built yet): the web helpers are no-ops.
import type { MuseApi } from "./api";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";
export async function pushState(): Promise<PushState> {
  return "unsupported";
}
export async function enablePush(_api: MuseApi): Promise<PushState> {
  return "unsupported";
}
export async function disablePush(_api: MuseApi) {}
export function startPush(_onOpen: (url: string) => void) {
  return () => {};
}
export function setBadge(_count: number) {}
