// Private sign-in: the person types credentials into an OpenMuse card and the worker
// fills the page form directly. Nothing is stored, logged or returned, and the model
// never sees the values. Adapted from an earlier BrowserSecureLogin, for Playwright.
import { randomUUID } from "node:crypto";
import type { JSHandle, Page, Request } from "playwright";
import { WorkerError } from "../errors.ts";

export interface LoginRequest {
  id: string;
  origin: string;
  expiresAt: string;
}
type Pending = LoginRequest & { form: JSHandle; timer: NodeJS.Timeout; submitting: boolean };

const TTL_MS = 10 * 60_000;

// Runs in the page: pins the one unambiguous login form, or explains why not.
function findForm() {
  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    return (
      !!(el as HTMLElement).getClientRects().length &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const passwords = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    .filter(visible)
    .filter((el) => el.autocomplete !== "new-password");
  if (passwords.length !== 1) return { error: "one password field" } as const;
  const passwordInput = passwords[0] as HTMLInputElement;
  const scope: ParentNode = passwordInput.form ?? document;
  const users = [
    ...scope.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[type="text"], input:not([type])',
    ),
  ].filter(visible);
  if (users.length !== 1) return { error: "one username field" } as const;
  const buttons = [
    ...scope.querySelectorAll<HTMLElement>(
      'button[type="submit"], input[type="submit"], button:not([type])',
    ),
  ].filter(visible);
  if (buttons.length !== 1) return { error: "one sign-in button" } as const;
  return {
    form: {
      username: users[0],
      passwordInput,
      button: buttons[0],
      href: location.href,
      document,
    },
  } as const;
}

// Runs in the page with the credentials as arguments, never as generated code.
async function fill(
  pinned: {
    username: HTMLInputElement;
    passwordInput: HTMLInputElement;
    button: HTMLElement;
    href: string;
    document: Document;
  },
  values: [string, string],
) {
  const valid = () =>
    pinned.document === document &&
    location.href === pinned.href &&
    location.protocol === "https:" &&
    pinned.username.isConnected &&
    pinned.passwordInput.isConnected &&
    pinned.button.isConnected;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter || !valid()) return false;
  for (const [el, value] of [
    [pinned.username, values[0]],
    [pinned.passwordInput, values[1]],
  ] as const) {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!valid()) return false;
  pinned.button.click();
  return true;
}

export function createLoginManager() {
  const pending = new Map<string, Pending>();
  const finish = (sessionId: string, state: Pending) => {
    clearTimeout(state.timer);
    if (pending.get(sessionId) === state) pending.delete(sessionId);
    void state.form.dispose().catch(() => {});
  };
  return {
    get: (sessionId: string): LoginRequest | undefined => {
      const state = pending.get(sessionId);
      return state && { id: state.id, origin: state.origin, expiresAt: state.expiresAt };
    },
    busy: (sessionId: string) => pending.has(sessionId),
    async request(sessionId: string, page: Page): Promise<LoginRequest> {
      const existing = pending.get(sessionId);
      if (existing)
        return { id: existing.id, origin: existing.origin, expiresAt: existing.expiresAt };
      const url = new URL(page.url());
      if (url.protocol !== "https:")
        throw new WorkerError(
          "LOGIN_UNAVAILABLE",
          "O login privado precisa de uma página HTTPS.",
          409,
        );
      // Dev runs through tsx, which wraps named inner functions in a __name helper that
      // does not exist in the page; a no-op shim keeps the page functions identical.
      await page.evaluate("globalThis.__name ??= (fn) => fn");
      let found: JSHandle | undefined;
      for (let attempt = 0; attempt < 3 && !found; attempt++) {
        const handle = await page.evaluateHandle(findForm);
        if (await handle.evaluate((value) => "form" in value)) found = handle;
        else {
          await handle.dispose();
          await page.waitForTimeout(500);
        }
      }
      if (!found)
        throw new WorkerError(
          "LOGIN_UNAVAILABLE",
          "Não foi encontrado um único formulário de login. Abra o navegador e faça login você mesmo.",
          409,
        );
      const form = await found.evaluateHandle((value) => ("form" in value ? value.form : null));
      await found.dispose();
      const state: Pending = {
        id: randomUUID(),
        origin: url.origin,
        expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
        form,
        submitting: false,
        timer: setTimeout(() => finish(sessionId, state), TTL_MS),
      };
      state.timer.unref();
      pending.set(sessionId, state);
      return { id: state.id, origin: state.origin, expiresAt: state.expiresAt };
    },
    async respond(
      sessionId: string,
      page: Page,
      input: { requestId: unknown; action: unknown; username?: unknown; password?: unknown },
    ) {
      const state = pending.get(sessionId);
      if (!state || state.id !== input.requestId || state.submitting)
        throw new WorkerError(
          "LOGIN_NOT_FOUND",
          "Esta solicitação de login não está mais aberta.",
          409,
        );
      if (input.action === "cancel") {
        finish(sessionId, state);
        return { ok: false, cancelled: true };
      }
      const { username, password } = input;
      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        !username ||
        !password ||
        username.length > 2048 ||
        password.length > 4096
      )
        throw new WorkerError("INVALID_LOGIN", "Informe um usuário e uma senha.");
      if (new URL(page.url()).origin !== state.origin) {
        finish(sessionId, state);
        throw new WorkerError("LOGIN_EXPIRED", "A página mudou. Peça um novo login.", 409);
      }
      state.submitting = true;
      let sent = false;
      // Success means a POST actually carried both values, not just that a button was clicked.
      const watch = (request: Request) => {
        if (request.method() !== "POST") return;
        const body = request.postData() ?? "";
        const decoded = (() => {
          try {
            return decodeURIComponent(body.replace(/\+/g, " "));
          } catch {
            return body;
          }
        })();
        if (
          (body.includes(username) || decoded.includes(username)) &&
          (body.includes(password) || decoded.includes(password))
        )
          sent = true;
      };
      page.on("request", watch);
      try {
        await page.evaluate("globalThis.__name ??= (fn) => fn");
        const startUrl = page.url();
        const clicked = await state.form.evaluate(fill, [username, password] as [string, string]);
        // Either the values left in a POST, or the page moved past its sign-in form
        // (sites that check credentials in JavaScript never POST the form).
        const passed = async () =>
          sent ||
          (page.url() !== startUrl &&
            !(await page
              .locator('input[type="password"]:visible')
              .count()
              .catch(() => 1)));
        const deadline = Date.now() + 15_000;
        while (clicked && !(await passed()) && Date.now() < deadline)
          await page.waitForTimeout(250);
        return { ok: clicked && (await passed()) };
      } catch {
        return { ok: false };
      } finally {
        page.off("request", watch);
        finish(sessionId, state);
      }
    },
    cancel(sessionId: string) {
      const state = pending.get(sessionId);
      if (state) finish(sessionId, state);
    },
  };
}
