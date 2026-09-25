// The show_route card: how long, when to leave, the path drawn from the polyline (no map
// tiles), from → to, the steps on demand and a button to the full route in Maps.
import {
  ArrowRight,
  Bike,
  Car,
  ChevronDown,
  Footprints,
  type LucideIcon,
  TramFront,
  TriangleAlert,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { Image, type LayoutChangeEvent, Linking, Pressable, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors, s } from "../../shared/ui";
import { Element, HeadsUp } from "../chat/result-cards";
import {
  decodePolyline,
  distanceLine,
  fitPath,
  MODE_LABEL,
  type Route,
  type TravelMode,
  timingLine,
} from "./route";

const MODE_ICON: Record<TravelMode, LucideIcon> = {
  driving: Car,
  transit: TramFront,
  walking: Footprints,
  bicycling: Bike,
};
const START = "#2E9E5B";
const END = colors.text;
const LINE = "#2F7FD8";
const STAGE = "#F2F5F8";
const GRID = "#E1E7ED";
const HAIRLINE = "#F0F1F3";

export function RouteCard({
  route,
  mapsUrl,
  mapImage,
}: {
  route: Route;
  mapsUrl: string;
  /** Server-drawn picture of the path over a real map (signed URL); the drawing is the fallback. */
  mapImage?: string;
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const Mode = MODE_ICON[route.mode];
  const distance = distanceLine(route);
  const timing = timingLine(route);
  const points = useMemo(
    () => (route.polyline ? decodePolyline(route.polyline) : []),
    [route.polyline],
  );
  const drawn = points.length >= 2;
  return (
    <Element title={route.to} meta={MODE_LABEL[route.mode]}>
      <View style={{ padding: 14, gap: 12 }}>
        {route.warnings?.map((warning) => (
          <HeadsUp key={warning} icon={TriangleAlert}>
            {warning}
          </HeadsUp>
        ))}
        <View style={{ gap: 3, paddingHorizontal: 2 }}>
          <View style={[s.row, { gap: 10 }]}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: colors.sky,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Mode size={20} color={colors.blueDark} strokeWidth={2} />
            </View>
            <Text
              style={{
                flexShrink: 1,
                fontSize: 32,
                lineHeight: 38,
                fontWeight: "700",
                letterSpacing: -0.8,
                color: colors.text,
              }}
            >
              {route.duration}
            </Text>
          </View>
          {!!distance && (
            <Text numberOfLines={1} style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>
              {distance}
            </Text>
          )}
          {!!timing && (
            <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.text }}>{timing}</Text>
          )}
        </View>
        {mapImage && !mapFailed ? (
          <Image
            accessibilityLabel={`Mapa do trajeto até ${route.to}`}
            source={{ uri: mapImage }}
            onError={() => setMapFailed(true)}
            resizeMode="cover"
            style={{
              width: "100%",
              aspectRatio: 360 / 200,
              borderRadius: 14,
              backgroundColor: "#EEF1F4",
            }}
          />
        ) : drawn ? (
          <PathDrawing points={points} />
        ) : (
          <PlainTrip from={route.from} to={route.to} />
        )}
        {drawn && <Stops from={route.from} to={route.to} />}
        {!!route.steps?.length && <Steps steps={route.steps} />}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Abrir no Maps"
          onPress={() => void Linking.openURL(mapsUrl)}
          style={({ pressed }) => [
            s.row,
            {
              justifyContent: "center",
              gap: 8,
              backgroundColor: colors.text,
              borderRadius: 14,
              paddingVertical: 13,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#FFF" }}>Abrir no Maps</Text>
          <ArrowRight size={17} color="#FFF" strokeWidth={2.2} />
        </Pressable>
      </View>
    </Element>
  );
}

function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  return [width, onLayout] as const;
}

/** A faint dot grid, so the drawing reads as a place without pretending to be a map. */
function Grid({ width, height }: { width: number; height: number }) {
  const dots = [];
  for (let y = 12; y < height; y += 16)
    for (let x = 12; x < width; x += 16)
      dots.push(<Circle key={`${x}-${y}`} cx={x} cy={y} r={1} fill={GRID} />);
  return <>{dots}</>;
}

function Dot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <>
      <Circle cx={x} cy={y} r={8} fill="#FFF" />
      <Circle cx={x} cy={y} r={5} fill={color} />
    </>
  );
}

