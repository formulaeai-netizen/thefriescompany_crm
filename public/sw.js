const CACHE_VERSION = "fryguys-crm-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const DEFAULT_NOTIFICATION_TARGET = "/";
const STATIC_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/logo.png",
  "/pwa-192.png",
  "/pwa-512.png",
  "/pwa-maskable-192.png",
  "/pwa-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function safeNotificationTarget(value) {
  const target =
    typeof value === "string" && value.trim() ? value.trim() : DEFAULT_NOTIFICATION_TARGET;
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) {
    return DEFAULT_NOTIFICATION_TARGET;
  }
  try {
    const parsed = new URL(target, self.location.origin);
    if (parsed.origin !== self.location.origin) return DEFAULT_NOTIFICATION_TARGET;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_NOTIFICATION_TARGET;
  }
}

function parsePushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return {};
  }
}

function isFinancialOrApiRequest(url) {
  return (
    url.hostname.includes("supabase.co") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_server") ||
    url.pathname.startsWith("/~") ||
    url.pathname.includes("auth")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (isFinancialOrApiRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(OFFLINE_URL).then((response) => response || Response.error())),
    );
    return;
  }

  if (url.origin === self.location.origin && STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  if (
    url.origin === self.location.origin &&
    /\.(?:js|css|woff2|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = typeof payload.title === "string" ? payload.title : "Fry Guys CRM";
  const targetUrl = safeNotificationTarget(payload.target_url);
  const options = {
    body: typeof payload.body === "string" ? payload.body : "New CRM notification",
    icon: typeof payload.icon === "string" ? payload.icon : "/pwa-192.png",
    badge: typeof payload.badge === "string" ? payload.badge : "/pwa-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : payload.notification_id,
    renotify: payload.severity === "Critical",
    requireInteraction: payload.severity === "Critical",
    data: {
      notification_id: payload.notification_id,
      category: payload.category,
      severity: payload.severity,
      target_url: targetUrl,
      source_type: payload.source_type,
      source_id: payload.source_id,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = safeNotificationTarget(event.notification.data?.target_url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== self.location.origin) continue;
        if ("navigate" in client && clientUrl.pathname + clientUrl.search !== targetUrl) {
          await client.navigate(targetUrl);
        }
        return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("notificationclose", () => {
  // Canonical read state stays in the app; no network write is made on close.
});
