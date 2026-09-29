// O log é o que o usuário vai LER durante a partida, então o que se testa aqui
// é a leitura: a frase sai certa em português, o marcador de "dá pra alertar"
// só aparece quando o gatilho de fato existe, e o teto de memória segura.
import { describe, it, expect } from "vitest";
import {
  EventLog, linhaDeEvento, linhaDeAlerta, transicoes, memoriaVazia,
  LIMITE_LINHAS, relogio, reconstruirLog, type FotoPoll,
} from "../coach/eventLog.js";
import { EVENTOS } from "../coach/alertRules.js";

describe("descrição dos eventos da API", () => {
  it("lê um abate com nome de quem matou e de quem morreu", () => {
    const l = linhaDeEvento(
      { EventID: 12, EventName: "ChampionKill", EventTime: 421.5, KillerName: "Jogador", VictimName: "Jhin", Assisters: [] }, 0);
    expect(l.texto).toBe("Jogador matou Jhin");
    expect(l.t).toBe(421.5);
    expect(l.fonte).toBe("evento");
  });

  it("cita os assistentes quando existem", () => {
    const l = linhaDeEvento(
      { EventID: 13, EventName: "ChampionKill", KillerName: "Jogador", VictimName: "Jhin", Assisters: ["Volibear", "Ezreal"] }, 100);
    expect(l.texto).toBe("Jogador matou Jhin (assist: Volibear, Ezreal)");
  });

  it("nomeia o tipo do dragão e marca roubo", () => {
    expect(linhaDeEvento({ EventID: 1, EventName: "DragonKill", DragonType: "Fire", KillerName: "Jogador", Stolen: "False" }, 0).texto)
      .toBe("Jogador pegou o Dragão de Fire");
    expect(linhaDeEvento({ EventID: 2, EventName: "DragonKill", DragonType: "Elder", KillerName: "Jhin", Stolen: "True" }, 0).texto)
      .toBe("Jhin pegou o Dragão Ancião — ROUBADO");
  });

  it("traduz multikill pelo KillStreak", () => {
    expect(linhaDeEvento({ EventID: 3, EventName: "Multikill", KillerName: "Jogador", KillStreak: 3 }, 0).texto)
      .toBe("Jogador fez Triple Kill");
    expect(linhaDeEvento({ EventID: 4, EventName: "Multikill", KillerName: "Jogador", KillStreak: 5 }, 0).texto)
      .toBe("Jogador fez Penta Kill");
  });

  it("lê os eventos de estrutura, início e voidgrub", () => {
    expect(linhaDeEvento({ EventID: 5, EventName: "GameStart", EventTime: 0 }, 0).texto).toBe("Partida começou");
    expect(linhaDeEvento({ EventID: 6, EventName: "MinionsSpawning", EventTime: 30 }, 0).texto)
      .toBe("Minions saíram da base — a lane abriu");
    expect(linhaDeEvento({ EventID: 7, EventName: "HordeKill", KillerName: "Volibear" }, 0).texto)
      .toBe("Volibear pegou uma Voidgrub");
    expect(linhaDeEvento({ EventID: 8, EventName: "TurretKilled", KillerName: "Jogador", TurretKilled: "Turret_T1_C_05_A" }, 0).texto)
      .toBe("Jogador derrubou uma torre (Turret_T1_C_05_A)");
    expect(linhaDeEvento({ EventID: 9, EventName: "Ace", Acer: "Jogador" }, 0).texto)
      .toBe("Ace — Jogador zerou o time inimigo");
  });

  it("mostra o nome cru de evento desconhecido em vez de esconder", () => {
    // O log existe pra REVELAR o que a API expõe; engolir um evento novo seria
    // reintroduzir exatamente o problema que ele resolve.
    const l = linhaDeEvento({ EventID: 99, EventName: "TurretPlateDestroyed" }, 300);
    expect(l.texto).toContain("TurretPlateDestroyed");
    expect(l.alertavel).toBeNull();
  });
});

