// Draft — acompanha o champ select AO VIVO pelo cliente do LoL.
//
// Como funciona: o cliente do LoL expõe uma API local (LCU). Ao abrir, ele
// escreve um lockfile com porta e senha; a partir daí dá pra ler o estado do
// champ select em tempo real, sem Overwolf e sem injeção em processo.
//
// O que este servidor faz:
//   1. Lê o lockfile e conecta no LCU (certificado local, daí o rejectUnauthorized).
//   2. A cada 1s, lê a fase do jogo e /lol-champ-select/v1/session.
//   3. Cada pick TRAVADO escreve o nome do campeão no teclado (draftLuzes.ts).
//   4. A tela de loading acende a barra de carregamento no teclado.
//   5. Serve os dois times em /state — a página do in-game (7778) mostra o
//      draft enquanto o champ select estiver aberto.
//
// Uso: tsx coach/server.ts   → http://localhost:7777/state
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { request, Agent } from "undici";
import { chaveDeCampeao } from "./ddragon.js";
import { DraftLuzes, transicaoLoading } from "./draftLuzes.js";
import { luzes } from "./rgbClient.js";

// Onde o cliente costuma estar instalado. LOL_LOCKFILE no .env vence os dois,
// para quem instalou em outro lugar.
const LOCKFILES = [
  process.env.LOL_LOCKFILE ?? "",
  "C:/Riot Games/League of Legends/lockfile",
  "D:/Riot Games/League of Legends/lockfile",
].filter(Boolean);
const PORT = Number(process.env.DRAFT_PORT ?? 7777);

// O LCU usa certificado auto-assinado local; validar quebraria a conexão.
const agente = new Agent({ connect: { rejectUnauthorized: false } });

interface Lock { port: string; pw: string }

async function readLock(): Promise<Lock | null> {
  for (const p of LOCKFILES) {
    if (!existsSync(p)) continue;
    try {
      const parts = (await readFile(p, "utf8")).trim().split(":");
      if (parts.length >= 4) return { port: parts[2], pw: parts[3] };
    } catch { /* tenta o próximo */ }
  }
  return null;
}

async function lcu<T>(lock: Lock, path: string): Promise<T | null> {
  try {
    const res = await request(`https://127.0.0.1:${lock.port}${path}`, {
      headers: { authorization: "Basic " + Buffer.from(`riot:${lock.pw}`).toString("base64") },
      dispatcher: agente,
    });
    if (res.statusCode >= 400) { await res.body.dump(); return null; }
    return (await res.body.json()) as T;
  } catch { return null; }
}

let champById: Record<number, string> = {};
async function loadChampions(lock: Lock) {
  const list = await lcu<any[]>(lock, "/lol-game-data/assets/v1/champion-summary.json");
  if (!list) return;
  champById = {};
  for (const c of list) champById[c.id] = c.name;
}

const POS_LABEL: Record<string, string> = {
  top: "TOP", jungle: "JG", middle: "MID", bottom: "ADC", utility: "SUP", "": "?",
};

interface Read {
  phase: string;
  myChamp: string;
  myTeam: { champ: string; champKey: string; pos: string; isMe: boolean }[];
  enemyTeam: { champ: string; champKey: string; pos: string }[];
}

// Luzes: cada pick travado escreve o nome do campeão no teclado.
const draftLuzes = new DraftLuzes();
// Fase anterior da LCU, para a barra da tela de loading (null = ainda não lida).
let faseAnterior: string | null = null;

let lastRead: Read = { phase: "Desconectado", myChamp: "", myTeam: [], enemyTeam: [] };

async function poll() {
  const lock = await readLock();
  if (!lock) {
    if (faseAnterior === "InProgress") void luzes.carregando(false);
    faseAnterior = null;
    lastRead = { phase: "Cliente fechado", myChamp: "", myTeam: [], enemyTeam: [] };
    return;
  }
  if (!Object.keys(champById).length) await loadChampions(lock);

  const phase = await lcu<string>(lock, "/lol-gameflow/v1/gameflow-phase");
  const session = await lcu<any>(lock, "/lol-champ-select/v1/session");

  if (phase) {
    const t = transicaoLoading(faseAnterior, phase);
    if (t) void luzes.carregando(t === "inicio");
    faseAnterior = phase;
  }

  if (!session || !session.myTeam) {
    lastRead = { phase: phase ?? "?", myChamp: "", myTeam: [], enemyTeam: [] };
    draftLuzes.reset();
    return;
  }

  // Um por vez e em ordem: o daemon enfileira nomes (o lote escolheria só um).
  const picks = draftLuzes.processar(session, champById);
  if (picks.length) {
    void (async () => { for (const c of picks) await luzes.efeito(c.efeito, c.params); })();
  }

  const localCell = session.localPlayerCellId;
  const nomeDe = (p: any) => champById[p.championId] ?? champById[p.championPickIntent] ?? "";
  const myTeam = (session.myTeam ?? []).map((p: any) => ({
    champ: nomeDe(p), champKey: chaveDeCampeao(nomeDe(p)),
    pos: POS_LABEL[p.assignedPosition ?? ""] ?? "?",
    isMe: p.cellId === localCell,
  })).filter((p: any) => p.champ);
  const enemyTeam = (session.theirTeam ?? []).map((p: any) => ({
    champ: champById[p.championId] ?? "", champKey: chaveDeCampeao(champById[p.championId] ?? ""),
    pos: POS_LABEL[p.assignedPosition ?? ""] ?? "?",
  })).filter((p: any) => p.champ);

  lastRead = {
    phase: phase ?? "ChampSelect",
    myChamp: myTeam.find((p: any) => p.isMe)?.champ ?? "",
    myTeam, enemyTeam,
  };
}

// Poll que não derruba o processo: uma exceção no setInterval mataria o
// servidor, e perder uma leitura de 1s é irrelevante.
async function pollSeguro() {
  try { await poll(); } catch (e: any) { console.error(`  [draft] ${e?.message ?? e}`); }
}
setInterval(pollSeguro, 1000);
pollSeguro();

// Draft de exemplo (/state?demo=1) pra conferir o visual sem champ select real.
const POS5 = ["TOP", "JG", "MID", "ADC", "SUP"];
function demoRead(): Read {
  const mine = ["Ornn", "Sejuani", "Ahri", "Kai'Sa", "Nautilus"];
  const theirs = ["Sett", "Nunu & Willump", "Zed", "Jinx", "Milio"];
  return {
    phase: "DEMO", myChamp: "Ahri",
    myTeam: mine.map((c, i) => ({ champ: c, champKey: chaveDeCampeao(c), pos: POS5[i], isMe: c === "Ahri" })),
    enemyTeam: theirs.map((c, i) => ({ champ: c, champKey: chaveDeCampeao(c), pos: POS5[i] })),
  };
}

createServer((req, res) => {
  if (req.url?.startsWith("/state")) {
    const demo = new URL(req.url, "http://x").searchParams.get("demo");
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(demo ? demoRead() : lastRead));
    return;
  }
  // A tela é uma só, a do in-game: ela mostra o draft sozinha.
  res.writeHead(302, { location: `http://localhost:${process.env.INGAME_PORT ?? 7778}/` });
  res.end();
}).listen(PORT, () => {
  console.log(`\n  Draft em http://localhost:${PORT}/state (a tela é a do in-game, ${process.env.INGAME_PORT ?? 7778})\n`);
});
