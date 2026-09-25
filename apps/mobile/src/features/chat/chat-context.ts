import { createContext } from "react";

/**
 * Lets a card continue the conversation (after a private sign-in, or to ask for an
 * item's details). Undefined outside a chat, where cards fall back to opening links.
 */
export const ChatSendContext = createContext<((text: string) => void) | undefined>(undefined);
