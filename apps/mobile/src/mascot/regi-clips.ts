/**
 * Regi's animation graph. Clips are generated from the character sheets (tools/mascot) and all
 * start on the same neutral keyframe:
 *
 *   neutral ─enter→ pose (held still) ─enter reversed→ neutral     look-down, think, smile, doze
 *   neutral ─in→ laptop ⟲ loop ─out→ neutral                        laptop (long work)
 *   neutral ─blink / glance→ neutral                                 rare idle beats
 *
 * Regi is still most of the time; a pose is a place he goes to and stays, not a loop.
 */
import type { RegiMood } from "./regi-poses";

export type Expression = "neutral" | "lookDown" | "think" | "smile" | "doze" | "laptop";

export interface Clip {
  sheet: number; // require() of the spritesheet
  frames: number;
  fps: number;
  cols: number;
}

const clip = (sheet: number, meta: { frames: number; fps: number; cols: number }): Clip => ({
  sheet,
  ...meta,
});

/** One-way clips from neutral into a held pose; played backwards to return. */
export const ENTER: Partial<Record<Expression, Clip>> = {
  lookDown: clip(
    require("../../assets/regi/clips/look-down.webp"),
    require("../../assets/regi/clips/look-down.json"),
  ),
  think: clip(
    require("../../assets/regi/clips/think.webp"),
    require("../../assets/regi/clips/think.json"),
  ),
  smile: clip(
    require("../../assets/regi/clips/smile.webp"),
    require("../../assets/regi/clips/smile.json"),
  ),
  doze: clip(
    require("../../assets/regi/clips/doze.webp"),
    require("../../assets/regi/clips/doze.json"),
  ),
};

export const LAPTOP = {
  in: clip(
    require("../../assets/regi/clips/sit-to-laptop.webp"),
    require("../../assets/regi/clips/sit-to-laptop.json"),
  ),
  loop: clip(
    require("../../assets/regi/clips/laptop.webp"),
    require("../../assets/regi/clips/laptop.json"),
  ),
  out: clip(
    require("../../assets/regi/clips/laptop-to-sit.webp"),
    require("../../assets/regi/clips/laptop-to-sit.json"),
  ),
};

/** Small neutral → neutral beats while idle. */
export const BEATS = {
  blink: clip(
    require("../../assets/regi/clips/blink.webp"),
    require("../../assets/regi/clips/blink.json"),
  ),
  glance: clip(
    require("../../assets/regi/clips/glance.webp"),
    require("../../assets/regi/clips/glance.json"),
  ),
};

export const ALL_CLIPS: Clip[] = [
  ...Object.values(ENTER),
  LAPTOP.in,
  LAPTOP.loop,
  LAPTOP.out,
  BEATS.blink,
  BEATS.glance,
];

/**
 * What Regi shows for a mood. Work shows the laptop only once it has run for a while (`long`);
 * quick lookups just get a thoughtful look.
 */
export function expressionFor(mood: RegiMood, long: boolean): Expression {
  switch (mood) {
    case "listening":
      return "lookDown";
    case "thinking":
    case "noting":
      return "think";
    case "working":
    case "browsing":
    case "reading":
      return long ? "laptop" : "think";
    case "happy":
    case "hello":
      return "smile";
    case "sleeping":
      return "doze";
    default:
      return "neutral";
  }
}
