/**
 * Cliente do daemon de luzes (rgb/rgb_daemon.py, porta 7779).
 *
 * Fire-and-forget com timeout curto: luz é enfeite, nunca pode atrasar o poll,
 * a voz ou os alertas. Daemon fora = loga UMA vez e segue; loga de novo quando
 * ele voltar.
 */
import type { ComandoRgb } from "./rgbBridge.js";

const BASE = process.env.RGB_URL ?? "http://127.0.0.1:7779";
const TIMEOUT_MS = 300;

let online: boolean | null = null;

async function chamar(rota: string, corpo?: unknown): Promise<any | null> {
  try {
    const r = await fetch(BASE + rota, {
      method: corpo === undefined ? "GET" : "POST",
      headers: corpo === undefined ? undefined : { "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (online !== true) console.log("  luzes: daemon RGB conectado");
    online = true;
    return await r.json();
  } catch {
    if (online !== false) console.log("  luzes: daemon RGB offline (o coach segue sem luzes)");
    online = false;
    return null;
  }
}

export const luzes = {
  comandos(lote: ComandoRgb[]) {
    return lote.length ? chamar("/efeito", { lote }) : Promise.resolve(null);
  },
  efeito(efeito: string, params?: Record<string, unknown>) {
    return chamar("/efeito", { efeito, params });
  },
  estado(morto: boolean, respawnEm: number, teste = false) {
    return chamar("/estado", { morto, respawnEm, teste });
  },
  carregando(ativo: boolean, teste = false, estimativa?: number) {
    return chamar("/carregando", { ativo, teste, estimativa });
  },
  partida(ativa: boolean) {
    return chamar("/partida", { ativa });
  },
  reset() {
    return chamar("/reset", {});
  },
  status() {
    return chamar("/status");
  },
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tela de loading simulada para a aba Luzes: não grava no histórico de loadings. */
export async function simularLoading(segundos: number): Promise<void> {
  await luzes.carregando(true, true, segundos);
  await espera(segundos * 1000);
  await luzes.carregando(false, true);
}

/** Morte simulada para a aba Luzes: não mexe no flag de partida (teste=true). */
export async function simularMorte(segundos: number): Promise<void> {
  await luzes.estado(true, segundos, true);
  await espera(segundos * 1000);
  await luzes.estado(false, 0, true);
}

/**
 * Sequência realista para conferir prioridade e interrupção: o double chega
 * antes de o kill terminar, a morte cinza fica por baixo, e a escalada
 * triple -> quadra -> penta substitui cada efeito no meio.
 */
export async function simularSequencia(): Promise<void> {
  await luzes.efeito("kill");
  await espera(500);
  await luzes.efeito("multikill", { n: 2 });
  await espera(2000);
  await luzes.estado(true, 8, true);
  await espera(8000);
  await luzes.estado(false, 0, true);
  await espera(1000);
  await luzes.efeito("multikill", { n: 3 });
  await espera(1800);
  await luzes.efeito("multikill", { n: 4 });
  await espera(2500);
  await luzes.efeito("multikill", { n: 5 });
}
