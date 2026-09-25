// Whether the person is typing in the chat composer. The tab bar hides meanwhile, so the
// keyboard and the conversation get the room (it comes back when the composer loses focus).
import { useSyncExternalStore } from "react";

let focused = false;
const listeners = new Set<() => void>();

export function setComposerFocused(next: boolean) {
  if (next === focused) return;
  focused = next;
  for (const listener of listeners) listener();
}

export function useComposerFocused() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => focused,
    () => false,
  );
}
