// Soft two-tone line icons for the weather card: a pale fill under a colored stroke, drawn on a
// 24-unit grid with react-native-svg (web and native). Parts are composed per icon, so a rain
// cloud is the same cloud as "Nublado", raised to make room for the drops.
import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { iconFamily, TILE, type WeatherIconName } from "./weather";

const INK = {
  sunFill: "#FFE49A",
  sun: "#EFA52A",
  moonFill: "#E7E1FB",
  moon: "#8A79D6",
  cloudFill: "#F7F9FB",
  cloud: "#8195AA",
  darkCloudFill: "#E4EAF0",
  darkCloud: "#62768B",
  drop: "#3A8BDD",
  snow: "#7BAEE3",
  fog: "#9AA7B4",
  boltFill: "#FFD04A",
  bolt: "#E29E00",
};
const STROKE = 1.6;
const CLOUD = "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z";
const MOON = "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z";

function Sun({ cx = 12, cy = 12, r = 4, rays = [6.4, 8.6] }) {
  return (
    <G>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const a = (angle * Math.PI) / 180;
        return (
          <Line
            key={angle}
            x1={cx + Math.cos(a) * rays[0]}
            y1={cy + Math.sin(a) * rays[0]}
            x2={cx + Math.cos(a) * rays[1]}
            y2={cy + Math.sin(a) * rays[1]}
            stroke={INK.sun}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        );
      })}
      <Circle cx={cx} cy={cy} r={r} fill={INK.sunFill} stroke={INK.sun} strokeWidth={STROKE} />
    </G>
  );
}

/** The cloud, placed with a translate + scale; stroke width stays the same on screen. */
function Cloud({ x = 0, y = 0, k = 1, dark = false }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${k})`}>
      <Path
        d={CLOUD}
        fill={dark ? INK.darkCloudFill : INK.cloudFill}
        stroke={dark ? INK.darkCloud : INK.cloud}
        strokeWidth={STROKE / k}
        strokeLinejoin="round"
      />
    </G>
  );
}

/** Raised cloud for icons with something falling under it. */
const High = ({ dark = false }) => <Cloud x={1.4} y={-2.8} k={0.88} dark={dark} />;

const streak = (x: number, y: number, length: number, color = INK.drop) => (
  <Line
    key={`${x}-${y}`}
    x1={x}
    y1={y}
    x2={x - length * 0.3}
    y2={y + length}
    stroke={color}
    strokeWidth={STROKE}
    strokeLinecap="round"
  />
);

function parts(name: WeatherIconName): ReactNode {
  switch (name) {
    case "sun":
      return <Sun />;
    case "moon":
      return (
        <Path
          d={MOON}
          fill={INK.moonFill}
          stroke={INK.moon}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
      );
    case "partly":
      return (
        <>
          <Sun cx={8.6} cy={8.4} r={3.1} rays={[4.9, 6.4]} />
          <Cloud x={3.4} y={4.3} k={0.84} />
        </>
      );
    case "partly-night":
      return (
        <>
          <G transform="translate(-0.2 -0.4) scale(0.66)">
            <Path
              d={MOON}
              fill={INK.moonFill}
              stroke={INK.moon}
              strokeWidth={STROKE / 0.66}
              strokeLinejoin="round"
            />
          </G>
          <Cloud x={3.4} y={4.3} k={0.84} />
        </>
      );
    case "fog":
      return (
        <>
          <Cloud x={1.4} y={-3.4} k={0.88} />
          {[
            [5, 16.6, 19],
            [7.5, 20.2, 17],
          ].map(([x1, y, x2]) => (
            <Line
              key={y}
              x1={x1}
              y1={y}
              x2={x2}
              y2={y}
              stroke={INK.fog}
              strokeWidth={STROKE}
              strokeLinecap="round"
            />
          ))}
        </>
      );
    case "drizzle":
      return (
        <>
          <High />
          {[
            [8.4, 16.8],
            [12.4, 16.8],
            [16.4, 16.8],
            [10.4, 20],
            [14.4, 20],
          ].map(([x, y]) => streak(x, y, 1.4))}
        </>
      );
    case "rain":
      return (
        <>
          <High />
          {[8.4, 12.4, 16.4].map((x) => streak(x, 16.6, 4))}
        </>
      );
    case "heavy-rain":
      return (
        <>
          <High dark />
          {[6.8, 10.4, 14, 17.6].map((x) => streak(x, 16.4, 5.2))}
        </>
      );
    case "snow":
      return (
        <>
          <High />
          {[
            [8, 17.4],
            [12, 17.4],
            [16, 17.4],
            [10, 20.8],
            [14, 20.8],
          ].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.05} fill={INK.snow} />
          ))}
        </>
      );
    case "thunder":
      return (
        <>
          <High dark />
          <Path
            d="M13.2 12.6 L9.7 17.6 H12.4 L11.3 22 L15.2 16.4 H12.5 Z"
            fill={INK.boltFill}
            stroke={INK.bolt}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
        </>
      );
    default:
      return <Cloud />;
  }
}

/** A weather icon; with `tile`, on a pale rounded square tinted by its family. */
export function WeatherIcon({
  name,
  size = 24,
  tile,
}: {
  name: WeatherIconName;
  size?: number;
  /** Tile side; the icon sits inside with room around it. */
  tile?: number;
}) {
  const icon = (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {parts(name)}
    </Svg>
  );
  if (!tile) return icon;
  return (
    <View
      style={{
        width: tile,
        height: tile,
        borderRadius: Math.round(tile * 0.3),
        backgroundColor: TILE[iconFamily(name)],
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {icon}
    </View>
  );
}
