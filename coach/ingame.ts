// In-Game Coach — avisos, sons e luzes AO VIVO durante a partida.
//
// Fonte: Live Client Data API (https://127.0.0.1:2999), que o próprio jogo sobe
// enquanto a partida roda. Não é injeção nem overlay — é leitura da API oficial.
//
// O que ele faz:
//   - cronômetro de todos os objetivos (dragão, vastilarvas, arauto, barão,
//     ancião), contado a partir do evento real de morte;
//   - avisos na tela e em voz (60s/30s antes, objetivo livre, objetivo prestes
//     a sumir, nível 6, inimigos mortos com objetivo perto);
//   - alertas criados pelo usuário (regra montada por IA na criação, avaliada
//     localmente na partida);
//   - luzes no teclado/RAM/placa via OpenRGB (kill, multikill, objetivos, morte).
//
// VOZ: os alertas saem no alto-falante com o áudio GRAVADO pelo usuário
// (sounds/). Alerta sem gravação fica mudo de propósito, e o painel de sons
// marca quais ainda faltam gravar.
//
// Uso: tsx coach/ingame.ts   → http://localhost:7778
import "dotenv/config";
import { createServer } from "node:http";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { request, Agent } from "undici";
import { chaveDeCampeao, versaoDDragon } from "./ddragon.js";
import { marcarTrades, contarSemTrade, mortesJulgaveis, type Abate } from "./trades.js";
import { VoiceQueue } from "./voice.js";
import { RgbBridge } from "./rgbBridge.js";
import { luzes, simularLoading, simularMorte, simularSequencia } from "./rgbClient.js";
import { fileURLToPath } from "node:url";
import { resolverSom, tocar, paraWav } from "./player.js";
import { avaliar, descrever, fontesDoGatilho, type Regra, type Estado } from "./alertRules.js";
import { listarAlertas, salvarAlerta, apagarAlerta } from "./alertStore.js";
import { gerarSom, VOZES } from "./tts.js";
import { criarRegra } from "./alertAuthor.js";
import {
  EventLog, linhaDeEvento, linhaDeAlerta, transicoes, LIMITE_LINHAS,
  type LinhaLog, type FotoPoll,
} from "./eventLog.js";

const PORT = Number(process.env.INGAME_PORT ?? 7778);
const LIVE = "https://127.0.0.1:2999/liveclientdata";
const agent = new Agent({ connect: { rejectUnauthorized: false } });

async function live<T>(path: string): Promise<T | null> {
  try {
    const res = await request(LIVE + path, { dispatcher: agent, headersTimeout: 2000, bodyTimeout: 2000 });
    if (res.statusCode >= 400) { await res.body.dump(); return null; }
    return (await res.body.json()) as T;
  } catch { return null; }
}

interface Deaths { at: number; traded: boolean }

interface State {
  active: boolean;
  gameTime: number;          // segundos
  // `champ` é o nome de EXIBIÇÃO (é o que se lê na tela) e `champKey` a chave
  // do Data Dragon (é o que vira arquivo .png).
  me: { champ: string; champKey: string; k: number; d: number; a: number; cs: number; ward: number };
  // `up` = já está no mapa há `inSec` segundos, esperando alguém pegar.
  nextObjective: { name: string; inSec: number; up: boolean } | null;
  // TODOS os objetivos, não só o próximo: com um slot só, o Arauto nunca
  // aparecia e o Dragão parecia repetir.
  objectives: Objective[];
  // `id` identifica o TIPO de alerta (estável entre polls) e `fireId` uma
  // OCORRÊNCIA específica. O som só toca quando aparece um fireId novo —
  // sem isso o áudio repetiria a cada segundo enquanto a condição durasse.
  alerts: { id: string; fireId: string; level: "warn" | "info" | "good"; text: string; sound: string }[];
  // Console bruto: tudo que a API expõe, pra inspecionar e decidir o que vale
  // virar alerta.
  raw: {
    events: { t: number; name: string; detail: string }[];
    stats: { k: string; v: string }[];     // championStats do jogador ativo
    players: { name: string; champ: string; champKey: string; team: string; kda: string; cs: number; lvl: number; items: string; itemIds: number[]; dead: boolean; respawn: number }[];
    game: { k: string; v: string }[];
    fields: { path: string; sample: string }[];  // mapa de campos disponíveis
  };
  // Log cronológico e legível do que a API expôs nesta partida. `raw` é o
  // ESQUEMA reescrito a cada poll; isto é a HISTÓRIA acumulada.
  log: LinhaLog[];
}

const emptyRaw = (): State["raw"] => ({ events: [], stats: [], players: [], game: [], fields: [] });

// O log de eventos vive fora do `state` porque ACUMULA entre polls, enquanto
// o `state` é reconstruído inteiro a cada leitura. Só uma cópia entra no
// payload de /state na hora de responder.
const eventLog = new EventLog();

// Quantas linhas viajam no /state a cada segundo.
//
// O log guarda até LIMITE_LINHAS (300) em memória, mas mandar as 300 a cada
// poll custa ~45 KB/s de JSON — 2,7 MB por minuto de partida, serializados e
// reparseados sem que quase nada tenha mudado. 120 linhas cobrem de sobra o
// que cabe na rolagem do painel (~14 visíveis) e derrubam o payload pra ~18 KB.
// O histórico completo da partida, esse, já está em recordings/*.json.
const LOG_NA_TELA = 120;

// A voz mora aqui, não na página: o servidor decide quando e o que toca.
//
// (removido) existia aqui um NarratorQueue — frases escritas por modelo na
// nuvem — e um PiperClient de voz sintética. Os dois saíram: o coach só fala
// com a voz gravada pelo usuário. Não reintroduza sem essa decisão mudar.
const voice = new VoiceQueue({ resolverSom, tocar });
// COACH_VOZ=0 sobe com a voz desligada (dá pra ligar pelo botão da página).
if (process.env.COACH_VOZ === "0") voice.habilitado = false;

// Alertas criados pelo usuário. Recarregados sob demanda (a página avisa
// quando cria ou apaga) em vez de a cada poll: ler o disco 1x/s por uma lista
// que muda raramente é desperdício.
//
// COMEÇA VAZIA E CARREGA EM SEGUNDO PLANO, em vez de `await` no topo: um
// `await` aqui adiaria a avaliação do resto do módulo até o disco responder,
// e o resto do módulo inclui o `setInterval` do poll e o `listen` do
// servidor. Um arquivo lento não pode atrasar a subida do coach; a lista
// entrar um instante depois não custa nada, porque só é lida durante partida.
let regrasDoUsuario: Regra[] = [];
async function recarregarRegras() {
  regrasDoUsuario = await listarAlertas();
}
void recarregarRegras().catch((e) => {
  console.error(`  [alertas] falha ao carregar: ${e?.message ?? e}`);
});

/** Regras já satisfeitas, para disparar na transição e não a cada segundo. */
let ativas = new Set<string>();
/** EventNames já vistos nesta partida, para as regras do usuário. */
let eventosVistos = new Set<string>();

let state: State = {
  active: false, gameTime: 0,
  me: { champ: "", champKey: "", k: 0, d: 0, a: 0, cs: 0, ward: 0 },
  nextObjective: null, objectives: [], alerts: [], raw: emptyRaw(), log: [],
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Descreve um evento em uma linha legível, sem perder os campos que ele traz.
function describeEvent(e: any): string {
  const skip = new Set(["EventID", "EventName", "EventTime"]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (skip.has(k)) continue;
    parts.push(`${k}=${Array.isArray(v) ? `[${v.join(", ")}]` : v}`);
  }
  return parts.join("  ");
}

// Mapa de campos disponíveis: caminho + valor de exemplo. É isso que permite
// descobrir métricas novas sem adivinhar.
function mapFields(obj: any, prefix = "", out: { path: string; sample: string }[] = [], depth = 0): { path: string; sample: string }[] {
  if (depth > 2 || !obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) { out.push({ path, sample: "null" }); continue; }
    if (Array.isArray(v)) {
      out.push({ path: `${path}[]`, sample: `${v.length} itens` });
      if (v.length && typeof v[0] === "object") mapFields(v[0], `${path}[0]`, out, depth + 1);
      continue;
    }
    if (typeof v === "object") { mapFields(v, path, out, depth + 1); continue; }
    const s = String(v);
    out.push({ path, sample: s.length > 42 ? s.slice(0, 42) + "…" : s });
  }
  return out;
}

