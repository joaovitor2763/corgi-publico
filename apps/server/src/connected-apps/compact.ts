// App results carry a lot the model never needs (etags, rich-text blocks that repeat the text,
// link-preview images, sizes, internal flags). Dropping that before the size cap means a week of
// calendar or 50 Slack messages fit whole instead of being cut in the middle.

/** Keys that are pure noise in every app we connect. */
const NOISE = new Set([
  "etag",
  "kind",
  "iCalUID",
  "sequence",
  "reminders",
  "blocks",
  "team",
  "client_msg_id",
  "bot_profile",
  "icons",
  "fallback",
  "priority",
  "context_team_id",
  "is_org_shared",
  "score",
  "iid",
  "service_icon",
  "from_url",
  "original_url",
  "media_type",
  "historyId",
  "sizeEstimate",
]);
const NOISE_PREFIX = /^(?:image_|thumb_|video_)/;
const MAX_STRING = 3000;

/** E-mail bodies often come as full HTML: keep the words, drop the markup. */
export function htmlToText(value: string) {
  return (
    value
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      // Keep where links go ("Visualizar para assinar" is useless without its URL).
      .replace(
        /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_, href: string, label: string) => {
          const text = label
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          return /^(https?:|mailto:)/i.test(href) ? ` ${text || "link"} (${href}) ` : ` ${text} `;
        },
      )
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim()
  );
}
const HTML = /<(?:!doctype|html|body|div|table|p|br|span)[\s>/]/i;

/** Links that are only pictures (icons, logos, previews): not worth keeping. */
const ASSET =
  /\.(?:png|jpe?g|gif|webp|svg|ico|dtd)(?:[?#]|$)|\/(?:favicon|apple-touch-icon)|[?&]format=webp|^https?:\/\/www\.w3\.org\//i;
const LINK = /https?:\/\/[^\s"'<>)\]]+/g;

/**
 * Cuts a long text without losing where it points: every link in the cut part is kept in a list
 * at the end (a contract's "Visualizar para assinar", a Doc attached in an event description).
 */
export function cutKeepingLinks(text: string, max = MAX_STRING) {
  if (text.length <= max) return text;
  const kept = text.slice(0, max);
  const shown = new Set(kept.match(LINK) ?? []);
  const later = [...new Set(text.slice(max).match(LINK) ?? [])].filter(
    (url) => !shown.has(url) && !ASSET.test(url),
  );
  return `${kept}… (cortado)${later.length ? `\nLinks no resto do texto: ${later.slice(0, 40).join(" ")}` : ""}`;
}

/** A document read on its own (a Doc, a transcript) is kept whole up to the result cap. */
const MAX_SINGLE = 60_000;

/**
 * `inList`: inside a list of several items (e-mails, messages, events), where each long text is
 * cut; a text that stands alone (one document's body) is the answer and stays whole.
 */
export function compact(value: unknown, depth = 0, inList = false): unknown {
  if (typeof value === "string") {
    const text = value.length > 200 && HTML.test(value) ? htmlToText(value) : value;
    return cutKeepingLinks(text, inList ? MAX_STRING : MAX_SINGLE);
  }
  // Lists are never shortened here: a missing item is worse than a long result (the size cap
  // and the digest handle length, and say so).
  if (Array.isArray(value))
    return value
      .map((item) => compact(item, depth + 1, inList || value.length > 2))
      .filter((item) => !empty(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (NOISE.has(key) || NOISE_PREFIX.test(key)) continue;
      // Gmail's raw MIME payload repeats the body already given as messageText.
      if (key === "payload" && "messageText" in (value as object)) continue;
      // Slack-style flags ("is_archived": false, "no_reactions": true) say nothing useful.
      if ((key.startsWith("is_") && item === false) || key === "no_reactions") continue;
      const kept = compact(item, depth + 1, inList);
      if (!empty(kept)) out[key] = kept;
    }
    return out;
  }
  return value;
}

function empty(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0)
  );
}
