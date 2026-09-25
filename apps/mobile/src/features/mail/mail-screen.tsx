import { FileText, Inbox, Mail, Plus, Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { EmailDraft } from "../../../../../packages/domain/src";
import { Button, Card, colors, dateLabel, Empty, ErrorNotice, LinkRow, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";

function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <View
      style={{
        width: 35,
        height: 35,
        borderRadius: 12,
        backgroundColor: [colors.orange, colors.lavender, colors.green, colors.sky][index % 4],
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: "500" }}>
        {name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </Text>
    </View>
  );
}
export function MailScreen() {
  const { workspace: w, api, open } = useWorkspace();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [drafts, setDrafts] = useState<(EmailDraft & { id: string; createdAt: string })[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api
      .request<(EmailDraft & { id: string; createdAt: string })[]>("/api/drafts")
      .then(setDrafts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, w]);
  const items = w.mail.filter(
    (m) =>
      (tab !== "unread" || m.unread) &&
      `${m.sender} ${m.subject} ${m.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredDrafts = drafts.filter((d) =>
    `${d.to.join(" ")} ${d.subject} ${d.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <View style={{ gap: 20 }}>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View
          style={[
            s.row,
            {
              gap: 9,
              flex: 1,
              minWidth: 200,
              backgroundColor: "#FFF",
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 12,
              paddingHorizontal: 14,
            },
          ]}
        >
          <Search size={16} color={colors.muted} />
          <TextInput
            accessibilityLabel="Buscar e-mails"
            placeholder="Buscar na caixa de entrada"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            style={{ flex: 1, paddingVertical: 13, fontSize: 13, color: colors.text }}
          />
        </View>
        <Button onPress={() => open({ type: "email" })} primary icon={Plus}>
          Escrever
        </Button>
      </View>
      <ErrorNotice error={error} />
      <Card>
        <View style={[s.row, { gap: 10, marginBottom: 15, flexWrap: "wrap" }]}>
          <Button small primary={tab === "all"} onPress={() => setTab("all")}>
            Todas
          </Button>
          <Button small primary={tab === "unread"} onPress={() => setTab("unread")}>
            Não lidas · {w.mail.filter((m) => m.unread).length}
          </Button>
          <Button small primary={tab === "drafts"} onPress={() => setTab("drafts")}>
            Rascunhos · {drafts.length}
          </Button>
        </View>
        {tab === "drafts" ? (
          filteredDrafts.length ? (
            filteredDrafts.map((d) => (
              <LinkRow
                key={d.id}
                icon={Mail}
                title={d.subject}
                detail={`Para: ${d.to.join(", ")} · salvo ${dateLabel(d.createdAt)}`}
                onPress={() => open({ type: "email", draft: d })}
              />
            ))
          ) : (
            <Empty
              icon={Mail}
              title="Nenhum rascunho"
              detail="Os e-mails que você salvar como rascunho ficam aqui."
            />
          )
        ) : items.length ? (
          items.map((m, i) => (
            <Pressable
              key={m.id}
              onPress={() => open({ type: "mail", mail: m })}
              style={[
                s.row,
                { gap: 15, paddingVertical: 20, borderTopWidth: 1, borderTopColor: colors.line },
              ]}
            >
              <Avatar name={m.sender} index={i} />
              <View style={{ flex: 1, gap: 5 }}>
                <View style={s.between}>
                  <Text style={[s.text, { fontWeight: m.unread ? "600" : "400" }]}>{m.sender}</Text>
                  <Text style={s.small}>{dateLabel(m.date)}</Text>
                </View>
                <Text style={[s.text, { fontWeight: "500", fontSize: 13 }]}>{m.subject}</Text>
                <Text style={s.muted} numberOfLines={1}>
                  {m.body.replace(/\n/g, " ")}
                </Text>
                {!!m.attachments.length && (
                  <View style={[s.row, { gap: 4, marginTop: 2 }]}>
                    <FileText size={12} color={colors.muted} />
                    <Text style={s.small}>
                      {m.attachments.length} {m.attachments.length > 1 ? "anexos" : "anexo"}
                    </Text>
                  </View>
                )}
              </View>
              {m.unread && (
                <View
                  style={{ width: 6, height: 6, borderRadius: 4, backgroundColor: "#83B5D3" }}
                />
              )}
            </Pressable>
          ))
        ) : (
          <Empty
            icon={Inbox}
            title={query ? "Nenhum e-mail encontrado" : "Sua caixa de entrada está vazia"}
            detail={
              query
                ? "Tente outro nome ou assunto."
                : "Conecte o Google em Conexões para ler seus e-mails aqui."
            }
          />
        )}
      </Card>
    </View>
  );
}
