import {
  ArrowUp,
  ChevronRight,
  CircleAlert,
  FileText,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  X,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  type ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Artifact, BrowserSession } from "../../../../../packages/domain/src";
import type {
  AgentArtifact,
  AgentTask,
  Evidence,
  RunEvent,
} from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { errorText, stamp, statusLabel } from "../../shared/format";
import { MarkdownText } from "../../shared/markdown";
import { plainText } from "../../shared/markdown-parser";
import {
  Button,
  Card,
  CheckRow,
  colors,
  ErrorNotice,
  Field,
  LinkRow,
  resultSummary,
  Sheet,
  s,
} from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

import { ArtifactCard } from "../chat/artifact-card";
import { useMuseThread } from "../chat/threads";
import { ActivityScreen } from "./activity-screen";
import {
  composerFor,
  eventDetail,
  eventTitle,
  followUpsOf,
  type Instruction,
  taskTimeline,
  workingOnInstruction,
} from "./task-timeline";

function activeTask(task: AgentTask) {
  return !["succeeded", "failed", "cancelled"].includes(task.status);
}
export function AgentStatus() {
  const { data, error, refresh } = useAgentWorkspace();
  if (data?.worker.running && !error) return null;
  return (
    <View style={{ gap: 8 }}>
      <ErrorNotice error={error ? `Não consegui atualizar as tarefas. ${error}` : ""} />
      {!!error && (
        <Button small onPress={() => void refresh().catch(() => {})}>
          Reconectar
        </Button>
      )}
      {!data && !error && <ActivityIndicator color={colors.blueDark} />}
      {data && !data.worker.running && (
        <View
          accessibilityRole="alert"
          style={{
            flexDirection: "row",
            gap: 10,
            padding: 14,
            borderRadius: 16,
            backgroundColor: colors.orange,
          }}
        >
          <CircleAlert size={18} color="#8A5A12" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#6B4510" }}>
              As tarefas estão paradas
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: "#6B4510" }}>
              O servidor não está rodando o trabalho em segundo plano. Nada se perde: continua
              quando ele voltar.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
export function TaskCard({
  task,
  compact = false,
  onOpen,
}: {
  task: AgentTask;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { open } = useWorkspace();
  const done = task.plan.filter((step) => step.status === "succeeded").length;
  const next = task.plan.find((step) => ["running", "waiting"].includes(step.status));
  const waiting = ["waiting_input", "waiting_approval"].includes(task.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir tarefa: ${task.title}`}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId: task.id });
      }}
    >
      <Card
        style={{
          padding: compact ? 15 : 20,
          gap: 11,
          borderRadius: 22,
          backgroundColor: "#F0F1F2",
        }}
      >
        <View style={[s.row, { gap: 10 }]}>
          <View
            style={[
              s.iconBox,
              { width: 34, height: 34, backgroundColor: waiting ? colors.orange : colors.sky },
            ]}
          >
            <ListChecks size={18} color={colors.blueDark} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.heading}>{task.title}</Text>
            <Text style={s.small}>
              {statusLabel(task.status)}
              {task.plan.length ? ` · ${done}/${task.plan.length} etapas` : ""}
            </Text>
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
        {!!task.plan.length && (
          <View style={{ height: 4, backgroundColor: colors.line, borderRadius: 4 }}>
            <View
              style={{
                height: 4,
                width: `${Math.round((done / task.plan.length) * 100)}%`,
                backgroundColor: "#6AAEE0",
                borderRadius: 4,
              }}
            />
          </View>
        )}
        {(task.question || task.result || task.error || next?.title) && (
          <Text numberOfLines={compact ? 2 : 4} style={s.muted}>
            {plainText(
              task.question || task.error || resultSummary(task.result || next?.title || ""),
            )}
          </Text>
        )}
        {waiting && (
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            {task.status === "waiting_approval" ? "Precisa da sua revisão" : "Precisa de você"}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}
export function ChatWork() {
  const { data } = useAgentWorkspace();
  const tasks = [...(data?.tasks || [])]
    .filter(activeTask)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {tasks.map((task) => (
        <TaskCard task={task} key={task.id} compact />
      ))}
    </View>
  );
}
export function AgentActivityScreen() {
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <ActivityScreen />
    </View>
  );
}
export function EvidenceList({ items }: { items: Evidence[] }) {
  const { workspace, open } = useWorkspace();
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 10 }}>
      {items.map((item) => (
        <View
          key={item.id}
          style={{ borderLeftWidth: 2, borderLeftColor: colors.blue, paddingLeft: 12, gap: 4 }}
        >
          <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>{item.title}</Text>
          <Text selectable style={s.small}>
            {item.excerpt}
          </Text>
          {item.url && /^https?:\/\//i.test(item.url) && (
            <Button
              small
              onPress={() =>
                void Linking.openURL(item.url || "").catch((e) => setError(errorText(e)))
              }
            >
              Abrir fonte
            </Button>
          )}
          {item.kind === "mail" && workspace.mail.some((mail) => mail.id === item.id) && (
            <Button
              small
              onPress={() => {
                const mail = workspace.mail.find((m) => m.id === item.id);
                if (mail) open({ type: "mail", mail });
              }}
            >
              Ver e-mail
            </Button>
          )}
          {item.kind === "file" && workspace.files.some((file) => file.id === item.id) && (
            <Button
              small
              onPress={() => {
                const file = workspace.files.find((f) => f.id === item.id);
                if (file) open({ type: "file", file });
              }}
            >
              Ver arquivo
            </Button>
          )}
        </View>
      ))}
      <ErrorNotice error={error} />
    </View>
  );
}
/** The person's instruction in the task's timeline: a small right-aligned bubble. */
function InstructionBubble({ text, at, pending }: { text: string; at: string; pending: boolean }) {
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "85%", alignItems: "flex-end", gap: 3 }}>
      <View
        style={{
          paddingHorizontal: 13,
          paddingVertical: 8,
          borderRadius: 18,
          borderBottomRightRadius: 6,
          backgroundColor: colors.blue,
          opacity: pending ? 0.7 : 1,
        }}
      >
        <Text selectable style={{ fontSize: 14.5, lineHeight: 21, color: colors.text }}>
          {text}
        </Text>
      </View>
      <Text style={[s.small, { paddingRight: 4 }]}>
        {pending ? "Enviando…" : `Sua instrução · ${stamp(at)}`}
      </Text>
    </View>
  );
}

/**
 * Pinned at the bottom of the task window: a one-line composer to steer the task (or answer its
 * question). Monitors and other fixed tasks get a hint instead.
 */
function TaskComposer({
  task,
  draft,
  onChange,
  onSend,
  working,
  error,
}: {
  task: AgentTask;
  draft: string;
  onChange: (text: string) => void;
  onSend: () => void;
  working: boolean;
  error: string;
}) {
  const [height, setHeight] = useState(40);
  const target = composerFor(task);
  if (target.mode === "hint")
    return <Text style={[s.small, { textAlign: "center", paddingBottom: 6 }]}>{target.hint}</Text>;
  const ready = !!draft.trim();
  return (
    <View style={{ gap: 8 }}>
      <ErrorNotice error={error} />
      {/* The sheet opens at the latest step; the question it waits on stays next to the reply. */}
      {task.status === "waiting_input" && task.question && !working && (
        <View style={{ backgroundColor: colors.sky, borderRadius: 16, padding: 12 }}>
          <Text selectable numberOfLines={6} style={{ fontSize: 14, color: colors.text }}>
            {task.question}
          </Text>
        </View>
      )}
      {working && (
        <View style={[s.row, { gap: 7, paddingHorizontal: 6 }]}>
          <ActivityIndicator
            size="small"
            color={colors.blueDark}
            style={{ transform: [{ scale: 0.8 }] }}
          />
          <Text style={{ fontSize: 13, color: colors.muted }}>Trabalhando na sua instrução…</Text>
        </View>
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 6,
          padding: 5,
          paddingLeft: 14,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: "#E6E9EC",
          backgroundColor: "#FFF",
        }}
      >
        <TextInput
          accessibilityLabel={
            target.mode === "answer" ? "Responder à tarefa" : "Instrução para a tarefa"
          }
          value={draft}
          onChangeText={onChange}
          placeholder={target.placeholder}
          placeholderTextColor="#949B9F"
          selectionColor={colors.blueDark}
          multiline
          onContentSizeChange={(event) =>
            setHeight(Math.max(40, Math.min(110, event.nativeEvent.contentSize.height)))
          }
          onKeyPress={
            Platform.OS === "web"
              ? (event) => {
                  if (
                    event.nativeEvent.key === "Enter" &&
                    !("shiftKey" in event.nativeEvent && event.nativeEvent.shiftKey)
                  ) {
                    event.preventDefault();
                    if (ready) onSend();
                  }
                }
              : undefined
          }
          style={{
            flex: 1,
            // Back to one line once the text is sent.
            height: draft ? height : 40,
            minHeight: 40,
            maxHeight: 110,
            fontSize: 16,
            lineHeight: 22,
            paddingTop: 9,
            paddingBottom: 9,
            color: colors.text,
            outlineWidth: Platform.OS === "web" ? 0 : undefined,
            outlineColor: Platform.OS === "web" ? "transparent" : undefined,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={target.mode === "answer" ? "Enviar resposta" : "Enviar instrução"}
          disabled={!ready}
          onPress={onSend}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: ready ? colors.blue : "#F3F5F6",
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          <ArrowUp size={21} strokeWidth={1.9} color={ready ? colors.text : "#9CB5C5"} />
        </Pressable>
      </View>
    </View>
  );
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const { api, workspace, close, open, navigate, refresh: refreshWorkspace } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [detail, setDetail] = useState<{
    task: AgentTask;
    events: RunEvent[];
    artifacts: AgentArtifact[];
    files: Artifact[];
    browsers: BrowserSession[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [fieldJson, setFieldJson] = useState("");
  const [showFieldJson, setShowFieldJson] = useState(false);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  // Instructions sent from this window, shown at once and kept until the server has them.
  const [sent, setSent] = useState<(Instruction & { pending: boolean })[]>([]);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const scroller = useRef<ScrollView>(null);
  const task = data?.tasks.find((item) => item.id === taskId) || detail?.task;
  // Open-ended tasks are side chats: opening one goes to its conversation, where it can be
  // followed, answered and approved like any chat.
  const { select } = useMuseThread();
  const threadId = typeof task?.state.threadId === "string" ? task.state.threadId : undefined;
  const redirected = useRef(false);
  useEffect(() => {
    if (!threadId || redirected.current) return;
    redirected.current = true;
    select({ id: threadId, existing: true });
    navigate("chat");
    close();
  }, [threadId, select, navigate, close]);
  async function instruct() {
    const text = draft.trim();
    if (!text) return;
    const at = new Date().toISOString();
    setSent((list) => [...list, { text, at, pending: true }]);
    setDraft("");
    setSendError("");
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    try {
      await mutate(`/tasks/${taskId}/follow-up`, { text });
      setSent((list) => list.map((item) => (item.at === at ? { ...item, pending: false } : item)));
    } catch (e) {
      setSent((list) => list.filter((item) => item.at !== at));
      setDraft(text);
      setSendError(errorText(e));
    }
  }
  useEffect(() => {
    let active = true;
    void api
      .request<{
        task: AgentTask;
        events: RunEvent[];
        artifacts: AgentArtifact[];
        files: Artifact[];
        browsers: BrowserSession[];
      }>(`/api/agent/tasks/${taskId}`)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [api, taskId, task?.updatedAt]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/tasks/${taskId}/${path}`, body);
      if (path === "input") {
        setAnswer("");
        setFields({});
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function submitInput() {
    try {
      let parsed: Record<string, string | boolean> = fields;
      if (fieldJson.trim()) {
        const raw: unknown = JSON.parse(fieldJson);
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.values(raw).some(
            (value) => typeof value !== "string" && typeof value !== "boolean",
          )
        )
          throw new Error(
            "Os campos precisam ser um objeto JSON com textos ou valores true/false.",
          );
        parsed = raw as Record<string, string | boolean>;
      }
      await act("input", {
        answer: answer.trim() || "Enviei os campos pedidos.",
        fields: parsed,
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function review() {
    setBusy(true);
    setError("");
    try {
      await refreshWorkspace();
      const snapshot = await api.request<typeof workspace>("/api/workspace");
      const action = snapshot.actions.find((item) => item.id === task?.actionId);
      if (!action)
        throw new Error("Esta revisão ainda não está disponível. Atualize e tente de novo.");
      open({ type: "review", action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const missing = Array.isArray(task?.state.missingFields) ? task.state.missingFields : [];
  const fieldNames = missing
    .map((field) =>
      typeof field === "string"
        ? field
        : typeof field === "object" && field && "name" in field
          ? String(field.name)
          : "",
    )
    .filter(Boolean);
  // Forms (named fields, documents) keep their own card; a plain question is answered below.
  const formInput = fieldNames.length > 0 || task?.kind === "document";
  const timeline = taskTimeline(detail?.events ?? [], followUpsOf(task?.state), sent);
  const working = !!task && workingOnInstruction(timeline, task.status);
  return (
    <Sheet
      title={task?.title || "Tarefa"}
      subtitle={
        task
          ? `${statusLabel(task.status)} · ${stamp(task.updatedAt)}`
          : "Carregando o progresso salvo…"
      }
      onClose={close}
      scrollRef={scroller}
      footer={
        task && (
          <TaskComposer
            task={task}
            draft={draft}
            onChange={setDraft}
            onSend={() => void instruct()}
            working={working}
            error={sendError}
          />
        )
      }
    >
      <ErrorNotice error={error} />
      {!task ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : (
        <View style={{ gap: 20 }}>
          <Text selectable style={s.text}>
            {task.prompt}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {["queued", "running", "scheduled", "waiting_input", "waiting_approval"].includes(
              task.status,
            ) && (
              <Button
                small
                icon={Pause}
                busy={busy}
                onPress={() => void act("control", { action: "pause" })}
              >
                Pausar
              </Button>
            )}
            {task.status === "paused" && (
              <Button
                small
                icon={Play}
                busy={busy}
                onPress={() => void act("control", { action: "resume" })}
              >
                Retomar
              </Button>
            )}
            {task.status === "failed" && (
              <Button
                small
                icon={RefreshCw}
                busy={busy}
                onPress={() => void act("control", { action: "retry" })}
              >
                Tentar de novo
              </Button>
            )}
            {activeTask(task) && (
              <Button
                small
                danger
                icon={X}
                busy={busy}
                onPress={() => void act("control", { action: "cancel" })}
              >
                Cancelar tarefa
              </Button>
            )}
          </View>
          {task.status === "waiting_approval" && (
            <Card style={{ backgroundColor: colors.lavender, gap: 12 }}>
              <Text style={s.heading}>Pronta para sua revisão</Text>
              <Text style={s.muted}>Revise a ação e a conta antes de seguir.</Text>
              <Button primary busy={busy} onPress={() => void review()}>
                Revisar ação
              </Button>
            </Card>
          )}
          {task.status === "waiting_input" && (
            <Card style={{ backgroundColor: colors.sky, gap: 10 }}>
              <Text style={s.heading}>{task.question || "Preciso de um detalhe seu"}</Text>
              {fieldNames.map((name) =>
                missing.some(
                  (f) => typeof f === "object" && f && f.name === name && f.type === "checkbox",
                ) ? (
                  <CheckRow
                    key={name}
                    label={name.replace(/_/g, " ")}
                    checked={Boolean(fields[name])}
                    onPress={() => setFields((current) => ({ ...current, [name]: !current[name] }))}
                  />
                ) : (
                  <Field
                    key={name}
                    label={name.replace(/_/g, " ")}
                    value={String(fields[name] ?? "")}
                    onChangeText={(value) =>
                      setFields((current) => ({ ...current, [name]: value }))
                    }
                  />
                ),
              )}
              {!formInput && <Text style={s.muted}>Responda aqui embaixo.</Text>}
              {formInput && !fieldNames.length && (
                <Field
                  label="Sua resposta"
                  value={answer}
                  onChangeText={setAnswer}
                  multiline
                  placeholder="Complete o que falta…"
                />
              )}
              {task.kind === "document" && !fieldNames.length && (
                <>
                  <Button small onPress={() => setShowFieldJson(!showFieldJson)}>
                    Valores dos campos
                  </Button>
                  {showFieldJson && (
                    <Field
                      label="Campos (JSON: nome do campo e valor)"
                      value={fieldJson}
                      onChangeText={setFieldJson}
                      multiline
                      autoCapitalize="none"
                      placeholder={'{"nome_completo":"Seu nome","consentimento":true}'}
                    />
                  )}
                </>
              )}
              {formInput && (
                <Button
                  primary
                  busy={busy}
                  disabled={!answer.trim() && !Object.keys(fields).length && !fieldJson.trim()}
                  onPress={() => void submitInput()}
                >
                  Continuar tarefa
                </Button>
              )}
            </Card>
          )}
          {!!task.plan.length && (
            <Card style={{ gap: 15 }}>
              <Text style={s.heading}>Plano</Text>
              {task.plan.map((step, index) => (
                <View key={step.id} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
                  <Text
                    style={[
                      s.text,
                      { color: step.status === "succeeded" ? colors.blueDark : colors.muted },
                    ]}
                  >
                    {step.status === "succeeded" ? "✓" : `${index + 1}.`}
                  </Text>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.text}>{step.title}</Text>
                    <Text style={s.small}>
                      {statusLabel(step.status)}
                      {step.detail ? ` · ${step.detail}` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
          {task.result && (
            <Card style={{ backgroundColor: colors.green }}>
              <MarkdownText>{resultSummary(task.result)}</MarkdownText>
            </Card>
          )}
          <ErrorNotice error={task.error ?? undefined} />
          {detail?.browsers?.map((browser) => (
            <Card key={browser.id} style={{ gap: 10 }}>
              <Text style={s.heading}>{browser.title || "Navegador do assistente"}</Text>
              <Text style={s.small}>{browser.url}</Text>
              {browser.status === "active" && browser.previewUrl && (
                <Image
                  accessibilityLabel="Prévia do navegador do assistente"
                  source={{ uri: api.url(browser.previewUrl) }}
                  style={{ width: "100%", aspectRatio: 1.6, borderRadius: 12 }}
                />
              )}
              <Button
                small
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  void (async () => {
                    try {
                      if (["running", "scheduled", "queued"].includes(task.status))
                        await mutate(`/tasks/${taskId}/control`, { action: "pause" });
                      open({ type: "browser", browser });
                    } catch (error) {
                      setError(errorText(error));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {["running", "scheduled", "queued"].includes(task.status)
                  ? "Pausar e abrir navegador"
                  : "Abrir navegador"}
              </Button>
            </Card>
          ))}
          {detail?.files?.map((file) => (
            <LinkRow
              key={file.id}
              title={file.name}
              detail={`${file.pageCount} páginas · PDF`}
              icon={FileText}
              onPress={() => open({ type: "file", file })}
            />
          ))}
          {(
            data?.artifacts.filter((artifact) => artifact.taskId === taskId) ||
            detail?.artifacts ||
            []
          ).map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
          {!!task.evidence.length && (
            <View style={{ gap: 14 }}>
              <Text style={s.heading}>Fontes</Text>
              <EvidenceList items={task.evidence} />
            </View>
          )}
          <Text style={s.heading}>Linha do tempo</Text>
          {timeline.map((item) =>
            item.type === "instruction" ? (
              <InstructionBubble
                key={item.key}
                text={item.text}
                at={item.at}
                pending={item.pending}
              />
            ) : (
              <View
                key={item.key}
                style={{
                  gap: 4,
                  paddingLeft: 14,
                  borderLeftWidth: 2,
                  borderLeftColor: colors.line,
                }}
              >
                <Text style={s.small}>
                  {stamp(item.event.date)} · {statusLabel(item.event.kind)}
                </Text>
                <Text style={s.text}>{eventTitle(item.event.title)}</Text>
                {/* A preview: the full report is rendered once, in the result card above. */}
                {!!item.event.detail && (
                  <Text selectable numberOfLines={4} style={s.muted}>
                    {plainText(eventDetail(item.event.detail))}
                  </Text>
                )}
              </View>
            ),
          )}
          {!timeline.length && <Text style={s.muted}>Cada etapa vai aparecer aqui.</Text>}
        </View>
      )}
    </Sheet>
  );
}
