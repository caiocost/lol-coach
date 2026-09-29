// Nomes de campeão, e como casá-los com o que a Live Client API devolve.
//
// POR QUE ISTO EXISTE COMO MÓDULO PRÓPRIO, E ESTÁTICO: o alertRules.ts é puro
// -- sem rede, sem relógio, sem IO -- porque é isso que permite validar uma
// regra na hora em que o usuário a cria e reusar o mesmo motor no backtest. O
// damageType.ts até busca o champion.json do Data Dragon, mas é `async` e
// depende da rede: se a validação dependesse dele, um pedido feito com a
// internet oscilando recusaria um campeão que existe. Validar nome de campeão
// é a última coisa que pode virar intermitente, então a lista mora aqui,
// congelada, e a atualização é uma edição de código quando sai campeão novo.
//
// O NOME É O DE EXIBIÇÃO, NÃO A CHAVE DO DATA DRAGON. Isto foi verificado
// contra gravação real de partida (recordings/): a API devolve "Master Yi"
// (com espaço) e "Kai'Sa" (com apóstrofo e S maiúsculo), enquanto as chaves do
// Data Dragon para os mesmos campeões são "MasterYi" e "Kaisa". Validar contra
// a chave teria recusado exatamente os nomes que a API produz.
//
// LOCALE: a Live Client API devolve o nome no idioma do CLIENTE. Comparando
// en_US com pt_BR na versão 16.18.1, só dois campeões mudam de nome -- Bard/
// Bardo e "Nunu & Willump"/"Nunu e Willump". Os dois estão nos APELIDOS
// abaixo, então a regra casa com o cliente em inglês ou em português sem o
// usuário ter que saber em que idioma o jogo dele está.

/**
 * Nomes de exibição, como a API os escreve (en_US da versão 16.18.1).
 *
 * Serve para RECUSAR nome que não existe. Sem esta lista, um campeão
 * inventado pelo modelo ("Leblank") passaria na validação e viraria uma regra
 * que nunca dispara -- a pior falha possível aqui, porque é silenciosa: o
 * usuário grava a voz, confia no alerta e espera a partida inteira.
 */
export const CAMPEOES = [
  "Aatrox", "Ahri", "Akali", "Akshan", "Alistar", "Ambessa", "Amumu",
  "Anivia", "Annie", "Aphelios", "Ashe", "Aurelion Sol", "Aurora", "Azir",
  "Bard", "Bel'Veth", "Blitzcrank", "Brand", "Braum", "Briar", "Caitlyn",
  "Camille", "Cassiopeia", "Cho'Gath", "Corki", "Darius", "Diana",
  "Dr. Mundo", "Draven", "Ekko", "Elise", "Evelynn", "Ezreal",
  "Fiddlesticks", "Fiora", "Fizz", "Galio", "Gangplank", "Garen", "Gnar",
  "Gragas", "Graves", "Gwen", "Hecarim", "Heimerdinger", "Hwei", "Illaoi",
  "Irelia", "Ivern", "Janna", "Jarvan IV", "Jax", "Jayce", "Jhin", "Jinx",
  "K'Sante", "Kai'Sa", "Kalista", "Karma", "Karthus", "Kassadin", "Katarina",
  "Kayle", "Kayn", "Kennen", "Kha'Zix", "Kindred", "Kled", "Kog'Maw",
  "LeBlanc", "Lee Sin", "Leona", "Lillia", "Lissandra", "Locke", "Lucian",
  "Lulu", "Lux", "Malphite", "Malzahar", "Maokai", "Master Yi", "Mel",
  "Milio", "Miss Fortune", "Mordekaiser", "Morgana", "Naafiri", "Nami",
  "Nasus", "Nautilus", "Neeko", "Nidalee", "Nilah", "Nocturne",
  "Nunu & Willump", "Olaf", "Orianna", "Ornn", "Pantheon", "Poppy", "Pyke",
  "Qiyana", "Quinn", "Rakan", "Rammus", "Rek'Sai", "Rell", "Renata Glasc",
  "Renekton", "Rengar", "Riven", "Rumble", "Ryze", "Samira", "Sejuani",
  "Senna", "Seraphine", "Sett", "Shaco", "Shen", "Shyvana", "Singed", "Sion",
  "Sivir", "Skarner", "Smolder", "Sona", "Soraka", "Swain", "Sylas",
  "Syndra", "Tahm Kench", "Taliyah", "Talon", "Taric", "Teemo", "Thresh",
  "Tristana", "Trundle", "Tryndamere", "Twisted Fate", "Twitch", "Udyr",
  "Urgot", "Varus", "Vayne", "Veigar", "Vel'Koz", "Vex", "Vi", "Viego",
  "Viktor", "Vladimir", "Volibear", "Warwick", "Wukong", "Xayah", "Xerath",
  "Xin Zhao", "Yasuo", "Yone", "Yorick", "Yunara", "Yuumi", "Zaahen", "Zac",
  "Zed", "Zeri", "Ziggs", "Zilean", "Zoe", "Zyra",
] as const;

