// A render error never leaves a blank screen: it shows what broke and a way back in.
import { Component, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

export class CrashScreen extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Corgi crashed", error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: "#F7F8F9", padding: 24, paddingTop: 72, gap: 14 }}>
        <Text style={{ fontSize: 22, fontWeight: "600", color: "#1B2328" }}>
          Algo quebrou nesta tela
        </Text>
        <Text style={{ fontSize: 15, color: "#5B6570", lineHeight: 22 }}>
          Suas conversas e tarefas estão salvas no servidor. Recarregue para voltar; se repetir,
          mande um print desta tela.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (Platform.OS === "web") globalThis.location?.reload();
            else this.setState({ error: undefined });
          }}
          style={{
            alignSelf: "flex-start",
            backgroundColor: "#CFE8F7",
            paddingHorizontal: 18,
            paddingVertical: 12,
            borderRadius: 22,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: "#1B2328" }}>Recarregar</Text>
        </Pressable>
        <ScrollView style={{ maxHeight: 260, backgroundColor: "#FFF", borderRadius: 12 }}>
          <Text selectable style={{ padding: 12, fontSize: 12, color: "#5B6570" }}>
            {`${error.name}: ${error.message}\n\n${(error.stack ?? "").slice(0, 1500)}`}
          </Text>
        </ScrollView>
      </View>
    );
  }
}
