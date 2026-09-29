import { describe, expect, it } from "vitest";
import { marcarTrades, contarSemTrade, mortesJulgaveis, ESPERA_VEREDITO_S, JANELA_TRADE_S, JANELA_PARTICIPACAO_S, type Abate } from "../coach/trades.js";

const EU = "Jogador";

/** Abate do time inimigo que me mata. */
const meMata = (at: number, killer: string, assisters: string[] = []): Abate =>
  ({ at, killer, victim: EU, assisters, doMeuTime: false });

/** Abate do meu time sobre `victim`. */
const meuTimeMata = (at: number, victim: string, killer = "aliado"): Abate =>
  ({ at, killer, victim, assisters: [], doMeuTime: true });

describe("morte sem trade", () => {
  it("conta como trade quando o time mata quem me matou, logo depois", () => {
    const abates = [meMata(100, "Caitlyn"), meuTimeMata(105, "Caitlyn")];
    const r = marcarTrades([{ at: 100, traded: false }], abates, EU);
    expect(r[0].traded).toBe(true);
    expect(contarSemTrade(r)).toBe(0);
  });

  it("conta como trade quando o time mata um ASSISTENTE da minha morte", () => {
    const abates = [meMata(100, "Caitlyn", ["Seraphine"]), meuTimeMata(108, "Seraphine")];
    const r = marcarTrades([{ at: 100, traded: false }], abates, EU);
    expect(r[0].traded).toBe(true);
  });

  // O defeito nº 1 do critério antigo: janela simétrica.
  it("NÃO conta abate ANTERIOR à morte (causalidade invertida)", () => {
    const abates = [meuTimeMata(90, "Caitlyn"), meMata(100, "Caitlyn")];
    const r = marcarTrades([{ at: 100, traded: false }], abates, EU);
    expect(r[0].traded).toBe(false);
    expect(contarSemTrade(r)).toBe(1);
  });

  // O defeito nº 2, e o mais custoso: abate sem relação com a minha morte.
  it("NÃO conta abate de inimigo não envolvido (toplaner do outro lado do mapa)", () => {
    const abates = [meMata(100, "Caitlyn"), meuTimeMata(103, "Volibear")];
    const r = marcarTrades([{ at: 100, traded: false }], abates, EU);
    expect(r[0].traded).toBe(false);
  });

  it("respeita a janela: fora dela não absolve", () => {
    const dentro = [meMata(100, "Caitlyn"), meuTimeMata(100 + JANELA_TRADE_S, "Caitlyn")];
    const fora = [meMata(100, "Caitlyn"), meuTimeMata(100 + JANELA_TRADE_S + 1, "Caitlyn")];
    expect(marcarTrades([{ at: 100, traded: false }], dentro, EU)[0].traded).toBe(true);
    expect(marcarTrades([{ at: 100, traded: false }], fora, EU)[0].traded).toBe(false);
  });

  it("sem envolvido identificado, não inventa trade", () => {
    // Morte sem o ChampionKill correspondente (evento perdido): nada absolve.
    const r = marcarTrades([{ at: 100, traded: false }], [meuTimeMata(105, "Caitlyn")], EU);
    expect(r[0].traded).toBe(false);
  });

  it("cada morte é avaliada por conta própria", () => {
    const abates = [
      meMata(100, "Caitlyn"), meuTimeMata(104, "Caitlyn"),   // trocada
      meMata(300, "Volibear"), meuTimeMata(306, "Brand"),    // não envolvido
    ];
    const r = marcarTrades([{ at: 100, traded: false }, { at: 300, traded: false }], abates, EU);
    expect(r.map((m) => m.traded)).toEqual([true, false]);
    expect(contarSemTrade(r)).toBe(1);
  });

  it("não lança com entrada malformada", () => {
    expect(() => marcarTrades(null as any, null as any, EU)).not.toThrow();
    expect(contarSemTrade(null as any)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Correção: participação PRÓPRIA absolve a morte.
//
// O critério de envolvimento consertou o falso trade do aliado do outro lado
// do mapa, mas deixou passar o caso oposto e mais óbvio: VOCÊ trocou. Se você
// matou alguém ou deu assistência na luta que te matou, a morte teve troca
// por definição — não é "morte de graça", que é o que a métrica quer medir.
//
// Caso real (gravação 2026-09-16T13-26-54, morte aos 24,7min):
//   -19s  Jogador matou Qiyana
//   -13s  Jogador matou Inimigo2
//    -2s  o time matou Inimigo3, com assistência de Jogador
//     0s  Jogador morre     -> contado como SEM TRADE
//
// Sobre as 24 gravações, 32 das 94 mortes sem trade (34%) eram este caso.
//
// A janela aqui é SIMÉTRICA e maior (30s), ao contrário da janela de 15s só
// para frente do critério de envolvimento. O motivo é que a pergunta é outra:
// lá é "meu time vingou minha morte?" (causal, só para frente); aqui é "eu
// participei desta luta?" — e a luta começa antes de você cair.
describe("participação própria na luta", () => {
  const euMato = (at: number, victim: string): Abate =>
    ({ at, killer: EU, victim, assisters: [], doMeuTime: true });
  const euAssisto = (at: number, victim: string): Abate =>
    ({ at, killer: "aliado", victim, assisters: [EU], doMeuTime: true });

  it("conta como trade quando EU matei alguém pouco antes de morrer", () => {
    const abates = [euMato(85, "Qiyana"), meMata(100, "Gwen")];
    const r = marcarTrades([{ at: 100, traded: false }], abates, EU);
    expect(r[0].traded).toBe(true);
    expect(contarSemTrade(r)).toBe(0);
  });

  it("conta como trade quando EU dei assistência pouco antes de morrer", () => {
    const abates = [euAssisto(98, "Mel"), meMata(100, "Gwen")];
    expect(marcarTrades([{ at: 100, traded: false }], abates, EU)[0].traded).toBe(true);
  });

  it("conta como trade quando participei logo DEPOIS (a luta seguiu)", () => {
    const abates = [meMata(100, "Gwen"), euAssisto(112, "Gwen")];
    expect(marcarTrades([{ at: 100, traded: false }], abates, EU)[0].traded).toBe(true);
  });

  it("respeita a janela de participação: 31s antes já não absolve", () => {
    const dentro = [euMato(100 - JANELA_PARTICIPACAO_S, "Qiyana"), meMata(100, "Gwen")];
    const fora = [euMato(100 - JANELA_PARTICIPACAO_S - 1, "Qiyana"), meMata(100, "Gwen")];
    expect(marcarTrades([{ at: 100, traded: false }], dentro, EU)[0].traded).toBe(true);
    expect(marcarTrades([{ at: 100, traded: false }], fora, EU)[0].traded).toBe(false);
  });

  it("a própria morte não conta como participação", () => {
    // O abate que me mata tem victim === EU. Se ele absolvesse, nenhuma morte
    // seria jamais contada e a métrica viraria zero constante.
    const r = marcarTrades([{ at: 100, traded: false }], [meMata(100, "Gwen")], EU);
    expect(r[0].traded).toBe(false);
    expect(contarSemTrade(r)).toBe(1);
  });

  it("morte realmente gratuita continua contando", () => {
    // Sem participação minha e sem vingança do time: é exatamente o que a
    // métrica existe para pegar.
    const abates = [meMata(100, "Gwen"), meuTimeMata(140, "Gwen")];
    expect(marcarTrades([{ at: 100, traded: false }], abates, EU)[0].traded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Correção: não julgar a morte antes da hora.
//
// O poll de 1s avaliava a morte no instante em que ela aparecia e já
// anunciava "morte sem trade". Só que os abates que absolvem a morte vêm
// DEPOIS dela. No instante zero o veredito só podia ser negativo — o coach
// anunciava "sem trade" para toda morte que não tivesse nada antes, que é o
// contrário do que a métrica mede.
describe("espera do veredito", () => {
  it("não julga a morte antes de fechar a maior janela", () => {
    const mortes = [{ at: 100, traded: false }];
    expect(mortesJulgaveis(mortes, 100)).toHaveLength(0);
    expect(mortesJulgaveis(mortes, 100 + ESPERA_VEREDITO_S - 1)).toHaveLength(0);
  });

  it("libera o veredito quando a janela fecha", () => {
    const mortes = [{ at: 100, traded: false }];
    expect(mortesJulgaveis(mortes, 100 + ESPERA_VEREDITO_S)).toHaveLength(1);
  });

  it("a espera cobre as DUAS janelas, não só a menor", () => {
    // Se esperasse só os 15s da vingança, um trade por participação que
    // acontecesse aos +20s seria anunciado como 'sem trade' aos 15s.
    expect(ESPERA_VEREDITO_S).toBeGreaterThanOrEqual(JANELA_PARTICIPACAO_S);
    expect(ESPERA_VEREDITO_S).toBeGreaterThanOrEqual(JANELA_TRADE_S);
  });

  it("julga cada morte pelo próprio relógio", () => {
    const mortes = [{ at: 100, traded: false }, { at: 200, traded: false }];
    const r = mortesJulgaveis(mortes, 200);
    expect(r).toHaveLength(1);
    expect(r[0].at).toBe(100);
  });

  it("não lança com entrada malformada", () => {
    expect(() => mortesJulgaveis(null as any, 100)).not.toThrow();
    expect(mortesJulgaveis([{ at: NaN, traded: false }], 1000)).toHaveLength(0);
  });
});
