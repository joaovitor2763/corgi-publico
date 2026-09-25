// Como o Corgi pensa: automatic by default; fixing one model is an advanced choice.
import { Check } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "../../shared/agent-workspace";
import { colors, ErrorNotice, Sheet, s } from "../../shared/ui";

export function ModelSheet({ onClose }: { onClose: () => void }) {
  const { data, mutate } = useAgentWorkspace();
  const [modelBusy, setModelBusy] = useState<string>();
  const [modelError, setModelError] = useState("");
  const modelSettings = data?.model;
  const [advancedModels, setAdvancedModels] = useState(false);
  async function chooseModel(modelId: string) {
    if (modelId === modelSettings?.selectedId || modelBusy) return;
    setModelBusy(modelId);
    setModelError("");
    try {
      await mutate("/model", { modelId });
    } catch (e) {
      setModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelBusy(undefined);
    }
  }
  return (
    <Sheet title="Como o Corgi pensa" onClose={onClose}>
      {modelSettings ? (
        <View style={{ gap: 10 }}>
          <Text style={s.small}>
            No automático, ele escolhe sozinho a cada mensagem. Você não precisa pensar nisso.
          </Text>
          <ErrorNotice error={modelError} />
          {modelSettings.options
            .filter(
              (option) =>
                option.id === "auto" || advancedModels || option.id === modelSettings.selectedId,
            )
            .map((option) => {
              const checked = option.id === modelSettings.selectedId;
              const busy = modelBusy === option.id;
              const context =
                option.contextWindow >= 1_000_000
                  ? `${Math.round(option.contextWindow / 1_000_000)}M de contexto`
                  : `${Math.round(option.contextWindow / 1_000)}K de contexto`;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityLabel={`Usar ${option.name}`}
                  accessibilityState={{ checked, disabled: Boolean(modelBusy) }}
                  disabled={Boolean(modelBusy)}
                  onPress={() => void chooseModel(option.id)}
                  style={({ pressed }) => [
                    {
                      padding: 13,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: checked ? "#A8CEE5" : colors.line,
                      backgroundColor: checked ? colors.sky : colors.canvas,
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 11,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      marginTop: 1,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: checked ? colors.blueDark : "#B9BEC1",
                      backgroundColor: checked ? colors.blueDark : "#FFFFFF",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {checked && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={[s.row, { gap: 7, flexWrap: "wrap" }]}>
                      <Text style={[s.text, { fontWeight: "600" }]}>{option.name}</Text>
                      {option.recommended && (
                        <Text
                          style={[
                            s.small,
                            {
                              color: colors.blueDark,
                              backgroundColor: "#FFFFFF",
                              paddingHorizontal: 7,
                              borderRadius: 10,
                            },
                          ]}
                        >
                          Recomendado
                        </Text>
                      )}
                    </View>
                    <Text style={s.small}>{option.description}</Text>
                    {option.id !== "auto" && (
                      <Text style={[s.small, { color: colors.text }]}>
                        {context} · ${option.inputPricePerMillion.toFixed(2)} entrada · $
                        {option.outputPricePerMillion.toFixed(2)} saída / 1M tokens
                      </Text>
                    )}
                    {option.note && (
                      <Text style={[s.small, { color: colors.danger }]}>{option.note}</Text>
                    )}
                  </View>
                  {busy && <ActivityIndicator color={colors.blueDark} size="small" />}
                </Pressable>
              );
            })}
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdvancedModels((open) => !open)}
            hitSlop={8}
            style={{ alignSelf: "flex-start", paddingVertical: 4 }}
          >
            <Text style={[s.small, { fontWeight: "600", color: colors.blueDark }]}>
              {advancedModels ? "Ocultar opções avançadas" : "Avançado: fixar um modelo"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={s.muted}>A escolha de modelo não está disponível neste servidor.</Text>
      )}
    </Sheet>
  );
}
