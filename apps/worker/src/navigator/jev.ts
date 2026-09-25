// Fast browser actions with TypeSafe's Jev decision model.
// Adapted from jev-browser by Joey Kudish (MIT, github.com/jkudish/jev-browser):
// code owns control flow, Jev picks the next element; one Jev call per step.
// Unlike jev-browser, this drives the session's existing page, so every request
// still passes the worker's public-network guard and the person can watch or take over.
import type { Page } from "playwright";
import { validatePublicUrl } from "../browser/network.ts";
import { WorkerError } from "../errors.ts";
import { type PageItem, pageItems, rankItems } from "./items.ts";

export interface JevConfig {
  apiKey: string;
  /** Any /v1/systemone host: Impossibl (default) or TypeSafe directly. */
  baseUrl: string;
  model: string;
  /** OpenAI-compatible chat model that writes text for search boxes and forms. */
  typeModel: string;
}

export function jevConfig(env = process.env): JevConfig | undefined {
  const apiKey = env.JEV_API_KEY ?? env.IMPOSSIBL_API_KEY;
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseUrl: (env.JEV_BASE_URL ?? "https://api.impossibl.com").replace(/\/+$/, ""),
    model: env.JEV_MODEL ?? "typesafe-ai/jev",
    typeModel: env.JEV_TYPE_MODEL ?? "zai/glm-5.3-flash",
  };
}

export interface JevStep {
  step: number;
  action: string | null;
  detail: string;
  outcome: string;
  confidence: number | null;
  goalDone: number;
}
export interface JevResult {
  status:
    | "done"
    | "goal_achieved"
    | "stuck"
    | "max_steps"
    | "timeout"
    | "needs_login"
    | "needs_human"
    | "ready_to_checkout"
    | "error";
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  steps: JevStep[];
  jevCalls: number;
  error?: string;
  /** Set when a password field blocks progress; the agent never types secrets. */
  login?: { origin: string };
  /** Cards found on the final page (image, title, price, link), read from the DOM. */
  items: PageItem[];
}

type Raw = {
  attr: string;
  tag: string;
  text: string;
  href: string;
  typeAttr: string;
  clickable: boolean;
  typeable: boolean;
  selectable: boolean;
  options?: string[];
};
type Element = {
  id: string;
  attr: string;
  kind: "click" | "type" | "select";
  description: string;
  options?: string[];
};
type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } };
type Answer = {
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number | null;
  noul?: number;
};

const MAX_ELEMENTS = 240; // Jev Choice supports up to 255 options.
/** Buttons that complete a purchase; matched loosely on purpose. */
export const PURCHASE_BUTTON =
  /\b(finalizar (compra|pedido)|fazer pedido|confirmar (compra|pedido)|comprar agora|pagar( agora)?|place (your )?order|buy now|pay now)\b/i;
const JUNK = new Set([
  "jump to content",
  "skip to content",
  "edit",
  "permalink",
  "permanent link",
  "cite this page",
  "donate",
  "view history",
]);

