import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, AppState, Image, View } from "react-native";
import { ALL_CLIPS, BEATS, type Clip, ENTER, type Expression, LAPTOP } from "./regi-clips";

const FPS = 20;

const uriOf = (c: Clip) => {
  // Web bundles an asset as a URL or {uri}; native resolves the module id.
  const sheet = c.sheet as unknown;
  return typeof sheet === "string"
    ? sheet
    : typeof sheet === "object" && sheet && "uri" in sheet
      ? String(sheet.uri)
      : Image.resolveAssetSource?.(c.sheet)?.uri;
};
const prefetch = (clips: Clip[]) => {
  for (const c of clips) {
    const uri = uriOf(c);
    if (uri) void Image.prefetch(uri).catch(() => {});
  }
};

/**
 * Sheets are ~0.5 MB each (4.4 MB in all). Fetch the everyday beats (blink, glance) now and the
 * rest a few seconds later, so Regi never competes with the app itself for the first load.
 */
let preloaded = false;
function usePreload() {
  useEffect(() => {
    if (preloaded) return;
    preloaded = true;
    prefetch([BEATS.blink, BEATS.glance]);
    const rest = setTimeout(
      () => prefetch(ALL_CLIPS.filter((c) => c !== BEATS.blink && c !== BEATS.glance)),
      4000,
    );
    return () => clearTimeout(rest);
  }, []);
}

type Playing = { clip: Clip; dir: 1 | -1; arrive: Expression };
type Engine = {
  at: Expression; // where Regi rests when nothing plays
  playing?: Playing;
  waiting?: Playing; // next clip, held back until its sheet has loaded and decoded
  shown: { clip: Clip; frame: number };
  nextBlink: number;
  nextGlance: number;
};

const later = (min: number, max: number) => Date.now() + min + Math.random() * (max - min);

/**
 * Plays Regi toward `target`. At rest he holds the last frame (still, like a portrait); while
 * neutral he blinks every few seconds and glances around now and then. Moving between two poses
 * always goes back through neutral: a held pose leaves by playing its entrance backwards.
 */
