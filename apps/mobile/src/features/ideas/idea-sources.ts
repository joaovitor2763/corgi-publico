// Ideias → Fontes: what the server keeps (a list of sources, apps/server/src/ideas/sources.ts)
// ⇄ what the sheet shows (one card per app, a switch per account, Gmail search, Slack slices).

export type SourceApp = "googlecalendar" | "gmail" | "slack" | "instagram";

export interface IdeaSource {
  app: SourceApp;
  /** A connected account id; omitted = every account of the app. */
  account?: string;
  enabled: boolean;
  /** What the person asked for in their words (the filters were made from it). */
  note?: string;
  query?: string;
  channels?: string[];
  mentions?: boolean;
  dms?: boolean;
}

export interface SourceAppInfo {
  app: SourceApp;
  name: string;
  detail: string;
  connected: boolean;
  accounts: { id: string; label: string }[];
}

export interface IdeaSourcesResponse {
  sources: IdeaSource[];
  custom: boolean;
  apps: SourceAppInfo[];
}

export interface AppChoice {
  info: SourceAppInfo;
  on: boolean;
  /** Chosen account ids; only meaningful when the app has more than one account. */
  chosen: string[];
  note: string;
  query: string;
  channels: string[];
  mentions: boolean;
  dms: boolean;
  /** Saved sources of an app that isn't connected now: kept as they are. */
  kept: IdeaSource[];
}

export type SourcesState = AppChoice[];

export const SHORT_NAMES: Record<SourceApp, string> = {
  googlecalendar: "Agenda",
  gmail: "Gmail",
  slack: "Slack",
  instagram: "Instagram",
};

export function toState(apps: SourceAppInfo[], sources: IdeaSource[]): SourcesState {
  return apps.map((info) => {
    const own = sources.filter((source) => source.app === info.app);
    const live = own.filter((source) => source.enabled !== false);
    const ids = info.accounts.map((account) => account.id);
    const chosen = live.some((source) => !source.account)
      ? ids
      : ids.filter((id) => live.some((source) => source.account === id));
    const settings = live[0] ?? own[0];
    return {
      info,
      on: info.connected && (ids.length > 1 ? chosen.length > 0 : live.length > 0),
      chosen: ids.length > 1 ? chosen : ids,
      note: settings?.note ?? "",
      query: settings?.query ?? "",
      channels: settings?.channels ?? [],
      mentions: settings?.mentions !== false,
      dms: settings?.dms !== false,
      kept: info.connected ? [] : own,
    };
  });
}

function extras(choice: AppChoice): Partial<IdeaSource> {
  const { app } = choice.info;
  const note = choice.note.trim() ? { note: choice.note.trim() } : {};
  if (app === "gmail")
    return { ...note, ...(choice.query.trim() ? { query: choice.query.trim() } : {}) };
  if (app === "slack")
    return {
      ...note,
      mentions: choice.mentions,
      dms: choice.dms,
      ...(choice.channels.length ? { channels: choice.channels } : {}),
    };
  return {};
}

export function toSources(state: SourcesState): IdeaSource[] {
  return state.flatMap((choice): IdeaSource[] => {
    const { app, connected, accounts } = choice.info;
    if (!connected) return choice.kept;
    const settings = extras(choice);
    if (!choice.on) {
      // Off, but keep what was typed (a Gmail search, Slack channels) for when it's back on.
      const typed = Boolean(settings.query || settings.channels);
      return typed ? [{ app, enabled: false, ...settings }] : [];
    }
    const chosen = accounts.filter((account) => choice.chosen.includes(account.id));
    if (accounts.length < 2 || chosen.length === accounts.length)
      return [{ app, enabled: true, ...settings }];
    return chosen.map((account) => ({ app, account: account.id, enabled: true, ...settings }));
  });
}

export function setApp(state: SourcesState, app: SourceApp, on: boolean): SourcesState {
  return state.map((choice) =>
    choice.info.app !== app
      ? choice
      : {
          ...choice,
          on,
          chosen:
            on && !choice.chosen.length ? choice.info.accounts.map((a) => a.id) : choice.chosen,
        },
  );
}

export function setAccount(
  state: SourcesState,
  app: SourceApp,
  id: string,
  on: boolean,
): SourcesState {
  return state.map((choice) => {
    if (choice.info.app !== app) return choice;
    const chosen = on
      ? choice.info.accounts.map((a) => a.id).filter((a) => a === id || choice.chosen.includes(a))
      : choice.chosen.filter((a) => a !== id);
    return { ...choice, chosen, on: chosen.length > 0 };
  });
}

export function update(
  state: SourcesState,
  app: SourceApp,
  patch: Partial<Pick<AppChoice, "note" | "query" | "channels" | "mentions" | "dms">>,
): SourcesState {
  return state.map((choice) => (choice.info.app === app ? { ...choice, ...patch } : choice));
}

/** "#Vendas " → "vendas"; empty when nothing is left. */
export function channelName(raw: string) {
  return raw.trim().replace(/^#+/, "").trim().toLowerCase();
}

export function addChannel(channels: string[], raw: string) {
  const name = channelName(raw);
  return !name || channels.includes(name) ? channels : [...channels, name];
}

/** The apps Ideas reads today, for the "O que o Corgi observa" line. */
export function watching(state: SourcesState) {
  return state.filter((choice) => choice.on).map((choice) => SHORT_NAMES[choice.info.app]);
}
