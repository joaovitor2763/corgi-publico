import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, s } from "../../shared/ui";
import { useWorkspace } from "../../shared/workspace";
import { insertSkill, skillQuery } from "./skill-query";

export interface PickerSkill {
  name: string;
  title: string;
  description: string;
  ready: boolean;
  missing: string[];
  builtIn?: boolean;
}

let cache: PickerSkill[] | undefined;

/**
 * Typing @ in the composer lists skills: ready ones first (their apps are connected), then the
 * rest dimmed with what to connect. Loads once per session; nothing renders until @ is typed.
 */
export function SkillPicker({ draft, onPick }: { draft: string; onPick: (next: string) => void }) {
  const { api } = useWorkspace();
  const query = skillQuery(draft);
  const [skills, setSkills] = useState(cache);
  useEffect(() => {
    if (query === undefined || cache) return;
    void api
      .request<{ skills: PickerSkill[] }>("/api/agent/skills")
      .then((result) => {
        cache = result.skills;
        setSkills(result.skills);
      })
      .catch(() => {});
  }, [api, query]);
  if (query === undefined || !skills) return null;
  const matches = skills
    .filter((skill) => skill.name.startsWith(query) || skill.title.toLowerCase().includes(query))
    .sort((a, b) => Number(b.ready) - Number(a.ready))
    .slice(0, 5);
  if (!matches.length) return null;
  return (
    <View
      style={{
        marginBottom: 10,
        paddingVertical: 6,
        borderRadius: 22,
        backgroundColor: "#FFF",
        borderWidth: 1,
        borderColor: "#ECEEF0",
        shadowColor: "#18384B",
        shadowOpacity: 0.1,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: -4 },
        elevation: 6,
      }}
    >
      {matches.map((skill) => (
        <Pressable
          key={skill.name}
          accessibilityRole="button"
          accessibilityLabel={`Usar @${skill.name}: ${skill.title}`}
          onPress={() => onPick(insertSkill(draft, skill.name))}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 9,
            backgroundColor: pressed ? "#F3F6F9" : "transparent",
            opacity: skill.ready ? 1 : 0.55,
          })}
        >
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.blueDark, minWidth: 92 }}>
            @{skill.name}
          </Text>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 14, color: colors.text }}>
              {skill.title}
            </Text>
            <Text numberOfLines={1} style={[s.small, { fontSize: 12 }]}>
              {skill.ready
                ? skill.description
                : `Conecte ${skill.missing.slice(0, 2).join(" ou ")} em Ajustes`}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
