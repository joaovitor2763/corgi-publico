// Some app tools answer with a thin summary the model then can't work from, and it keeps calling
// them anyway (they're the obvious choice). Instead of hoping the prompt steers it elsewhere, the
// server completes those results right after the call.
type Run = (slug: string, args: Record<string, unknown>) => Promise<unknown>;

const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

/**
 * GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS returns titles and times only: no description, no
 * attachments (meeting notes, transcripts), no Meet link, no guests' answers. Fill those in for
 * the primary calendar's events from one GOOGLECALENDAR_EVENTS_LIST call over the same range.
 */
async function calendarDetails(args: Record<string, unknown>, raw: unknown, run: Run) {
  const data = record(raw);
  // "Minimal response" puts the events in summary_view and leaves events empty.
  const list = (value: unknown) =>
    Array.isArray(value) && value.length ? (value as Record<string, unknown>[]) : undefined;
  const events = list(data?.events) ?? list(data?.summary_view) ?? [];
  if (!events.length) return raw;
  const full = record(
    await run("GOOGLECALENDAR_EVENTS_LIST", {
      calendarId: "primary",
      ...(args.time_min ? { timeMin: args.time_min } : {}),
      ...(args.time_max ? { timeMax: args.time_max } : {}),
      ...(args.q ? { q: args.q } : {}),
      singleEvents: true,
      maxResults: 250,
    }).catch(() => undefined),
  );
  const items = (full?.items ?? record(full?.response_data)?.items) as
    | Record<string, unknown>[]
    | undefined;
  if (!Array.isArray(items)) return raw;
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const detailed = events.map((event) => {
    const match = byId.get(String(event.event_id));
    if (!match) return event;
    const attendees = Array.isArray(match.attendees)
      ? (match.attendees as Record<string, unknown>[]).map((a) => ({
          email: a.email,
          name: a.displayName,
          response: a.responseStatus,
          ...(a.self ? { you: true } : {}),
          ...(a.organizer ? { organizer: true } : {}),
        }))
      : undefined;
    return {
      ...event,
      description: match.description,
      location: match.location,
      meet: match.hangoutLink,
      attachments: match.attachments,
      attendees,
      organizer: record(match.organizer)?.email,
    };
  });
  // summary_view repeats the same events; the detailed list replaces both.
  const { summary_view: _summary, ...rest } = data as Record<string, unknown>;
  return { ...rest, events: detailed };
}

/**
 * GOOGLEDOCS_GET_DOCUMENT_BY_ID returns the document's layout structure (tens of KB of styles
 * around the words). What the model needs is the text: the plain-text read of the same Doc.
 */
async function docText(args: Record<string, unknown>, raw: unknown, run: Run) {
  const id = args.document_id ?? args.id ?? record(raw)?.documentId;
  if (typeof id !== "string") return raw;
  const text = record(await run("GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", { document_id: id }));
  if (!text || typeof text.plain_text !== "string") return raw;
  return { title: record(raw)?.title, ...text };
}

const ENRICH: Record<
  string,
  (args: Record<string, unknown>, raw: unknown, run: Run) => Promise<unknown>
> = {
  GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS: calendarDetails,
  GOOGLEDOCS_GET_DOCUMENT_BY_ID: docText,
};

/** The tool's result, completed when it's one of the thin ones above. Never fails the read. */
export async function enrich(slug: string, args: Record<string, unknown>, raw: unknown, run: Run) {
  const complete = ENRICH[slug];
  if (!complete) return raw;
  return complete(args, raw, run).catch(() => raw);
}
