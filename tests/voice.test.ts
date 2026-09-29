import { describe, it, expect } from "vitest";
import { VoiceQueue } from "../coach/voice.js";

/** Dublê: nenhum teste toca som de verdade. */
function fazerFila(opts: { temGravacao?: (c: string) => boolean } = {}) {
  const tocados: string[] = [];

  const fila = new VoiceQueue({
    cooldownMs: 0,
    resolverSom: async (som: string) =>
      (opts.temGravacao?.(som) ?? false) ? `/fake/${som}.wav` : null,
    tocar: async (caminho: string) => { tocados.push(caminho); },
  });

  return { fila, tocados };
}

describe("VoiceQueue", () => {
  it("toca a gravacao do usuario quando ela existe", async () => {
    const { fila, tocados } = fazerFila({ temGravacao: () => true });
    await fila.falar({ chave: "cw-1", som: "control-ward", texto: "Compra control ward" });
    await fila.drenar();

    expect(tocados).toEqual(["/fake/control-ward.wav"]);
  });

  // Consequencia aceita da retirada do TTS: alerta sem gravacao fica MUDO.
  // Ele continua aparecendo na tela, e o painel de sons marca o que falta.
  it("fica em silencio quando nao ha gravacao, sem quebrar", async () => {
    const { fila, tocados } = fazerFila({ temGravacao: () => false });
    await fila.falar({ chave: "ol-1", som: "objetivo-livre", texto: "Objetivo de graca" });
    await expect(fila.drenar()).resolves.not.toThrow();

    expect(tocados).toEqual([]);
    expect(fila.historico).toEqual([]);   // so entra no historico o que tocou
  });

  it("nao fala a mesma chave duas vezes", async () => {
    const { fila, tocados } = fazerFila({ temGravacao: () => true });
    await fila.falar({ chave: "mst-1", som: "morte-sem-trade", texto: "Morreu de graca" });
    await fila.falar({ chave: "mst-1", som: "morte-sem-trade", texto: "Morreu de graca" });
    await fila.drenar();

    expect(tocados).toHaveLength(1);
  });

  it("fala o mais prioritario primeiro", async () => {
    const { fila, tocados } = fazerFila({ temGravacao: () => true });
    await fila.falar({ chave: "baixa", som: "baixa", texto: "torre", prioridade: 3 });
    await fila.falar({ chave: "alta", som: "alta", texto: "barao", prioridade: 1 });
    await fila.drenar();

    expect(tocados[0]).toBe("/fake/alta.wav");
  });

  it("descarta o que envelheceu alem do TTL", async () => {
    const { fila, tocados } = fazerFila({ temGravacao: () => true });
    await fila.falar({ chave: "velha", som: "velha", texto: "antiga", expiraEm: Date.now() - 1 });
    await fila.drenar();

    expect(tocados).toEqual([]);
  });

  // Fala sem `som` nao tem gravacao a procurar: nada a tocar, e nao pode
  // derrubar a fila. Antes isto caia no TTS.
  it("nao quebra numa fala sem som associado", async () => {
    const { fila, tocados } = fazerFila({ temGravacao: () => true });
    await fila.falar({ chave: "qualquer", texto: "texto" });
    await expect(fila.drenar()).resolves.not.toThrow();

    expect(tocados).toEqual([]);
  });

  it("registra no historico o que realmente tocou", async () => {
    const { fila } = fazerFila({ temGravacao: (c) => c === "gravada" });
    await fila.falar({ chave: "gravada", som: "gravada", texto: "a" });
    await fila.falar({ chave: "sem-gravacao", som: "sem-gravacao", texto: "b" });
    await fila.drenar();

    expect(fila.historico.map((h) => h.chave)).toEqual(["gravada"]);
  });
});