// eventos já processados (a API reenvia o histórico inteiro a cada chamada)
let seenEvents = new Set<number>();
// Abates da partida e mortes suas: alimentam o campo `mortesSemTrade` que os
// alertas do usuário podem usar (ver trades.ts).
let todosAbates: Abate[] = [];
let myDeaths: Deaths[] = [];
let csAt15: number | null = null;

// Timers do patch atual (26.x). Conferidos na wiki e nos patch notes oficiais
// em 12/09/2026 — o 26.01 reverteu várias mudanças de 2025, então guia antigo
// engana. O que mudou em relação ao que eu tinha aqui:
//   - Arauto nasce às 15:00, não 14:00 (V25.09 baixou de 16 para 15).
//   - Arauto SOME às 19:45 mesmo se ninguém pegar; não havia despawn no código.
//   - Barão voltou a 20:00 no 26.01 (tinha ido a 25:00 em 2025).
//   - Ancião só nasce 6min depois do 4º drake de UM time, não do 4º no total.
//   - Voidgrubs existem, nascem às 8:00 e somem às 14:45 — não eram avisados.
//   - Atakhan foi REMOVIDO no 26.01; não tratar.
const DRAGON_FIRST = 5 * 60;
const DRAGON_RESPAWN = 5 * 60;
const DRAGONS_FOR_SOUL = 4;        // 4 drakes de um time fecham a alma
const ELDER_AFTER_SOUL = 6 * 60;   // Ancião nasce 6min depois disso
const ELDER_RESPAWN = 6 * 60;
const BARON_SPAWN = 20 * 60;
const BARON_RESPAWN = 6 * 60;
const HERALD_SPAWN = 15 * 60;
const HERALD_DESPAWN = 19 * 60 + 45;
const GRUBS_SPAWN = 8 * 60;
const GRUBS_DESPAWN = 14 * 60 + 45;

// Nível de cada jogador no poll anterior. A Live Client API não emite evento
// de level up — só expõe o nível atual —, então a transição para o 6 é
// detectada comparando polls.

let prevLevels = new Map<string, number>();

// O que já se VIU do time inimigo, para os gatilhos inimigo-nivel/inimigo-item.
//
// ACUMULA e nunca diminui dentro da partida, de propósito: a Live Client API
// aplica fog of war, então o inimigo sumir do campo de visão não desfaz o que
// ele já mostrou. Se isto espelhasse só o instante, o alerta piscaria a cada
// ida dele pro mato — e o usuário aprenderia a ignorá-lo.
let maiorNivelInimigoVisto = 0;
let itensInimigosVistos = new Set<number>();

let lastDragonKill: number | null = null;
let lastBaronKill: number | null = null;
let heraldTaken = false;
let grubsTaken = false;
// Drakes por TIME: a alma é de quem fechou 4, não do total da partida.
let dragonsByTeam: Record<string, number> = { ORDER: 0, CHAOS: 0 };
// Quando a alma fechou — o Ancião nasce 6min depois disso, não na hora.
let soulAt: number | null = null;
let lastElderKill: number | null = null;

/** Quando o próximo objetivo relevante nasce, dado o que já morreu. */
/** Um objetivo e seu estado agora. `up` = está no mapa esperando alguém. */
export interface Objective {
  name: string;
  /** Segundos até nascer (up=false) ou há quanto tempo está de pé (up=true). */
  inSec: number;
  up: boolean;
  /** Some do mapa neste segundo de jogo, se tiver prazo. */
  expiresAt?: number;
}

/**
 * Estado de TODOS os objetivos, não só do próximo.
 *
 * Antes isto devolvia um objetivo só, e daí vinham dois erros reportados em
 * partida: o Arauto nunca era anunciado (o Barão ou o Dragão sempre ganhavam
 * a disputa pelo único slot) e o Dragão parecia repetir (sendo o único
 * mostrado, seu alerta era o único que aparecia).
 *
 * Agora cada objetivo é rastreado por conta própria e a tela mostra todos os
 * relevantes. Nenhum tempo é fixo por ciclo: tudo conta a partir do evento
 * real de morte.
 */
function objectiveState(t: number): Objective[] {
  const out: Objective[] = [];
  const add = (name: string, at: number, expiresAt?: number) => {
    if (expiresAt !== undefined && t >= expiresAt) return;   // já sumiu do mapa
    out.push(
      at > t
        ? { name, inSec: Math.round(at - t), up: false, expiresAt }
        : { name, inSec: Math.round(t - at), up: true, expiresAt },
    );
  };

  // DRAGÃO / ANCIÃO — o pit é o mesmo, mas as regras mudam quando a alma fecha.
  //
  // Antes da alma: drake elemental, 5:00 o primeiro e 5:00 após cada morte.
  // Depois que um time fecha 4 drakes: não nascem mais elementais, e o Ancião
  // aparece 6min DEPOIS da alma (não na hora) e repete 6min após cada morte.
  if (soulAt === null) {
    add("Dragão", lastDragonKill === null ? DRAGON_FIRST : lastDragonKill + DRAGON_RESPAWN);
  } else {
    add("Dragão Ancião",
      lastElderKill === null ? soulAt + ELDER_AFTER_SOUL : lastElderKill + ELDER_RESPAWN);
  }

  // VOIDGRUBS — 8:00, uma leva só, somem às 14:45. Não respawnam.
  if (!grubsTaken) add("Voidgrubs", GRUBS_SPAWN, GRUBS_DESPAWN);

  // ARAUTO — 15:00, uma vez só, some às 19:45 mesmo se ninguém pegar.
  // Era aqui o bug: o código antigo o descartava depois dos 15:00, então ele
  // nunca era anunciado durante a janela em que estava de fato disponível.
  if (!heraldTaken) add("Arauto", HERALD_SPAWN, HERALD_DESPAWN);

  // BARÃO — 20:00; depois, 6min após a morte.
  add("Barão", lastBaronKill === null ? BARON_SPAWN : lastBaronKill + BARON_RESPAWN);

  // No mapa primeiro (janela aberta agora), depois o que nasce mais cedo.
  return out.sort((a, b) => {
    if (a.up !== b.up) return a.up ? -1 : 1;
    return a.up ? b.inSec - a.inSec : a.inSec - b.inSec;
  });
}

/** O objetivo que merece o destaque: o que está de pé, senão o mais próximo. */
function nextObjective(t: number): Objective {
  const all = objectiveState(t);
  return all[0] ?? { name: "Dragão", inSec: 0, up: false };
}

// Luzes RGB: a bridge guarda só a contagem de sequências (para o shutdown);
// o resto do estado (morte, prioridade) mora no daemon.
const rgb = new RgbBridge();
let rgbEmPartida = false;

