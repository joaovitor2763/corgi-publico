import { useEffect, useRef, useState } from "react";
import { Animated, Platform, View } from "react-native";
import { RegiClipPlayer } from "./RegiClipPlayer";
import { useRegiMood } from "./RegiSprite";
import { expressionFor } from "./regi-clips";

const WORK_MOODS = new Set(["working", "browsing", "reading"]);

/** True once work has been running for a while, so quick lookups don't pull out the laptop. */
function useLongWork(mood: string) {
  const working = WORK_MOODS.has(mood);
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!working) {
      setLong(false);
      return;
    }
    const timer = setTimeout(() => setLong(true), 3000);
    return () => clearTimeout(timer);
  }, [working]);
  return long;
}

/**
 * Regi, head and shoulders on a transparent background, like Muse's avatar: clips generated from
 * the character sheets (tools/mascot). He is calm by default and reacts to the situation.
 */
export function RegiAvatar({ size, poked = false }: { size: number; poked?: boolean }) {
  const mood = useRegiMood();
  const worked = expressionFor(mood, useLongWork(mood));
  const expression = poked ? "smile" : worked;
  // The laptop sits low in the frame; lift Regi while he types so the name pill doesn't hide it.
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(lift, {
      toValue: expression === "laptop" ? -size * 0.2 : 0,
      friction: 8,
      tension: 60,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [expression, lift, size]);
  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel={`Regi, ${mood}`}
      style={{ transform: [{ translateY: lift }] }}
    >
      <RegiClipPlayer size={size} target={expression} />
    </Animated.View>
  );
}

/**
 * Header avatar: Regi in a round frame (like a profile photo). Some poses reach the top of their
 * frame (ears in "think" and "smile"); inside a circle that reads as the frame's edge, not a cut.
 */
export function AgentAvatar({ size, poked }: { size: number; poked?: boolean }) {
  const border = 2;
  return (
    <View
      style={{
        borderRadius: size / 2,
        shadowColor: "#1B2A33",
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: border,
          borderColor: "#FFFFFF",
          backgroundColor: "#E8F3FA",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <RegiAvatar size={size - border * 2} poked={poked} />
      </View>
    </View>
  );
}
