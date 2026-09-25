import {
  AlignLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  Mail as MailIcon,
  MapPin,
  Reply,
  RotateCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, Text, View } from "react-native";
import {
  type ActionProposal,
  type ActivityEntry,
  type Artifact,
  type BrowserSession,
  type CalendarEvent,
  type EmailDraft,
  type EventDraft,
  emailDraftSchema,
  eventDraftSchema,
  type Mail,
  type ProposalInput,
} from "../../../../packages/domain/src";
import { NotificationsSheet } from "../features/activity/notifications-sheet";
import { TaskDetail } from "../features/activity/tasks";
import { GuardNotice, useRiskGate } from "../features/approvals/guard-notice";
import BrowserConsole from "../features/browser/BrowserConsole";
import { browserAddress, browserSite } from "../features/browser/browser-address";
import {
  actionApp,
  actionState,
  actionSummary,
  argumentRows,
  DONE_LINE,
  eventSummary,
  relativeTime,
  resultLine,
  resultLink,
  statusState,
  stepDetail,
  zoneLabel,
} from "../features/chat/action-summary";
import { StatusDot, StatusPill, toneColors } from "../features/chat/action-timeline";
import { ComputerSheet } from "../features/computer/computer";
import { shareFile } from "../features/files/share-file";
import { FuzziesSheet } from "../features/fuzzies/fuzzies-sheet";
import { MemorySheet } from "../features/memory/memory-sheet";
import { ModelSheet } from "../features/settings/model-sheet";
import { PushSheet } from "../features/settings/push-sheet";
import DateTimeEditor from "../shared/DateTimeEditor";
import { localDateTime, zonedInstant } from "../shared/date-time";
import { statusLabel } from "../shared/format";
import PdfReader from "../shared/PdfReader";
import RemoteImage from "../shared/RemoteImage";
import { isFreshSignedUrl } from "../shared/signed-url";
import {
  Button,
  Card,
  CheckRow,
  colors,
  dateLabel,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  resultSummary,
  SectionHeading,
  Sheet,
  s,
  timeLabel,
} from "../shared/ui";
import { type Detail, useWorkspace } from "../shared/workspace";
export function Details({ detail }: { detail: Detail }) {
  const { close, navigate } = useWorkspace();
  if (detail.type === "computer") return <ComputerSheet />;
  if (detail.type === "task") return <TaskDetail taskId={detail.taskId} />;
  if (detail.type === "notifications") return <NotificationsSheet />;
  if (detail.type === "push") return <PushSheet onClose={close} />;
  if (detail.type === "memory") return <MemorySheet onClose={close} />;
  if (detail.type === "fuzzies") return <FuzziesSheet onClose={close} />;
  if (detail.type === "model") return <ModelSheet onClose={close} />;
  if (detail.type === "mail") return <MailDetail mail={detail.mail} />;
  if (detail.type === "email") return <EmailEditor draft={detail.draft} />;
  if (detail.type === "event")
    return <EventEditor event={detail.event} draft={detail.draft} neighbors={detail.neighbors} />;
  if (detail.type === "file") return <FileDetail file={detail.file} />;
  if (detail.type === "review") return <ReviewDetail initial={detail.action} />;
  if (detail.type === "browser") return <BrowserDetail initial={detail.browser} />;
  return (
    <Sheet title="Seu espaço" subtitle="Um cantinho para tudo." onClose={close}>
      {[
        { section: "mail" as const, title: "E-mail", icon: MailIcon },
        { section: "calendar" as const, title: "Agenda", icon: CalendarDays },
        { section: "browser" as const, title: "Navegador", icon: Globe2 },
        { section: "files" as const, title: "Arquivos", icon: FileText },
        { section: "activity" as const, title: "Atividade", icon: Clock3 },
        { section: "connections" as const, title: "Conexões", icon: ShieldCheck },
      ].map((item) => (
        <LinkRow
          key={item.section}
          title={item.title}
          icon={item.icon}
          onPress={() => {
            navigate(item.section);
            close();
          }}
        />
      ))}
    </Sheet>
  );
}
function MailDetail({ mail: m }: { mail: Mail }) {
  const { workspace: w, api, refresh, open, close } = useWorkspace();
  const [error, setError] = useState("");
  const [importing, setImporting] = useState("");
  async function importAttachment(reference: string) {
    setError("");
    setImporting(reference);
    try {
      const file = await api.request<Artifact>("/api/mail/import-attachment", { reference });
      await refresh();
      open({ type: "file", file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting("");
    }
  }
  const [thread, setThread] = useState<Mail[]>([m]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<Mail[]>(`/api/mail/threads/${encodeURIComponent(m.threadId)}`)
      .then((items) => {
        if (active) setThread(items.sort((a, b) => a.date.localeCompare(b.date)));
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, m.threadId, retry]);
  return (
    <Sheet
      title={m.subject}
      subtitle={`${thread.length} mensage${thread.length === 1 ? "m" : "ns"} nesta conversa`}
      onClose={close}
    >
      {loading && (
        <View style={[s.row, { gap: 10, paddingBottom: 20 }]}>
          <ActivityIndicator color={colors.blueDark} />
          <Text style={s.muted}>Carregando a conversa…</Text>
        </View>
      )}
      {thread.map((message) => (
        <Card key={message.id} style={{ marginBottom: 16 }}>
          <View style={s.between}>
            <View style={{ gap: 4, flex: 1 }}>
              <Text style={s.heading}>{message.sender}</Text>
              <Text style={s.small}>{message.from}</Text>
              <Text style={s.small}>Para: {message.to.join(", ")}</Text>
            </View>
            <Text style={s.small}>
              {dateLabel(message.date)} · {timeLabel(message.date)}
            </Text>
          </View>
          <View style={s.divider} />
          <Text selectable style={[s.text, { lineHeight: 25 }]}>
            {message.body}
          </Text>
          {message.attachments.map((id) => {
            const file = w.files.find((f) => f.id === id);
            return file ? (
              <LinkRow
                key={id}
                title={file.name}
                detail={`${file.pageCount} páginas · anexo PDF`}
                icon={FileText}
                onPress={() => open({ type: "file", file })}
              />
            ) : (
              <Button
                key={id}
                busy={importing === id}
                icon={FileText}
                onPress={() => void importAttachment(id)}
              >
                {decodeURIComponent(id.split(":").slice(2).join(":")) || "Abrir anexo"}
              </Button>
            );
          })}
        </Card>
      ))}
      <ErrorNotice error={error} />
      {error && <Button onPress={() => setRetry(retry + 1)}>Recarregar conversa</Button>}
      <Button
        primary
        icon={Reply}
        style={{ alignSelf: "flex-start" }}
        onPress={() =>
          open({
            type: "email",
            draft: {
              to: [m.from],
              subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
              body: "",
              cc: [],
              bcc: [],
              attachmentIds: [],
              threadId: m.threadId,
              replyToMessageId: m.id,
            },
          })
        }
      >
        Responder
      </Button>
    </Sheet>
  );
}
function EmailEditor({ draft }: { draft?: Partial<EmailDraft> & { id?: string } }) {
  const { workspace: w, api, refresh, open, close, notify } = useWorkspace();
  const [to, setTo] = useState(draft?.to?.join(", ") || "");
  const [cc, setCc] = useState(draft?.cc?.join(", ") || "");
  const [bcc, setBcc] = useState(draft?.bcc?.join(", ") || "");
  const [subject, setSubject] = useState(draft?.subject || "");
  const [body, setBody] = useState(draft?.body || "");
  const [attachments, setAttachments] = useState(draft?.attachmentIds || []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  function emails(value: string) {
    return value
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  async function save(review: boolean) {
    setBusy(review ? "review" : "draft");
    setError("");
    try {
      const parsed = emailDraftSchema.safeParse({
        to: emails(to),
        cc: emails(cc),
        bcc: emails(bcc),
        subject,
        body,
        attachmentIds: attachments,
        threadId: draft?.threadId,
        replyToMessageId: draft?.replyToMessageId,
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
        );
      if (review) {
        const action = await api.request<ActionProposal>("/api/actions", {
          kind: "email.send",
          data: parsed.data,
        });
        await refresh();
        open({ type: "review", action });
      } else {
        await api.request("/api/drafts", {
          ...parsed.data,
          ...(draft?.id ? { id: draft.id } : {}),
        });
        await refresh();
        notify("Rascunho salvo.");
        close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <Sheet
      title={draft?.threadId ? "Responder" : "Nova mensagem"}
      subtitle={`De ${w.profile.email} · salvo só para você`}
      onClose={close}
    >
      <Field
        label="Para"
        value={to}
        onChangeText={setTo}
        placeholder="pessoa@exemplo.com"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Cc"
            value={cc}
            onChangeText={setCc}
            placeholder="Opcional"
            autoCapitalize="none"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Cco"
            value={bcc}
            onChangeText={setBcc}
            placeholder="Opcional"
            autoCapitalize="none"
          />
        </View>
      </View>
      <Field
        label="Assunto"
        value={subject}
        onChangeText={setSubject}
        placeholder="Sobre o que é?"
      />
      <Field
        label="Mensagem"
        value={body}
        onChangeText={setBody}
        multiline
        placeholder="Escreva sua mensagem…"
        style={{ minHeight: 210 }}
      />
      {w.files.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 18 }}>
          <Text style={[s.heading, { fontSize: 13, marginBottom: 5 }]}>Anexos</Text>
          {w.files.map((f) => (
            <CheckRow
              key={f.id}
              checked={attachments.includes(f.id)}
              label={`${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB`}
              onPress={() =>
                setAttachments(
                  attachments.includes(f.id)
                    ? attachments.filter((id) => id !== f.id)
                    : [...attachments, f.id],
                )
              }
            />
          ))}
        </Card>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button
          primary
          icon={ShieldCheck}
          busy={busy === "review"}
          disabled={!!busy}
          onPress={() => void save(true)}
        >
          Revisar e-mail
        </Button>
        <Button
          icon={Save}
          busy={busy === "draft"}
          disabled={!!busy}
          onPress={() => void save(false)}
        >
          Salvar rascunho
        </Button>
      </View>
      <Text style={[s.small, { marginTop: 13 }]}>
        Você revisa destinatários, mensagem e anexos antes de qualquer envio.
      </Text>
    </Sheet>
  );
}
function EventEditor({
  event: e,
  draft,
  neighbors,
}: {
  event?: CalendarEvent;
  draft?: EventDraft;
  neighbors?: CalendarEvent[];
}) {
  const seed = e || draft;
  const { workspace: w, api, open, close, refresh } = useWorkspace();
  const initialStart = new Date();
  initialStart.setMinutes(0, 0, 0);
  initialStart.setHours(initialStart.getHours() + 1);
  const [title, setTitle] = useState(seed?.title || "");
  const [start, setStart] = useState(seed?.start || initialStart.toISOString());
  const [end, setEnd] = useState(
    seed?.end || new Date(initialStart.getTime() + 3600000).toISOString(),
  );
  const [allDay, setAllDay] = useState(seed?.allDay || false);
  const [zone, setZone] = useState(
    seed?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [location, setLocation] = useState(seed?.location || "");
  const [description, setDescription] = useState(seed?.description || "");
  const [attendees, setAttendees] = useState(seed?.attendees.join(", ") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conflicts = (neighbors || w.events).filter(
    (item) =>
      item.id !== e?.id &&
      Date.parse(start) < Date.parse(item.end) &&
      Date.parse(end) > Date.parse(item.start),
  );
  async function propose(remove = false) {
    setBusy(true);
    setError("");
    try {
      let data: ProposalInput;
      if (remove && e) {
        data = {
          kind: "calendar.delete",
          data: { eventId: e.id, calendarId: e.calendarId, title: e.title },
        };
      } else {
        const parsed = eventDraftSchema.safeParse({
          calendarId: e?.calendarId || draft?.calendarId || "primary",
          title,
          start,
          end,
          allDay,
          timeZone: zone,
          location,
          description,
          attendees: attendees
            .split(/[,;\n]/)
            .map((a) => a.trim())
            .filter(Boolean),
        });
        if (!parsed.success)
          throw new Error(
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
          );
        data = e
          ? { kind: "calendar.update", data: { ...parsed.data, eventId: e.id } }
          : { kind: "calendar.create", data: parsed.data };
      }
      const action = await api.request<ActionProposal>("/api/actions", data);
      await refresh();
      open({ type: "review", action });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={e ? "Editar evento" : "Novo evento"}
      subtitle={e ? "Edite o evento e depois revise as mudanças." : "Crie um evento na sua agenda."}
      onClose={close}
    >
      <Field
        label="Título do evento"
        value={title}
        onChangeText={setTitle}
        placeholder="Para que é esse tempo?"
      />
      <CheckRow
        label="Dia inteiro"
        checked={allDay}
        onPress={() => {
          try {
            if (!allDay) {
              const local = localDateTime(start, zone);
              const endDay = new Date(`${local.date}T12:00:00Z`);
              endDay.setUTCDate(endDay.getUTCDate() + 1);
              setStart(local.date);
              setEnd(endDay.toISOString().slice(0, 10));
            } else {
              setStart(zonedInstant(start, "09:00", zone));
              setEnd(zonedInstant(start, "10:00", zone));
            }
            setAllDay(!allDay);
            setError("");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      />
      <DateTimeEditor
        label="Início"
        value={start}
        onChange={setStart}
        timeZone={zone}
        allDay={allDay}
      />
      <DateTimeEditor label="Fim" value={end} onChange={setEnd} timeZone={zone} allDay={allDay} />
      {allDay && (
        <Text style={[s.small, { marginBottom: 15 }]}>
          A data de fim é o dia seguinte ao último dia do evento.
        </Text>
      )}
      <Field
        label="Fuso horário"
        value={zone}
        onChangeText={setZone}
        placeholder="America/Sao_Paulo"
      />
      <Field
        label="Local ou link da reunião"
        value={location}
        onChangeText={setLocation}
        placeholder="Opcional"
      />
      <Field
        label="Convidados"
        value={attendees}
        onChangeText={setAttendees}
        placeholder="E-mails, separados por vírgula"
      />
      <Field
        label="Notas"
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Algo mais para lembrar?"
      />
      {!!conflicts.length && (
        <Card style={{ backgroundColor: colors.orange, padding: 16, marginBottom: 16 }}>
          <Text style={s.heading}>Esse horário tem conflito</Text>
          {conflicts.map((c) => (
            <Text key={c.id} style={s.muted}>
              {c.title} · {timeLabel(c.start, c.timeZone)}–{timeLabel(c.end, c.timeZone)}
            </Text>
          ))}
        </Card>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button primary icon={ShieldCheck} busy={busy} onPress={() => void propose()}>
          {e ? "Revisar mudanças" : "Revisar evento"}
        </Button>
        {e && (
          <Button icon={Trash2} disabled={busy} danger onPress={() => void propose(true)}>
            Revisar exclusão
          </Button>
        )}
      </View>
    </Sheet>
  );
}
function ReviewDetail({ initial }: { initial: ActionProposal }) {
  const { workspace: w, api, refresh, close, open } = useWorkspace();
  const [local, setLocal] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action =
    local.status !== initial.status ? local : w.actions.find((a) => a.id === initial.id) || local;
  const d = action.data;
  const pending = action.status === "awaiting_review";
  const gate = useRiskGate(action);
  async function decide(decision: "approve" | "deny") {
    if (decision === "approve" && !gate.pass()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<ActionProposal>(`/api/actions/${action.id}/decide`, {
        decision,
        hash: action.hash,
        ...(decision === "approve" ? gate.extra : {}),
      });
      setLocal(result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    setBusy(true);
    setError("");
    try {
      let next: Detail;
      if (action.kind === "email.send")
        next = { type: "email", draft: emailDraftSchema.parse(action.data) };
      else {
        const draft = eventDraftSchema.parse(action.data);
        if (action.kind === "calendar.update") {
          const eventId = action.data.eventId;
          if (typeof eventId !== "string" || !eventId)
            throw new Error(
              "Não encontrei a referência do evento. Abra o evento na Agenda de novo.",
            );
          next = { type: "event", event: { ...draft, id: eventId } };
        } else next = { type: "event", draft };
      }
      await api.request(`/api/actions/${action.id}/decide`, {
        decision: "deny",
        hash: action.hash,
      });
      await refresh();
      open(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const email = action.kind === "email.send";
  const checkout = action.kind === "browser.checkout";
  // Checkouts reuse the non-Google path: no account line, no editing, no calendar fields.
  const app = action.kind === "app.action" || checkout;
  const state = actionState(action);
  const appLabel = actionApp(action);
  // Calendar app actions get the readable event card; other app actions a humanized key list.
  const appEvent = action.kind === "app.action" ? eventSummary(action) : undefined;
  const KindIcon = checkout
    ? Globe2
    : email || /mail/i.test(appLabel)
      ? MailIcon
      : appEvent || !app
        ? CalendarDays
        : ShieldCheck;
  const link = resultLink(action.result);
  const outcome =
    action.status === "succeeded"
      ? link
        ? DONE_LINE
        : resultLine(action) === DONE_LINE || !resultLine(action)
          ? DONE_LINE
          : `${DONE_LINE} · ${resultSummary(resultLine(action))}`
      : ["failed", "outcome_unknown"].includes(action.status)
        ? resultLine(action) ||
          (action.status === "failed"
            ? "Não deu certo."
            : "O app não confirmou o resultado. Confira antes de tentar de novo.")
        : "";
  const history = w.activity
    .filter((entry) => entry.actionId === action.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Sheet
      title={pending ? "Uma última olhada" : appLabel}
      subtitle={
        !pending
          ? undefined
          : app
            ? `Roda na sua conta ${appLabel} conectada assim que você permitir.`
            : w.mode === "sample"
              ? "Esta ação fica só no seu espaço local."
              : "Revise esta ação antes que ela mude sua conta conectada."
      }
      onClose={close}
    >
      <View style={[s.row, { gap: 11, marginBottom: 14 }]}>
        <View style={[s.iconBox, { width: 34, height: 34, borderRadius: 11 }]}>
          <KindIcon size={17} color={colors.blueDark} />
        </View>
        <Text style={[s.small, { flex: 1 }]}>
          {pending ? "Solicitada" : "Proposta"} {relativeTime(action.createdAt).toLowerCase()}
        </Text>
        <StatusPill state={state} />
      </View>
      {appEvent || (app && !checkout) ? (
        <Card style={{ gap: 12, padding: 18 }}>
          {appEvent ? (
            <>
              <Text style={[s.heading, { fontSize: 18 }]}>{appEvent.title}</Text>
              {!!appEvent.when && (
                <SummaryLine
                  icon={Clock3}
                  text={appEvent.when}
                  detail={zoneLabel(appEvent.timeZone)}
                />
              )}
              {appEvent.calendar && <SummaryLine icon={CalendarDays} text={appEvent.calendar} />}
              {appEvent.location && <SummaryLine icon={MapPin} text={appEvent.location} />}
              {appEvent.attendees.length > 0 && (
                <SummaryLine icon={Users} text={appEvent.attendees.join(", ")} />
              )}
              {appEvent.description && <SummaryLine icon={AlignLeft} text={appEvent.description} />}
            </>
          ) : (
            <>
              <Text style={[s.heading, { fontSize: 17 }]}>{actionSummary(action)}</Text>
              {argumentRows((d.arguments as Record<string, unknown>) ?? {}).map((row) => (
                <View key={row.key} style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
                  <Text style={[s.small, { width: 104, fontSize: 12 }]}>{row.label}</Text>
                  <Text selectable style={[s.text, { flex: 1, fontSize: 14, lineHeight: 20 }]}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </>
          )}
        </Card>
      ) : null}
      {(!app || checkout) && (
        <Card style={{ gap: 13 }}>
          {!app && <ReviewLine label="Conta" value={action.account || w.profile.email} />}
          {checkout ? (
            <>
              <ReviewLine label="Loja" value={String(d.merchant || "")} />
              <ReviewLine label="Pedido" value={String(d.summary || "")} />
              <ReviewLine label="Total" value={String(d.total || "—")} />
              {typeof d.screenshot === "string" && (
                <Image
                  accessibilityLabel="Tela final do pedido"
                  source={{ uri: d.screenshot }}
                  style={{ width: "100%", aspectRatio: 1.6, borderRadius: 12 }}
                  resizeMode="contain"
                />
              )}
              <Text style={s.small}>
                Permitir clica em “{String(d.button || "")}” na loja, só se a página e o total ainda
                forem estes. Usa o pagamento salvo na sua conta da loja.
              </Text>
            </>
          ) : email ? (
            <>
              <ReviewLine label="Para" value={arrayText(d.to)} />
              <ReviewLine label="Cc" value={arrayText(d.cc) || "Nenhum"} />
              <ReviewLine label="Cco" value={arrayText(d.bcc) || "Nenhum"} />
              <ReviewLine label="Assunto" value={String(d.subject || "")} />
              <View style={s.divider} />
              <Text selectable style={[s.text, { lineHeight: 25 }]}>
                {String(d.body || "")}
              </Text>
              <View style={s.divider} />
              <Text style={s.label}>Anexos</Text>
              {Array.isArray(d.attachmentIds) && d.attachmentIds.length ? (
                d.attachmentIds.map((id) => {
                  const file = w.files.find((f) => f.id === id);
                  return (
                    <Text key={String(id)} style={s.text}>
                      {file?.name || String(id)} · versão {String(id).slice(-8)}
                    </Text>
                  );
                })
              ) : (
                <Text style={s.muted}>Sem anexos</Text>
              )}
            </>
          ) : (
            <>
              <ReviewLine label="Evento" value={String(d.title || "")} />
              {action.kind !== "calendar.delete" && (
                <>
                  <ReviewLine
                    label="Início"
                    value={
                      d.allDay
                        ? String(d.start || "")
                        : `${dateLabel(String(d.start || ""), { year: "numeric", month: "short", day: "numeric", timeZone: String(d.timeZone || "UTC") })} · ${timeLabel(String(d.start || ""), String(d.timeZone || "UTC"))}`
                    }
                  />
                  <ReviewLine
                    label="Fim"
                    value={
                      d.allDay
                        ? `${String(d.end || "")} (não incluso)`
                        : `${dateLabel(String(d.end || ""), { year: "numeric", month: "short", day: "numeric", timeZone: String(d.timeZone || "UTC") })} · ${timeLabel(String(d.end || ""), String(d.timeZone || "UTC"))}`
                    }
                  />
                  <ReviewLine label="Fuso horário" value={String(d.timeZone || "")} />
                  <ReviewLine label="Dia inteiro" value={d.allDay ? "Sim" : "Não"} />
                  <ReviewLine label="Local" value={String(d.location || "Nenhum")} />
                  <ReviewLine label="Convidados" value={arrayText(d.attendees) || "Só você"} />
                  <ReviewLine label="Notas" value={String(d.description || "Nenhuma")} />
                </>
              )}
              <ReviewLine label="Agenda" value={String(d.calendarId || "primary")} />
              <Text style={s.small}>
                {action.kind === "calendar.delete"
                  ? "Isso remove o evento e pode avisar os convidados."
                  : "Os convidados podem receber um convite ou atualização da sua agenda conectada."}
              </Text>
            </>
          )}
        </Card>
      )}
      <ErrorNotice error={error} />
      {outcome && (
        <View
          style={[
            s.row,
            {
              gap: 8,
              marginTop: 12,
              paddingHorizontal: 14,
              paddingVertical: 11,
              borderRadius: 14,
              backgroundColor: toneColors[state.tone].tint,
            },
          ]}
        >
          <StatusDot tone={state.tone} />
          <Text
            selectable
            style={[s.text, { flex: 1, fontSize: 14, color: toneColors[state.tone].text }]}
          >
            {outcome}
          </Text>
          {link && (
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(link)}>
              <Text style={[s.text, { fontSize: 14, fontWeight: "600", color: colors.blueDark }]}>
                Abrir no {appLabel} ↗
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {(app || action.result || history.length > 0) && !checkout && (
        <TechnicalDetails action={action} history={history} />
      )}
      {pending ? (
        <>
          <View style={{ marginTop: 17 }}>
            <GuardNotice action={action} />
          </View>
          {gate.hint ? (
            <Text style={[s.small, { color: "#A33A30", marginTop: 8 }]}>{gate.hint}</Text>
          ) : null}
          <Text style={[s.small, { marginVertical: 17 }]}>
            A revisão expira em{" "}
            {new Date(action.expiresAt).toLocaleString("pt-BR", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            })}
            . Sua aprovação vale só para os detalhes acima.
          </Text>
          <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button primary icon={Check} busy={busy} onPress={() => void decide("approve")}>
              {gate.armed
                ? gate.label("")
                : app
                  ? "Permitir e executar"
                  : w.mode === "sample"
                    ? "Aprovar localmente"
                    : email
                      ? "Aprovar e enviar"
                      : "Aprovar mudança"}
            </Button>
            {action.kind !== "calendar.delete" && !app && (
              <Button icon={Edit3} disabled={busy} onPress={() => void edit()}>
                Editar detalhes
              </Button>
            )}
            <Button icon={X} disabled={busy} onPress={() => void decide("deny")}>
              Não seguir
            </Button>
          </View>
        </>
      ) : (
        <Button style={{ alignSelf: "flex-start", marginTop: 19 }} onPress={close}>
          Pronto
        </Button>
      )}
    </Sheet>
  );
}
function arrayText(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(", ") : "";
}
function SummaryLine({
  icon: Icon,
  text,
  detail,
}: {
  icon: typeof Clock3;
  text: string;
  detail?: string;
}) {
  return (
    <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
      <View style={{ paddingTop: 3 }}>
        <Icon size={15} color={colors.muted} />
      </View>
      <Text selectable style={[s.text, { flex: 1, fontSize: 14, lineHeight: 21 }]}>
        {text}
        {detail ? <Text style={s.small}>{`  ${detail}`}</Text> : null}
      </Text>
    </View>
  );
}
/** Exact tool, input, raw result and step history, folded away but one tap from view. */
function TechnicalDetails({
  action,
  history,
}: {
  action: ActionProposal;
  history: ActivityEntry[];
}) {
  const [openDetails, setOpenDetails] = useState(false);
  const mono = {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
  };
  return (
    <View style={{ marginTop: 14 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: openDetails }}
        onPress={() => setOpenDetails((v) => !v)}
        style={[s.row, { gap: 6, paddingVertical: 6 }]}
      >
        {openDetails ? (
          <ChevronDown size={14} color={colors.muted} />
        ) : (
          <ChevronRight size={14} color={colors.muted} />
        )}
        <Text style={[s.small, { fontSize: 12, fontWeight: "600" }]}>Detalhes técnicos</Text>
      </Pressable>
      {openDetails && (
        <Card style={{ gap: 10, padding: 16, backgroundColor: "#F6F7F8" }}>
          {action.kind === "app.action" && (
            <Text selectable style={[s.small, { fontSize: 12 }]}>
              {String(action.data.toolkit || "")} · {String(action.data.tool || "")}
            </Text>
          )}
          <Text style={s.label}>Entrada exata</Text>
          <Text selectable style={[s.text, mono]}>
            {JSON.stringify(
              action.kind === "app.action" ? (action.data.arguments ?? {}) : action.data,
              null,
              2,
            )}
          </Text>
          {!!(action.result || action.error) && (
            <>
              <Text style={s.label}>Resultado bruto</Text>
              <Text selectable style={[s.text, mono, { color: colors.muted }]}>
                {action.error || action.result}
              </Text>
            </>
          )}
          {history.length > 0 && (
            <>
              <Text style={s.label}>Histórico</Text>
              {history.map((entry) => (
                <View key={entry.id} style={[s.row, { gap: 8 }]}>
                  <StatusDot tone={statusState(entry.status).tone} size={6} />
                  <Text style={[s.small, { flex: 1, fontSize: 12 }]}>
                    {stepDetail(entry)} · {timeLabel(entry.date)}
                  </Text>
                </View>
              ))}
            </>
          )}
        </Card>
      )}
    </View>
  );
}
function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Text selectable style={s.text}>
        {value}
      </Text>
    </View>
  );
}
function FileDetail({ file: given }: { file: Artifact }) {
  const { api, refresh, open, close } = useWorkspace();
  // The file with links signed just now. The one handed over came from a chat card, the library
  // or the workspace loaded a while ago: its links may have expired, or never existed (a file a
  // script produced before the workspace caught up). A stale link is not shown at all; the
  // reissued one is.
  const [{ file: f, reissued }, setFile] = useState({ file: given, reissued: false });
  const [linkFailed, setLinkFailed] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api
      .file(given.id)
      .then((fresh) => {
        if (!cancelled)
          setFile({ file: { ...fresh, excerpt: fresh.excerpt ?? given.excerpt }, reissued: true });
      })
      // Could not ask (offline, say): what the app kept is worth a try.
      .catch(() => {
        if (!cancelled) setFile((state) => ({ ...state, reissued: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, given, linkFailed]);
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      (f.fields || [])
        .filter((field) => field.type !== "unsupported")
        .map((field) => [
          field.name,
          field.type === "checkbox" ? field.value === "true" || field.value === "Yes" : field.value,
        ]),
    ),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A link the server issued for this sheet is trusted as is (the phone's clock may be off);
  // one the app kept is shown only while its own expiry says it still works.
  const url = f.url && (reissued || isFreshSignedUrl(f.url)) ? api.url(f.url) : undefined;
  const isPdf = f.mimeType === "application/pdf";
  const isImage = f.mimeType.startsWith("image/");
  async function fill() {
    setBusy(true);
    setError("");
    try {
      const file = await api.request<Artifact>(`/api/files/${f.id}/fill`, { fields: values });
      await refresh();
      open({ type: "file", file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    setError("");
    try {
      await shareFile(api, f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Sheet
      title={f.name}
      subtitle={`${isPdf ? `${f.pageCount} páginas · ` : ""}${Math.max(1, Math.round(f.size / 1024))} KB · ${f.source}`}
      onClose={close}
      wide
    >
      {isPdf && url ? (
        <PdfReader url={url} token={api.token} pageCount={f.pageCount} />
      ) : isImage ? (
        <View
          style={{
            width: "100%",
            aspectRatio: 1.2,
            borderRadius: 14,
            backgroundColor: "#F7F8F9",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {url ? (
            <RemoteImage
              uri={url}
              label={f.name}
              width="100%"
              height="100%"
              fit="contain"
              // A link that fails is reissued once (it may have expired while the sheet was open).
              onError={() => setLinkFailed((n) => (n < 1 ? n + 1 : n))}
            />
          ) : (
            <ActivityIndicator color={colors.muted} />
          )}
        </View>
      ) : isPdf ? (
        <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : (
        <Text style={s.muted}>
          O Corgi lê este arquivo quando você o anexa numa conversa. Para ver o original, abra ou
          compartilhe abaixo.
        </Text>
      )}
      <View style={[s.row, { gap: 10, marginVertical: 18, flexWrap: "wrap" }]}>
        <Button icon={Download} onPress={() => void share()}>
          {Platform.OS === "web" ? "Abrir / baixar" : "Salvar ou compartilhar"}
        </Button>
        <Button
          icon={Send}
          onPress={() => open({ type: "email", draft: { attachmentIds: [f.id] } })}
        >
          Anexar ao e-mail
        </Button>
      </View>
      {f.fields && f.fields.length > 0 && (
        <Card>
          <SectionHeading title="Preencher formulário" />
          <Text style={[s.muted, { marginBottom: 18 }]}>
            Preencha abaixo. Ao salvar, criamos uma cópia nova e o original fica intacto.
          </Text>
          {f.fields.map((field) =>
            field.type === "unsupported" ? (
              <Text key={field.name} style={s.muted}>
                {field.name} · tipo de campo não suportado
              </Text>
            ) : field.type === "checkbox" ? (
              <CheckRow
                key={field.name}
                checked={!!values[field.name]}
                label={field.name.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase())}
                onPress={() => setValues({ ...values, [field.name]: !values[field.name] })}
              />
            ) : (
              <Field
                key={field.name}
                label={field.name.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase())}
                value={String(values[field.name] || "")}
                onChangeText={(value) => setValues({ ...values, [field.name]: value })}
              />
            ),
          )}
          <Button primary icon={Save} busy={busy} onPress={() => void fill()}>
            Salvar cópia preenchida
          </Button>
        </Card>
      )}
      <ErrorNotice error={error} />
      <Text style={[s.small, { marginTop: 15 }]}>
        Adicionado em {dateLabel(f.createdAt)}
        {f.parentId ? " · cópia preenchida" : ""}
      </Text>
    </Sheet>
  );
}
function BrowserDetail({ initial }: { initial: BrowserSession }) {
  const { workspace: w, api, refresh, close, notify } = useWorkspace();
  const [local, setLocal] = useState(initial);
  const [url, setUrl] = useState(initial.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const latest = w.browsers.find((b) => b.id === initial.id);
  const browser = {
    ...(latest && latest.updatedAt > local.updatedAt ? latest : local),
    consoleUrl: local.consoleUrl,
    previewUrl: local.previewUrl,
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<BrowserSession>(`/api/browsers/${initial.id}`)
      .then((session) => {
        if (active) {
          setLocal(session);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, initial.id, retry]);
  async function importDownloads() {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{
        files: Artifact[];
        failures: { name: string; message: string }[];
      }>(`/api/browsers/${browser.id}/import-downloads`, {});
      await refresh();
      if (result.failures.length)
        setError(
          result.failures.map((failure) => `${failure.name}: ${failure.message}`).join("\n"),
        );
      const files = result.files;
      notify(
        files.length
          ? files.length === 1
            ? "1 PDF baixado foi adicionado a Arquivos."
            : `${files.length} PDFs baixados foram adicionados a Arquivos.`
          : "Nenhum PDF novo baixado nesta sessão.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(end = false) {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<BrowserSession>(
        `/api/browsers/${browser.id}/${end ? "close" : browser.status === "closed" ? "reopen" : "navigate"}`,
        end ? {} : { url: browserAddress(url) },
      );
      setLocal(result);
      setUrl(result.url);
      await refresh();
      if (end) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={browserSite(browser.url)}
      subtitle={`${statusLabel(browser.status)} · atualizado às ${timeLabel(browser.updatedAt)}`}
      onClose={close}
      wide
    >
      <View style={[s.row, { gap: 10, marginBottom: 16 }]}>
        <View style={{ flex: 1 }}>
          <Field
            label="Endereço do site"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            keyboardType="url"
            onSubmitEditing={() => void mutate()}
          />
        </View>
        <Button primary busy={busy} disabled={loading || !url.trim()} onPress={() => void mutate()}>
          {browser.status === "closed"
            ? "Reabrir"
            : browser.status === "error"
              ? "Reconectar"
              : "Ir"}
        </Button>
      </View>
      <ErrorNotice error={error} />
      {loading ? (
        <View style={[s.row, { gap: 10, paddingVertical: 24 }]}>
          {error ? (
            <Button onPress={() => setRetry(retry + 1)}>Tentar conectar de novo</Button>
          ) : (
            <>
              <ActivityIndicator color={colors.blueDark} />
              <Text style={s.muted}>Conectando ao seu navegador…</Text>
            </>
          )}
        </View>
      ) : browser.status === "active" && browser.consoleUrl ? (
        <BrowserConsole url={api.url(browser.consoleUrl)} />
      ) : browser.status === "active" && browser.previewUrl ? (
        <Image
          source={{ uri: api.url(browser.previewUrl) }}
          style={{ width: "100%", height: 450, backgroundColor: colors.canvas }}
          resizeMode="contain"
        />
      ) : (
        <Empty
          icon={Globe2}
          title={browser.status === "closed" ? "Esta sessão foi encerrada" : "Prévia indisponível"}
          detail={
            browser.status === "closed"
              ? "Seu perfil e downloads estão salvos. Reabra para continuar de onde parou."
              : "Reconecte para continuar com o perfil salvo do navegador."
          }
        />
      )}
      <View style={[s.row, { gap: 10, marginTop: 18, flexWrap: "wrap" }]}>
        {!loading && browser.status === "active" && browser.consoleUrl && (
          <Button
            icon={ExternalLink}
            onPress={() => void Linking.openURL(api.url(browser.consoleUrl || ""))}
          >
            Abrir navegador em uma janela
          </Button>
        )}
        {!loading && (
          <Button icon={RotateCw} disabled={busy} onPress={() => setRetry(retry + 1)}>
            Atualizar conexão
          </Button>
        )}
        {!loading && browser.status !== "closed" && (
          <Button icon={Download} busy={busy} onPress={() => void importDownloads()}>
            Importar PDFs baixados
          </Button>
        )}
        {!loading && browser.status !== "closed" && (
          <Button icon={X} danger busy={busy} onPress={() => void mutate(true)}>
            Encerrar sessão
          </Button>
        )}
      </View>
    </Sheet>
  );
}
