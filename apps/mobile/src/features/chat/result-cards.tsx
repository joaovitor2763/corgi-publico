import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bell,
  ChevronRight,
  ExternalLink,
  type LucideIcon,
  MessageSquare,
  MoreHorizontal,
  ShoppingBag,
} from "lucide-react-native";
import { type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import {
  Image,
  type LayoutChangeEvent,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { z } from "zod";
import { colors, Sheet, s } from "../../shared/ui";
import {
  dayHeader,
  inTimeOrder,
  liftCommonBadges,
  nowMarker,
  overlapping,
  timeRange,
} from "./agenda";
import { ChatSendContext } from "./chat-context";
import {
  CELL_PAD,
  type ColumnKind,
  layoutTable,
  nextSort,
  type SortDirection,
  sortRows,
  type TableLayout,
} from "./table-sort";

const https = z
  .string()
  .max(4096)
  .refine((value) => /^https:\/\//.test(value));

/** What the agent (or the browser) found, as data the app renders; never raw HTML. */
export const resultItemSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  detail: z.string().max(300).optional(),
  price: z.string().max(40).optional(),
  was: z.string().max(40).optional(),
  image: https.optional(),
  url: https.optional(),
  badges: z.array(z.string().max(40)).max(4).optional(),
  times: z.array(z.string().max(20)).max(16).optional(),
  /** Table rows: one value per column, in order. */
  cells: z.array(z.string().max(120)).max(6).optional(),
});
export type ResultItem = z.infer<typeof resultItemSchema>;

export const resultsSchema = z.object({
  title: z.string().max(120).optional(),
  source: z.string().max(120).optional(),
  layout: z
    .enum(["cards", "list", "times", "detail", "timeline", "table", "stats"])
    .default("cards"),
  /** Table headers. */
  columns: z.array(z.string().max(40)).max(6).optional(),
  /** The day a one-day timeline is on (YYYY-MM-DD): draws the day header and, today, "now". */
  date: z.string().max(10).optional(),
  items: z.array(resultItemSchema).max(20),
});
type Layout = z.infer<typeof resultsSchema>["layout"];

// The element language: a grey shell, the content on white, a "Ver tudo" row only when needed.
const SHELL = "#EEEEF0";
const HAIRLINE = "#F0F1F3";
const AMBER = "#E8A93B";
const AMBER_TEXT = "#8A5A00";
const GAIN = "#2E7A55";
const LOSS = "#B4493F";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function host(url?: string) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const open = (url?: string) => url && void Linking.openURL(url);

/** Stable keys for a tool result's items, which never reorder once shown. */
function keyed<T extends { url?: string; title: string }>(items: T[]) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = item.url ?? item.title;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { item, key: `${base}#${count}` };
  });
}

/** Green for a gain, red for a loss, when a value carries a sign: "+11%", "(-16%)", "↓ 3". */
function signTone(value: string) {
  if (/(^|\()\s*[+↑▲]\s*\d/.test(value)) return GAIN;
  if (/(^|\()\s*[-−↓▼]\s*\d/.test(value)) return LOSS;
  return undefined;
}

function Pill({ children, tone = "grey" }: { children: string; tone?: "grey" | "blue" | "amber" }) {
  const style =
    tone === "blue"
      ? { color: colors.blueDark, backgroundColor: colors.sky }
      : tone === "amber"
        ? { color: AMBER_TEXT, backgroundColor: "#FFF3DE" }
        : { color: colors.muted, backgroundColor: "#F1F3F4" };
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: "600",
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 7,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

/** A soft amber heads-up row at the top of an element ("Chuva prevista em ~30 min"). */
export function HeadsUp({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <View
      accessibilityRole="text"
      style={[
        s.row,
        {
          gap: 9,
          backgroundColor: "#FFF5E2",
          borderRadius: 14,
          paddingHorizontal: 11,
          paddingVertical: 9,
        },
      ]}
    >
      <Icon size={16} color={AMBER} strokeWidth={2.2} />
      <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 18, color: AMBER_TEXT }}>{children}</Text>
    </View>
  );
}

/** Measures a container's width once, for layouts that size columns from it. */
function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  return [width, onLayout] as const;
}

/**
 * Every element sits in the same shell: what it is on top (the title the agent gave it, how
 * much, from where), the content on white with a height limit (longer content fades out at the
 * bottom), and a "Ver tudo" row only when there is more than the preview shows or the full
 * element does more (a table sorts and opens rows).
 */