/**
 * Outras formas de escrever o mesmo campeão -> nome canônico.
 *
 * Duas famílias, por motivos diferentes:
 *
 *   1. LOCALE. "Bardo" e "Nunu e Willump" são o que um cliente em português
 *      devolve. Sem eles, a regra criada por um usuário brasileiro não casaria
 *      com a própria partida dele.
 *   2. COMO AS PESSOAS ESCREVEM. "mundo" por "Dr. Mundo", "yi" por "Master
 *      Yi", "mf" por "Miss Fortune". O usuário fala do campeão pelo apelido, e
 *      recusar por causa disso seria recusar por formalidade, não por falta de
 *      dado.
 *
 * As chaves passam pelo mesmo normalizar() dos nomes, então não precisam de
 * acento nem de maiúscula corretos aqui.
 */
const APELIDOS: Record<string, string> = {
  // locale pt_BR
  bardo: "Bard",
  nunuewillump: "Nunu & Willump",
  nunu: "Nunu & Willump",
  // apelidos de uso comum
  mundo: "Dr. Mundo",
  drmundo: "Dr. Mundo",
  yi: "Master Yi",
  mf: "Miss Fortune",
  tf: "Twisted Fate",
  ali: "Alistar",
  blitz: "Blitzcrank",
  cait: "Caitlyn",
  cho: "Cho'Gath",
  eve: "Evelynn",
  fiddle: "Fiddlesticks",
  ez: "Ezreal",
  j4: "Jarvan IV",
  jarvan: "Jarvan IV",
  kha: "Kha'Zix",
  kog: "Kog'Maw",
  lb: "LeBlanc",
  leesin: "Lee Sin",
  lee: "Lee Sin",
  malf: "Malphite",
  morde: "Mordekaiser",
  naut: "Nautilus",
  sera: "Seraphine",
  tahm: "Tahm Kench",
  trynda: "Tryndamere",
  voli: "Volibear",
  ww: "Warwick",
  xin: "Xin Zhao",
  asol: "Aurelion Sol",
  velkoz: "Vel'Koz",
  reksai: "Rek'Sai",
  ksante: "K'Sante",
  belveth: "Bel'Veth",
  kaisa: "Kai'Sa",
};

/**
 * Reduz um nome à forma que se compara.
 *
 * Tira acento, apóstrofo, ponto, espaço, "&"/"e" e maiúscula, porque nenhuma
 * dessas coisas distingue dois campeões -- mas todas distinguem a forma como o
 * usuário digita ("leblanc") da forma como a API escreve ("LeBlanc"). Sem
 * isto, a regra validaria e nunca dispararia.
 *
 * NFD + remoção de diacríticos cobre o acento que o usuário digita em
 * português ("Céu"/"Ceu") sem precisar de lista de casos.
 */
export function normalizarCampeao(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");        // espaço, apóstrofo, ponto, &, hífen
}

// Índice construído uma vez: normalizado -> nome canônico.
const INDICE = new Map<string, string>();
for (const c of CAMPEOES) INDICE.set(normalizarCampeao(c), c);
for (const [apelido, canonico] of Object.entries(APELIDOS)) {
  INDICE.set(normalizarCampeao(apelido), canonico);
}

/**
 * Resolve o que o usuário (ou o modelo) escreveu para o nome canônico.
 *
 * Devolve null quando não existe. NULL É O PONTO DO MÓDULO: é o que permite a
 * validação recusar "Leblank" em vez de aceitar em silêncio uma regra morta.
 */
export function resolverCampeao(nome: unknown): string | null {
  if (typeof nome !== "string" || !nome.trim()) return null;
  return INDICE.get(normalizarCampeao(nome)) ?? null;
}

/**
 * O campeão da regra é este jogador?
 *
 * Compara NORMALIZADO dos dois lados, e não o nome canônico contra o cru: se o
 * cliente do usuário estiver em português, a API manda "Bardo" enquanto a
 * regra guarda "Bard". Normalizar só um dos lados faria o alerta nunca
 * disparar justamente para quem joga em português -- que é o caso deste
 * usuário.
 */
export function mesmoCampeao(daRegra: string, daApi: unknown): boolean {
  if (typeof daApi !== "string") return false;
  const a = resolverCampeao(daRegra);
  const b = resolverCampeao(daApi);
  // Se um dos dois não está na lista (campeão novo que a API já tem e esta
  // lista ainda não), cai na comparação normalizada crua em vez de dizer não.
  if (a && b) return a === b;
  return normalizarCampeao(daRegra) === normalizarCampeao(daApi);
}