const HEIGHT = 160;

function PathDrawing({ points }: { points: [number, number][] }) {
  const [width, onLayout] = useWidth();
  const path = useMemo(
    () => (width ? fitPath(points, width, HEIGHT, 22) : undefined),
    [points, width],
  );
  return (
    <View
      onLayout={onLayout}
      accessibilityLabel="Desenho do trajeto"
      style={{ height: HEIGHT, borderRadius: 16, backgroundColor: STAGE, overflow: "hidden" }}
    >
      {!!width && (
        <Svg width={width} height={HEIGHT}>
          <Grid width={width} height={HEIGHT} />
          {path && (
            <>
              <Path
                d={path.d}
                fill="none"
                stroke="#FFF"
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d={path.d}
                fill="none"
                stroke={LINE}
                strokeWidth={4.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Dot {...path.start} color={START} />
              <Dot {...path.end} color={END} />
            </>
          )}
        </Svg>
      )}
    </View>
  );
}

/** Without a polyline: a gentle arc between the two places, their names under the dots. */
function PlainTrip({ from, to }: { from: string; to: string }) {
  const [width, onLayout] = useWidth();
  const height = 104;
  const y = 40;
  const left = 26;
  const right = width - 26;
  return (
    <View
      onLayout={onLayout}
      style={{ height, borderRadius: 16, backgroundColor: STAGE, overflow: "hidden" }}
    >
      {!!width && (
        <Svg width={width} height={height} style={{ position: "absolute" }}>
          <Grid width={width} height={height} />
          <Path
            d={`M${left} ${y} Q${width / 2} ${y - 34} ${right} ${y}`}
            fill="none"
            stroke={LINE}
            strokeWidth={3}
            strokeDasharray="1 7"
            strokeLinecap="round"
          />
          <Dot x={left} y={y} color={START} />
          <Dot x={right} y={y} color={END} />
        </Svg>
      )}
      <View
        style={[s.between, { position: "absolute", left: 12, right: 12, top: y + 16, gap: 16 }]}
      >
        <Text numberOfLines={2} style={{ flex: 1, fontSize: 12.5, color: colors.text }}>
          {from}
        </Text>
        <Text
          numberOfLines={2}
          style={{ flex: 1, fontSize: 12.5, color: colors.text, textAlign: "right" }}
        >
          {to}
        </Text>
      </View>
    </View>
  );
}

function Stops({ from, to }: { from: string; to: string }) {
  const stop = (label: string, place: string, color: string) => (
    <View style={[s.row, { gap: 12 }]}>
      <View style={{ width: 12, alignItems: "center" }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      </View>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.text }}>
        <Text style={{ color: colors.muted }}>{label} </Text>
        {place}
      </Text>
    </View>
  );
  return (
    <View style={{ paddingHorizontal: 4 }}>
      {stop("De", from, START)}
      <View style={{ width: 12, alignItems: "center", paddingVertical: 2 }}>
        <View style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: GRID }} />
      </View>
      {stop("Até", to, END)}
    </View>
  );
}

function Steps({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  // Directions repeat themselves ("Continue em frente"); keys count repeats instead.
  const seen = new Map<string, number>();
  const rows = steps.map((step) => {
    const count = (seen.get(step) ?? 0) + 1;
    seen.set(step, count);
    return { step, key: `${step}#${count}` };
  });
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          s.row,
          { gap: 6, paddingVertical: 8, paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.blueDark }}>
          {open ? "Esconder passos" : `Ver passos (${steps.length})`}
        </Text>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronDown size={16} color={colors.blueDark} />
        </View>
      </Pressable>
      {open && (
        <View style={{ gap: 10, paddingHorizontal: 4, paddingBottom: 4 }}>
          {rows.map(({ step, key }, index) => (
            <View key={key} style={{ flexDirection: "row", gap: 10 }}>
              <Text
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  overflow: "hidden",
                  backgroundColor: "#F1F3F4",
                  textAlign: "center",
                  lineHeight: 20,
                  fontSize: 11,
                  fontWeight: "700",
                  color: colors.muted,
                }}
              >
                {index + 1}
              </Text>
              <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: colors.text }}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
