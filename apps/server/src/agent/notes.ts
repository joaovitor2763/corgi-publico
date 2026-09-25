// write_notes: the agent's working notes for one conversation, shown to it every turn. About the
// job (ids, links, what was sent or approved, where it stopped), not the person: that is memory.
import { z } from "zod";

export const NOTES_MAX = 4000;

export const notesInput = z.object({
  mode: z.enum(["append", "replace"]).default("append"),
  text: z.string().trim().min(1).max(NOTES_MAX),
});

export const notesDescription =
  "Your working notes for this conversation, shown to you every turn. Keep what you'll need later and might lose: ids and links, names, numbers, what was sent/created/approved, decisions and why, where you stopped. append adds lines; replace rewrites everything (use it to tidy). Max 4000 characters. Not for facts about the person (remember_fact).";

export function applyNotes(previous: string, input: z.infer<typeof notesInput>) {
  const notes =
    input.mode === "replace" ? input.text : [previous, input.text].filter(Boolean).join("\n");
  if (notes.length > NOTES_MAX)
    return {
      notes: previous,
      rejected: `Notes are full (${NOTES_MAX} characters): call again with mode replace and a shorter version.`,
    };
  return { notes };
}

/** The notes as the model sees them each turn (its own words, still data). */
export function notesContext(notes: string) {
  return notes.trim() ? `# Your working notes (this conversation)\n${notes.trim()}` : "";
}