async function pollInterno() {
  const all = await live<any>("/allgamedata");
  if (!all || !all.activePlayer) {
    if (rgbEmPartida) { rgbEmPartida = false; void luzes.partida(false); }
    state = {
      ...state, active: false, alerts: [], raw: emptyRaw(), objectives: [],
      // O log SOBREVIVE ao fim da partida: é depois do jogo que dá pra reler
      // com calma o que a API expôs e decidir o que virar alerta. Zera só
      // quando uma partida nova começa.
      log: eventLog.recentes(LOG_NA_TELA),
    };
    return;
  }

  const t: number = all.gameData?.gameTime ?? 0;
  const meName: string = all.activePlayer?.riotIdGameName ?? all.activePlayer?.summonerName ?? "";
  const list: any[] = all.allPlayers ?? [];
  const me = list.find((p) => (p.riotIdGameName ?? p.summonerName) === meName);
  if (!me) { state = { ...state, active: false }; return; }

  // partida nova? zera o acumulado
  if (t < state.gameTime - 5) {
    seenEvents = new Set(); todosAbates = []; myDeaths = []; csAt15 = null;
    lastDragonKill = null; lastBaronKill = null; heraldTaken = false;
    prevLevels = new Map();
    maiorNivelInimigoVisto = 0; itensInimigosVistos = new Set();
    grubsTaken = false; dragonsByTeam = { ORDER: 0, CHAOS: 0 };
    soulAt = null; lastElderKill = null;
    // A fila de voz é por partida: sem isto, uma fala enfileirada no fim do
    // jogo anterior poderia sair no começo do próximo.
    voice.reset();
    // Sem isto uma regra que ficou satisfeita no jogo anterior (nível 6, por
    // exemplo) nasceria "já ativa" no novo e nunca mais dispararia.
    ativas = new Set();
    eventosVistos = new Set();
    // Partida nova = log novo.
    eventLog.reset();
    rgb.reset();
  }

  const myTeam: string = me.team;
  const events: any[] = all.events?.Events ?? [];
  // Eventos ainda não vistos neste poll — alimentam as luzes e o log.
  const freshEvents: any[] = [];
  for (const e of events) {
    if (seenEvents.has(e.EventID)) continue;
    seenEvents.add(e.EventID);
    freshEvents.push(e);

    // Nomes dos eventos desta partida, para as regras do usuário. Acumula em
    // vez de olhar só o poll atual: "quando sair primeiro sangue" precisa
    // continuar valendo depois do segundo em que o evento chegou.
    eventosVistos.add(String(e.EventName ?? ""));

    // Timers de objetivo saem do evento real de morte — é isso que torna a
    // contagem correta em vez de um ciclo fixo chutado.
    if (e.EventName === "DragonKill") {
      const quando = e.EventTime ?? t;
      // Ancião é um dragão à parte: não conta pra alma e tem respawn próprio.
      if (String(e.DragonType ?? "") === "Elder") {
        lastElderKill = quando;
        continue;
      }
      lastDragonKill = quando;
      const timeDoKill = list.find(
        (p: any) => (p.riotIdGameName ?? p.summonerName) === e.KillerName,
      )?.team;
      if (timeDoKill && dragonsByTeam[timeDoKill] !== undefined) {
        dragonsByTeam[timeDoKill]++;
        // 4 drakes de UM time fecham a alma; daí o pit passa a gerar Ancião.
        if (dragonsByTeam[timeDoKill] >= DRAGONS_FOR_SOUL && soulAt === null) {
          soulAt = quando;
        }
      }
      continue;
    }
    if (e.EventName === "BaronKill") { lastBaronKill = e.EventTime ?? t; continue; }
    if (e.EventName === "HeraldKill") { heraldTaken = true; continue; }
    if (e.EventName === "HordeKill") { grubsTaken = true; continue; }


    if (e.EventName !== "ChampionKill") continue;
    const killer = list.find((p) => (p.riotIdGameName ?? p.summonerName) === e.KillerName);
    todosAbates.push({
      at: e.EventTime,
      killer: e.KillerName ?? "",
      victim: e.VictimName ?? "",
      assisters: Array.isArray(e.Assisters) ? e.Assisters : [],
      doMeuTime: !!killer && killer.team === myTeam,
    });
    if (e.VictimName === meName) myDeaths.push({ at: e.EventTime, traded: false });
  }
  // Luzes: fire-and-forget, nunca espera o daemon. O /estado a cada poll é
  // também o heartbeat que mantém o flag de partida (o "Beber Água" agendado
  // espera a próxima morte em vez de tomar o teclado no meio da luta).
  {
    const nomeDe = (p: any) => String(p.riotIdGameName ?? p.summonerName ?? "");
    const aliados = new Set(list.filter((p) => p.team === myTeam).map(nomeDe));
    const cmds = rgb.processar(freshEvents, {
      eu: meName, meuTime: myTeam, aliados, campeao: String(me.championName ?? ""),
    }, t);
    void luzes.comandos(cmds);
    void luzes.estado(!!me.isDead, Number(me.respawnTimer ?? 0));
    rgbEmPartida = true;
  }

  // Morte sem trade: nenhuma meta embutida — o número só alimenta as regras
  // que o usuário criar (campo `mortesSemTrade`). Só conta veredito fechado.
  marcarTrades(myDeaths, todosAbates, meName);
  const noTrade = contarSemTrade(mortesJulgaveis(myDeaths, t));

  const cs = (me.scores?.creepScore ?? 0);
  if (t >= 900 && csAt15 === null) csAt15 = cs;
  const csPost = csAt15 !== null && t > 900 ? (cs - csAt15) / ((t - 900) / 60) : null;

  const post15 = t >= 900;
  const objetivos = objectiveState(t);
  const nx = objetivos[0] ?? nextObjective(t);

  // ---- nível 6 ----
  // Compara com o poll anterior. Na primeira leitura da partida só registra,
  // sem disparar: se você abrir o coach com a partida em andamento, ninguém
  // "acabou de" chegar ao 6 — anunciar cinco ults de uma vez seria ruído.
  const primeiraLeitura = prevLevels.size === 0;
  const dinged6: { champ: string; enemy: boolean; role: string }[] = [];
  for (const p of list) {
    const nome = p.riotIdGameName ?? p.summonerName ?? "";
    const lvl = p.level ?? 0;
    const antes = prevLevels.get(nome);
    if (!primeiraLeitura && antes !== undefined && antes < 6 && lvl >= 6) {
      dinged6.push({
        champ: p.championName ?? "?",
        enemy: p.team !== myTeam,
        role: p.position ?? "",
      });
    }
    prevLevels.set(nome, lvl);

    // O que o inimigo mostrou nesta leitura alimenta os gatilhos do usuário.
    // Vem do mesmo lugar que o alerta ult6 embutido já lia há tempos — era
    // incoerente o coach anunciar o nível 6 inimigo e a IA recusar a fazer o
    // mesmo.
    //
    // COMO O FOG OF WAR APARECE AQUI: a API NÃO omite o jogador fora de visão
    // — `allPlayers` devolve os dez SEMPRE. O que acontece é que `level` e
    // `items` de quem está no escuro CONGELAM no último valor conhecido, e só
    // saltam pro valor real quando o inimigo reaparece.
    //
    // Verificado nas 13 gravações em recordings/: todas têm 10 jogadores em
    // setup.players (que é um map direto sobre allPlayers no primeiro poll),
    // incluindo gravações iniciadas em t=918s, 876s e 869s de partida, quando
    // os cinco inimigos não podiam estar todos visíveis.
    //
    // O acumulado abaixo continua certo, mas por outro motivo: não é que falte
    // dado a preservar, é que o dado presente está defasado. Acumular garante
    // que um valor já observado não seja substituído por um congelado antigo.
    if (p.team !== myTeam) {
      if (lvl > maiorNivelInimigoVisto) maiorNivelInimigoVisto = lvl;
      for (const i of p.items ?? []) {
        if (i?.itemID) itensInimigosVistos.add(i.itemID);
      }
    }
  }

  // ---- alertas ----
  // Cada um tem um `sound` (nome do arquivo em sounds/) e um `fireId` que muda
  // só quando é uma ocorrência NOVA — é o fireId que autoriza tocar o áudio.
  const alerts: State["alerts"] = [];
  const A = (id: string, fireId: string, level: "warn" | "info" | "good", text: string, sound: string) => {
    alerts.push({ id, fireId, level, text, sound });
  };

  // objetivo chegando: dispara uma vez por janela (60s e 30s antes)
  // Um alerta POR objetivo. Antes só o "próximo" era avaliado, então o Arauto
  // nascendo às 15:00 era silenciado pelo Barão e pelo Dragão.
  for (const o of objetivos) {
    if (o.up) continue;                       // objetivo de pé tem alerta próprio
    // O fireId ancora no SPAWN deste objetivo, não no minuto do relógio.
    // Com `Math.floor(t / 60)` o alerta disparava de novo toda vez que a
    // janela atravessava a virada do minuto — daí o aviso repetido e a
    // impressão de cadência fixa de 5 em 5, mesmo com o cálculo correto.
    const spawn = Math.round(t + o.inSec);
    if (o.inSec <= 60 && o.inSec > 45) {
      A(`obj-60-${o.name}`, `obj60-${o.name}-${spawn}`, "info",
        `${o.name} em ${o.inSec}s — comece a andar pro rio`, "objetivo-60.mp3");
    } else if (o.inSec <= 32 && o.inSec > 12) {
      A(`obj-30-${o.name}`, `obj30-${o.name}-${spawn}`, "warn",
        `${o.name} em ${o.inSec}s — esteja no rio AGORA, com visão posta`, "objetivo-30.mp3");
    }
  }

  // nível 6: o seu e o dos inimigos
  for (const d of dinged6) {
    if (d.enemy) {
      A("ult6", `ult6-${d.champ}`, "warn",
        `${d.champ} chegou ao nível 6 — ultimate disponível`, "nivel-6-inimigo.mp3");
    } else {
      A("ult6-eu", "ult6-eu", "good",
        "Você chegou ao nível 6 — ultimate disponível", "nivel-6-seu.mp3");
    }
  }

  // Objetivo de pé e ninguém pegou.
  //
  // Este bloco tinha três problemas que juntos produziam "avisa 30 segundos
  // pro dragão toda hora enquanto ele tá vivo":
  //
  //   1. SOM ERRADO: usava objetivo-30.mp3, o áudio gravado dizendo "objetivo
  //      agora, rio com visão" — ou seja, o aviso de 30s PARA NASCER. Com o
  //      dragão já no mapa, o que se ouvia era o alerta errado.
  //   2. REPETIA PARA SEMPRE: o fireId mudava a cada 90s, então enquanto
  //      ninguém pegasse o objetivo (o que pode durar a partida inteira) o
  //      aviso voltava indefinidamente.
  //   3. AVISAVA CEDO DEMAIS: qualquer objetivo de pé há mais de 20s
  //      disparava, mesmo o dragão que acabou de nascer e o time já está indo.
  //
  // Agora: no máximo DUAS vezes por ocorrência, só depois de 45s de pé (tempo
  // de o time reagir sozinho), e com som próprio. Objetivo com prazo a
  // vencer continua tendo prioridade, porque ali a perda é definitiva.
  for (const o of objetivos) {
    if (!o.up) continue;

    const sobra = o.expiresAt !== undefined ? Math.round(o.expiresAt - t) : null;

    // Prazo vencendo (Arauto às 19:45, Voidgrubs às 14:45): aviso único, e
    // a âncora é o próprio prazo, então não repete.
    if (sobra !== null && sobra <= 75 && sobra > 10) {
      A(`obj-expira-${o.name}`, `objexp-${o.name}-${o.expiresAt}`, "warn",
        `${o.name} some em ${sobra}s — pegue agora ou perde`, "objetivo-expira.mp3");
      continue;
    }

    // Sem prazo (dragão, barão): lembra que está livre, mas só duas vezes.
    // O fireId ancora no instante do SPAWN (t - inSec), que é constante
    // durante toda a ocorrência — por isso a repetição é contada, não infinita.
    if (o.inSec < 45) continue;
    const spawnEm = Math.round(t - o.inSec);
    const rodada = o.inSec >= 150 ? 2 : 1;          // 45s e 2min30 de pé
    A(`obj-vivo-${o.name}`, `objvivo-${o.name}-${spawnEm}-${rodada}`, "warn",
      `${o.name} está no mapa há ${mmss(o.inSec)} — ninguém pegou ainda`,
      "objetivo-livre.mp3");
  }

  // inimigos mortos = janela de objetivo grátis
  const deadEnemies = list.filter((p: any) => p.team !== myTeam && p.isDead);
  if (post15 && deadEnemies.length >= 2 && (nx.up || nx.inSec < 90)) {
    A("janela", `janela-${Math.floor(t / 30)}`, "good",
      `${deadEnemies.length} inimigos mortos e ${nx.name} perto — janela de objetivo AGORA`, "janela-objetivo.mp3");
  }

  // ---- alertas do usuário ----
  // O estado vai montado aqui, e não dentro do motor: o motor é puro de
  // propósito, pra ser testável sem partida.
  const estadoRegras: Estado = {
    t,
    meuNivel: me.level ?? 0,
    meusAbates: me.scores?.kills ?? 0,
    minhasMortes: me.scores?.deaths ?? 0,
    minhasAssistencias: me.scores?.assists ?? 0,
    mortesSemTrade: noTrade,
    cs,
    csMinPost15: csPost,
    ouro: Math.round(all.activePlayer?.currentGold ?? 0),
    meusItens: (me.items ?? []).map((i: any) => i.itemID).filter(Boolean),
    inimigosMortos: list.filter((p: any) => p.team !== myTeam && p.isDead).length,
    // Os mesmos campos que o painel bruto já mostra (isDead/respawnTimer), só
    // que entregues ao motor de regras. Não há acumulação aqui, ao contrário
    // de nível e item: morte é anunciada globalmente, então o instantâneo é o
    // estado real — guardar histórico faria o alerta continuar verdadeiro
    // depois de o inimigo já ter voltado.
    inimigos: list
      .filter((p: any) => p.team !== myTeam)
      .map((p: any) => ({
        campeao: String(p.championName ?? ""),
        morto: !!p.isDead,
        respawnEm: Math.max(0, Math.round(p.respawnTimer ?? 0)),
      })),
    maiorNivelInimigoVisto,
    itensInimigosVistos: [...itensInimigosVistos],
    eventos: [...eventosVistos],
    // Os MESMOS tempos que alimentam os alertas nativos obj-60/obj-30. Sem
    // este campo o motor não tinha o que avaliar, e uma regra de objetivo
    // passaria na validação para nunca disparar em partida.
    objetivos: objetivos.map((o) => ({ nome: o.name, inSec: o.inSec, up: o.up })),
  };

  for (const regra of regrasDoUsuario) {
    if (!avaliar(regra, estadoRegras)) {
      ativas.delete(regra.id);
      continue;
    }
    // Dispara na TRANSIÇÃO: a condição costuma continuar verdadeira depois
    // (nível 6 vale até o fim da partida), e sem isto o alerta soaria a cada
    // segundo — o mesmo defeito que o alerta de objetivo teve em 42087cd.
    if (ativas.has(regra.id)) continue;
    ativas.add(regra.id);
    A(regra.id, `usr-${regra.id}-${Math.round(t)}`,
      regra.prioridade === 1 ? "warn" : "info", regra.texto, `${regra.som}.mp3`);
  }

  // ---- console bruto ----
  const raw: State["raw"] = {
    events: events.slice(-40).reverse().map((e: any) => ({
      t: e.EventTime, name: e.EventName, detail: describeEvent(e),
    })),
    stats: Object.entries(all.activePlayer?.championStats ?? {})
      .map(([k, v]) => ({ k, v: typeof v === "number" ? (Math.round(v * 100) / 100).toString() : String(v) })),
    players: list.map((p: any) => ({
      name: p.riotIdGameName ?? p.summonerName ?? "?",
      // championName aqui vem da LIVE CLIENT API, ou seja, é nome de exibição
      // ("Kai'Sa") — por isso passa pelo chaveDeCampeao(), diferente do que a
      // Match-v5 manda. É pura e síncrona: o poll não paga rede por isto.
      champ: p.championName, champKey: chaveDeCampeao(p.championName), team: p.team,
      kda: `${p.scores?.kills ?? 0}/${p.scores?.deaths ?? 0}/${p.scores?.assists ?? 0}`,
      cs: p.scores?.creepScore ?? 0,
      lvl: p.level ?? 0,
      items: (p.items ?? []).map((i: any) => i.displayName).filter(Boolean).join(", ") || "—",
      itemIds: (p.items ?? []).map((i: any) => i.itemID).filter((i: any) => Number.isFinite(i) && i > 0),
      dead: !!p.isDead, respawn: Math.round(p.respawnTimer ?? 0),
    })),
    game: Object.entries(all.gameData ?? {}).map(([k, v]) => ({
      k, v: k === "gameTime" ? mmss(Number(v)) : String(v),
    })),
    fields: mapFields(all).slice(0, 220),
  };

  // ---- log amigável de eventos ----
  //
  // Roda DEPOIS de tudo já estar calculado e só REUSA o que o poll derivou
  // (freshEvents, list, objetivos, alerts).
  // Nada é repolado nem recalculado aqui — o log é uma leitura do trabalho
  // que o poll já fez.
  //
  // O try/catch é a garantia dura: o log é acessório, e um defeito de
  // formatação não pode derrubar o servidor no meio da partida. Se falhar, o
  // poll segue e o log simplesmente para de crescer neste ciclo.
  try {
    const foto: FotoPoll = {
      t,
      niveis: list.map((p: any) => ({
        nome: p.riotIdGameName ?? p.summonerName ?? "?",
        champ: p.championName ?? "?",
        nivel: p.level ?? 0,
        inimigo: p.team !== myTeam,
      })),
      itens: list.map((p: any) => ({
        nome: p.riotIdGameName ?? p.summonerName ?? "?",
        champ: p.championName ?? "?",
        inimigo: p.team !== myTeam,
        itens: (p.items ?? [])
          .filter((i: any) => i?.itemID)
          .map((i: any) => ({ id: i.itemID, nome: String(i.displayName ?? "") })),
      })),
      inimigos: estadoRegras.inimigos,      // já montado acima, não remonta
      objetivos: objetivos.map((o) => ({ name: o.name, inSec: o.inSec, up: o.up })),
      mortesSemTrade: noTrade,
    };
    eventLog.adicionar([
      ...freshEvents.map((e) => linhaDeEvento(e, t)),
      ...transicoes(foto, eventLog.mem),
      ...alerts.map((a) => linhaDeAlerta(a, t)),
    ]);
  } catch (e: any) {
    // O log é acessório: um defeito de formatação não pode derrubar o poll.
    console.error(`  [log] falha ao montar (log segue parado): ${e?.message ?? e}`);
  }

  state = {
    active: true, gameTime: t,
    me: {
      champ: me.championName, champKey: chaveDeCampeao(me.championName),
      k: me.scores?.kills ?? 0, d: me.scores?.deaths ?? 0,
      a: me.scores?.assists ?? 0, cs, ward: Math.round(me.scores?.wardScore ?? 0),
    },
    nextObjective: nx, objectives: objetivos, alerts, raw,
    log: eventLog.recentes(LOG_NA_TELA),
  };

  // ---- voz ----
  // O nome-base do som é a chave da gravação. Se o usuário gravou, toca a voz
  // dele; se não gravou, o alerta sai só na tela — não há fala sintética.
  for (const al of alerts) {
    if (!al.fireId) continue;
    const base = semExtensao(al.sound ?? "");
    const doCatalogo = catalogoPorBase().get(base);
    void voice.falar({
      chave: al.fireId,                       // dedup pela ocorrência
      som: base,                              // qual gravação procurar
      texto: doCatalogo?.suggestion ?? al.text,
      prioridade: al.level === "warn" ? 1 : 2,
      expiraEm: Date.now() + 25000,
    });
  }
}

