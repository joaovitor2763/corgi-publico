// The agent's checklist in the chat: what it will do, what it is doing, what is done.
import { Check, Circle, Loader, Minus } from "lucide-react-native";
import { Text, View } from "react-native";
import { colors, s } from "../../shared/ui";
import { type TodoItem, todoProgress } from "./todo-progress";

const ICON = {
  done: { icon: Check, color: "#3E8E5E" },
  in_progress: { icon: Loader, color: colors.blueDark },
  pending: { icon: Circle, color: "#B5BDC4" },
  skipped: { icon: Minus, color: colors.muted },
} as const;

export function TodoCard({ todos }: { todos: TodoItem[] }) {
  if (!todos.length) return null;
  const { done, total } = todoProgress(todos);
  return (
    <View
      style={{
        backgroundColor: "#FFF",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "#ECEEF0",
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 8,
      }}
    >
      <Text style={[s.small, { fontWeight: "600" }]}>
        Etapas · {done}/{total}
      </Text>
      {todos.map((todo, index) => {
        const { icon: Icon, color } = ICON[todo.status];
        const finished = todo.status === "done" || todo.status === "skipped";
        return (
          <View key={todo.id ?? index} style={[s.row, { gap: 9, alignItems: "flex-start" }]}>
            <View style={{ paddingTop: 2 }}>
              <Icon size={15} color={color} strokeWidth={todo.status === "done" ? 2.6 : 2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14.5,
                  lineHeight: 20,
                  color: finished ? colors.muted : colors.text,
                  fontWeight: todo.status === "in_progress" ? "600" : "400",
                  textDecorationLine: todo.status === "skipped" ? "line-through" : "none",
                }}
              >
                {todo.text}
              </Text>
              {!!todo.note && <Text style={s.small}>{todo.note}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}
