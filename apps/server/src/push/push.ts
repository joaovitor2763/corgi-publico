// Web Push: the home-screen web app gets notifications on the phone (iOS 16.4+), no native app.
// Keys are made on first use and kept in the store, so nothing needs configuring per person.
import { createHash } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import type { AgentTask } from "../../../../packages/domain/src/agent.ts";
import type { ActionProposal } from "../../../../packages/domain/src/index.ts";
import type { Store } from "../platform/db.ts";

export const CATEGORIES = ["approvals", "questions", "done", "problems"] as const;
export type PushCategory = (typeof CATEGORIES)[number];
export type PushPrefs = Record<PushCategory, boolean>;
const DEFAULT_PREFS: PushPrefs = { approvals: true, questions: true, done: true, problems: true };

export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type Subscription = z.infer<typeof subscriptionSchema> & {
  id: string;
  device?: string;
  createdAt: string;
};

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap goes, inside the app ("/?open=task:…"). */
  url?: string;
  category: PushCategory;
  /** Same tag replaces the previous notification (a task's newest state). */
  tag?: string;
}

type Send = typeof webpush.sendNotification;
const KIND = "push-subscriptions";
const idOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

export class PushService {
  private keys?: Promise<{ publicKey: string; privateKey: string }>;
  constructor(
    private readonly db: Store,
    /** A mailto: or https: contact the push services may use (the server's own address). */
    private readonly contact: string,
    private readonly send: Send = webpush.sendNotification.bind(webpush),
  ) {}

  /** The VAPID key pair: made once, then read back. */
  vapid() {
    this.keys ??= (async () => {
      const saved = await this.db.get<{ publicKey: string; privateKey: string }>(
        "system",
        "push-vapid",
        "keys",
      );
      if (saved) return saved;
      const made = webpush.generateVAPIDKeys();
      await this.db.insertIfAbsent("system", "push-vapid", { id: "keys", ...made });
      return (
        (await this.db.get<{ publicKey: string; privateKey: string }>(
          "system",
          "push-vapid",
          "keys",
        )) ?? made
      );
    })();
    return this.keys;
  }

  async subscribe(owner: string, raw: unknown, device?: string) {
    const parsed = subscriptionSchema.parse(raw);
    const value: Subscription = {
      ...parsed,
      id: idOf(parsed.endpoint),
      ...(device ? { device: device.slice(0, 80) } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.db.put(owner, KIND, value);
    return { id: value.id };
  }

  async unsubscribe(owner: string, endpoint: string) {
    await this.db.take(owner, KIND, idOf(endpoint)).catch(() => undefined);
  }

  async devices(owner: string) {
    return (await this.db.list<Subscription>(owner, KIND)).map(({ id, device, createdAt }) => ({
      id,
      device,
      createdAt,
    }));
  }

  async prefs(owner: string): Promise<PushPrefs> {
    const saved = await this.db.get<Partial<PushPrefs>>(owner, "agent-settings", "push");
    return { ...DEFAULT_PREFS, ...(saved ?? {}) };
  }

  async setPrefs(owner: string, raw: unknown) {
    const patch = z
      .object(Object.fromEntries(CATEGORIES.map((c) => [c, z.boolean()])))
      .partial()
      .parse(raw);
    const next = { ...(await this.prefs(owner)), ...patch };
    await this.db.put(owner, "agent-settings", { id: "push", ...next });
    return next;
  }

  /** What needs the person right now: the number on the app icon. */
  async pending(owner: string) {
    const now = Date.now();
    const [actions, tasks] = await Promise.all([
      this.db.list<ActionProposal>(owner, "actions"),
      this.db.list<AgentTask>(owner, "tasks"),
    ]);
    return (
      actions.filter((a) => a.status === "awaiting_review" && Date.parse(a.expiresAt) > now)
        .length + tasks.filter((t) => t.status === "waiting_input" && !t.archivedAt).length
    );
  }

  /** Sends to every device of the person, if they want this kind; drops devices that left. */
  async notify(owner: string, message: PushMessage) {
    if (!(await this.prefs(owner))[message.category]) return 0;
    const devices = await this.db.list<Subscription>(owner, KIND);
    if (!devices.length) return 0;
    const { publicKey, privateKey } = await this.vapid();
    const payload = JSON.stringify({
      title: message.title,
      body: message.body.slice(0, 240),
      url: message.url ?? "/",
      tag: message.tag,
      badge: await this.pending(owner),
    });
    let sent = 0;
    await Promise.all(
      devices.map(async (device) => {
        try {
          await this.send({ endpoint: device.endpoint, keys: device.keys }, payload, {
            vapidDetails: { subject: this.contact, publicKey, privateKey },
            TTL: 24 * 60 * 60,
            urgency:
              message.category === "approvals" || message.category === "questions"
                ? "high"
                : "normal",
          });
          sent++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // The phone removed the app or turned notifications off: forget that device.
          if (status === 404 || status === 410)
            await this.db.take(owner, KIND, device.id).catch(() => {});
        }
      }),
    );
    return sent;
  }
}

/** Which push a new notification becomes (its key says what it is about). */
export function pushFor(note: {
  title: string;
  body: string;
  taskId?: string;
  status?: string;
  key?: string;
}): PushMessage | undefined {
  const url = note.taskId ? `/?open=${encodeURIComponent(`task:${note.taskId}`)}` : "/";
  const tag = note.taskId ? `task:${note.taskId}` : undefined;
  const category: PushCategory | undefined = note.key?.startsWith("review:")
    ? "approvals"
    : note.key?.startsWith("input:")
      ? "questions"
      : note.status === "done"
        ? "done"
        : note.status === "blocked"
          ? "problems"
          : undefined;
  if (!category) return undefined;
  return { title: note.title, body: note.body, url, category, tag };
}