/**
 * Casca protetora do poll.
 *
 * O poll roda em setInterval, então uma exceção dentro dele derrubava o
 * processo inteiro — no meio da partida, que é o pior momento possível. Já
 * aconteceu: uma corrida no gravador matou o servidor e a tela congelou no
 * último alerta, parecendo alerta repetido sem parar.
 *
 * Aqui a falha é registrada e o próximo ciclo segue. Perder uma leitura de 1s
 * é irrelevante; perder o servidor no meio do jogo não é.
 */
let errosSeguidos = 0;
async function pollSeguro() {
  try {
    await pollInterno();
    errosSeguidos = 0;
  } catch (e: any) {
    errosSeguidos++;
    // Não inunda o log se a falha for persistente: avisa as primeiras e
    // depois só a cada 30 ocorrências.
    if (errosSeguidos <= 3 || errosSeguidos % 30 === 0) {
      console.error(`  [poll] falha #${errosSeguidos}: ${e?.message ?? e}`);
      if (errosSeguidos <= 3 && e?.stack) {
        console.error(String(e.stack).split("\n").slice(1, 4).join("\n"));
      }
    }
  }
}

// Promessa rejeitada sem catch também mata o processo no Node. Aqui só o
// estado do gravador estaria em jogo, então registrar e seguir é suficiente.
process.on("unhandledRejection", (motivo) => {
  console.error(`  [unhandledRejection] ${motivo instanceof Error ? motivo.message : motivo}`);
});

