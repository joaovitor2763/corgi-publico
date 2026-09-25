import { RegiAvatar } from "./agent-avatar";

/** Regi, large, for roomy moments (an empty chat). */
export function RegiHero({ size = 150 }: { size?: number }) {
  return <RegiAvatar size={size} />;
}