export function RegiClipPlayer({ size, target }: { size: number; target: Expression }) {
  usePreload();
  const targetRef = useRef(target);
  targetRef.current = target;
  const engine = useRef<Engine>({
    at: "neutral",
    shown: { clip: BEATS.blink, frame: 0 },
    nextBlink: later(2500, 5000),
    nextGlance: later(12_000, 22_000),
  });
  // Only the sheet is React state (it changes a few times a minute). Frames move an Animated
  // value directly: no re-render 20 times a second, which on a phone made the whole app stutter.
  const [clip, setClip] = useState(engine.current.shown.clip);
  // Swapping an Image's source blanks it until the new sheet is decoded (react-native-web shows the
  // undecoded URL right away), so Regi flickered away on every change of pose. Instead the next
  // sheet mounts as a hidden layer under the current one; only once it has loaded does it take
  // over, and until then the last frame stays on screen.
  const [pending, setPending] = useState<Clip>();
  const loaded = useRef(new Set<Clip>()).current;
  const frameX = useRef(new Animated.Value(0)).current;
  const frameY = useRef(new Animated.Value(0)).current;
  // Each frame is drawn 1px larger on every side and cropped, so the neighbouring frame in the
  // sheet never bleeds in as a thin line at the edge.
  const cell = size + 2;
  const place = (next: Clip, frame: number) => {
    frameX.setValue(-(frame % next.cols) * cell - 1);
    frameY.setValue(-Math.floor(frame / next.cols) * cell - 1);
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  // A new sheet: position its first frame only once it is the one on screen.
  useLayoutEffect(() => {
    placeRef.current(clip, engine.current.shown.frame);
  }, [clip]);

  useEffect(() => {
    const e = engine.current;
    const show = (next: Clip, frame: number) => {
      if (e.shown.clip === next && e.shown.frame === frame) return;
      const previous = e.shown.clip;
      e.shown = { clip: next, frame };
      if (previous === next) return placeRef.current(next, frame);
      loaded.delete(previous); // its layer unmounts with this switch
      setClip(next);
      setPending(undefined);
    };
    // Nothing to animate while the app is in the background or the tab is hidden.
    let visible = AppState.currentState !== "background";
    const subscription = AppState.addEventListener("change", (state) => {
      visible = state === "active";
    });
    const start = (clip: Clip, dir: 1 | -1, arrive: Expression) => {
      if (clip !== e.shown.clip && !loaded.has(clip)) {
        e.waiting = { clip, dir, arrive };
        setPending(clip);
        return;
      }
      e.waiting = undefined;
      e.playing = { clip, dir, arrive };
      show(clip, dir === 1 ? 0 : clip.frames - 1);
    };
    const timer = setInterval(() => {
      if (!visible) return;
      const w = e.waiting;
      if (w) {
        // Hold the current frame until the next sheet is ready.
        if (loaded.has(w.clip)) start(w.clip, w.dir, w.arrive);
        return;
      }
      const p = e.playing;
      if (p) {
        // Returning to neutral runs at double speed: the way back shouldn't drag.
        const next = e.shown.frame + (p.dir === -1 ? -2 : 1);
        if (next >= 0 && next < p.clip.frames) return show(p.clip, next);
        e.at = p.arrive;
        e.playing = undefined;
      }
      const want = targetRef.current;
      if (e.at !== want) {
        // Leave the current pose first; everything passes through neutral.
        if (e.at === "laptop") return start(LAPTOP.out, 1, "neutral");
        const back = ENTER[e.at];
        if (e.at !== "neutral" && back) return start(back, -1, "neutral");
        if (want === "laptop") return start(LAPTOP.in, 1, "laptop");
        const enter = ENTER[want];
        if (enter) return start(enter, 1, want);
        return;
      }
      if (e.at === "laptop") return start(LAPTOP.loop, 1, "laptop");
      if (e.at !== "neutral") return; // hold the pose, still
      const now = Date.now();
      if (now >= e.nextGlance) {
        e.nextGlance = later(15_000, 30_000);
        e.nextBlink = later(3000, 6000);
        return start(BEATS.glance, 1, "neutral");
      }
      if (now >= e.nextBlink) {
        e.nextBlink = later(3000, 7000);
        return start(BEATS.blink, 1, "neutral");
      }
    }, 1000 / FPS);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [loaded]);

  const layers = pending && pending !== clip ? [clip, pending] : [clip];
  return (
    <View style={{ width: size, height: size, overflow: "hidden" }} pointerEvents="none">
      {layers.map((layer) => (
        <SheetLayer
          key={ALL_CLIPS.indexOf(layer)}
          clip={layer}
          cell={cell}
          visible={layer === clip}
          frameX={frameX}
          frameY={frameY}
          onReady={loaded}
        />
      ))}
    </View>
  );
}

/**
 * One spritesheet, stacked in the same spot. Its key is the clip, so it keeps the same mounted
 * image when it goes from hidden (loading) to shown: no remount, no reload.
 */
const SheetLayer = memo(function SheetLayer({
  clip,
  cell,
  visible,
  frameX,
  frameY,
  onReady,
}: {
  clip: Clip;
  cell: number;
  visible: boolean;
  frameX: Animated.Value;
  frameY: Animated.Value;
  onReady: Set<Clip>;
}) {
  // Stable handler: a new one each render would restart the image load on the web. A sheet that
  // fails to load still counts as ready, so Regi is never stuck waiting for it.
  const [onLoad] = useState(() => () => {
    onReady.add(clip);
  });
  const rows = Math.ceil(clip.frames / clip.cols);
  return (
    <Animated.Image
      source={clip.sheet}
      fadeDuration={0}
      onLoad={onLoad}
      onError={onLoad}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        opacity: visible ? 1 : 0,
        width: cell * clip.cols,
        height: cell * rows,
        transform: [{ translateX: frameX }, { translateY: frameY }],
      }}
    />
  );
});