setInterval(pollSeguro, 1000);
pollSeguro();

// Estado de exemplo (/state?demo=1) — partida aos 22min, pra conferir o
// visual sem entrar em jogo.
async function demoState(): Promise<State> {
  const t = 22 * 60 + 18;
  // Cenário que expõe o caso difícil: Arauto de pé prestes a sumir E Dragão
  // renascido, os dois ao mesmo tempo — com um slot só, sumiam.
  const nx: Objective = { name: "Arauto", inSec: 258, up: true, expiresAt: HERALD_DESPAWN };
  const objetivosDemo: Objective[] = [
    { name: "Arauto", inSec: 258, up: true, expiresAt: HERALD_DESPAWN },
    { name: "Dragão", inSec: 74, up: true },
    { name: "Barão", inSec: 102, up: false },
  ];
  return {
    active: true, gameTime: t,
    me: { champ: "Ahri", champKey: chaveDeCampeao("Ahri"), k: 7, d: 4, a: 11, cs: 188, ward: 21 },
    nextObjective: nx, objectives: objetivosDemo,
    alerts: [
      { id: "obj-expira-Arauto", fireId: "demo-obj", level: "warn", text: "Arauto some em 87s — pegue agora ou perde", sound: "objetivo-expira.mp3" },
      { id: "obj-vivo-Dragão", fireId: "demo-obj2", level: "warn", text: "Dragão está no mapa há 1:14 — ninguém pegou ainda", sound: "objetivo-livre.mp3" },
      { id: "ult6", fireId: "demo-ult6", level: "warn", text: "Zed chegou ao nível 6 — ultimate disponível", sound: "nivel-6-inimigo.mp3" },
    ],
    raw: {
      events: [
        { t: 1300, name: "ChampionKill", detail: "KillerName=Inimigo1  VictimName=Voce  Assisters=[Inimigo2]" },
        { t: 1245, name: "DragonKill", detail: "DragonType=Fire  KillerName=Aliado2  Stolen=False" },
        { t: 1020, name: "TurretKilled", detail: "TurretKilled=Turret_TOrder_L1_P2_1225900006_0  KillerName=Voce" },
      ],
      stats: [
        { k: "abilityPower", v: "412" }, { k: "armor", v: "84.4" }, { k: "attackDamage", v: "87.6" },
        { k: "currentHealth", v: "1204" }, { k: "maxHealth", v: "1810" }, { k: "moveSpeed", v: "385" },
      ],
      players: [
        // Nomes de propósito difíceis ("Kai'Sa", "Nunu & Willump"): o demo já
        // mostra se a conversão nome->chave do ícone quebrou.
        { name: "Voce", champ: "Ahri", champKey: chaveDeCampeao("Ahri"), team: "ORDER", kda: "7/4/11", cs: 188, lvl: 14, items: "Capuz da Morte de Rabadon", itemIds: [3089], dead: false, respawn: 0 },
        { name: "Aliado1", champ: "Kai'Sa", champKey: chaveDeCampeao("Kai'Sa"), team: "ORDER", kda: "9/3/8", cs: 201, lvl: 15, items: "Gume do Infinito", itemIds: [3031], dead: false, respawn: 0 },
        { name: "Aliado2", champ: "Nunu & Willump", champKey: chaveDeCampeao("Nunu & Willump"), team: "ORDER", kda: "2/5/14", cs: 96, lvl: 13, items: "Coração Congelado", itemIds: [3110], dead: false, respawn: 0 },
        { name: "Inimigo1", champ: "Zed", champKey: chaveDeCampeao("Zed"), team: "CHAOS", kda: "5/8/4", cs: 178, lvl: 13, items: "Youmuu", itemIds: [3142], dead: true, respawn: 18 },
      ],
      game: [
        { k: "gameMode", v: "CLASSIC" }, { k: "gameTime", v: "22:18" },
        { k: "mapName", v: "Map11" }, { k: "mapNumber", v: "11" },
      ],
      fields: [
        { path: "activePlayer.currentGold", sample: "1247" },
        { path: "allPlayers[0].isDead", sample: "false" },
        { path: "allPlayers[0].respawnTimer", sample: "0" },
        { path: "events.Events[]", sample: "27 itens" },
      ],
    },
    // Log montado pelo MESMO formatador da partida real — assim o demo não
    // pode "ficar bonito" com texto que o código não produz.
    log: [
      linhaDeAlerta({ id: "obj-expira-Arauto", fireId: "demo-obj", text: "Arauto some em 87s — pegue agora ou perde" }, 1338),
      linhaDeEvento({ EventID: 41, EventName: "DragonKill", EventTime: 1245, DragonType: "Fire", KillerName: "Aliado2", Stolen: "False" }, 1245),
      linhaDeEvento({ EventID: 30, EventName: "TurretKilled", EventTime: 1020, TurretKilled: "Turret_TOrder_L1_P2_1225900006_0", KillerName: "Voce" }, 1020),
      linhaDeEvento({ EventID: 2, EventName: "FirstBlood", EventTime: 204, Recipient: "Voce" }, 204),
      linhaDeEvento({ EventID: 0, EventName: "GameStart", EventTime: 0 }, 0),
    ],
  };
}

