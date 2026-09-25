import { Play, Plus, Repeat, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import type { Routine } from "../../../../../packages/domain/src/agent";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { kit, More, Panel, Row, Segments } from "../../shared/kit";
import { Button, colors, ErrorNotice, Sheet, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import {
  describeRoutineSchedule,
  FREQUENCIES,
  LAST_DAY,
  quarterMonths,
  type ScheduleForm,
  type ScheduleInput,
  scheduleForm,
  scheduleInput,
  scheduleSummary,
  scheduleValid,
  WEEKDAYS,
  WEEKS,
} from "./schedule";

const DAY_NAMES = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTH_NAMES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** Ready-made routines: the useful defaults, one tap to add. */
const PRESETS: { title: string; days: number[]; time: string; prompt: string }[] = [
  {
    title: "Briefing da manhã",
    days: WEEKDAYS,
    time: "08:00",
    prompt:
      "Leia minha agenda de hoje (todas as contas conectadas) e os e-mails das últimas 24h. Me entregue: 1) compromissos de hoje com horário e o que preparar para cada um; 2) e-mails que precisam de resposta minha (quem, assunto, por quê); 3) conflitos ou buracos na agenda; 4) o que priorizar hoje. Curto e direto.",
  },
  {
    title: "Fechamento do dia",
    days: WEEKDAYS,
    time: "18:00",
    prompt:
      "Revise os e-mails de hoje e o que ficou pendente. Liste o que ainda precisa de resposta e prepare rascunhos curtos para minha aprovação. Diga o que ficou para amanhã.",
  },
  {
    title: "Planejar a semana",
    days: [1],
    time: "08:30",
    prompt:
      "Veja minha agenda da semana e minhas metas ativas. Me dê um panorama: dias mais cheios, reuniões importantes para preparar, blocos livres para foco e 3 prioridades sugeridas para a semana.",
  },
  {
    title: "Revisão da sexta",
    days: [5],
    time: "17:00",
    prompt:
      "Resuma minha semana: reuniões que aconteceram, e-mails importantes que ficaram sem resposta e o avanço das minhas metas. Sugira o que levar para a próxima semana.",
  },
];

/** "Seg a sex · 08:00", "Todo dia 2 do mês · 09:00", "A cada 2 semanas · Seg · 08:30". */
export const scheduleLabel = describeRoutineSchedule;

function nextLabel(iso: string) {
  const at = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const time = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === today.toDateString()) return `hoje às ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `amanhã às ${time}`;
  return `${at.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })} às ${time}`;
}

/**
 * Things Corgi does on a schedule: briefings, inbox triage, week reviews. Each run is a
 * background task; the result arrives in notifications (and the chat, if enabled).
 */
export function RoutinesSection() {
  const { data, mutate, refresh } = useAgentWorkspace();
  const { api } = useWorkspace();
  const [editing, setEditing] = useState<Partial<Routine> & { id?: string }>();
  const [menu, setMenu] = useState<string>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [allSuggestions, setAllSuggestions] = useState(false);
  const routines = data?.routines ?? [];
  const suggestions = PRESETS.filter((p) => !routines.some((r) => r.title === p.title));

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <Panel title="Rotinas" action="Nova" onAction={() => setEditing({ title: "", prompt: "" })}>
      {routines.map((routine, index) => (
        <View key={routine.id}>
          <Row
            first={index === 0}
            icon={Repeat}
            title={routine.title}
            detail={`${scheduleLabel(routine)}${routine.autoApprove ? " · aprova sozinha" : ""}${routine.enabled ? ` · próxima ${nextLabel(routine.nextRunAt)}` : " · pausada"}`}
            onPress={() => setMenu(menu === routine.id ? undefined : routine.id)}
            label={`Opções de ${routine.title}`}
            trailing={
              busy === routine.id ? (
                <ActivityIndicator size="small" color={colors.blueDark} />
              ) : (
                <Switch
                  trackColor={{ false: "#D5D9DC", true: kit.accent }}
                  thumbColor="#FFFFFF"
                  {...{ activeThumbColor: "#FFFFFF" }}
                  accessibilityLabel={`${routine.title} ${routine.enabled ? "ligada" : "desligada"}`}
                  value={routine.enabled}
                  onValueChange={(enabled) =>
                    void run(routine.id, () => mutate(`/routines/${routine.id}`, { enabled }))
                  }
                />
              )
            }
          />
          {menu === routine.id && (
            <View style={[s.row, { gap: 8, flexWrap: "wrap", paddingLeft: 46, paddingBottom: 10 }]}>
              <Button
                small
                icon={Play}
                onPress={() => {
                  setMenu(undefined);
                  void run(routine.id, () => mutate(`/routines/${routine.id}/run`, {}));
                }}
              >
                Rodar agora
              </Button>
              <Button
                small
                onPress={() => {
                  setMenu(undefined);
                  setEditing(routine);
                }}
              >
                Editar
              </Button>
              <Button
                small
                icon={Trash2}
                onPress={() => {
                  setMenu(undefined);
                  void run(routine.id, async () => {
                    await api.request(`/api/agent/routines/${routine.id}`, undefined, "DELETE");
                    await refresh();
                  });
                }}
              >
                Apagar
              </Button>
            </View>
          )}
        </View>
      ))}
      {(allSuggestions ? suggestions : suggestions.slice(0, routines.length ? 1 : 2)).map(
        (preset, index) => (
          <Row
            key={preset.title}
            first={!routines.length && index === 0}
            muted
            icon={Plus}
            title={preset.title}
            detail={`Sugestão · ${scheduleLabel(preset)}`}
            label={`Adicionar rotina: ${preset.title}`}
            onPress={() => void run(preset.title, () => mutate("/routines", preset))}
            trailing={
              busy === preset.title ? (
                <ActivityIndicator size="small" color={colors.blueDark} />
              ) : (
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.blueDark }}>
                  Adicionar
                </Text>
              )
            }
          />
        ),
      )}
      <More
        hidden={suggestions.length - (routines.length ? 1 : 2)}
        expanded={allSuggestions}
        onPress={() => setAllSuggestions(!allSuggestions)}
      />
      {editing && (
        <Sheet
          title={editing.id ? "Editar rotina" : "Nova rotina"}
          subtitle="Algo que o Corgi faz sozinho, sempre no mesmo horário"
          onClose={() => setEditing(undefined)}
        >
          <RoutineForm
            value={editing}
            onCancel={() => setEditing(undefined)}
            onSave={(input) =>
              run(editing.id ?? "new", async () => {
                await mutate(editing.id ? `/routines/${editing.id}` : "/routines", input);
                setEditing(undefined);
              })
            }
          />
        </Sheet>
      )}
      <ErrorNotice error={error} />
    </Panel>
  );
}

const inputStyle = {
  backgroundColor: "#FFF",
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#E6E8EA",
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 15,
  color: colors.text,
} as const;

/** A round toggle: a weekday initial or a month. */
function Dot({
  label,
  on,
  onPress,
  accessibilityLabel,
  role = "checkbox",
  wide,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  role?: "checkbox" | "radio";
  wide?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{
        minWidth: 34,
        paddingHorizontal: wide ? 10 : 0,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? kit.accent : "#FFF",
        borderWidth: 1,
        borderColor: on ? kit.accent : "#E6E8EA",
      }}
    >
      <Text style={{ fontWeight: "600", color: on ? "#FFF" : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function WeekdayDots({
  selected,
  onToggle,
  single,
}: {
  selected: number[];
  onToggle: (day: number) => void;
  single?: boolean;
}) {
  const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  return (
    <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
      {DAY_NAMES.map((name, day) => (
        <Dot
          key={names[day] ?? name}
          label={name}
          on={selected.includes(day)}
          onPress={() => onToggle(day)}
          accessibilityLabel={names[day] ?? name}
          role={single ? "radio" : "checkbox"}
        />
      ))}
    </View>
  );
}

function RoutineForm({
  value,
  onSave,
  onCancel,
}: {
  value: Partial<Routine>;
  onSave: (input: ScheduleInput & { title: string; prompt: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(value.title ?? "");
  const [prompt, setPrompt] = useState(value.prompt ?? "");
  const [form, setForm] = useState<ScheduleForm>(() => scheduleForm(value));
  const [dayText, setDayText] = useState(String(form.dayOfMonth));
  const set = (patch: Partial<ScheduleForm>) => setForm({ ...form, ...patch });
  const monthly = form.frequency === "monthly" || form.frequency === "quarterly";
  const valid = title.trim() && prompt.trim() && scheduleValid(form);
  return (
    <View style={{ gap: 12 }}>
      <TextInput
        accessibilityLabel="Nome da rotina"
        placeholder="Nome, ex.: Briefing da manhã"
        placeholderTextColor="#949B9F"
        value={title}
        onChangeText={setTitle}
        style={inputStyle}
      />
      <TextInput
        accessibilityLabel="O que fazer"
        placeholder="O que fazer a cada vez, ex.: leia minha agenda e e-mails e me diga o que priorizar"
        placeholderTextColor="#949B9F"
        value={prompt}
        onChangeText={setPrompt}
        multiline
        style={[inputStyle, { minHeight: 76, textAlignVertical: "top" }]}
      />
      <Segments
        options={FREQUENCIES}
        value={form.frequency}
        onChange={(frequency) => set({ frequency })}
      />
      {!monthly && (
        <WeekdayDots
          selected={form.days}
          onToggle={(day) =>
            set({
              days: form.days.includes(day)
                ? form.days.filter((d) => d !== day)
                : [...form.days, day],
            })
          }
        />
      )}
      {monthly && (
        <Segments
          options={[
            { value: "day", label: "Dia do mês" },
            { value: "weekday", label: "Dia da semana" },
          ]}
          value={form.monthlyBy}
          onChange={(monthlyBy) => set({ monthlyBy })}
        />
      )}
      {monthly && form.monthlyBy === "day" && (
        <View style={[s.row, { gap: 8, alignItems: "center", flexWrap: "wrap" }]}>
          <Text style={{ color: colors.text }}>Dia</Text>
          <TextInput
            accessibilityLabel="Dia do mês"
            value={dayText}
            keyboardType="number-pad"
            maxLength={2}
            onChangeText={(text) => {
              setDayText(text);
              set({ dayOfMonth: Number(text) });
            }}
            style={[inputStyle, { width: 56, textAlign: "center", paddingVertical: 7 }]}
          />
          <Dot
            wide
            role="radio"
            label="Último dia"
            accessibilityLabel="Último dia do mês"
            on={form.dayOfMonth === LAST_DAY}
            onPress={() => {
              setDayText(String(LAST_DAY));
              set({ dayOfMonth: LAST_DAY });
            }}
          />
        </View>
      )}
      {monthly && form.monthlyBy === "weekday" && (
        <View style={{ gap: 8 }}>
          <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
            {WEEKS.map((week) => (
              <Dot
                key={week.label}
                wide
                role="radio"
                label={week.label}
                accessibilityLabel={`${week.label} semana do mês`}
                on={form.week === week.value}
                onPress={() => set({ week: week.value })}
              />
            ))}
          </View>
          <WeekdayDots single selected={[form.weekday]} onToggle={(weekday) => set({ weekday })} />
        </View>
      )}
      {form.frequency === "quarterly" && (
        <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
          {MONTH_NAMES.map((name, index) => (
            <Dot
              key={name}
              wide
              role="radio"
              label={name}
              accessibilityLabel={`Trimestres a partir de ${name}`}
              on={quarterMonths(form.startMonth).includes(index + 1)}
              onPress={() => set({ startMonth: index + 1 })}
            />
          ))}
        </View>
      )}
      <View style={[s.row, { gap: 8, alignItems: "center" }]}>
        <Text style={{ color: colors.text }}>Às</Text>
        <TextInput
          accessibilityLabel="Horário"
          value={form.time}
          onChangeText={(time) => set({ time })}
          placeholder="08:00"
          maxLength={5}
          style={[inputStyle, { width: 78, textAlign: "center", paddingVertical: 7 }]}
        />
      </View>
      <Text style={{ fontSize: 13, color: "#6B7378" }}>
        {scheduleValid(form) ? scheduleSummary(form) : "Complete o horário e os dias"}
      </Text>
      <View style={[s.row, { gap: 10, alignItems: "center" }]}>
        <Switch
          trackColor={{ false: "#D5D9DC", true: kit.accent }}
          thumbColor="#FFFFFF"
          {...{ activeThumbColor: "#FFFFFF" }}
          accessibilityLabel="Aprovar sozinho o que for seguro"
          value={form.autoApprove}
          onValueChange={(autoApprove) => set({ autoApprove })}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>
            Aprovar sozinho o que for seguro
          </Text>
          <Text style={{ fontSize: 12, color: "#6B7378" }}>
            Ações seguras em apps (criar, atualizar) rodam sem perguntar. Enviar, apagar e pagar
            sempre pedem sua aprovação.
          </Text>
        </View>
      </View>
      <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
        <Button small onPress={onCancel}>
          Cancelar
        </Button>
        <Button
          small
          primary
          disabled={!valid}
          onPress={() =>
            onSave({ title: title.trim(), prompt: prompt.trim(), ...scheduleInput(form) })
          }
        >
          Salvar
        </Button>
      </View>
    </View>
  );
}
