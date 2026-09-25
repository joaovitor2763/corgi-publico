export type MarkdownBlock =
  | { type: "paragraph" | "heading"; text: string }
  | { type: "bullet"; text: string }
  | { type: "ordered"; marker: string; text: string }
  | { type: "space" };

export type MarkdownSpan = {
  text: string;
  style?: "bold" | "italic" | "code" | "link";
  url?: string;
};

/** "https://www.ingresso.com/filme/verity" -> "ingresso.com": raw URLs never fill a reply. */
export function linkLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function parseMarkdown(value: string): MarkdownBlock[] {
  return value.split(/\r?\n/).map((line) => {
    if (!line.trim()) return { type: "space" };
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return { type: "heading", text: heading[1] };
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) return { type: "bullet", text: bullet[1] };
    const ordered = line.match(/^\s*(\d+\.)\s+(.+)$/);
    if (ordered) return { type: "ordered", marker: ordered[1], text: ordered[2] };
    return { type: "paragraph", text: line };
  });
}

export function parseInlineMarkdown(value: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  const pattern =
    /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)<>]+[^\s)<>.,;:!?"']|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) spans.push({ text: value.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith("[")) {
      const [, label = "", url = ""] = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      spans.push({ text: label, style: "link", url });
    } else if (token.startsWith("http"))
      spans.push({ text: linkLabel(token), style: "link", url: token });
    // Models often wrap code in bold ("**Lovable — `Leo virou admin`**"): keep it bold, drop the ticks.
    else if (token.startsWith("**"))
      spans.push({ text: token.slice(2, -2).replace(/`/g, ""), style: "bold" });
    else if (token.startsWith("`")) spans.push({ text: token.slice(1, -1), style: "code" });
    else spans.push({ text: token.slice(1, -1), style: "italic" });
    cursor = index + token.length;
  }
  if (cursor < value.length) {
    // A streamed reply can end mid-emphasis ("**Tare"); show it bold now instead of
    // flashing literal asterisks until the closing marker arrives.
    const rest = value.slice(cursor);
    const open = rest.indexOf("**");
    if (open >= 0 && !rest.slice(open + 2).includes("*") && rest.slice(open + 2).trim()) {
      if (open > 0) spans.push({ text: rest.slice(0, open) });
      spans.push({ text: rest.slice(open + 2), style: "bold" });
    } else spans.push({ text: rest });
  }
  return spans.length ? spans : [{ text: value }];
}

/** One-line previews (task cards, notifications): the words without markdown symbols. */
export function plainText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*(#{1,6}|[-*]|\d+\.)\s+/gm, "")
    .replace(/\*\*|`|(?<!\w)\*(?!\s)|(?<!\s)\*(?!\w)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
