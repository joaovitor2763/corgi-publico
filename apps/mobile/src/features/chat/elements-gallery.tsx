import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import type { z } from "zod";
import { colors, s } from "../../shared/ui";
import { mapsUrlFor, type Route } from "../routes/route";
import { RouteCard } from "../routes/route-card";
import { WEATHER_ICONS, type WeatherReport } from "../weather/weather";
import { WeatherCard } from "../weather/weather-card";
import { WeatherIcon } from "../weather/weather-icon";
import { ResultsCard, type resultsSchema } from "./result-cards";

type Fixture = z.infer<typeof resultsSchema>;

const today = (() => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();

/** Realistic data for every element, as the agent would send it. */
export const ELEMENT_FIXTURES: Record<string, Fixture> = {
  timeline: {
    layout: "timeline",
    title: "Agenda de hoje",
    date: today,
    items: [
      {
        title: "Treino",
        subtitle: "06:30–07:30",
        detail: "Academia",
        badges: ["voce@empresa.com"],
      },
      {
        title: "Lançamento do produto",
        subtitle: "08:30–09:30",
        detail: "Refeitório + Meet",
        badges: ["voce@empresa.com", "Meet"],
      },
      {
        title: "Comitê de produto",
        subtitle: "09:00–10:45",
        detail: "Sala 8",
        badges: ["voce@empresa.com"],
      },
      {
        title: "Block.",
        subtitle: "11:00–12:00",
        detail: "Bloqueio pessoal",
        badges: ["voce@empresa.com"],
      },
      {
        title: "Almoço",
        subtitle: "12:00–13:00",
        detail: "Sala 6",
        badges: ["voce@empresa.com"],
      },
      {
        title: "1:1 com a Marina",
        subtitle: "14:00–14:30",
        detail: "Meet",
        badges: ["voce@empresa.com", "Meet"],
      },
      {
        title: "Reunião de diretoria",
        subtitle: "16:00–18:00",
        detail: "Sala 1",
        badges: ["voce@empresa.com"],
      },
      {
        title: "Jantar com a Ana",
        subtitle: "20:00–22:00",
        detail: "Jamie's Italian",
        badges: ["voce@empresa.com"],
      },
    ],
  },
  "timeline-short": {
    layout: "timeline",
    title: "Amanhã",
    date: "2026-09-25",
    items: [
      { title: "Revisão de receita", subtitle: "09:00–10:00", detail: "Meet" },
      { title: "Entrevista Head de Growth", subtitle: "11:00–12:00", detail: "Sala 3" },
      { title: "Feriado municipal", subtitle: "Dia todo" },
    ],
  },
  "timeline-history": {
    layout: "timeline",
    title: "Pedido #48213",
    source: "amazon.com.br",
    items: [
      { title: "Pedido confirmado", subtitle: "12 set", detail: "Pagamento aprovado" },
      { title: "Enviado", subtitle: "13 set", detail: "Centro de distribuição Cajamar" },
      { title: "Em trânsito", subtitle: "15 set", detail: "Saiu para entrega" },
      { title: "Entregue", subtitle: "15 set", detail: "Recebido por J. Silva", badges: ["hoje"] },
    ],
  },
  table: {
    layout: "table",
    title: "Receita vs Meta - Setembro",
    source: "Notion",
    columns: ["Produto", "Receita", "Meta", "Ating."],
    items: [
      { title: "Varejo", cells: ["Varejo", "R$ 420 mil", "R$ 500 mil", "84% (-16%)"] },
      { title: "Atacado", cells: ["Atacado", "R$ 310 mil", "R$ 280 mil", "111% (+11%)"] },
      { title: "Eventos", cells: ["Eventos", "R$ 150 mil", "R$ 200 mil", "75% (-25%)"] },
      { title: "Online", cells: ["Online", "R$ 92 mil", "R$ 80 mil", "115% (+15%)"] },
      { title: "Assinaturas", cells: ["Assinaturas", "R$ 61 mil", "R$ 70 mil", "87% (-13%)"] },
      { title: "Outros", cells: ["Outros", "R$ 18 mil", "—", "—"] },
    ],
  },
  "table-wide": {
    layout: "table",
    title: "Planos pagos do Notion",
    source: "notion.com",
    columns: ["Plano", "Preço", "Ideal para", "Membros", "SSO", "Histórico"],
    items: [
      {
        title: "Plus",
        cells: [
          "Plus",
          "US$10/membro/mês",
          "Profissionais e equipes pequenas",
          "Ilimitado",
          "Não",
          "30 dias",
        ],
      },
      {
        title: "Business",
        cells: [
          "Business",
          "US$20/membro/mês",
          "Empresas em crescimento que precisam de mais controle e espaços privados",
          "Ilimitado",
          "Sim",
          "90 dias",
        ],
      },
      {
        title: "Enterprise",
        cells: [
          "Enterprise",
          "Personalizado",
          "Grandes organizações com requisitos de segurança",
          "Ilimitado",
          "Sim",
          "Ilimitado",
        ],
      },
      { title: "Free", cells: ["Free", "US$0", "Uso pessoal", "1", "Não", "7 dias"] },
      {
        title: "Education",
        cells: ["Education", "US$0", "Estudantes e professores", "1", "Não", "7 dias"],
      },
    ],
  },
  stats: {
    layout: "stats",
    title: "Setembro - números-chave",
    source: "Revisão mensal",
    items: [
      { title: "Receita total", subtitle: "R$ 880 mil", detail: "-11% vs meta" },
      { title: "Meta total", subtitle: "R$ 980 mil", detail: "soma das metas" },
      { title: "Atingimento", subtitle: "90%", detail: "-100 mil no mês" },
      { title: "Novos clientes", subtitle: "142", detail: "+18% vs agosto" },
      { title: "Ticket médio", subtitle: "R$ 6,2 mil" },
    ],
  },
  cards: {
    layout: "cards",
    title: "Carrinhos de bebê para viagem",
    items: [
      {
        title: "Glide Pro Stroller — dobrável, cabine de avião",
        price: "R$ 1.299",
        was: "R$ 1.890",
        subtitle: "4,7 ★ (2.310)",
        url: "https://www.amazon.com.br/dp/B0EXAMPLE1",
        badges: ["Oferta"],
      },
      {
        title: "Babyzen YOYO2 6+",
        price: "R$ 3.499",
        subtitle: "4,9 ★ (812)",
        url: "https://www.amazon.com.br/dp/B0EXAMPLE2",
      },
      {
        title: "Chicco Goody Plus compacto",
        price: "R$ 1.099",
        subtitle: "4,5 ★ (1.024)",
        url: "https://www.amazon.com.br/dp/B0EXAMPLE3",
        badges: ["Mais vendido"],
      },
      {
        title: "Joie Pact Lite",
        price: "R$ 1.590",
        subtitle: "4,6 ★ (410)",
        url: "https://www.amazon.com.br/dp/B0EXAMPLE4",
      },
    ],
  },
  list: {
    layout: "list",
    title: "E-mails que pedem resposta",
    source: "Gmail",
    items: [
      {
        title: "Proposta comercial — renovação Acme",
        subtitle: "Paulo Lima · ontem",
        detail: "Precisamos da sua aprovação até sexta para manter o desconto.",
        url: "https://mail.google.com/mail/u/0/#inbox/1",
        badges: ["urgente"],
      },
      {
        title: "Pauta da diretoria de outubro",
        subtitle: "Beatriz · há 2 dias",
        detail: "Segue a proposta de pauta; falta o bloco de Produto.",
        url: "https://mail.google.com/mail/u/0/#inbox/2",
      },
      {
        title: "Convite: Web Summit Lisboa",
        subtitle: "Eventos · há 3 dias",
        detail: "Confirmar presença e passagens até 30/09.",
        url: "https://mail.google.com/mail/u/0/#inbox/3",
      },
      {
        title: "Relatório semanal Business Ops",
        subtitle: "Marina Costa · há 4 dias",
        detail: "Link do Notion com status das squads e bloqueios.",
        url: "https://mail.google.com/mail/u/0/#inbox/4",
      },
      {
        title: "Nota fiscal setembro",
        subtitle: "Financeiro · há 5 dias",
        url: "https://mail.google.com/mail/u/0/#inbox/5",
      },
    ],
  },
  times: {
    layout: "times",
    title: "Sessões de hoje — Duna: Parte Três",
    source: "ingresso.com",
    items: [
      {
        title: "Cinemark Iguatemi",
        subtitle: "IMAX · Legendado",
        times: ["14:30", "17:45", "20:15", "21:00", "22:40"],
        url: "https://www.ingresso.com/cinema/cinemark-iguatemi",
        badges: ["Sala VIP"],
      },
      {
        title: "Kinoplex Itaim",
        subtitle: "Dublado",
        times: ["15:00", "18:10", "21:20"],
        url: "https://www.ingresso.com/cinema/kinoplex-itaim",
      },
      {
        title: "Cinépolis JK",
        subtitle: "Macro XE · Legendado",
        times: ["16:00", "19:30", "22:50"],
        url: "https://www.ingresso.com/cinema/cinepolis-jk",
      },
    ],
  },
  detail: {
    layout: "detail",
    items: [
      {
        title: "Glide Pro Stroller — dobrável para cabine de avião",
        price: "R$ 1.299",
        was: "R$ 1.890",
        subtitle: "Vendido por Amazon · entrega amanhã",
        detail:
          "Carrinho leve (5,8 kg) com dobra em um movimento, aceito como bagagem de mão na maioria das companhias. Encosto reclinável até 165°, capota UPF 50+ e cesto de 5 kg. Compatível com bebê conforto via adaptador (vendido à parte).",
        url: "https://www.amazon.com.br/dp/B0EXAMPLE1",
        badges: ["Oferta", "Frete grátis", "4,7 ★"],
      },
    ],
  },
};

const hours = (
  start: number,
  list: [WeatherReport["hours"][number]["icon"], number, number][],
): WeatherReport["hours"] =>
  list.map(([icon, temperature, rainChance], i) => ({
    time: `${String((start + i) % 24).padStart(2, "0")}:00`,
    icon,
    temperature,
    rainChance,
  }));

const WEATHER: Record<string, WeatherReport> = {
  weather: {
    kind: "weather",
    place: "São Paulo",
    now: {
      temperature: 20,
      feelsLike: 20,
      label: "Parcialmente nublado",
      icon: "partly",
      humidity: 78,
      windKmh: 12,
    },
    days: [
      {
        date: "2026-09-24",
        name: "Hoje",
        label: "Chuva",
        icon: "rain",
        max: 21,
        min: 13,
        rainChance: 80,
        sunrise: "05:52",
        sunset: "18:03",
      },
      {
        date: "2026-09-25",
        name: "Amanhã",
        label: "Nublado",
        icon: "cloud",
        max: 24,
        min: 15,
        rainChance: 20,
      },
      {
        date: "2026-09-26",
        name: "Depois de amanhã",
        label: "Tempestade",
        icon: "thunder",
        max: 27,
        min: 17,
        rainChance: 70,
      },
    ],
    hours: hours(14, [
      ["partly", 20, 10],
      ["cloud", 20, 25],
      ["rain", 19, 70],
      ["heavy-rain", 18, 90],
      ["rain", 17, 60],
      ["drizzle", 16, 40],
      ["cloud", 16, 20],
      ["partly-night", 15, 10],
      ["moon", 15, 0],
      ["moon", 14, 0],
      ["fog", 14, 0],
      ["fog", 13, 0],
    ]),
    alert: "Chuva prevista em ~30 min",
  },
  "weather-night": {
    kind: "weather",
    place: "Curitiba, Paraná",
    now: {
      temperature: 9,
      feelsLike: 6,
      label: "Noite limpa",
      icon: "moon",
      humidity: 64,
      windKmh: 8,
    },
    days: [
      {
        date: "2026-09-24",
        name: "Hoje",
        label: "Céu limpo",
        icon: "sun",
        max: 18,
        min: 7,
        rainChance: 0,
      },
      {
        date: "2026-09-25",
        name: "Amanhã",
        label: "Céu limpo",
        icon: "sun",
        max: 21,
        min: 8,
        rainChance: 5,
      },
      {
        date: "2026-09-26",
        name: "Depois de amanhã",
        label: "Parcialmente nublado",
        icon: "partly",
        max: 22,
        min: 11,
        rainChance: 10,
      },
    ],
    hours: hours(21, [
      ["moon", 9, 0],
      ["moon", 8, 0],
      ["partly-night", 8, 0],
      ["partly-night", 7, 0],
      ["fog", 7, 0],
      ["fog", 7, 0],
      ["fog", 6, 0],
      ["fog", 6, 0],
      ["fog", 7, 0],
      ["partly", 9, 0],
      ["sun", 12, 0],
      ["sun", 14, 0],
    ]),
  },
};

// Coordinates along a real-looking drive (Paulista → Congonhas), encoded as Google does.
const PATH = String.raw`bmynCfwv{GnF_IzE_IfJcG~HsDzYcGbVwGnFzE~HfJ~\~Rb[nP~\bLz^bL~a@fJn_@nFnZfJ~MSzJkCfTwGbL_NfEbBnArD`;

const ROUTES: Record<string, Route> = {
  route: {
    from: "Av. Paulista, 1000",
    to: "Aeroporto de Congonhas",
    mode: "driving",
    duration: "26 min",
    distance: "8,4 km",
    via: "Av. 23 de Maio",
    leaveBy: "09:15",
    arriveBy: "09:45",
    warnings: ["Trânsito intenso na Av. 23 de Maio (+8 min)"],
    steps: [
      "Siga pela Av. Paulista em direção à Av. Brigadeiro Luís Antônio",
      "Vire à direita na Av. Brigadeiro Luís Antônio",
      "Pegue a Av. 23 de Maio sentido aeroporto",
      "Continue pela Av. Rubem Berta",
      "Siga pela Av. Moreira Guimarães",
      "Entre à direita no acesso ao Aeroporto de Congonhas",
    ],
    polyline: PATH,
  },
  "route-transit": {
    from: "Estação Consolação",
    to: "Parque Ibirapuera, portão 3",
    mode: "transit",
    duration: "34 min",
    distance: "5,1 km",
    via: "Linha 4-Amarela e ônibus 5185",
    leaveBy: "14:10",
  },
};

/** Tool-backed elements (their own cards, not show_results). */
const TOOL_ELEMENTS: Record<string, () => ReactNode> = {
  ...Object.fromEntries(
    Object.entries(WEATHER).map(([name, report]) => [name, () => <WeatherCard report={report} />]),
  ),
  "weather-icons": () => (
    <View style={[s.row, { flexWrap: "wrap", gap: 12 }]}>
      {WEATHER_ICONS.map((name) => (
        <View key={name} style={{ alignItems: "center", gap: 4, width: 64 }}>
          <WeatherIcon name={name} size={32} tile={52} />
          <Text style={{ fontSize: 10, color: colors.muted }}>{name}</Text>
        </View>
      ))}
    </View>
  ),
  ...Object.fromEntries(
    Object.entries(ROUTES).map(([name, route]) => [
      name,
      () => <RouteCard route={route} mapsUrl={mapsUrlFor(route)} />,
    ]),
  ),
};

/** Design review (web: /elements): every structured answer element at phone width. */
export function ElementsGallery() {
  const only =
    typeof location === "undefined" ? null : new URLSearchParams(location.search).get("only");
  const entries: [string, () => ReactNode][] = [
    ...Object.entries(ELEMENT_FIXTURES).map(([name, fixture]): [string, () => ReactNode] => [
      name,
      () => <ResultsCard {...fixture} />,
    ]),
    ...Object.entries(TOOL_ELEMENTS),
  ].filter(([name]) => !only || name === only);
  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: 16, gap: 22, alignItems: "stretch" }}
    >
      {entries.map(([name, render]) => (
        <View key={name} style={{ gap: 8 }} testID={`element-${name}`}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 1 }}>
            {name.toUpperCase()}
          </Text>
          <View style={{ alignSelf: "flex-start", width: "95%" }}>{render()}</View>
        </View>
      ))}
    </ScrollView>
  );
}