export function Element({
  title,
  meta,
  more,
  hint,
  maxHeight,
  plain,
  children,
  sheet,
  sheetPlain,
}: {
  title?: string;
  /** "6 linhas · Notion". */
  meta?: string;
  /** The full element is worth opening even when the preview shows everything. */
  more?: boolean;
  /** Next to "Ver tudo": what the full element adds ("+2 colunas"). */
  hint?: string;
  /** Preview height limit; content beyond it fades out. */
  maxHeight?: number;
  /** The preview has no white card of its own (a carousel, tiles). */
  plain?: boolean;
  children: ReactNode;
  /** The full element, mounted only when opened; without it the preview is the whole element. */
  sheet?: () => ReactNode;
  /** The full element scrolls itself (a table with a pinned column). */
  sheetPlain?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [height, setHeight] = useState(0);
  const truncated = !!maxHeight && height > maxHeight;
  const fade = plain ? SHELL : "#FFFFFF";
  const heading = title ?? meta ?? "Ver tudo";
  return (
    <View style={{ backgroundColor: SHELL, borderRadius: 24, padding: 8, gap: 6 }}>
      {!!(title || meta) && (
        <View style={{ paddingHorizontal: 6, paddingTop: 3, gap: 1 }}>
          {!!title && (
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
              {title}
            </Text>
          )}
          {!!meta && (
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted }}>
              {meta}
            </Text>
          )}
        </View>
      )}
      <View
        style={{
          borderRadius: 18,
          overflow: "hidden",
          maxHeight,
          backgroundColor: plain ? undefined : "#FFF",
        }}
      >
        <View
          onLayout={(event: LayoutChangeEvent) => {
            const next = Math.round(event.nativeEvent.layout.height);
            if (next !== height) setHeight(next);
          }}
        >
          {children}
        </View>
        {truncated && (
          <LinearGradient
            pointerEvents="none"
            colors={[`${fade}00`, fade]}
            style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 76 }}
          />
        )}
      </View>
      {(truncated || more) && !!sheet && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ver tudo: ${heading}`}
          onPress={() => setOpened(true)}
          style={({ pressed }) => [
            s.row,
            { gap: 8, paddingHorizontal: 6, paddingVertical: 4, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.blueDark }}>Ver tudo</Text>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: colors.muted }}>
            {hint ?? ""}
          </Text>
          <ChevronRight size={17} color={colors.blueDark} />
        </Pressable>
      )}
      {opened && !!sheet && (
        <Sheet
          title={heading}
          subtitle={title ? meta : undefined}
          onClose={() => setOpened(false)}
          plain={sheetPlain}
        >
          {sheet()}
        </Sheet>
      )}
    </View>
  );
}

function Price({ item, size = 16 }: { item: ResultItem; size?: number }) {
  if (!item.price) return null;
  return (
    <View style={[s.row, { gap: 6, alignItems: "baseline", flexWrap: "wrap" }]}>
      <Text style={{ fontSize: size, fontWeight: "700", color: colors.text }}>{item.price}</Text>
      {!!item.was && (
        <Text style={{ fontSize: 12, color: colors.muted, textDecorationLine: "line-through" }}>
          {item.was}
        </Text>
      )}
    </View>
  );
}

const detailsPrompt = (item: ResultItem) =>
  `Me mostra os detalhes de "${item.title}"${item.url ? `\n${item.url}` : ""}`;
const alertPrompt = (item: ResultItem) =>
  `Cria um alerta pra quando "${item.title}" ficar mais barato${item.price ? ` que ${item.price}` : ""}${item.url ? `\n${item.url}` : ""}`;

/**
 * One listing. A tap brings its details into the conversation; holding it (or the ⋯
 * button, for a mouse) offers opening the site or a price alert instead.
 */
function ItemCard({ item, fill }: { item: ResultItem; fill?: boolean }) {
  const send = useContext(ChatSendContext);
  const [menu, setMenu] = useState(false);
  const choose = (action: () => void) => {
    setMenu(false);
    action();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.title, item.price].filter(Boolean).join(", ")}
      accessibilityHint={
        send ? "Mostra os detalhes na conversa. Toque e segure para mais opções." : undefined
      }
      onPress={() => (menu ? setMenu(false) : send ? send(detailsPrompt(item)) : open(item.url))}
      onLongPress={() => setMenu(true)}
      delayLongPress={350}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        width: fill ? undefined : 172,
        flexBasis: fill ? "47%" : undefined,
        flexGrow: fill ? 1 : 0,
        borderRadius: 18,
        backgroundColor: "#FFF",
        overflow: "hidden",
        transform: [{ translateY: hovered ? -2 : 0 }, { scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View
        style={{
          height: item.image ? 148 : 96,
          backgroundColor: "#F6F7F8",
          padding: 10,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            accessibilityIgnoresInvertColors
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
          />
        ) : (
          <ShoppingBag size={28} color="#C9CDD1" strokeWidth={1.6} />
        )}
        {!!item.badges?.[0] && (
          <View style={{ position: "absolute", top: 8, left: 8 }}>
            <Pill tone="blue">{item.badges[0]}</Pill>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mais opções para ${item.title}`}
          hitSlop={8}
          onPress={() => setMenu(!menu)}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: "rgba(255,255,255,0.92)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MoreHorizontal size={16} color={colors.text} />
        </Pressable>
      </View>
      <View style={{ padding: 12, gap: 5, flex: 1 }}>
        <Text numberOfLines={2} style={{ fontSize: 13.5, lineHeight: 18, color: colors.text }}>
          {item.title}
        </Text>
        <Price item={item} />
        {!!(item.subtitle || item.detail) && (
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted }}>
            {item.subtitle || item.detail}
          </Text>
        )}
      </View>
      {menu && (
        <View
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            top: 40,
            backgroundColor: "#FFF",
            borderRadius: 14,
            paddingVertical: 4,
            boxShadow: "0 8px 24px rgba(17, 25, 28, 0.16)",
          }}
        >
          {[
            send && {
              label: "Ver detalhes aqui",
              icon: MessageSquare,
              run: () => send(detailsPrompt(item)),
            },
            item.url && { label: "Abrir no site", icon: ExternalLink, run: () => open(item.url) },
            send &&
              item.url && {
                label: "Criar alerta de preço",
                icon: Bell,
                run: () => send(alertPrompt(item)),
              },
          ]
            .filter(
              (option): option is { label: string; icon: typeof Bell; run: () => void } => !!option,
            )
            .map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="menuitem"
                onPress={() => choose(option.run)}
                style={({ pressed }) => [
                  s.row,
                  {
                    gap: 9,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <option.icon size={15} color={colors.text} />
                <Text style={{ fontSize: 13, color: colors.text }}>{option.label}</Text>
              </Pressable>
            ))}
        </View>
      )}
    </Pressable>
  );
}

