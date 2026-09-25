import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { RegiClipPlayer } from "./RegiClipPlayer";
import type { Expression } from "./regi-clips";

const TOUR: Expression[] = [
  "neutral",
  "lookDown",
  "neutral",
  "think",
  "smile",
  "laptop",
  "neutral",
  "doze",
];

/** Design review (web: /regi): Regi's clips at app sizes, switching state every few seconds. */
export function RegiGallery() {
  const [step, setStep] = useState(0);
  const target = TOUR[step % TOUR.length] ?? "neutral";
  useEffect(() => {
    const timer = setInterval(() => setStep((n) => n + 1), 6000);
    return () => clearInterval(timer);
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 18, backgroundColor: "#FAFAFB" }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Regi · {target}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 28 }}>
        {[160, 96, 61, 44].map((size) => (
          <View key={size} style={{ width: size, height: size }}>
            <RegiClipPlayer size={size} target={target} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
