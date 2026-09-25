// The get_weather card: now, the next hours, today's numbers and the next two days, in the same
// shell as the other answer elements (grey shell, place on top, content on white).
import { Droplet, Droplets, type LucideIcon, Umbrella, Wind } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import { colors, s } from "../../shared/ui";
import { Element, HeadsUp } from "../chat/result-cards";
import {
  deg,
  feelsLine,
  hourLabel,
  nextDays,
  shortDay,
  showRain,
  type WeatherReport,
} from "./weather";
import { WeatherIcon } from "./weather-icon";

const RAIN = "#2F80D1";
const HAIRLINE = "#F0F1F3";
const TILE_BG = "#F5F6F8";

export function WeatherCard({ report }: { report: WeatherReport }) {
  const today = report.days[0];
  const later = nextDays(report);
  const anyRain = report.hours.some((hour) => showRain(hour.rainChance));
  return (
    <Element title={report.place} meta={report.now.label}>
      <View style={{ padding: 16, paddingBottom: 12, gap: 12 }}>
        {!!report.alert && <HeadsUp icon={Umbrella}>{report.alert}</HeadsUp>}
        <View style={[s.between, { gap: 12 }]}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text
              accessibilityLabel={`${report.now.temperature} graus, ${report.now.label}`}
              style={{
                fontSize: 58,
                lineHeight: 64,
                fontWeight: "300",
                letterSpacing: -2,
                color: colors.text,
              }}
            >
              {deg(report.now.temperature)}
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted }}>{feelsLine(report)}</Text>
          </View>
          <WeatherIcon name={report.now.icon} size={46} tile={72} />
        </View>
      </View>
      {report.hours.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}
          contentContainerStyle={{ paddingHorizontal: 6, paddingVertical: 12 }}
        >
          {report.hours.map((hour, index) => (
            <View key={hour.time} style={{ width: 50, alignItems: "center", gap: 6 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: index === 0 ? colors.text : colors.muted,
                  fontWeight: index === 0 ? "600" : "400",
                }}
              >
                {hourLabel(index, hour.time)}
              </Text>
              <WeatherIcon name={hour.icon} size={26} />
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
                {deg(hour.temperature)}
              </Text>
              {anyRain && (
                <Text style={{ fontSize: 11, lineHeight: 14, fontWeight: "600", color: RAIN }}>
                  {showRain(hour.rainChance) ? `${hour.rainChance}%` : " "}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={[s.row, { gap: 8, paddingHorizontal: 12, paddingBottom: 12 }]}>
        <Figure icon={Droplets} label="Umidade" value={`${report.now.humidity}%`} />
        <Figure icon={Wind} label="Vento" value={`${report.now.windKmh} km/h`} />
        {!!today && <Figure icon={Umbrella} label="Chuva" value={`${today.rainChance}%`} />}
      </View>
      {later.length > 0 && (
        <View style={[s.row, { borderTopWidth: 1, borderTopColor: HAIRLINE }]}>
          {later.map((day, index) => (
            <View
              key={day.date}
              accessibilityLabel={`${day.name}: ${day.label}, máxima ${day.max}, mínima ${day.min}`}
              style={[
                s.row,
                {
                  flex: 1,
                  gap: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 12,
                  borderLeftWidth: index ? 1 : 0,
                  borderLeftColor: HAIRLINE,
                },
              ]}
            >
              <WeatherIcon name={day.icon} size={20} tile={32} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 13, fontWeight: "600", color: colors.text }}
                >
                  {shortDay(day.name)}
                </Text>
                {/* Temperatures, then the rain chance on the same line: the day name keeps its
                    whole line, so "Amanhã" is never cut. */}
                <View style={[s.row, { gap: 5, flexWrap: "wrap", rowGap: 1 }]}>
                  <Text style={{ flexShrink: 0, fontSize: 13, color: colors.muted }}>
                    <Text style={{ color: colors.text, fontWeight: "600" }}>{deg(day.max)}</Text>
                    {` / ${deg(day.min)}`}
                  </Text>
                  {showRain(day.rainChance) && (
                    <View style={[s.row, { gap: 2, flexShrink: 0 }]}>
                      <Droplet size={10} color={RAIN} fill={RAIN} />
                      <Text style={{ fontSize: 11.5, fontWeight: "600", color: RAIN }}>
                        {`${day.rainChance}%`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </Element>
  );
}

function Figure({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: TILE_BG, borderRadius: 14, padding: 10, gap: 4 }}>
      <View style={[s.row, { gap: 5 }]}>
        <Icon size={13} color={colors.muted} strokeWidth={2.2} />
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted }}>
          {label}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
        {value}
      </Text>
    </View>
  );
}