/** Horizontal cards with images: products, places, tickets. */
export function ResultCarousel({ items }: { items: ResultItem[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 8 }}
    >
      {keyed(items).map(({ item, key }) => (
        <ItemCard key={key} item={item} />
      ))}
    </ScrollView>
  );
}

/** Every card at once, two per row: the full element behind a carousel. */
function CardGrid({ items }: { items: ResultItem[] }) {
  return (
    <View style={[s.row, { flexWrap: "wrap", gap: 10, alignItems: "stretch" }]}>
      {keyed(items).map(({ item, key }) => (
        <ItemCard key={key} item={item} fill />
      ))}
    </View>
  );
}

/** One item in depth: what a tap on a listing brings into the conversation. */
function ResultDetail({ item }: { item: ResultItem }) {
  const send = useContext(ChatSendContext);
  return (
    <View style={{ backgroundColor: "#FFF", borderRadius: 18, overflow: "hidden" }}>
      {item.image ? (
        <View style={{ height: 220, backgroundColor: "#F6F7F8", padding: 14 }}>
          <Image
            source={{ uri: item.image }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
          />
        </View>
      ) : null}
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", lineHeight: 24, color: colors.text }}>
          {item.title}
        </Text>
        <Price item={item} size={20} />
        {!!item.subtitle && <Text style={[s.muted, { fontSize: 13.5 }]}>{item.subtitle}</Text>}
        {!!item.badges?.length && (
          <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
            {item.badges.map((badge) => (
              <Pill key={badge} tone="blue">
                {badge}
              </Pill>
            ))}
          </View>
        )}
        {!!item.detail && (
          <Text style={{ fontSize: 14.5, lineHeight: 22, color: "#3C4448" }}>{item.detail}</Text>
        )}
        {!!item.url && (
          <View style={[s.row, { gap: 8, marginTop: 4, flexWrap: "wrap" }]}>
            <Pressable
              accessibilityRole="link"
              onPress={() => open(item.url)}
              style={({ pressed }) => [
                s.row,
                {
                  gap: 6,
                  backgroundColor: colors.blue,
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <ExternalLink size={15} color={colors.text} />
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>
                Abrir no site
              </Text>
            </Pressable>
            {send ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => send(alertPrompt(item))}
                style={({ pressed }) => [
                  s.row,
                  {
                    gap: 6,
                    backgroundColor: "#F1F3F4",
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Bell size={15} color={colors.text} />
                <Text style={{ fontSize: 14, color: colors.text }}>Alerta de preço</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

/** Rows: calendar events, messages, options without images. */
function ResultList({ items }: { items: ResultItem[] }) {
  return (
    <View style={{ backgroundColor: "#FFF", borderRadius: 18, paddingHorizontal: 14 }}>
      {keyed(items).map(({ item, key }, index) => (
        <Pressable
          key={key}
          disabled={!item.url}
          onPress={() => open(item.url)}
          style={[
            s.row,
            {
              gap: 12,
              paddingVertical: 12,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: HAIRLINE,
            },
          ]}
        >
          {item.image ? (
            <Image
              source={{ uri: item.image }}
              style={{ width: 42, height: 42, borderRadius: 11, backgroundColor: "#F6F7F8" }}
            />
          ) : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={2} style={[s.text, { fontSize: 15, fontWeight: "500" }]}>
              {item.title}
            </Text>
            {!!item.subtitle && (
              <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.muted }}>
                {item.subtitle}
              </Text>
            )}
            {!!item.detail && (
              <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 17, color: colors.muted }}>
                {item.detail}
              </Text>
            )}
            {!!item.badges?.length && (
              <View style={[s.row, { gap: 5, flexWrap: "wrap", marginTop: 3 }]}>
                {item.badges.map((badge) => (
                  <Pill key={badge}>{badge}</Pill>
                ))}
              </View>
            )}
          </View>
          {item.price ? <Price item={item} size={15} /> : null}
          {item.url ? <ChevronRight size={16} color="#A4A7AA" /> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Showtimes and other time slots, grouped per venue. */
function ResultTimes({ items }: { items: ResultItem[] }) {
  return (
    <View style={{ backgroundColor: "#FFF", borderRadius: 18, paddingHorizontal: 14 }}>
      {keyed(items).map(({ item, key }, index) => (
        <View
          key={key}
          style={{
            paddingVertical: 13,
            gap: 9,
            borderTopWidth: index ? 1 : 0,
            borderTopColor: HAIRLINE,
          }}
        >
          <View style={[s.row, { gap: 8 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.text, { fontSize: 15, fontWeight: "600", lineHeight: 20 }]}>
                {item.title}
              </Text>
              {!!(item.subtitle || item.detail) && (
                <Text numberOfLines={2} style={{ fontSize: 12.5, color: colors.muted }}>
                  {[item.subtitle, item.detail].filter(Boolean).join(" · ")}
                </Text>
              )}
            </View>
            {item.url ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Abrir ${item.title}`}
                hitSlop={8}
                onPress={() => open(item.url)}
              >
                <ExternalLink size={16} color={colors.blueDark} />
              </Pressable>
            ) : null}
          </View>
          {!!item.times?.length && (
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              {item.times.map((time) => (
                <View
                  key={time}
                  style={{
                    backgroundColor: colors.sky,
                    borderRadius: 10,
                    paddingHorizontal: 11,
                    paddingVertical: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13.5,
                      fontWeight: "600",
                      color: colors.blueDark,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {time}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {!!item.badges?.length && (
            <View style={[s.row, { gap: 5, flexWrap: "wrap" }]}>
              {item.badges.map((badge) => (
                <Pill key={badge}>{badge}</Pill>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** "24 · Quinta-feira · 24 de setembro": the day a one-day timeline is on, big and calm. */
function DayHeader({ date }: { date?: string }) {
  const day = dayHeader(date);
  if (!day) return null;
  const weekday = day.weekday.charAt(0).toUpperCase() + day.weekday.slice(1);
  return (
    <View
      style={[
        s.row,
        {
          alignItems: "flex-end",
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: "#E9EBEE",
        },
      ]}
    >
      <Text
        style={{
          fontSize: 46,
          lineHeight: 50,
          fontWeight: "700",
          letterSpacing: -2,
          color: colors.text,
        }}
      >
        {day.day}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end", gap: 1, paddingBottom: 6 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.muted }}>
          {day.today ? `Hoje, ${day.weekday}` : weekday}
        </Text>
        <Text style={{ fontSize: 13.5, color: colors.muted }}>{day.month}</Text>
      </View>
    </View>
  );
}

/**
 * Anything ordered in time (a day, a delivery's history, steps): blue times on the left, what
 * and where on the right. Overlapping time ranges are found here from the labels themselves
 * (not trusted to the model) and marked in amber; today, a blue line shows where "now" is.
 */
function ResultTimeline({ items, date }: { items: ResultItem[]; date?: string }) {
  const clash = overlapping(items);
  const now = nowMarker(items, date);
  const marker = (
    <View style={[s.row, { paddingHorizontal: 14, height: 14, gap: 12 }]}>
      <Text
        style={{
          width: 54,
          fontSize: 11,
          fontWeight: "700",
          color: colors.blueDark,
          fontVariant: ["tabular-nums"],
        }}
      >
        {now?.label}
      </Text>
      <View
        style={{
          width: 9,
          height: 9,
          borderRadius: 5,
          backgroundColor: colors.blueDark,
          marginLeft: -3,
        }}
      />
      <View style={{ flex: 1, height: 2, backgroundColor: colors.blueDark, marginLeft: -12 }} />
    </View>
  );
  return (
    <View style={{ backgroundColor: "#FFF", borderRadius: 18, paddingBottom: 4 }}>
      <DayHeader date={date} />
      {keyed(items).map(({ item, key }, index) => {
        const [start, end] = (item.subtitle ?? "").split(/\s*[–—-]\s*/);
        const range = timeRange(item.subtitle);
        const conflict = clash.has(index);
        return (
          <View key={key}>
            {now?.index === index && marker}
            <Pressable
              disabled={!item.url}
              onPress={() => open(item.url)}
              style={[
                s.row,
                {
                  alignItems: "stretch",
                  gap: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderTopWidth: index ? 1 : 0,
                  borderTopColor: HAIRLINE,
                },
              ]}
            >
              <View style={{ width: 54, paddingTop: 1 }}>
                <Text
                  numberOfLines={2}
                  style={{
                    fontSize: range ? 15 : 12,
                    lineHeight: range ? 20 : 16,
                    fontWeight: "700",
                    color: range ? colors.blueDark : colors.muted,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {range ? start : item.subtitle || "—"}
                </Text>
                {range && !!end && (
                  <Text
                    style={{
                      fontSize: 12,
                      lineHeight: 16,
                      color: colors.muted,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {end}
                  </Text>
                )}
              </View>
              <View
                style={{
                  width: 3,
                  borderRadius: 2,
                  backgroundColor: conflict ? AMBER : "#DCE9F3",
                }}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15, lineHeight: 20, color: colors.text }}>
                  {item.title}
                </Text>
                {!!item.detail && (
                  <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.muted }}>
                    {item.detail}
                  </Text>
                )}
                {(conflict || !!item.badges?.length) && (
                  <View style={[s.row, { gap: 5, flexWrap: "wrap", marginTop: 3 }]}>
                    {conflict && <Pill tone="amber">sobrepõe</Pill>}
                    {item.badges?.map((badge) => (
                      <Pill key={badge}>{badge}</Pill>
                    ))}
                  </View>
                )}
              </View>
            </Pressable>
          </View>
        );
      })}
      {now?.index === items.length && marker}
    </View>
  );
}

interface Row {
  id: string;
  cells: string[];
}

function tableRows(items: ResultItem[]): Row[] {
  return items.map((item, index) => ({
    id: `r${index}`,
    cells: item.cells ?? [item.title, item.subtitle ?? ""],
  }));
}

type Sort = { column: number; direction: SortDirection } | undefined;

/**
 * Several items × attributes, laid out by `layoutTable`. Side by side, the grid fills the width
 * and rows take the height they need (a preview may leave trailing columns out and say "+N").
 * Wider, the first column pins and the others scroll, header included, with one estimated
 * height per row so pinned and scrolling cells stay aligned.
 */
function TableGrid({
  rows,
  columns,
  layout,
  sort,
  onSort,
  onRow,
}: {
  rows: Row[];
  columns: string[];
  layout: TableLayout;
  sort?: Sort;
  onSort?: (column: number) => void;
  onRow?: (row: Row) => void;
}) {
  const [atEnd, setAtEnd] = useState(false);
  const shown = layout.widths.length;
  const head = Array.from({ length: shown }, (_, column) => ({
    id: `h${column}`,
    label: columns[column] ?? "",
    column,
  }));
  const font = layout.font;
  const line = layout.font + 5;
  const headHeight = 34;
  const rowHeight = (index: number) => Math.round((layout.lines[index] ?? 1) * line + 20);
  const widthOf = (column: number) => Math.round(layout.widths[column] ?? 100);
  const hasHead = head.some((cell) => cell.label);

  const headCell = (cell: (typeof head)[number]) => {
    const active = sort?.column === cell.column;
    const right = layout.align[cell.column] === "right";
    const Arrow = sort?.direction === "desc" ? ArrowDown : ArrowUp;
    return (
      <Pressable
        key={cell.id}
        accessibilityRole={onSort ? "button" : undefined}
        accessibilityLabel={onSort ? `Ordenar por ${cell.label || cell.column + 1}` : undefined}
        disabled={!onSort}
        onPress={() => onSort?.(cell.column)}
        style={[
          s.row,
          {
            width: widthOf(cell.column),
            height: headHeight,
            paddingHorizontal: CELL_PAD,
            gap: 3,
            justifyContent: right ? "flex-end" : "flex-start",
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: 12,
            fontWeight: "700",
            color: active ? colors.blueDark : colors.muted,
            textAlign: right ? "right" : "left",
          }}
        >
          {cell.label}
        </Text>
        {active && <Arrow size={12} color={colors.blueDark} strokeWidth={2.5} />}
      </Pressable>
    );
  };
  const bodyCell = (row: Row, index: number, column: number) => {
    const text = row.cells[column] ?? "";
    const right = layout.align[column] === "right";
    return (
      <View
        key={`${row.id}c${column}`}
        style={{
          width: widthOf(column),
          height: layout.fits ? undefined : rowHeight(index),
          paddingHorizontal: CELL_PAD,
          paddingVertical: 10,
        }}
      >
        <Text
          numberOfLines={layout.fits ? undefined : (layout.lines[index] ?? 1)}
          style={{
            fontSize: font,
            lineHeight: line,
            fontWeight: column === 0 ? "600" : "400",
            color: signTone(text) ?? colors.text,
            textAlign: right ? "right" : "left",
            fontVariant: right ? ["tabular-nums"] : undefined,
          }}
        >
          {text}
        </Text>
      </View>
    );
  };
  const rowStyle = (index: number) => ({
    flexDirection: "row" as const,
    borderTopWidth: index || hasHead ? 1 : 0,
    borderTopColor: HAIRLINE,
  });
  const pressRow = (row: Row, index: number, cells: ReactNode) => (
    <Pressable
      key={row.id}
      disabled={!onRow}
      accessibilityRole={onRow ? "button" : undefined}
      onPress={() => onRow?.(row)}
      style={({ pressed }) => [rowStyle(index), pressed && { backgroundColor: colors.sky }]}
    >
      {cells}
    </Pressable>
  );
  const more = layout.hidden > 0 && (
    <View style={{ width: 44, alignItems: "flex-end", justifyContent: "center" }}>
      <Pill>{`+${layout.hidden}`}</Pill>
    </View>
  );

  if (layout.fits)
    return (
      <View style={{ paddingHorizontal: 4 }}>
        {hasHead && (
          <View style={{ flexDirection: "row" }}>
            {head.map(headCell)}
            {more}
          </View>
        )}
        {rows.map((row, index) =>
          pressRow(
            row,
            index,
            head.map((cell) => bodyCell(row, index, cell.column)),
          ),
        )}
      </View>
    );
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ zIndex: 1, paddingLeft: 4, backgroundColor: "#FFF" }}>
        {hasHead && <View style={{ flexDirection: "row" }}>{headCell(head[0])}</View>}
        {rows.map((row, index) => pressRow(row, index, bodyCell(row, index, 0)))}
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(17,25,28,0.07)", "rgba(17,25,28,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: "absolute", top: 0, bottom: 0, right: -10, width: 10 }}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        bounces={false}
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          const end = contentSize.width - contentOffset.x - layoutMeasurement.width < 12;
          if (end !== atEnd) setAtEnd(end);
        }}
        contentContainerStyle={{ paddingRight: 14 }}
      >
        <View>
          {hasHead && <View style={{ flexDirection: "row" }}>{head.slice(1).map(headCell)}</View>}
          {rows.map((row, index) =>
            pressRow(
              row,
              index,
              head.slice(1).map((cell) => bodyCell(row, index, cell.column)),
            ),
          )}
        </View>
      </ScrollView>
      {/* More columns to the right: the edge fades until the end is reached. */}
      {!atEnd && (
        <LinearGradient
          pointerEvents="none"
          colors={["#FFFFFF00", "#FFFFFF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 36 }}
        />
      )}
    </View>
  );
}

/** The table as it shows in the chat: the leading columns that fit, the first rows, "+N". */
function TablePreview({
  rows,
  columns,
  onLayout,
}: {
  rows: Row[];
  columns: string[];
  onLayout: (layout: TableLayout) => void;
}) {
  const [width, measure] = useWidth();
  const layout = useMemo(() => layoutTable(rows, columns, width - 8, true), [rows, columns, width]);
  useEffect(() => {
    if (width > 0) onLayout(layout);
  }, [width, layout]);
  return (
    <View onLayout={measure} style={{ backgroundColor: "#FFF", borderRadius: 18 }}>
      {width > 0 && <TableGrid rows={rows} columns={columns} layout={layout} />}
    </View>
  );
}

/** One row on its own: every column as a label and its full value. */
function RowDetail({
  row,
  columns,
  kinds,
  onBack,
}: {
  row: Row;
  columns: string[];
  kinds: ColumnKind[];
  onBack: () => void;
}) {
  const [first, ...rest] = row.cells;
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [
          s.row,
          { gap: 6, alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <ArrowLeft size={16} color={colors.blueDark} />
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.blueDark }}>
          Voltar à tabela
        </Text>
      </Pressable>
      <View style={{ backgroundColor: "#FFF", borderRadius: 18, padding: 16, gap: 14 }}>
        <View style={{ gap: 2 }}>
          {!!columns[0] && <Text style={s.small}>{columns[0]}</Text>}
          <Text selectable style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
            {first}
          </Text>
        </View>
        {rest.map((value, offset) => {
          const column = offset + 1;
          return (
            <View
              key={`${row.id}c${column}`}
              style={{ gap: 2, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 12 }}
            >
              <Text style={s.small}>{columns[column] || `Coluna ${column + 1}`}</Text>
              <Text
                selectable
                style={{
                  fontSize: 15.5,
                  lineHeight: 22,
                  color: signTone(value) ?? colors.text,
                  fontVariant: kinds[column] === "number" ? ["tabular-nums"] : undefined,
                }}
              >
                {value || "—"}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The full table: every column (the first pinned, the rest scrolling when they don't fit), tap
 * a header to sort (by value for numbers), a row to read it on its own; pinch to zoom on iOS.
 */
function TableSheet({ items, columns }: { items: ResultItem[]; columns: string[] }) {
  const rows = useMemo(() => tableRows(items), [items]);
  const [sort, setSort] = useState<Sort>(undefined);
  const [selected, setSelected] = useState<Row | undefined>(undefined);
  const [width, measure] = useWidth();
  const sorted = useMemo(
    () => (sort ? sortRows(rows, sort.column, sort.direction) : rows),
    [rows, sort],
  );
  const layout = useMemo(() => layoutTable(sorted, columns, width - 8), [sorted, columns, width]);
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, gap: 12 }}
      maximumZoomScale={Platform.OS === "ios" ? 3 : 1}
      minimumZoomScale={1}
      bouncesZoom
    >
      {selected ? (
        <RowDetail
          row={selected}
          columns={columns}
          kinds={layout.kinds}
          onBack={() => setSelected(undefined)}
        />
      ) : (
        <>
          <Text style={{ fontSize: 12.5, color: colors.muted }}>
            Toque num título para ordenar e numa linha para ver os detalhes.
          </Text>
          <View
            onLayout={measure}
            style={{ backgroundColor: "#FFF", borderRadius: 18, overflow: "hidden" }}
          >
            {width > 0 && (
              <TableGrid
                rows={sorted}
                columns={columns}
                layout={layout}
                sort={sort}
                onSort={(column) => setSort((current) => nextSort(current, column))}
                onRow={setSelected}
              />
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

/** Key figures: the value large, what it is below, the change as a pill colored by its sign. */
function ResultStats({ items, large }: { items: ResultItem[]; large?: boolean }) {
  return (
    <View style={[s.row, { flexWrap: "wrap", gap: 8, alignItems: "stretch" }]}>
      {keyed(items.slice(0, 6)).map(({ item, key }) => {
        const trend = item.detail?.trim() ?? "";
        const tone = /^[+↑▲]/.test(trend) ? GAIN : /^[-−↓▼]/.test(trend) ? LOSS : colors.muted;
        const tint = tone === GAIN ? colors.green : tone === LOSS ? "#FBEFED" : "#F1F3F4";
        return (
          <View
            key={key}
            style={{
              flexGrow: 1,
              flexBasis: "45%",
              backgroundColor: "#FFF",
              borderRadius: 18,
              paddingHorizontal: 14,
              paddingVertical: large ? 18 : 14,
              gap: 4,
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{
                fontSize: large ? 32 : 26,
                lineHeight: large ? 38 : 32,
                fontWeight: "700",
                letterSpacing: -0.8,
                color: colors.text,
                fontVariant: ["tabular-nums"],
              }}
            >
              {item.subtitle ?? "—"}
            </Text>
            <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 18, color: colors.muted }}>
              {item.title}
            </Text>
            {!!trend && (
              <View style={{ alignSelf: "flex-start", marginTop: 4 }}>
                <Text
                  numberOfLines={2}
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: tone,
                    backgroundColor: tint,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {trend}
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** A table element: the preview reports how many columns it left out, for the "Ver tudo" row. */
function TableElement({
  title,
  meta,
  items,
  columns,
}: {
  title?: string;
  meta?: string;
  items: ResultItem[];
  columns: string[];
}) {
  const rows = useMemo(() => tableRows(items), [items]);
  const [hidden, setHidden] = useState(0);
  const hint = hidden
    ? `+${plural(hidden, "coluna", "colunas")} · ordenar · detalhes`
    : "ordenar · detalhes";
  return (
    <Element
      title={title}
      meta={meta}
      more
      hint={hint}
      maxHeight={246}
      sheetPlain
      sheet={() => <TableSheet items={items} columns={columns} />}
    >
      <TablePreview
        rows={rows}
        columns={columns}
        onLayout={(layout) => {
          if (layout.hidden !== hidden) setHidden(layout.hidden);
        }}
      />
    </Element>
  );
}

/** "8 eventos", "6 linhas": how much the element holds, in words the content suggests. */
function unitOf(layout: Layout, items: ResultItem[], date?: string) {
  const n = items.length;
  switch (layout) {
    case "timeline":
      return date || items.some((item) => timeRange(item.subtitle))
        ? plural(n, "evento", "eventos")
        : plural(n, "etapa", "etapas");
    case "table":
      return plural(n, "linha", "linhas");
    case "stats":
      return plural(n, "indicador", "indicadores");
    case "cards":
      return plural(n, "resultado", "resultados");
    case "list":
      return plural(n, "item", "itens");
    case "times":
      return plural(n, "local", "locais");
    default:
      return "";
  }
}

export function ResultsCard({
  title,
  source,
  layout = "cards",
  columns,
  date,
  items,
}: {
  title?: string;
  source?: string;
  layout?: Layout;
  columns?: string[];
  date?: string;
  items: ResultItem[];
}) {
  if (!items.length) return null;
  // One row is not a list, a table or a timeline: the text reply says it better.
  if (items.length === 1 && (layout === "list" || layout === "table" || layout === "timeline"))
    return null;
  const lifted = liftCommonBadges(items);
  items = lifted.items;
  const found = source ?? host(items.find((item) => item.url)?.url);
  // What all items share goes once in the header (unless the source already says it).
  const site = [found, ...lifted.common.filter((badge) => !found?.includes(badge))]
    .filter(Boolean)
    .join(" · ");
  const meta = [unitOf(layout, items, date), site].filter(Boolean).join(" · ") || undefined;
  const headers = columns ?? [];

  if (layout === "detail" && items[0]) {
    const item = items[0];
    return (
      <Element
        title={title}
        meta={site || undefined}
        maxHeight={400}
        sheet={() => <ResultDetail item={item} />}
      >
        <ResultDetail item={item} />
      </Element>
    );
  }
  if (layout === "list")
    return (
      <Element title={title} meta={meta} maxHeight={312} sheet={() => <ResultList items={items} />}>
        <ResultList items={items} />
      </Element>
    );
  if (layout === "times")
    return (
      <Element
        title={title}
        meta={meta}
        maxHeight={330}
        sheet={() => <ResultTimes items={items} />}
      >
        <ResultTimes items={items} />
      </Element>
    );
  if (layout === "timeline") {
    // Merged calendars arrive out of order; a timeline is always in time order.
    items = inTimeOrder(items);
    return (
      <Element
        title={title}
        meta={meta}
        maxHeight={344}
        sheet={() => <ResultTimeline items={items} date={date} />}
      >
        <ResultTimeline items={items} date={date} />
      </Element>
    );
  }
  if (layout === "table")
    return <TableElement title={title} meta={meta} items={items} columns={headers} />;
  if (layout === "stats")
    return (
      <Element title={title} meta={meta} plain sheet={() => <ResultStats items={items} large />}>
        <ResultStats items={items} />
      </Element>
    );
  return (
    <Element
      title={title}
      meta={meta}
      plain
      more={items.length > 3}
      sheet={() => <CardGrid items={items} />}
    >
      <ResultCarousel items={items} />
    </Element>
  );
}
