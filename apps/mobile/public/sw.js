// Corgi's service worker: shows pushes (approvals, questions, finished tasks) and opens the
// right card when one is tapped. Nothing is cached here: the app always loads fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // The icon shows how many things wait on the person.
      if (typeof data.badge === "number" && self.navigator.setAppBadge) {
        if (data.badge > 0) await self.navigator.setAppBadge(data.badge).catch(() => {});
        else await self.navigator.clearAppBadge?.().catch(() => {});
      }
      await self.registration.showNotification(data.title || "Corgi", {
        body: data.body || "",
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: data.url || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({ type: "corgi-open", url });
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