// Catálogo de sons — a página usa isto pra montar o painel de gravação, e
// assim você vê exatamente quais arquivos gravar e com que nome salvar.
const SOUND_CATALOG = [
  { file: "objetivo-60.mp3", label: "Objetivo em 60s", suggestion: "Dragão chegando, comece a andar" },
  { file: "objetivo-30.mp3", label: "Objetivo em 30s", suggestion: "Objetivo agora, rio com visão" },
  { file: "objetivo-livre.mp3", label: "Objetivo livre no mapa", suggestion: "Objetivo de graça, ninguém pegou" },
  { file: "objetivo-expira.mp3", label: "Objetivo vai sumir", suggestion: "Vai sumir, pega agora" },
  { file: "janela-objetivo.mp3", label: "Janela de objetivo", suggestion: "Inimigos mortos, pega o objetivo" },
  { file: "nivel-6-inimigo.mp3", label: "Inimigo chegou ao 6", suggestion: "Cuidado, ele tem ult" },
  { file: "nivel-6-seu.mp3", label: "Você chegou ao 6", suggestion: "Ult na mão" },
];

/** "objetivo-60.mp3" -> "objetivo-60". O catálogo declara .mp3, o disco tem
 *  .wav/.m4a — sempre comparar e procurar pelo nome-base. */
const semExtensao = (nome: string) => nome.replace(/\.[a-z0-9]+$/i, "");

// Índice do catálogo por nome-base, montado sob demanda.
//
// SOB DEMANDA, NÃO NO TOPO: pollSeguro() é disparado na carga do módulo, antes
// desta linha ser avaliada — ler SOUND_CATALOG direto daqui de cima cairia na
// zona morta do `const`. Adiar até a primeira fala tira essa ordem da equação.
let catalogoIdx: Map<string, (typeof SOUND_CATALOG)[number]> | null = null;
function catalogoPorBase() {
  if (!catalogoIdx) {
    catalogoIdx = new Map(SOUND_CATALOG.map((s) => [semExtensao(s.file), s]));
  }
  return catalogoIdx;
}

/**
 * Os alertas do usuário no formato do catálogo embutido.
 *
 * NÃO ENTRA NO `catalogoIdx`: aquele é montado uma vez e cacheado, e esta
 * lista muda quando o usuário cria ou apaga um alerta. Fica como função pra
 * ser sempre lida fresca.
 */
function catalogoDoUsuario() {
  return regrasDoUsuario.map((r) => ({
    file: `${r.som}.mp3`,
    label: r.texto,
    suggestion: r.texto,
  }));
}

/**
 * Nomes de som de alertas que a IA acabou de montar mas que o usuário ainda
 * não salvou.
 *
 * EXISTE PORQUE A GRAVAÇÃO VIRA PARTE DA CRIAÇÃO: o áudio tem que subir ANTES
 * do alerta ser persistido (a regra só é salva depois que a voz chega), e
 * nesse instante o nome não está nem no SOUND_CATALOG nem nos alertas do
 * usuário — /record/ o recusaria.
 *
 * EM MEMÓRIA, DE PROPÓSITO: é permissão de uma sessão de criação, não estado
 * do projeto. Reiniciar o servidor limpa tudo, que é o comportamento certo —
 * uma criação abandonada não deve deixar permissão sobrando no disco.
 */
const somsPendentes = new Set<string>();

/**
 * Apaga a gravação de UM nome-base, em qualquer extensão.
 *
 * UM NOME EXATO, NUNCA UM PADRÃO: esta função é chamada por descarte e por
 * apagar-alerta, e um glob solto aqui varreria gravações alheias da pasta.
 */
async function apagarGravacao(base: string) {
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) return;
  try {
    const existing = await readdir(new URL(".", SOUND_DIR));
    for (const e of existing) {
      const eBase = e.replace(/(\.(mp3|wav|ogg|m4a|mp4|aac|webm|opus|flac))+$/i, "");
      if (eBase.toLowerCase() === base.toLowerCase()) {
        await unlink(new URL(encodeURIComponent(e), SOUND_DIR)).catch(() => {});
      }
    }
  } catch { /* pasta ausente: nada a apagar */ }
}

/** Entrada de catálogo por nome-base, embutida OU do usuário. */
function entradaDeSom(base: string) {
  return catalogoPorBase().get(base)
    ?? catalogoDoUsuario().find((s) => semExtensao(s.file) === base);
}

const SOUND_DIR = new URL("./sounds/", import.meta.url);
const MIME: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  mp4: "audio/mp4", aac: "audio/aac", webm: "audio/webm", opus: "audio/opus", flac: "audio/flac",
};
const AUDIO_EXTS = Object.keys(MIME);

// O catálogo pede "objetivo-60.mp3", mas gravador de celular costuma salvar
// .m4a — e às vezes anexa a extensão ao nome que você digitou, virando
// "objetivo-60.mp3.m4a". Em vez de exigir renomeação manual, resolvemos o
// arquivo pelo NOME-BASE e aceitamos qualquer extensão de áudio.
async function resolveSound(wanted: string): Promise<{ file: string; mime: string } | null> {
  const base = wanted.replace(/\.[^.]+$/, "");           // "objetivo-60.mp3" -> "objetivo-60"
  let entries: string[];
  try { entries = await readdir(new URL(".", SOUND_DIR)); } catch { return null; }
  // candidatos: mesmo nome-base, ignorando extensões empilhadas
  for (const e of entries) {
    const ext = e.split(".").pop()?.toLowerCase() ?? "";
    if (!AUDIO_EXTS.includes(ext)) continue;
    const eBase = e.replace(/(\.(mp3|wav|ogg|m4a|mp4|aac|webm|opus|flac))+$/i, "");
    if (eBase.toLowerCase() === base.toLowerCase()) {
      return { file: e, mime: MIME[ext] ?? "application/octet-stream" };
    }
  }
  return null;
}

