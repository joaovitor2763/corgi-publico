// Web Push for the home-screen web app (iOS 16.4+): register the service worker, ask once (on a
// tap), subscribe with the server's key, and open the card a notification points to.
import type { MuseApi } from "./api";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** iPhone/iPad: push only works in the app added to the Home Screen. */
function needsInstall() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function registration() {
  return (
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/" }))
  );
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (needsInstall()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const subscription = await (await registration()).pushManager.getSubscription().catch(() => null);
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64: string) {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

const deviceName = () =>
  /iPhone/.test(navigator.userAgent)
    ? "iPhone"
    : /iPad/.test(navigator.userAgent)
      ? "iPad"
      : /Android/.test(navigator.userAgent)
        ? "Android"
        : "Navegador";

/** Must run inside a tap: iOS only shows the permission prompt for a person's own action. */
export async function enablePush(api: MuseApi): Promise<PushState> {
  const state = await pushState();
  if (state === "needs-install" || state === "unsupported" || state === "denied") return state;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { publicKey } = await api.request<{ publicKey: string }>("/api/push");
  const worker = await registration();
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api.request("/api/push/subscribe", {
    subscription: subscription.toJSON(),
    device: deviceName(),
  });
  return "on";
}

export async function disablePush(api: MuseApi) {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return;
  await api.request("/api/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}

/** Opens what a notification points to: at launch (?open=…) and while the app is open. */
export function startPush(onOpen: (url: string) => void) {
  if (!supported()) return () => {};
  void registration().catch(() => {});
  const open = new URL(window.location.href).searchParams.get("open");
  if (open) {
    onOpen(`/?open=${encodeURIComponent(open)}`);
    window.history.replaceState(null, "", "/");
  }
  const listener = (event: MessageEvent) => {
    if (event.data?.type === "corgi-open" && typeof event.data.url === "string")
      onOpen(event.data.url);
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

/** The number on the app icon: what waits on the person. */
export function setBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) void nav.setAppBadge?.(count).catch(() => {});
  else void nav.clearAppBadge?.().catch(() => {});
}
