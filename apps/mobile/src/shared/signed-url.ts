// Signed links the server hands out for files, thumbnails and previews
// (`/api/…?owner=…&expires=…&signature=…`). They are the only way a plain <img>, a new tab or a
// share sheet can read a private file (none of them can send the session's bearer), and they
// expire after a few minutes: these helpers keep them usable wherever the app kept them.

/**
 * The link as the app should load it: the server signs links with its own public URL, but the
 * app may reach the same server another way (localhost, the LAN, the Tailscale name). A signed
 * `/api/…` link is rehomed to the API in use; a relative path is completed; anything else (a
 * page on the web, a data URL) is left alone.
 */
export function resolveApiUrl(url: string, apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) return url.startsWith("/") ? `${base}${url}` : url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.pathname.startsWith("/api/") || !parsed.searchParams.has("signature")) return url;
  return `${base}${parsed.pathname}${parsed.search}`;
}

/** When a signed link stops working (ms since the epoch), or undefined when it is not signed. */
export function signedUrlExpiry(url: string): number | undefined {
  const match = /[?&]expires=(\d{1,16})(?:&|$)/.exec(url);
  return match && /[?&]signature=/.test(url) ? Number(match[1]) : undefined;
}

/**
 * Whether a signed link can still be opened now, with a margin for the trip. An unsigned link
 * is never fresh: the server would ask for a session it cannot get from an <img> or a new tab.
 */
export function isFreshSignedUrl(url: string, now = Date.now(), marginMs = 30_000): boolean {
  const expiry = signedUrlExpiry(url);
  return expiry !== undefined && expiry - marginMs > now;
}

/** A link that makes the server send the file as a download rather than show it. */
export function withDownload(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

/**
 * iOS browsers (Safari, and every other browser there, which is Safari underneath) do not
 * download a link like desktop browsers do: a file is best opened, and shared from there.
 */
export function isIosBrowser(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