const PAGE = await readFile(new URL("./ingame.html", import.meta.url), "utf8");
createServer(async (req, res) => {
  // serve os áudios gravados; 404 silencioso quando o arquivo ainda não existe
  if (req.url?.startsWith("/sounds/")) {
    const name = decodeURIComponent(req.url.slice(8).split("?")[0]);
    if (name.includes("..") || name.includes("/")) { res.writeHead(400); res.end(); return; }
    const hit = await resolveSound(name);
    if (!hit) { res.writeHead(404); res.end(); return; }
    try {
      const buf = await readFile(new URL(encodeURIComponent(hit.file), SOUND_DIR));
      res.writeHead(200, { "content-type": hit.mime });
      res.end(buf);
    } catch { res.writeHead(404); res.end(); }
    return;
  }
  // Gravação direto da página: recebe o áudio do MediaRecorder e salva.
  // Assim não depende de gravador externo nem de extensão — o navegador manda
  // webm/ogg e o resolvedor de nome-base cuida do resto.
  // TTS: a mesma lista fechada de nomes que /record/ aceita, pelo mesmo motivo
  // (nome que o servidor não entregou não vira arquivo em sounds/).
  if (req.method === "POST" && req.url?.startsWith("/tts/")) {
    const wanted = decodeURIComponent(req.url.slice(5).split("?")[0]);
    if (wanted.includes("..") || wanted.includes("/")) { res.writeHead(400); res.end(); return; }
    const known = SOUND_CATALOG.some((s) => s.file === wanted)
      || catalogoDoUsuario().some((s) => s.file === wanted)
      || somsPendentes.has(wanted.replace(/\.[^.]+$/, ""));
    if (!known) { res.writeHead(404); res.end("som desconhecido"); return; }

    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let corpo: any = {};
    try { corpo = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* usa vazio */ }

    try {
      const r = await gerarSom(wanted.replace(/\.[^.]+$/, ""), SOUND_DIR, {
        texto: String(corpo.texto ?? ""),
        vozId: String(corpo.vozId ?? ""),
        efeito: corpo.efeito !== false,
        tom: Number(corpo.tom ?? 0.85),
        eco: Number(corpo.eco ?? 0.35),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...r }));
    } catch (e: any) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
    return;
  }

  // Vozes disponíveis, para o seletor do painel.
  if (req.url === "/tts/vozes") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ vozes: VOZES, temChave: !!process.env.FISH_API_KEY }));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/record/")) {
    const wanted = decodeURIComponent(req.url.slice(8).split("?")[0]);
    if (wanted.includes("..") || wanted.includes("/")) { res.writeHead(400); res.end(); return; }
    // Inclui os alertas do usuário: é por aqui que ele grava a voz deles, e
    // sem isto o painel listaria o alerta mas recusaria a gravação.
    // E inclui os PENDENTES: na criação a voz é gravada antes do alerta ser
    // salvo, então nesse momento o nome ainda não está em nenhuma das duas
    // listas. Continua sendo lista fechada — nome que o servidor não entregou
    // segue recusado.
    const known = SOUND_CATALOG.some((s) => s.file === wanted)
      || catalogoDoUsuario().some((s) => s.file === wanted)
      || somsPendentes.has(wanted.replace(/\.[^.]+$/, ""));
    if (!known) { res.writeHead(404); res.end("som desconhecido"); return; }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 8_000_000) { res.writeHead(413); res.end("audio grande demais"); return; }
      chunks.push(c as Buffer);
    }
    const ct = String(req.headers["content-type"] ?? "");
    const ext = ct.includes("ogg") ? "ogg" : ct.includes("mp4") ? "m4a" : "webm";
    const base = wanted.replace(/\.[^.]+$/, "");

    try {
      // remove gravações anteriores do mesmo alerta, em qualquer extensão,
      // senão o resolvedor poderia achar a antiga primeiro
      const existing = await readdir(new URL(".", SOUND_DIR));
      for (const e of existing) {
        const eBase = e.replace(/(\.(mp3|wav|ogg|m4a|mp4|aac|webm|opus|flac))+$/i, "");
        if (eBase.toLowerCase() === base.toLowerCase()) {
          await unlink(new URL(encodeURIComponent(e), SOUND_DIR)).catch(() => {});
        }
      }
      // CONVERTER PARA WAV NA GRAVAÇÃO, e não depois.
      //
      // O MediaRecorder do Chrome grava em .webm (Opus), e o Windows NÃO
      // decodifica webm pelo Media Foundation — falha EM SILÊNCIO, sem
      // exceção (ver o comentário em player.ts, que já tinha medido isso).
      // O resultado é o pior tipo de bug: o painel de sons mostra o alerta
      // como gravado, o alerta dispara, e nada sai no alto-falante. Foi
      // exatamente o que aconteceu numa partida inteira — 72 alertas, zero som.
      //
      // Converter aqui, e não num script separado, é o que impede a
      // reincidência: qualquer som novo nasce tocável. Se o ffmpeg não estiver
      // instalado, guarda o original e AVISA no retorno, em vez de gravar um
      // arquivo mudo fingindo sucesso.
      const bruto = Buffer.concat(chunks);
      const destinoWav = fileURLToPath(new URL(encodeURIComponent(`${base}.wav`), SOUND_DIR));
      const convertido = await paraWav(bruto, destinoWav);
      if (!convertido) {
        await writeFile(new URL(encodeURIComponent(`${base}.${ext}`), SOUND_DIR), bruto);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: true, file: `${base}.${ext}`, bytes: size, mudo: true,
          aviso: "Salvo em " + ext + ", mas o Windows não toca esse formato. Instale o ffmpeg para o som funcionar.",
        }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, file: `${base}.wav`, bytes: size }));
    } catch (e: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
    return;
  }

  if (req.method === "DELETE" && req.url?.startsWith("/record/")) {
    const wanted = decodeURIComponent(req.url.slice(8).split("?")[0]);
    if (wanted.includes("..") || wanted.includes("/")) { res.writeHead(400); res.end(); return; }
    await apagarGravacao(wanted.replace(/\.[^.]+$/, ""));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/sounds") {
    // diz quais já foram gravados (em qualquer extensão) e sob que nome real
    const out = [];
    // Os alertas do usuário entram no mesmo painel de gravação: é por ali que
    // ele grava a voz, e o alerta nasce mudo até isso acontecer.
    for (const s of [...SOUND_CATALOG, ...catalogoDoUsuario()]) {
      const hit = await resolveSound(s.file);
      out.push({ ...s, exists: !!hit, actualFile: hit?.file ?? null });
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(out));
    return;
  }
  // Proxy do servidor de draft (7777), pra tela ser uma só. Draft e partida
  // nunca coexistem, então a página alterna entre os dois estados.
  if (req.url?.startsWith("/draft-state")) {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    try {
      const r = await request(`http://127.0.0.1:${process.env.DRAFT_PORT ?? 7777}/state${qs}`, { headersTimeout: 1500, bodyTimeout: 1500 });
      const body = await r.body.text();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end("null");   // draft server fora do ar: a página simplesmente ignora
    }
    return;
  }
  // (removido) havia aqui um bloco /narrator/* (toggle, reset, test) para o
  // narrador escrito por modelo. Saiu junto com a narração.
  //
  // Controle da voz.
  //
  // Existe porque quem fala agora é o servidor: ligar/desligar o som, mudar o
  // volume e ouvir uma amostra são coisas que a página fazia sozinha quando o
  // áudio morava nela. Sem estas rotas os controles ficariam na tela sem fazer
  // nada — que é exatamente o tipo de falha silenciosa que motivou esta
  // migração.
  // Limpar o log à mão.
  //
  // O log sobrevive ao fim da partida de propósito — é depois do jogo que dá
  // pra reler com calma e decidir o que virar alerta. Mas aí ele fica na tela
  // até a próxima partida começar, e às vezes o usuário quer recomeçar a
  // leitura antes disso.
  if (req.method === "POST" && req.url?.startsWith("/log/limpar")) {
    eventLog.reset();
    state = { ...state, log: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url?.startsWith("/voice/")) {
    const qs = new URL(req.url, "http://x").searchParams;
    const cmd = req.url.slice(7).split("?")[0];

    if (cmd === "toggle") {
      voice.habilitado = !voice.habilitado;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(voice.status));
      return;
    }

    if (cmd === "volume") {
      const v = Number(qs.get("v"));
      if (Number.isFinite(v)) voice.volume = Math.max(0, Math.min(1, v));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ volume: voice.volume }));
      return;
    }

    // Toca uma amostra, igual em jogo: se a gravação existe, sai no
    // alto-falante; se não existe, não sai nada — que é justamente o que
    // acontece na partida.
    if (cmd === "play") {
      const som = qs.get("som") ?? "";
      const base = semExtensao(som);
      // Alertas do usuário também são pré-escutáveis: ele acabou de gravar a
      // voz, e conferir ali mesmo é o ponto do botão.
      const doCatalogo = base ? entradaDeSom(base) : undefined;
      if (!doCatalogo) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ erro: "som fora do catálogo" }));
        return;
      }
      // chave única: uma amostra pedida duas vezes deve tocar duas vezes.
      await voice.falar({
        chave: `amostra-${base}-${Date.now()}`,
        som: base,
        texto: doCatalogo.suggestion,
        prioridade: 1,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, som: base, texto: doCatalogo.suggestion }));
      return;
    }

    res.writeHead(404); res.end(); return;
  }

  // Alertas do usuário: criar (via IA), listar, salvar e apagar.
  // Aba "Luzes": repassa ao daemon pelo MESMO cliente da partida, então o
  // teste exercita o caminho real (e não um atalho que só funciona na aba).
  if (req.url?.startsWith("/rgb/")) {
    const u = new URL(req.url, "http://x");
    const json = (code: number, corpo: unknown) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(corpo));
    };
    const corpo = await new Promise<any>((ok) => {
      let s = ""; req.on("data", (c) => (s += c));
      req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } });
    });
    if (req.method === "GET" && u.pathname === "/rgb/status") {
      return json(200, (await luzes.status()) ?? { daemon: false });
    }
    if (req.method === "POST" && u.pathname === "/rgb/testar") {
      if (corpo.efeito === "loading") {
        void simularLoading(Number(corpo.params?.segundos ?? 20));
        return json(200, { ok: true });
      }
      if (corpo.efeito === "morte") {
        void simularMorte(Number(corpo.params?.segundos ?? 10));
        return json(200, { ok: true });
      }
      return json(200, (await luzes.efeito(String(corpo.efeito ?? ""), corpo.params)) ?? { daemon: false });
    }
    if (req.method === "POST" && u.pathname === "/rgb/sequencia") {
      void simularSequencia();
      return json(200, { ok: true });
    }
    if (req.method === "POST" && u.pathname === "/rgb/reset") {
      return json(200, (await luzes.reset()) ?? { daemon: false });
    }
    return json(404, { erro: "rota desconhecida" });
  }

  if (req.url?.startsWith("/alertas")) {
    const u = new URL(req.url, "http://x");
    const json = (code: number, corpo: unknown) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(corpo));
    };
    const lerCorpo = () => new Promise<string>((ok) => {
      let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => ok(s));
    });

    if (req.method === "GET" && u.pathname === "/alertas") {
      return json(200, { alertas: regrasDoUsuario });
    }

    // Cria a partir do texto em português. A IA roda AQUI, uma vez — nunca
    // durante a partida.
    if (req.method === "POST" && u.pathname === "/alertas/criar") {
      let pedido = "";
      try { pedido = String(JSON.parse((await lerCorpo()) || "{}").pedido ?? ""); } catch {}

      const r = await criarRegra(pedido);
      if (!r.ok) return json(200, { ok: false, motivo: r.motivo });

      // A gravação acontece AGORA, dentro da criação — então o `som` precisa
      // ser aceito por /record/ antes de existir alerta salvo. Sem isto o
      // fluxo trancaria: o usuário gravaria e o servidor responderia 404.
      somsPendentes.add(r.regra.som);
      // descrever() traduz o gatilho de volta pro português: é como o usuário
      // CONFERE o que a IA entendeu. Ler JSON não é conferência.
      // fontesDoGatilho() vem do CÓDIGO, não do modelo: nomeia os campos reais
      // que vão ser lidos, e por isso não pode ser alucinado. O `confirmo` do
      // modelo continua junto, como segunda opinião.
      // Não salva ainda — ele confere a leitura e grava a voz.
      return json(200, {
        ok: true,
        regra: { ...r.regra, descricao: descrever(r.regra.quando) },
        fontes: fontesDoGatilho(r.regra.quando),
        confirmo: r.confirmo ?? null,
        backtest: null,
      });
    }

    if (req.method === "POST" && u.pathname === "/alertas/salvar") {
      try {
        const regra = JSON.parse(await lerCorpo()).regra;
        // ÁUDIO OBRIGATÓRIO, CHECADO AQUI. O botão da página já força a ordem,
        // mas cliente não é garantia: qualquer curl salvaria um alerta mudo, e
        // alerta mudo é exatamente o estado que este fluxo veio eliminar. Sem
        // TTS não há voz de reserva — sem arquivo, o alerta não existiria de
        // verdade, só apareceria na tela.
        const som = String(regra?.som ?? "");
        if (!som || !(await resolveSound(`${som}.mp3`))) {
          return json(200, { ok: false, motivo: "grave a voz antes de salvar: sem áudio o alerta ficaria mudo" });
        }
        await salvarAlerta(regra);
        await recarregarRegras();
        // Salvo: o nome saiu do limbo e agora é conhecido pelo catálogo do
        // usuário, então a permissão temporária não é mais necessária.
        somsPendentes.delete(som);
        return json(200, { ok: true });
      } catch (e: any) {
        return json(200, { ok: false, motivo: e?.message ?? "falha ao salvar" });
      }
    }

    // Desistiu depois de gravar: apaga o áudio órfão. Sem isto a pasta
    // sounds/ juntaria gravações de alertas que não existem — e ninguém
    // saberia de quais, já que o catálogo só lista alerta salvo.
    if (req.method === "POST" && u.pathname === "/alertas/descartar") {
      let som = "";
      try { som = String(JSON.parse((await lerCorpo()) || "{}").som ?? ""); } catch {}
      // Só apaga nome que ESTE servidor entregou como pendente e que não virou
      // alerta salvo: é o que impede um POST qualquer de apagar a gravação de
      // um alerta existente (ou de um som embutido).
      if (som && somsPendentes.has(som) && !regrasDoUsuario.some((r) => r.som === som)) {
        somsPendentes.delete(som);
        await apagarGravacao(som);
      }
      return json(200, { ok: true });
    }

    if (req.method === "DELETE" && u.pathname.startsWith("/alertas/")) {
      const id = decodeURIComponent(u.pathname.slice("/alertas/".length));
      const alvo = regrasDoUsuario.find((r) => r.id === id);
      const foi = await apagarAlerta(id);
      await recarregarRegras();
      // O áudio vai junto com o alerta: mantido, ele só ocuparia espaço com um
      // nome que não aparece mais em lugar nenhum.
      if (foi && alvo?.som) await apagarGravacao(alvo.som);
      return json(200, { ok: foi });
    }

    res.writeHead(404); res.end(); return;
  }
  if (req.url?.startsWith("/state")) {
    const demo = new URL(req.url, "http://x").searchParams.get("demo");
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    // A versão do Data Dragon é lida AQUI, no pedido do navegador, e nunca
    // dentro do poll: demorar só atrasa uma resposta, e uma exceção no laço
    // de 1s derrubaria o servidor no meio da partida.
    const ddv = await versaoDDragon();
    res.end(JSON.stringify(
      demo
        ? { ...(await demoState()), ddVersion: ddv }
        : { ...state, voice: voice.status, ddVersion: ddv },
    ));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
}).listen(PORT, () => {
  console.log(`\n  In-Game Coach em http://localhost:${PORT}\n`);
  console.log("  Abre sozinho quando a partida começar. Ctrl+C para parar.\n");
});