export function buildActionSpace(raw: Raw[]): Element[] {
  const seen = new Set<string>();
  const elements: Element[] = [];
  for (const el of raw) {
    if (elements.length >= MAX_ELEMENTS) break;
    const name = el.text.trim().toLowerCase();
    if (!name || name.length > 80 || JUNK.has(name) || /^[\d\s.,:;()[\]-]+$/.test(name)) continue;
    if (el.href && /^(#|javascript:|mailto:|tel:)/.test(el.href)) continue;
    if (el.typeable && (el.typeAttr === "password" || el.typeAttr === "file")) continue;
    if (el.href) {
      const key = el.href.split("#")[0] ?? el.href;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const id = `e${elements.length + 1}`;
    const label = el.text.slice(0, 60);
    const kind = el.typeable ? "type" : el.selectable ? "select" : "click";
    const tail = el.href ? ` -> ${el.href.replace(/^https?:\/\//, "").slice(0, 70)}` : "";
    elements.push({
      id,
      attr: el.attr,
      kind,
      description:
        kind === "type"
          ? `${el.tag} "${label}" (type into this field)`
          : kind === "select"
            ? `${el.tag} "${label}" (dropdown; a follow-up picks the option)`
            : `${el.tag} "${label}"${tail}`,
      options: kind === "select" ? el.options : undefined,
    });
  }
  return elements;
}

export function stepQuestions(
  elements: Element[],
  options: { canGoBack?: boolean; canScroll?: boolean } = {},
): Record<string, Question> {
  const { canGoBack = true, canScroll = true } = options;
  const criteria: Record<string, string> = {};
  for (const el of elements) criteria[`${el.kind}_${el.id}`] = el.description;
  if (canScroll) {
    criteria.scroll_down = "Scroll down one screen to reveal more of the page";
    criteria.scroll_up = "Scroll up one screen";
  }
  // Only offered once this task has navigated, so it never leaves the page it was given.
  if (canGoBack) criteria.back = "Go back to the previous page; this branch is wrong";
  criteria.done = "The task is already complete; stop here";
  return {
    action: {
      type: "choice",
      instructions: "Which single action best advances the task on the current page?",
      criteria,
    },
    goal_done: {
      type: "noul",
      instructions:
        "The task's goal has been achieved: the current page and history show the sought outcome",
      criteria: {
        true: "The page being viewed is the sought destination or shows the sought information",
        false: "The goal is not yet achieved",
      },
    },
    stuck: {
      type: "noul",
      instructions:
        "The actions so far are not making progress toward the task (repeats, loops, or no change)",
      criteria: {
        true: "Recent actions repeat or nothing changes; a different strategy is needed",
        false: "Progress is visible or the first steps are still reasonable",
      },
    },
  };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function askJev(
  config: JevConfig,
  state: unknown,
  questions: Record<string, Question>,
  signal: AbortSignal,
) {
  // Gateway hiccups (429/5xx) are common and brief: retry twice with backoff before giving up.
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(600 * 2 ** (attempt - 1), signal);
    response = await fetch(`${config.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, state, questions }),
      signal,
    });
    if (response.ok || !(response.status === 429 || response.status >= 500)) break;
  }
  if (!response?.ok)
    throw new WorkerError("JEV_FAILED", `Falha na requisição ao Jev (${response?.status}).`, 502);
  const body = (await response.json()) as { answers?: Record<string, Answer> };
  if (!body.answers) throw new WorkerError("JEV_FAILED", "O Jev não retornou respostas.", 502);
  return body.answers;
}

async function textToType(
  config: JevConfig,
  task: string,
  field: string,
  url: string,
  signal: AbortSignal,
) {
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.typeModel,
      // Without this the model spends its whole budget reasoning and returns no text.
      reasoning_effort: "none",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `A browser agent is performing this task: "${task}". It must type into the ${field} on ${url}. Reply with ONLY the exact text to type (for a search box: a short search query; no quotes, no explanation). Never invent passwords, card numbers or personal data not present in the task.`,
        },
      ],
    }),
    signal,
  });
  const body = response.ok
    ? ((await response.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string } }[];
      })
    : {};
  const text = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
  return (text || keywords(task)).slice(0, 500);
}

/** Last-resort search text: the task's content words, without instructions. */
export function keywords(task: string) {
  const stop =
    /^(search|find|for|the|and|then|stop|when|open|sort|by|results?|visible|page|list|is|are|a|an|to|of|on|in|buscar|busque|procure|encontre|me|o|a|os|as|de|do|da|e|no|na|para|quando|pare)$/i;
  return task
    .split(/[\s.,;:!?"'()]+/)
    .filter((word) => word && !stop.test(word))
    .slice(0, 6)
    .join(" ");
}

// Runs inside the page. Stamps candidates so the chosen one can be targeted by selector.
function extract(): Raw[] {
  for (const el of document.querySelectorAll("[data-jev-id]")) el.removeAttribute("data-jev-id");
  const out: Raw[] = [];
  const selector =
    'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="searchbox"], [role="textbox"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="combobox"]';
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (out.length >= 2000) break;
    if (!el.getClientRects().length) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const typeAttr = (el.getAttribute("type") || "").toLowerCase();
    const text = (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const clickable =
      tag === "a" ||
      tag === "button" ||
      tag === "summary" ||
      // Custom dropdowns, menus and tabs (e.g. a store's "sort by" list) use ARIA roles.
      [
        "button",
        "link",
        "option",
        "menuitem",
        "menuitemradio",
        "tab",
        "radio",
        "checkbox",
        "switch",
        "combobox",
      ].includes(role) ||
      ["submit", "button", "checkbox", "radio"].includes(typeAttr);
    const typeable =
      tag === "textarea" ||
      (tag === "input" &&
        !["submit", "button", "checkbox", "radio", "file", "hidden", "range", "password"].includes(
          typeAttr,
        )) ||
      role === "searchbox" ||
      role === "textbox";
    const selectable = tag === "select";
    if (!clickable && !typeable && !selectable) continue;
    const attr = `j${out.length + 1}`;
    el.setAttribute("data-jev-id", attr);
    out.push({
      attr,
      tag,
      text: text.slice(0, 80),
      href: tag === "a" ? el.getAttribute("href") || "" : "",
      typeAttr,
      clickable,
      typeable,
      selectable,
      options:
        tag === "select"
          ? Array.from((el as HTMLSelectElement).options)
              .map((o) => (o.label || o.value || "").trim())
              .filter(Boolean)
              .slice(0, 200)
          : undefined,
    });
  }
  return out;
}

async function observe(page: Page) {
  const data = await page
    .evaluate(() => ({
      length: document.body?.innerText?.length ?? 0,
      scrollY: window.scrollY,
      excerpt: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 1500),
      password: !!document.querySelector('input[type="password"]'),
      controls: document.querySelectorAll(
        'a[href], button, input, select, [role="option"], [role="menuitem"], [role="tab"]',
      ).length,
      // Bot checks are the person's to pass; the agent never attempts them. A passive
      // reCAPTCHA badge on an ordinary page is not a block: only a challenge page counts.
      challenge:
        !!document.querySelector('#challenge-form, iframe[src*="challenges.cloudflare.com"]') ||
        /unusual traffic|are you a robot|verify you are human|confirme que você é humano|por segurança, complete esta etapa|verificação de segurança|checking your browser|performing security verification|^just a moment|^um momento/im.test(
          document.body?.innerText?.slice(0, 3000) ?? "",
        ),
    }))
    .catch(() => ({
      length: 0,
      scrollY: 0,
      excerpt: "",
      password: false,
      challenge: false,
      controls: 0,
    }));
  return { url: page.url(), title: await page.title().catch(() => ""), ...data };
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => {});
  const deadline = Date.now() + 1500;
  let previous: string | null = null;
  while (Date.now() < deadline) {
    const print = await page
      .evaluate(
        () =>
          `${document.body?.innerText?.length ?? 0}:${document.querySelectorAll("a,button,input,select,textarea").length}`,
      )
      .catch(() => null);
    if (print !== null && print === previous) return;
    previous = print;
    await page.waitForTimeout(250);
  }
}

export async function runJevTask(
  page: Page,
  config: JevConfig,
  options: { task: string; text?: string; maxSteps?: number; maxSeconds?: number },
): Promise<JevResult> {
  const { task, text: given, maxSteps = 15, maxSeconds = 90 } = options;
  const signal = AbortSignal.timeout(maxSeconds * 1000);
  const steps: JevStep[] = [];
  const history: { step: number; action: string; outcome: string }[] = [];
  let status: JevResult["status"] = "max_steps";
  let jevCalls = 0;
  let error: string | undefined;
  let login: JevResult["login"];
  let last: { action: string; outcome: string } | undefined;
  try {
    for (let step = 1; step <= maxSteps; step++) {
      signal.throwIfAborted();
      const elements = buildActionSpace(await page.evaluate(extract));
      const before = await observe(page);
      if (before.challenge) {
        status = "needs_human";
        break;
      }
      jevCalls++;
      const answers = await askJev(
        config,
        {
          task,
          current_page: { url: before.url, title: before.title },
          page_text_excerpt: before.excerpt,
          interactive_elements: elements.map((e) => ({ id: e.id, description: e.description })),
          no_interactive_elements: elements.length === 0,
          history,
        },
        stepQuestions(elements, {
          canGoBack: history.some((entry) => entry.outcome.startsWith("navigated")),
          // After four scrolls in a row the page has shown what it has; pick or stop.
          canScroll:
            history.slice(-4).filter((entry) => entry.action.startsWith("scroll")).length < 4,
        }),
        signal,
      );
      const action = answers.action ?? {};
      const goalDone = answers.goal_done?.noul ?? 0;
      const stuck = answers.stuck?.noul ?? 0;
      let chosen = action.choice ?? "done";
      const base = { step, confidence: action.confidence ?? null, goalDone };
      // Stop gates run before acting, so a finished page is never clicked past.
      if (chosen === "done" || goalDone > 0.7) {
        steps.push({ ...base, action: null, detail: chosen, outcome: "goal reached" });
        status = chosen === "done" ? "done" : "goal_achieved";
        break;
      }
      if (stuck > 0.85 && step > 2) {
        steps.push({ ...base, action: null, detail: chosen, outcome: "stuck" });
        status = before.password ? "needs_login" : "stuck";
        break;
      }
      if (last?.action === chosen && last.outcome === "no visible change") {
        const alternate = Object.entries(action.probabilities ?? {})
          .sort((a, b) => b[1] - a[1])
          .find(([option, p]) => option !== chosen && option !== "back" && p > 0);
        if (alternate) chosen = alternate[0];
      }
      const element = elements.find((e) => chosen === `${e.kind}_${e.id}`);
      // On a sign-in page the only safe typing is the person's own, through the private card.
      if (before.password && element?.kind === "type") {
        steps.push({ ...base, action: null, detail: chosen, outcome: "sign-in form" });
        status = "needs_login";
        break;
      }
      // Placing an order is never an automatic click: it needs the person's approval
      // through request_checkout, which re-checks the page before clicking.
      if (element?.kind === "click" && PURCHASE_BUTTON.test(element.description)) {
        steps.push({
          ...base,
          action: null,
          detail: element.description,
          outcome: "purchase button",
        });
        status = "ready_to_checkout";
        break;
      }
      const selector = element ? `[data-jev-id="${element.attr}"]` : "";
      let detail = element?.description ?? chosen;
      let failed = false;
      try {
        if (chosen === "back") await page.goBack({ timeout: 10_000 });
        else if (chosen === "scroll_down" || chosen === "scroll_up")
          await page.mouse.wheel(0, chosen === "scroll_down" ? 600 : -600);
        else if (!element) throw new Error(`unknown action ${chosen}`);
        else if (element.kind === "type") {
          // The main agent knows exactly what to search for; the model only guesses.
          const text =
            given ?? (await textToType(config, task, element.description, page.url(), signal));
          await page.fill(selector, text, { timeout: 4000 });
          await page.press(selector, "Enter", { timeout: 4000 });
          detail = `typed "${text}" into ${element.description}`;
        } else if (element.kind === "select") {
          const options = element.options ?? [];
          const criteria = Object.fromEntries(options.map((o, i) => [`o${i}`, o.slice(0, 80)]));
          jevCalls++;
          const pick = await askJev(
            config,
            { task, dropdown: element.description, options },
            {
              option: {
                type: "choice",
                instructions: `Which option should be selected in "${element.description}"?`,
                criteria,
              },
            },
            signal,
          );
          const label = options[Number((pick.option?.choice ?? "o0").slice(1))] ?? options[0];
          if (!label) throw new Error("dropdown has no options");
          await page.selectOption(selector, { label });
          detail = `selected "${label}"`;
        } else await page.click(selector, { timeout: 4000 });
      } catch (actionError) {
        signal.throwIfAborted();
        failed = true;
        detail = `${detail}: ${actionError instanceof Error ? actionError.message.slice(0, 160) : "failed"}`;
      }
      await settle(page);
      const after = await observe(page);
      const outcome = failed
        ? "action failed"
        : after.url !== before.url
          ? `navigated to ${after.url}`
          : after.title !== before.title
            ? `page changed: "${after.title}"`
            : Math.abs(after.length - before.length) > 50
              ? "page content changed"
              : Math.abs(after.scrollY - before.scrollY) > 40
                ? "scrolled"
                : after.controls > before.controls
                  ? "new options appeared (a menu or list opened)"
                  : "no visible change";
      last = { action: chosen, outcome };
      history.push({ step, action: chosen, outcome });
      steps.push({ ...base, action: chosen, detail, outcome });
      if (after.challenge) {
        status = "needs_human";
        break;
      }
      // A login wall is the person's to pass: hand back instead of guessing.
      if (after.password && !before.password) {
        status = "needs_login";
        break;
      }
    }
  } catch (runError) {
    status = signal.aborted ? "timeout" : "error";
    error =
      runError instanceof Error ? runError.message.slice(0, 300) : "A tarefa de navegador falhou";
  }
  const final = await page
    .evaluate(() => ({ text: document.body?.innerText ?? "", password: false }))
    .catch(() => ({ text: "", password: false }));
  const url = page.url();
  // The guard also covers where the task ended, not just each request along the way.
  if (url !== "about:blank") await validatePublicUrl(url);
  if (status === "needs_login") login = { origin: new URL(url).origin };
  const found = await pageItems(page, 24);
  const items = rankItems(found, task, url)
    .slice(0, 12)
    .filter((item) => {
      try {
        return new URL(item.url).protocol === "https:";
      } catch {
        return false;
      }
    });
  return {
    items,
    status,
    url,
    title: (await page.title().catch(() => "")).slice(0, 300),
    text: final.text.slice(0, 12_000),
    truncated: final.text.length > 12_000,
    steps,
    jevCalls,
    error,
    login,
  };
}
