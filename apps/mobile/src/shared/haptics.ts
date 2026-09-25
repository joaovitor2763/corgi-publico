// Light touch feedback for the moments that matter (send, copy, record); silent where unsupported.
import * as Haptics from "expo-haptics";

export const tap = () =>
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
export const success = () =>
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