describe("marcador de alertável", () => {
  it("só marca eventos que alertRules.EVENTOS de fato aceita", () => {
    // Prometer um alerta que a validação vai recusar é pior que não prometer —
    // foi o defeito do HordeKill, que o coach lia e a IA negava.
    for (const nome of EVENTOS) {
      const l = linhaDeEvento({ EventID: 1, EventName: nome }, 0);
      expect(l.alertavel, `${nome} deveria ser alertável`).not.toBeNull();
      expect(l.alertavel!.gatilho).toBe("evento");
      expect(l.alertavel!.pedido.length).toBeGreaterThan(5);
    }
  });

  it("não marca evento que existe na API mas não tem gatilho", () => {
    expect(linhaDeEvento({ EventID: 1, EventName: "GameEnd", Result: "Win" }, 0).alertavel).toBeNull();
    expect(linhaDeEvento({ EventID: 2, EventName: "InhibRespawned", InhibRespawned: "x" }, 0).alertavel).toBeNull();
  });

  it("alerta que disparou nunca oferece 'criar alerta disto' (seria circular)", () => {
    const l = linhaDeAlerta({ id: "no-trade", fireId: "nt-2", text: "2 mortes sem trade" }, 900);
    expect(l.texto).toBe("ALERTA: 2 mortes sem trade");
    expect(l.fonte).toBe("alerta");
    expect(l.alertavel).toBeNull();
  });
});

const fotoBase = (over: Partial<FotoPoll> = {}): FotoPoll => ({
  t: 600, niveis: [], itens: [], inimigos: [], objetivos: [],
  mortesSemTrade: 0, ctrlWards: 0, ...over,
});

describe("transições derivadas do poll", () => {
  it("não gera nada na PRIMEIRA leitura — ninguém 'acabou de' fazer nada", () => {
    const mem = memoriaVazia();
    const out = transicoes(fotoBase({
      niveis: [{ nome: "a", champ: "Zed", nivel: 11, inimigo: true }],
      inimigos: [{ campeao: "Zed", morto: true, respawnEm: 20 }],
    }), mem);
    expect(out).toHaveLength(0);
    expect(mem.iniciada).toBe(true);
  });

  it("anuncia o nível 6 inimigo com a ult, e oferece o gatilho certo", () => {
    const mem = memoriaVazia();
    transicoes(fotoBase({ niveis: [{ nome: "a", champ: "Zed", nivel: 5, inimigo: true }] }), mem);
    const out = transicoes(fotoBase({ t: 610, niveis: [{ nome: "a", champ: "Zed", nivel: 6, inimigo: true }] }), mem);
    expect(out).toHaveLength(1);
    expect(out[0].texto).toBe("Zed (inimigo) chegou ao nível 6 — ultimate disponível");
    expect(out[0].alertavel!.gatilho).toBe("inimigo-nivel");
  });

  it("registra item novo no inventário, com nome legível", () => {
    const mem = memoriaVazia();
    transicoes(fotoBase({ itens: [{ nome: "a", champ: "Zed", inimigo: true, itens: [] }] }), mem);
    const out = transicoes(fotoBase({
      t: 620,
      itens: [{ nome: "a", champ: "Zed", inimigo: true, itens: [{ id: 3157, nome: "Ampulheta de Zhonya" }] }],
    }), mem);
    expect(out[0].texto).toBe("Zed (inimigo) apareceu com Ampulheta de Zhonya");
    expect(out[0].alertavel!.pedido).toBe("me avisa quando um inimigo comprar Ampulheta de Zhonya");
  });

  it("morte e volta do inimigo saem uma vez cada, não a cada segundo", () => {
    const mem = memoriaVazia();
    transicoes(fotoBase({ inimigos: [{ campeao: "Zed", morto: false, respawnEm: 0 }] }), mem);
    const morreu = transicoes(fotoBase({ t: 610, inimigos: [{ campeao: "Zed", morto: true, respawnEm: 24 }] }), mem);
    expect(morreu).toHaveLength(1);
    expect(morreu[0].texto).toBe("Zed (inimigo) morreu — volta em 24s");
    // segundo ainda morto: nada de novo
    expect(transicoes(fotoBase({ t: 611, inimigos: [{ campeao: "Zed", morto: true, respawnEm: 23 }] }), mem)).toHaveLength(0);
    const voltou = transicoes(fotoBase({ t: 634, inimigos: [{ campeao: "Zed", morto: false, respawnEm: 0 }] }), mem);
    expect(voltou).toHaveLength(1);
    expect(voltou[0].texto).toBe("Zed (inimigo) voltou ao mapa");
  });

  it("janela de objetivo ancora no spawn, então não repete a cada segundo", () => {
    const mem = memoriaVazia();
    transicoes(fotoBase({ t: 1100, objetivos: [{ name: "Barão", inSec: 100, up: false }] }), mem);
    const a = transicoes(fotoBase({ t: 1140, objetivos: [{ name: "Barão", inSec: 60, up: false }] }), mem);
    expect(a).toHaveLength(1);
    expect(a[0].texto).toBe("Barão nasce em 60s — janela de 60s aberta");
    // mesmo spawn, segundo seguinte: nada
    expect(transicoes(fotoBase({ t: 1141, objetivos: [{ name: "Barão", inSec: 59, up: false }] }), mem)).toHaveLength(0);
    // a janela de 30s é outra ocorrência e sai
    const b = transicoes(fotoBase({ t: 1170, objetivos: [{ name: "Barão", inSec: 30, up: false }] }), mem);
    expect(b).toHaveLength(1);
    expect(b[0].texto).toContain("janela de 30s");
  });

  it("não loga ouro, HP nem nada que muda a cada segundo", () => {
    // O usuário recusou dump por segundo explicitamente. Duas leituras
    // idênticas fora dos gatilhos têm que produzir ZERO linhas.
    const mem = memoriaVazia();
    const f = () => fotoBase({
      niveis: [{ nome: "a", champ: "Zed", nivel: 9, inimigo: true }],
      itens: [{ nome: "a", champ: "Zed", inimigo: true, itens: [{ id: 3157, nome: "Zhonya" }] }],
      inimigos: [{ campeao: "Zed", morto: false, respawnEm: 0 }],
      objetivos: [{ name: "Barão", inSec: 400, up: false }],
      mortesSemTrade: 1, ctrlWards: 3,
    });
    transicoes(f(), mem);
    for (let i = 0; i < 50; i++) expect(transicoes(f(), mem)).toHaveLength(0);
  });
});

