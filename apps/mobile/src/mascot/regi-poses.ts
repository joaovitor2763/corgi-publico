/**
 * Regi's 2D poses, cut from the character sheets (tools/mascot/make_sprites.py). Each mood lists the
 * poses it can show; idle moods rotate between theirs so Regi never looks frozen.
 */
export type RegiMood =
  | "idle"
  | "resting"
  | "listening"
  | "thinking"
  | "working"
  | "reading"
  | "browsing"
  | "writing"
  | "noting"
  | "happy"
  | "sleeping"
  | "hello";

export type RegiPose = keyof typeof POSES;

export const POSES = {
  sit: require("../../assets/regi/sit.png"),
  sitBlink: require("../../assets/regi/sit-blink.png"),
  sitHappy: require("../../assets/regi/sit-happy.png"),
  sitTilt: require("../../assets/regi/sit-tilt.png"),
  coffee: require("../../assets/regi/coffee.png"),
  wave: require("../../assets/regi/wave.png"),
  jump: require("../../assets/regi/jump.png"),
  laptop: require("../../assets/regi/laptop.png"),
  typing: require("../../assets/regi/typing.png"),
  think: require("../../assets/regi/think.png"),
  idea: require("../../assets/regi/idea.png"),
  read: require("../../assets/regi/read.png"),
  run: require("../../assets/regi/run.png"),
  listen: require("../../assets/regi/listen.png"),
  lie: require("../../assets/regi/lie.png"),
  sleep: require("../../assets/regi/sleep.png"),
} as const;

/** First pose shows on entering the mood; the rest rotate while it lasts. */
export const MOOD_POSES: Record<RegiMood, RegiPose[]> = {
  idle: ["sit", "sitHappy", "sit", "sitTilt"],
  resting: ["lie"],
  listening: ["sitTilt", "listen"],
  thinking: ["think"],
  working: ["laptop"],
  reading: ["read"],
  browsing: ["laptop"],
  writing: ["typing"],
  noting: ["idea"],
  happy: ["jump", "sitHappy"],
  sleeping: ["sleep"],
  hello: ["wave", "sitHappy"],
};

/** Live-status label → mood. */
export function moodForLabel(label: string | undefined): RegiMood | undefined {
  if (!label) return undefined;
  if (label.startsWith("Navegando")) return "browsing";
  if (label.startsWith("Lendo")) return "reading";
  if (/^(Usando|Procurando|Delegando|Salvando)/.test(label)) return "working";
  if (label.startsWith("Anotando") || label.startsWith("Criando um alerta")) return "noting";
  if (label.startsWith("Escrevendo") || label.startsWith("Organizando")) return "writing";
  return "thinking";
}
