import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import { useLiveStatus } from "../features/chat/live-status";
import { MOOD_POSES, moodForLabel, POSES, type RegiMood, type RegiPose } from "./regi-poses";

const native = Platform.OS !== "web";
/** Moods where Regi is busy: faster breathing. */
const BUSY: RegiMood[] = ["thinking", "working", "reading", "browsing", "writing", "noting"];

/** A sine loop between 0 and 1 with the given half-period, native-driven where possible. */
function useOscillator(halfPeriod: number) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: halfPeriod,
          easing: ease,
          useNativeDriver: native,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: halfPeriod,
          easing: ease,
          useNativeDriver: native,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, halfPeriod]);
  return value;
}

/**
 * Regi as drawn on the character sheets, one pose per mood. A pose change is a squash-and-pop:
 * he squashes, the drawing swaps at the flattest moment (when the silhouette is unreadable), then
 * springs up with overshoot — so it reads as Regi moving, not as a new picture. Between changes
 * he breathes, sways on two out-of-step rhythms and blinks. All poses share one canvas with the
 * feet on the bottom edge.
 */
export function RegiSprite({ size, mood }: { size: number; mood: RegiMood }) {
  const [pose, setPose] = useState<RegiPose>(MOOD_POSES[mood][0] ?? "sit");
  const squash = useRef(new Animated.Value(0)).current;
  const [blink, setBlink] = useState(false);
  const shown = useRef(pose);
  const busy = BUSY.includes(mood);
  const breath = useOscillator(
    mood === "sleeping" || mood === "resting" ? 2600 : busy ? 900 : 1700,
  );
  const sway = useOscillator(1550);
  const drift = useOscillator(2350);

  function show(next: RegiPose) {
    if (next === shown.current) return;
    shown.current = next;
    squash.stopAnimation();
    Animated.timing(squash, {
      toValue: 1,
      duration: 110,
      easing: Easing.in(Easing.quad),
      useNativeDriver: native,
    }).start(() => {
      setPose(next);
      Animated.spring(squash, {
        toValue: 0,
        friction: 5,
        tension: 180,
        useNativeDriver: native,
      }).start();
    });
  }

  // A new mood: pop into its first pose; long moods drift through the rest, rarely.
  useEffect(() => {
    const poses = MOOD_POSES[mood];
    show(poses[0] ?? "sit");
    if (poses.length < 2) return;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(
        () => {
          index = (index + 1) % poses.length;
          show(poses[index] ?? "sit");
          next();
        },
        (mood === "idle" ? 25_000 : 4_000) + Math.random() * 15_000,
      );
    };
    next();
    return () => clearTimeout(timer);
  }, [mood]);

  // Blinks (sometimes double) on the sitting pose, which has a drawn closed-eye twin.
  useEffect(() => {
    if (pose !== "sit") return;
    let timer: ReturnType<typeof setTimeout>;
    const close = (then: () => void) => {
      setBlink(true);
      timer = setTimeout(() => {
        setBlink(false);
        then();
      }, 120);
    };
    const schedule = () => {
      timer = setTimeout(
        () =>
          close(() => {
            if (Math.random() < 0.25) timer = setTimeout(() => close(schedule), 140);
            else schedule();
          }),
        2000 + Math.random() * 4000,
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setBlink(false);
    };
  }, [pose]);

  // Every transform pivots on the feet: scale, then shift down by half the growth.
  const stretch = busy ? 0.03 : 0.02;
  const scaleY = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + stretch] }),
    squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.12, 0, -0.2] }),
  );
  const scaleX = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1 - stretch / 3] }),
    squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [-0.06, 0, 0.14] }),
  );
  const planted = Animated.multiply(Animated.add(scaleY, -1), -size / 2);
  const tilt = sway.interpolate({ inputRange: [0, 1], outputRange: ["-1.4deg", "1.4deg"] });
  const shift = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [-size * 0.012, size * 0.012],
  });
  // Rotating about the feet: move the pivot down, rotate, move back.
  const pivot = size / 2;
  const image = POSES[pose === "sit" && blink ? "sitBlink" : pose];
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View
        style={{
          width: size,
          height: size,
          transform: [
            { translateX: shift },
            { translateY: pivot },
            { rotate: tilt },
            { translateY: -pivot },
            { translateY: planted },
            { scaleX },
            { scaleY },
          ],
        }}
      >
        <Animated.Image
          source={image}
          resizeMode="contain"
          style={{ position: "absolute", width: size, height: size }}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The mood the app is in right now: the agent's live status first, then the user (typing →
 * listening, a quiet minute and a half → lying down, 5 idle minutes → asleep), with a wave on arrival and a hop when work finishes.
 */
export function useRegiMood(): RegiMood {
  const { label } = useLiveStatus();
  const working = moodForLabel(label);
  const [moment, setMoment] = useState<RegiMood | undefined>("hello");
  const [quietFor, setQuietFor] = useState<"awake" | "resting" | "asleep">("awake");
  const was = useRef(working);

  useEffect(() => {
    const timer = setTimeout(() => setMoment(undefined), 2600);
    return () => clearTimeout(timer);
  }, []);

  // Work just ended: celebrate briefly.
  useEffect(() => {
    const before = was.current;
    was.current = working;
    if (!before || working) return;
    setMoment("happy");
    const timer = setTimeout(() => setMoment(undefined), 3500);
    return () => clearTimeout(timer);
  }, [working]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let last = Date.now();
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      last = Date.now();
      setQuietFor("awake");
    };
    const onKey = (event: KeyboardEvent) => {
      wake();
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;
      setMoment((current) => (current === "hello" || current === "happy" ? current : "listening"));
      clearTimeout(quiet);
      quiet = setTimeout(
        () => setMoment((current) => (current === "listening" ? undefined : current)),
        1600,
      );
    };
    const check = setInterval(() => {
      const gap = Date.now() - last;
      setQuietFor(gap > 5 * 60_000 ? "asleep" : gap > 90_000 ? "resting" : "awake");
    }, 10_000);
    document.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("pointermove", wake, { passive: true });
    return () => {
      clearInterval(check);
      clearTimeout(quiet);
      document.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

  if (working) return working;
  if (moment) return moment;
  return quietFor === "asleep" ? "sleeping" : quietFor === "resting" ? "resting" : "idle";
}