describe("limite de memória", () => {
  it("uma partida longuíssima não passa do teto de linhas nem de chaves", () => {
    const log = new EventLog();
    // 40min a 1 poll/s = 2400 polls. Simula o pior caso: linha nova todo poll.
    for (let i = 0; i < 2400; i++) {
      log.adicionar([{ id: `x-${i}`, t: i, fonte: "evento", texto: `linha ${i}`, alertavel: null }]);
    }
    expect(log.tamanho).toBe(LIMITE_LINHAS);
    expect(log.recentes()).toHaveLength(LIMITE_LINHAS);
    // as mais recentes ficam, as antigas saem
    expect(log.recentes()[0].texto).toBe("linha 2399");
    // o Set de dedup acompanha o corte: sem isso ele cresceria a 2400 chaves
    // mesmo com o array limitado — vazamento silencioso.
    expect((log as any).vistas.size).toBe(LIMITE_LINHAS);
  });

  it("deduplica por id: o mesmo evento reenviado não vira linha nova", () => {
    // A Live Client API reenvia o histórico INTEIRO a cada chamada.
    const log = new EventLog();
    for (let i = 0; i < 100; i++) {
      log.adicionar([linhaDeEvento({ EventID: 7, EventName: "FirstBlood", Recipient: "Jogador" }, 0)]);
    }
    expect(log.tamanho).toBe(1);
  });

  it("reset de partida limpa linhas e memória de transição", () => {
    const log = new EventLog();
    log.adicionar([{ id: "a", t: 1, fonte: "evento", texto: "x", alertavel: null }]);
    transicoes(fotoBase({ niveis: [{ nome: "a", champ: "Zed", nivel: 5, inimigo: true }] }), log.mem);
    log.reset();
    expect(log.tamanho).toBe(0);
    expect(log.mem.iniciada).toBe(false);
    expect(log.mem.niveis.size).toBe(0);
  });
});

describe("nada aqui pode derrubar o poll", () => {
  it("aguenta evento nulo, sem campos, e lixo", () => {
    // O poll roda 1x/s dentro de pollSeguro(); uma exceção aqui já matou o
    // servidor em partida antes. Formatar lixo tem que ser inofensivo.
    for (const lixo of [null, undefined, {}, { EventName: null }, { EventName: 123 }, [], "texto"]) {
      expect(() => linhaDeEvento(lixo as any, 0)).not.toThrow();
    }
  });

  it("aguenta foto de poll incompleta", () => {
    const mem = memoriaVazia();
    expect(() => transicoes({} as any, mem)).not.toThrow();
    expect(() => transicoes({ t: NaN } as any, mem)).not.toThrow();
    expect(() => transicoes(fotoBase({ inimigos: [null as any, { campeao: "", morto: true, respawnEm: 0 }] }), mem)).not.toThrow();
  });

  it("adicionar() engole linha malformada em vez de lançar", () => {
    const log = new EventLog();
    expect(() => log.adicionar([null as any, undefined as any, { id: 5 } as any])).not.toThrow();
    expect(() => log.adicionar(null as any)).not.toThrow();
    expect(log.tamanho).toBe(0);
  });

  it("relógio não quebra com número inválido", () => {
    expect(relogio(NaN)).toBe("0:00");
    expect(relogio(-5)).toBe("0:00");
    expect(relogio(1338)).toBe("22:18");
  });
});

