// The @skill token being typed in the composer (pure: tested without React Native).

/** The "@partial" being typed at the end of the draft, or undefined. */
export function skillQuery(draft: string) {
  return draft.match(/(?:^|\s)@([a-z0-9-]*)$/i)?.[1]?.toLowerCase();
}

/** Replaces the "@partial" at the end of the draft with the chosen skill. */
export function insertSkill(draft: string, name: string) {
  return draft.replace(/@([a-z0-9-]*)$/i, `@${name} `);
}
