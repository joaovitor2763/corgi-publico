// How tasks read in Atividade and in the list of conversations: short, in Portuguese, no raw URLs.

/** A page watch in words: "Avisar quando o preço em amazon.com.br ficar abaixo de 80". */
export function watchPrompt(input: { url: string; condition: string; value?: string }) {
  const host = hostOf(input.url) ?? input.url;
  if (input.condition === "price_below")
    return `Avisar quando o preço em ${host} ficar abaixo de ${input.value}`;
  if (input.condition === "contains") return `Avisar quando ${host} mostrar “${input.value}”`;
  return `Avisar quando ${host} mudar`;
}

/**
 * A task's title when nobody gave one: the request's first sentence, links shown as their site,
 * cut at a word near 48 characters.
 */
export function shortTitle(prompt: string, max = 48) {
  const first =
    prompt
      .replace(/https?:\/\/\S+/g, (url) => hostOf(url) ?? url)
      .split(/\n|(?<=[.!?])\s/)[0]
      ?.replace(/\s+/g, " ")
      .replace(/^(por favor|pf|pfv)[,:]?\s+/i, "")
      .trim() ?? "";
  const text = first.charAt(0).toUpperCase() + first.slice(1);
  if (text.length <= max) return text.replace(/[.:;,]$/, "") || "Tarefa";
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.:;,]$/, "")}…`;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