// A reconstrução é o que o usuário lê ao abrir uma partida passada. O que
// importa testar: ela devolve as MESMAS frases do ao vivo (é o mesmo
// formatador), não inventa transição que não dá pra reconstruir, e não lança
// com gravação estragada — ela roda no boot do servidor.
describe("reconstruirLog", () => {
  const rec = {
    events: [
      { t: 0, kind: "GameStart", data: { EventID: 0, EventName: "GameStart", EventTime: 0 } },
      { t: 0, kind: "leitura", data: { flags: [], plan: null } },
      { t: 70, kind: "ChampionKill", data: { EventID: 2, EventName: "ChampionKill", EventTime: 70, KillerName: "A", VictimName: "B", Assisters: [] } },
      { t: 78, kind: "alerta", data: { id: "no-trade", level: "warn", text: "1 morte sem trade" } },
      { t: 123, kind: "alerta", data: { id: "no-trade", level: "warn", text: "2 mortes sem trade" } },
      { t: 433, kind: "DragonKill", data: { EventID: 17, EventName: "DragonKill", EventTime: 433, KillerName: "C", DragonType: "Water", Stolen: "False" } },
    ],
  };

  it("formata o evento cru igual ao log ao vivo", () => {
    const { linhas } = reconstruirLog(rec);
    const kill = linhas.find((l) => l.texto.includes("matou"));
    expect(kill?.texto).toBe(linhaDeEvento(rec.events[2].data, 70).texto);
    expect(linhas.find((l) => l.t === 433)?.texto).toContain("pegou o Dragão de Water");
  });

  it("devolve do mais recente pro mais antigo", () => {
    const ts = reconstruirLog(rec).linhas.map((l) => l.t);
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
  });

  it("não perde dois alertas de mesmo id em tempos diferentes", () => {
    // O recorder não grava fireId; sem o tempo na chave, a dedup comeria o 2o.
    const al = reconstruirLog(rec).linhas.filter((l) => l.fonte === "alerta");
    expect(al).toHaveLength(2);
    expect(al.map((l) => l.texto)).toContain("ALERTA: 2 mortes sem trade");
  });

  it("ignora a leitura de composicao, que e contexto e nao linha do log", () => {
    expect(reconstruirLog(rec).linhas.some((l) => l.texto.includes("flags"))).toBe(false);
    // 3 eventos de API + 2 alertas; a "leitura" fica de fora.
    expect(reconstruirLog(rec).linhas).toHaveLength(5);
  });

  it("avisa que é só evento — transição não é reconstruível", () => {
    expect(reconstruirLog(rec).soEventos).toBe(true);
    expect(reconstruirLog(rec).linhas.some((l) => l.fonte === "transicao")).toBe(false);
  });

  it("não lança com gravação estragada (roda no boot do servidor)", () => {
    const lixos = [null, undefined, {}, { events: null }, { events: [null, 1, "x"] }, { events: [{ t: NaN, kind: "alerta" }] }];
    for (const lixo of lixos) {
      expect(() => reconstruirLog(lixo as any)).not.toThrow();
    }
    expect(reconstruirLog(null).linhas).toEqual([]);
  });

  it("o log ao vivo continua aceitando linhas reconstruídas (reidratação do boot)", () => {
    // Regressão: reidratar não pode quebrar o EventLog que o poll usa depois.
    const log = new EventLog();
    log.adicionar([...reconstruirLog(rec).linhas].reverse());
    expect(log.tamanho).toBe(5);
    // e o poll segue somando em cima, sem duplicar o que já entrou
    log.adicionar([linhaDeEvento(rec.events[2].data, 70)]);
    expect(log.tamanho).toBe(5);
    log.adicionar([linhaDeEvento({ EventID: 99, EventName: "BaronKill", EventTime: 900, KillerName: "D" }, 900)]);
    expect(log.tamanho).toBe(6);
    expect(log.recentes(1)[0].texto).toContain("Barão");
  });
});
