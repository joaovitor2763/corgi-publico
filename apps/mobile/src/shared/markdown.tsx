import { memo, type ReactNode } from "react";
import { Linking, Text, type TextStyle, View } from "react-native";
import { parseInlineMarkdown, parseMarkdown } from "./markdown-parser";
import { colors, s } from "./ui";

/** A short, tappable link ("ingresso.com ↗") in place of a raw URL. */
function LinkSpan({ label, url }: { label: string; url: string }) {
  return (
    <Text
      accessibilityRole="link"
      onPress={() => void Linking.openURL(url)}
      style={{ color: colors.blueDark, fontWeight: "600" }}
    >
      {label} ↗
    </Text>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((span, index) => {
        if (span.style === "link" && span.url)
          // biome-ignore lint/suspicious/noArrayIndexKey: spans only ever grow at the end
          return <LinkSpan key={index} label={span.text} url={span.url} />;
        const style: TextStyle =
          span.style === "bold"
            ? { fontWeight: "700" }
            : span.style === "italic"
              ? { fontStyle: "italic" }
              : span.style === "code"
                ? {
                    fontFamily: "monospace",
                    fontSize: 14,
                    backgroundColor: "#E2E3E5",
                  }
                : {};
        return (
          // Position keys keep streamed text in the same node; content keys remount on every delta.
          // biome-ignore lint/suspicious/noArrayIndexKey: spans only ever grow at the end
          <Text key={index} style={style}>
            {span.text}
          </Text>
        );
      })}
    </>
  );
}

/**
 * `compact` is for text inside cards: smaller type and tighter spacing for a phone. Memoized on
 * the text: while a reply streams, earlier messages are not parsed again on every token.
 */
export const MarkdownText = memo(function MarkdownText({
  children,
  compact = false,
}: {
  children: string;
  compact?: boolean;
}): ReactNode {
  const size = compact ? 13.5 : 16;
  const line = compact ? 19 : 24;
  return (
    <View style={{ gap: compact ? 3 : 5 }}>
      {parseMarkdown(children).map((block, index) => {
        const blockKey = `${index}:${block.type}`;
        if (block.type === "space")
          return <View key={blockKey} style={{ height: compact ? 3 : 5 }} />;
        if (block.type === "bullet" || block.type === "ordered")
          return (
            <View key={blockKey} style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}>
              <Text
                style={[s.text, { fontSize: size, lineHeight: line, minWidth: compact ? 12 : 16 }]}
              >
                {block.type === "bullet" ? "•" : block.marker}
              </Text>
              <Text selectable style={[s.text, { flex: 1, fontSize: size, lineHeight: line }]}>
                <InlineMarkdown text={block.text} />
              </Text>
            </View>
          );
        return (
          <Text
            key={blockKey}
            selectable
            style={[
              s.text,
              {
                fontSize: block.type === "heading" ? size + 2 : size,
                lineHeight: block.type === "heading" ? line + 1 : line,
                fontWeight: block.type === "heading" ? "700" : "400",
                color: colors.text,
              },
            ]}
          >
            <InlineMarkdown text={block.text} />
          </Text>
        );
      })}
    </View>
  );
});
