import { describe, it, expect } from "vitest";
import { validarRegra, avaliar, descrever, fontesDoGatilho, EVENTOS, type Gatilho, type Regra, type Estado } from "../coach/alertRules.js";

/** Instantâneo mínimo de partida, para os testes não repetirem o objeto todo. */
function estado(over: Partial<Estado> = {}): Estado {
  return {
    t: 600,
    meuNivel: 5,
    meusAbates: 2,
    minhasMortes: 1,
    minhasAssistencias: 3,
    mortesSemTrade: 0,
    cs: 50,
    csMinPost15: null,
    ouro: 1200,
    meusItens: [],
    inimigosMortos: 0,
    inimigos: [],
    maiorNivelInimigoVisto: 0,
    itensInimigosVistos: [],
    eventos: [],
    objetivos: [],
    ...over,
  };
}

describe("validarRegra", () => {
  it("aceita uma regra bem formada", () => {
    const r = {
      id: "dois-mortos",
      texto: "Dois inimigos mortos, pega o objetivo",
      som: "dois-mortos",
      prioridade: 2,
      quando: { tipo: "inimigos-mortos", minimo: 2 },
    };
    expect(validarRegra(r).ok).toBe(true);
  });

  it("recusa tipo de gatilho desconhecido", () => {
    const r = {
      id: "x", texto: "t", som: "x", prioridade: 2,
      quando: { tipo: "posicao-no-mapa", area: "meu-mato" },
    };
    const v = validarRegra(r);
    expect(v.ok).toBe(false);
    expect(v.erro).toMatch(/tipo/i);
  });

  it("recusa som com travessia de caminho", () => {
    const r = {
      id: "x", texto: "t", som: "../../.env", prioridade: 2,
      quando: { tipo: "tempo", aosSegundos: 600 },
    };
    expect(validarRegra(r).ok).toBe(false);
  });

  it("recusa id vazio ou com caractere de caminho", () => {
    for (const id of ["", "a/b", "a\\b", ".."]) {
      const r = { id, texto: "t", som: "s", prioridade: 2, quando: { tipo: "tempo", aosSegundos: 60 } };
      expect(validarRegra(r).ok, `id ${JSON.stringify(id)}`).toBe(false);
    }
  });

  it("recusa aninhamento absurdo (proteção contra regra gigante)", () => {
    let q: any = { tipo: "tempo", aosSegundos: 60 };
    for (let i = 0; i < 12; i++) q = { tipo: "e", partes: [q] };
    const r = { id: "x", texto: "t", som: "s", prioridade: 2, quando: q };
    expect(validarRegra(r).ok).toBe(false);
  });
});

describe("avaliar", () => {
  const regra = (quando: any): Regra => ({
    id: "r", texto: "t", som: "s", prioridade: 2, quando,
  });

  it("inimigos-mortos dispara ao atingir o mínimo", () => {
    const r = regra({ tipo: "inimigos-mortos", minimo: 2 });
    expect(avaliar(r, estado({ inimigosMortos: 1 }))).toBe(false);
    expect(avaliar(r, estado({ inimigosMortos: 2 }))).toBe(true);
    expect(avaliar(r, estado({ inimigosMortos: 3 }))).toBe(true);
  });

  it("meu-stat compara o campo pedido", () => {
    const r = regra({ tipo: "meu-stat", campo: "mortesSemTrade", op: ">=", valor: 3 });
    expect(avaliar(r, estado({ mortesSemTrade: 2 }))).toBe(false);
    expect(avaliar(r, estado({ mortesSemTrade: 3 }))).toBe(true);
  });

  it("meu-nivel dispara a partir do nivel", () => {
    const r = regra({ tipo: "meu-nivel", minimo: 6 });
    expect(avaliar(r, estado({ meuNivel: 5 }))).toBe(false);
    expect(avaliar(r, estado({ meuNivel: 6 }))).toBe(true);
  });

  it("meu-item dispara quando o item esta no inventario", () => {
    const r = regra({ tipo: "meu-item", itens: [3142] });
    expect(avaliar(r, estado({ meusItens: [1001, 3134] }))).toBe(false);
    expect(avaliar(r, estado({ meusItens: [1001, 3142] }))).toBe(true);
  });

  it("tempo dispara a partir do instante", () => {
    const r = regra({ tipo: "tempo", aosSegundos: 900 });
    expect(avaliar(r, estado({ t: 899 }))).toBe(false);
    expect(avaliar(r, estado({ t: 900 }))).toBe(true);
  });

  it("evento dispara quando o evento esta na lista", () => {
    const r = regra({ tipo: "evento", evento: "BaronKill" });
    expect(avaliar(r, estado({ eventos: ["DragonKill"] }))).toBe(false);
    expect(avaliar(r, estado({ eventos: ["DragonKill", "BaronKill"] }))).toBe(true);
  });

  it("'e' exige todas as partes", () => {
    const r = regra({ tipo: "e", partes: [
      { tipo: "meu-nivel", minimo: 6 },
      { tipo: "inimigos-mortos", minimo: 2 },
    ]});
    expect(avaliar(r, estado({ meuNivel: 6, inimigosMortos: 1 }))).toBe(false);
    expect(avaliar(r, estado({ meuNivel: 6, inimigosMortos: 2 }))).toBe(true);
  });

  it("'ou' basta uma parte", () => {
    const r = regra({ tipo: "ou", partes: [
      { tipo: "meu-nivel", minimo: 11 },
      { tipo: "inimigos-mortos", minimo: 2 },
    ]});
    expect(avaliar(r, estado({ meuNivel: 6, inimigosMortos: 0 }))).toBe(false);
    expect(avaliar(r, estado({ meuNivel: 6, inimigosMortos: 2 }))).toBe(true);
  });

  it("campo nulo nao dispara em vez de quebrar", () => {
    const r = regra({ tipo: "meu-stat", campo: "csMinPost15", op: "<=", valor: 1 });
    expect(avaliar(r, estado({ csMinPost15: null }))).toBe(false);
  });
});

describe("descrever", () => {
  it("explica a regra em portugues", () => {
    const r: Regra = {
      id: "r", texto: "t", som: "s", prioridade: 2,
      quando: { tipo: "inimigos-mortos", minimo: 2 },
    };
    expect(descrever(r.quando)).toMatch(/2 inimigos/i);
  });
});

// Gatilhos de inimigo: existem porque a restrição anterior confundia ATRASADO
// com IMPOSSÍVEL. O que estes testes travam não é só o disparo — é a redação,
// que é a parte que informa o usuário do atraso.
describe("gatilhos de inimigo (atrasados por fog of war)", () => {
  const regra = (quando: any): Regra =>
    ({ id: "r", texto: "t", som: "s", prioridade: 2, quando });

  it("inimigo-nivel dispara no nivel visto ou acima", () => {
    const r = regra({ tipo: "inimigo-nivel", minimo: 6 });
    expect(avaliar(r, estado({ maiorNivelInimigoVisto: 5 }))).toBe(false);
    expect(avaliar(r, estado({ maiorNivelInimigoVisto: 6 }))).toBe(true);
    expect(avaliar(r, estado({ maiorNivelInimigoVisto: 11 }))).toBe(true);
  });

  it("inimigo-nivel nao dispara com inimigo nunca visto", () => {
    const r = regra({ tipo: "inimigo-nivel", minimo: 1 });
    expect(avaliar(r, estado({ maiorNivelInimigoVisto: 0 }))).toBe(false);
  });

  it("inimigo-item dispara se algum dos itens foi visto", () => {
    const r = regra({ tipo: "inimigo-item", itens: [3157, 3053] });
    expect(avaliar(r, estado({ itensInimigosVistos: [] }))).toBe(false);
    expect(avaliar(r, estado({ itensInimigosVistos: [1001, 3006] }))).toBe(false);
    expect(avaliar(r, estado({ itensInimigosVistos: [1001, 3157] }))).toBe(true);
  });

  it("valida faixa de nivel e lista de itens", () => {
    const base = { id: "x", texto: "t", som: "s", prioridade: 2 };
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-nivel", minimo: 6 } }).ok).toBe(true);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-nivel", minimo: 0 } }).ok).toBe(false);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-nivel", minimo: 19 } }).ok).toBe(false);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-item", itens: [3157] } }).ok).toBe(true);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-item", itens: [] } }).ok).toBe(false);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-item", itens: ["zhonya"] } }).ok).toBe(false);
  });

  // O ponto inteiro da correção: a descrição promete VER, não acontecer. Se
  // alguém trocar por "chegar ao nivel"/"comprar", o usuário volta a achar que
  // é avisado no instante do evento — e para quem executa por limiar de
  // vida, essa confusão custa a partida.
  it("descrever fala em VER, nunca em ter/chegar/comprar", () => {
    const nivel = descrever({ tipo: "inimigo-nivel", minimo: 6 });
    expect(nivel).toMatch(/VIR/);
    expect(nivel).toMatch(/aparecer/i);
    expect(nivel).not.toMatch(/chegar ao n[ií]vel/i);

    // "comprar" aparece, mas só NEGADO ("não quando ele comprar"): é o
    // contraste que ensina o atraso. O que não pode é afirmar a compra.
    const item = descrever({ tipo: "inimigo-item", itens: [3157] });
    expect(item).toMatch(/VIR/);
    expect(item).toMatch(/aparecer/i);
    expect(item).toMatch(/não quando ele comprar/i);
    expect(item).not.toMatch(/quando um inimigo comprar/i);
  });
});

// ---- objetivo-em ----
//
// Por que este bloco existe: o motor recusava "me avisa quando faltar 30s pro
// dragao" alegando que a API nao expunha o respawn. Alegacao falsa -- o
// ingame.ts ja calculava esses tempos e ja disparava alerta nativo com eles.
// O defeito real era o Estado nao carregar o campo, entao a regra passaria na
// validacao e NUNCA dispararia.
describe("objetivo-em", () => {
  const base = { id: "drag-30", texto: "Dragao em 30s", som: "drag-30", prioridade: 1 };
  const obj = (over: any = {}) => ({ nome: "Dragão", inSec: 300, up: false, ...over });

  it("aceita os objetivos que o ingame.ts realmente produz", () => {
    for (const objetivo of ["Dragão", "Dragão Ancião", "Voidgrubs", "Arauto", "Barão", "qualquer"]) {
      const v = validarRegra({ ...base, quando: { tipo: "objetivo-em", objetivo, emSegundos: 30 } });
      expect(v.ok, objetivo).toBe(true);
    }
  });

  it("recusa objetivo que nao existe no jogo", () => {
    // "Elder"/"Vazio" sao plausiveis e ERRADOS: o codigo emite "Dragão Ancião"
    // e "Voidgrubs". Comparacao de string que diverge = regra que nunca dispara.
    for (const objetivo of ["Elder", "Vazio", "Atakhan", "dragao"]) {
      const v = validarRegra({ ...base, quando: { tipo: "objetivo-em", objetivo, emSegundos: 30 } });
      expect(v.ok, objetivo).toBe(false);
      expect(v.erro).toMatch(/objetivo/i);
    }
  });

  it("recusa antecedencia fora de faixa", () => {
    for (const emSegundos of [0, -30, 601, "30"]) {
      expect(validarRegra({ ...base, quando: { tipo: "objetivo-em", objetivo: "Dragão", emSegundos } }).ok,
        String(emSegundos)).toBe(false);
    }
  });

  it("dispara quando falta menos que o pedido, e nao antes", () => {
    const r = { ...base, quando: { tipo: "objetivo-em", objetivo: "Dragão", emSegundos: 30 } } as Regra;
    expect(avaliar(r, estado({ objetivos: [obj({ inSec: 25 })] }))).toBe(true);
    expect(avaliar(r, estado({ objetivos: [obj({ inSec: 30 })] }))).toBe(true);
    expect(avaliar(r, estado({ objetivos: [obj({ inSec: 90 })] }))).toBe(false);
  });

  // Decisao deliberada: "faltar 30 segundos" e pedido de ANTECIPACAO. Um
  // objetivo ja nascido nao tem o que antecipar, e o coach ja tem alerta
  // proprio pra objetivo de pe. Sem isto a regra ficaria verdadeira o resto da
  // partida depois do primeiro spawn.
  it("objetivo JA DE PE nao satisfaz o gatilho", () => {
    const r = { ...base, quando: { tipo: "objetivo-em", objetivo: "Dragão", emSegundos: 30 } } as Regra;
    expect(avaliar(r, estado({ objetivos: [obj({ inSec: 10, up: true })] }))).toBe(false);
  });

  it("so olha o objetivo pedido", () => {
    const r = { ...base, quando: { tipo: "objetivo-em", objetivo: "Barão", emSegundos: 60 } } as Regra;
    const perto = [obj({ nome: "Dragão", inSec: 5 }), obj({ nome: "Barão", inSec: 400 })];
    expect(avaliar(r, estado({ objetivos: perto }))).toBe(false);
    expect(avaliar(r, estado({ objetivos: [obj({ nome: "Barão", inSec: 40 })] }))).toBe(true);
  });

  it("'qualquer' pega o que estiver chegando", () => {
    const r = { ...base, quando: { tipo: "objetivo-em", objetivo: "qualquer", emSegundos: 60 } } as Regra;
    expect(avaliar(r, estado({ objetivos: [obj({ nome: "Arauto", inSec: 45 })] }))).toBe(true);
    expect(avaliar(r, estado({ objetivos: [obj({ nome: "Arauto", inSec: 300 })] }))).toBe(false);
  });

  it("sem objetivos no estado, nao dispara", () => {
    const r = { ...base, quando: { tipo: "objetivo-em", objetivo: "Dragão", emSegundos: 30 } } as Regra;
    expect(avaliar(r, estado({ objetivos: [] }))).toBe(false);
  });

  it("descrever fala em faltar tempo pra nascer", () => {
    expect(descrever({ tipo: "objetivo-em", objetivo: "Dragão", emSegundos: 30 }))
      .toBe("quando faltarem 30s para o Dragão nascer");
    expect(descrever({ tipo: "objetivo-em", objetivo: "Barão", emSegundos: 60 }))
      .toBe("quando faltar 1 minuto para o Barão nascer");
    expect(descrever({ tipo: "objetivo-em", objetivo: "qualquer", emSegundos: 120 }))
      .toBe("quando faltarem 2 minutos para o próximo objetivo nascer");
  });
});

// fontesDoGatilho() existe para o usuario CONFERIR de onde o dado sai, em
// campos reais da API. O valor destes testes nao e o texto em si -- e garantir
// que ele nunca minta por omissao: um tipo de gatilho sem caso no switch
// devolveria undefined e a tela mostraria "De onde eu leio: undefined".
describe("fontesDoGatilho", () => {
  const TODOS: Gatilho[] = [
    { tipo: "meu-stat", campo: "ouro", op: ">=", valor: 1300 },
    { tipo: "meu-nivel", minimo: 6 },
    { tipo: "meu-item", itens: [3142] },
    { tipo: "inimigos-mortos", minimo: 2 },
    { tipo: "inimigo-nivel", minimo: 6 },
    { tipo: "inimigo-item", itens: [3047] },
    { tipo: "objetivo-em", objetivo: "Dragão", emSegundos: 30 },
    { tipo: "tempo", aosSegundos: 900 },
    { tipo: "evento", evento: "FirstBlood" },
    { tipo: "e", partes: [{ tipo: "meu-nivel", minimo: 6 }, { tipo: "inimigos-mortos", minimo: 2 }] },
    { tipo: "ou", partes: [{ tipo: "meu-nivel", minimo: 6 }, { tipo: "inimigos-mortos", minimo: 2 }] },
  ];

  it("cobre todo tipo de gatilho, sem undefined", () => {
    for (const g of TODOS) {
      const f = fontesDoGatilho(g);
      expect(typeof f, g.tipo).toBe("string");
      expect(f, g.tipo).not.toContain("undefined");
      expect(f.length, g.tipo).toBeGreaterThan(10);
    }
  });

  it("nomeia o campo concreto, nao so a ideia", () => {
    expect(fontesDoGatilho({ tipo: "meu-nivel", minimo: 6 }))
      .toBe("leio `allPlayers[você].level` a cada segundo e comparo com 6");
    expect(fontesDoGatilho({ tipo: "meu-stat", campo: "ouro", op: ">=", valor: 1300 }))
      .toContain("`activePlayer.currentGold`");
    expect(fontesDoGatilho({ tipo: "inimigos-mortos", minimo: 2 }))
      .toContain("`allPlayers[].isDead`");
    expect(fontesDoGatilho({ tipo: "evento", evento: "FirstBlood" }))
      .toContain("`events.Events[].EventName`");
  });

  // Nivel/item de inimigo passam por fog of war, e objetivo e DERIVADO. Dizer
  // "leio o timer do dragao" seria inventar um campo que a API nao tem.
  it("nao promete o que a API nao entrega", () => {
    expect(fontesDoGatilho({ tipo: "inimigo-nivel", minimo: 6 })).toContain("já visto");
    expect(fontesDoGatilho({ tipo: "inimigo-item", itens: [3047] })).toContain("já vistos");
    expect(fontesDoGatilho({ tipo: "objetivo-em", objetivo: "Dragão", emSegundos: 30 }))
      .toContain("não vem pronto da API");
  });

  it("junta as partes de e/ou sem perder nenhuma", () => {
    const e = fontesDoGatilho({ tipo: "e", partes: [
      { tipo: "meu-nivel", minimo: 6 }, { tipo: "inimigos-mortos", minimo: 2 }] });
    expect(e).toContain("`allPlayers[você].level`");
    expect(e).toContain("`allPlayers[].isDead`");
    expect(e).toContain("; e também ");
  });
});

// Morte e respawn de inimigo.
//
// POR QUE ESTE BLOCO EXISTE: a lista de impossíveis recusava os dois pedidos
// dizendo que "a API só informa que ALGUÉM morreu, não quem" e que ela "não
// expõe o tempo de respawn". As duas frases eram falsas — championName,
// isDead e respawnTimer estão em allPlayers[] e o ingame.ts já os lia. Estes
// testes travam o comportamento pra recusa não voltar.
describe("morte e respawn de inimigo (tempo real, sem fog of war)", () => {
  const regra = (quando: any): Regra =>
    ({ id: "r", texto: "t", som: "s", prioridade: 2, quando });

  /** Time inimigo de mentira, no formato que o ingame.ts monta. */
  const inimigos = (...ps: Array<[string, boolean, number]>) =>
    ps.map(([campeao, morto, respawnEm]) => ({ campeao, morto, respawnEm }));

  it("inimigo-morto dispara só para o campeão pedido", () => {
    const r = regra({ tipo: "inimigo-morto", campeao: "LeBlanc" });
    expect(avaliar(r, estado({ inimigos: inimigos(["LeBlanc", false, 0]) }))).toBe(false);
    // outro campeão morto não serve: o pedido era nominal
    expect(avaliar(r, estado({ inimigos: inimigos(["Thresh", true, 20]) }))).toBe(false);
    expect(avaliar(r, estado({ inimigos: inimigos(["LeBlanc", true, 12]) }))).toBe(true);
  });

  // O usuário digita "leblanc"; a API escreve "LeBlanc". Sem normalizar dos
  // DOIS lados, a regra validaria e nunca dispararia — falha silenciosa.
  it("casa o nome do campeão sem ligar pra caixa, acento ou apóstrofo", () => {
    const casos: Array<[string, string]> = [
      ["leblanc", "LeBlanc"],
      ["LEBLANC", "LeBlanc"],
      ["kaisa", "Kai'Sa"],
      ["Kai'Sa", "Kai'Sa"],
      ["master yi", "Master Yi"],
      ["masteryi", "Master Yi"],
      ["velkoz", "Vel'Koz"],
      ["dr mundo", "Dr. Mundo"],
    ];
    for (const [escrito, naApi] of casos) {
      const r = regra({ tipo: "inimigo-morto", campeao: escrito });
      expect(validarRegra({ id: "x", texto: "t", som: "s", prioridade: 2, quando: r.quando }).ok,
        `validar ${escrito}`).toBe(true);
      expect(avaliar(r, estado({ inimigos: inimigos([naApi, true, 10]) })),
        `${escrito} deve casar com ${naApi}`).toBe(true);
    }
  });

  // Cliente em português devolve "Bardo"/"Nunu e Willump". Se a regra guarda o
  // nome em inglês e a comparação não normalizasse os dois lados, o alerta
  // nunca dispararia justamente pra quem joga em PT — que é este usuário.
  it("casa mesmo com o cliente em português", () => {
    const r = regra({ tipo: "inimigo-morto", campeao: "Bard" });
    expect(avaliar(r, estado({ inimigos: inimigos(["Bardo", true, 15]) }))).toBe(true);
    const n = regra({ tipo: "inimigo-morto", campeao: "nunu" });
    expect(avaliar(n, estado({ inimigos: inimigos(["Nunu e Willump", true, 15]) }))).toBe(true);
  });

  // A recusa TEM que ser possível. Um nome inventado que passasse viraria uma
  // regra válida e eternamente muda: o usuário grava a voz e espera pra sempre.
  it("recusa campeão que não existe, em vez de aceitar regra morta", () => {
    const base = { id: "x", texto: "t", som: "s", prioridade: 2 };
    for (const nome of ["Leblank", "Jungler", "", "   ", "o suporte deles"]) {
      const v = validarRegra({ ...base, quando: { tipo: "inimigo-morto", campeao: nome } });
      expect(v.ok, `campeão ${JSON.stringify(nome)}`).toBe(false);
      expect(v.erro).toMatch(/campeão desconhecido/i);
    }
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-morto", campeao: "LeBlanc" } }).ok).toBe(true);
  });

  it("inimigo-respawn exige morto E tempo suficiente no contador", () => {
    const r = regra({ tipo: "inimigo-respawn", segundos: 30 });
    // vivo não conta, mesmo que o respawnTimer venha sujo
    expect(avaliar(r, estado({ inimigos: inimigos(["Ashe", false, 45]) }))).toBe(false);
    // morto, mas volta antes: não é janela de objetivo
    expect(avaliar(r, estado({ inimigos: inimigos(["Ashe", true, 29]) }))).toBe(false);
    expect(avaliar(r, estado({ inimigos: inimigos(["Ashe", true, 30]) }))).toBe(true);
    expect(avaliar(r, estado({ inimigos: inimigos(["Ashe", true, 52]) }))).toBe(true);
  });

  it("inimigo-respawn com campeão só olha aquele", () => {
    const r = regra({ tipo: "inimigo-respawn", segundos: 30, campeao: "Thresh" });
    // o morto por muito tempo é outro
    expect(avaliar(r, estado({ inimigos: inimigos(["Ashe", true, 50], ["Thresh", false, 0]) }))).toBe(false);
    expect(avaliar(r, estado({ inimigos: inimigos(["Ashe", true, 50], ["Thresh", true, 40]) }))).toBe(true);
  });

  it("valida a faixa de respawn e o campeão opcional", () => {
    const base = { id: "x", texto: "t", som: "s", prioridade: 2 };
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-respawn", segundos: 30 } }).ok).toBe(true);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-respawn", segundos: 0 } }).ok).toBe(false);
    // acima do timer de morte real do jogo: nunca dispararia
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-respawn", segundos: 120 } }).ok).toBe(false);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-respawn", segundos: 30, campeao: "Thresh" } }).ok).toBe(true);
    expect(validarRegra({ ...base, quando: { tipo: "inimigo-respawn", segundos: 30, campeao: "Xablau" } }).ok).toBe(false);
  });

  // O espelho do teste de fog of war: aqui a redação NÃO pode falar em VER.
  // Morte é anunciada globalmente, então prometer observação seria errar para
  // o outro lado — o usuário desconfiaria de um aviso que chega na hora.
  it("descrever fala do ACONTECIMENTO, sem ressalva de ver", () => {
    const d = descrever({ tipo: "inimigo-morto", campeao: "leblanc" });
    expect(d).toMatch(/LeBlanc/);          // normaliza pro nome canônico
    expect(d).toMatch(/morrer/);
    expect(d).not.toMatch(/VIR|aparecer|visto/i);

    const r = descrever({ tipo: "inimigo-respawn", segundos: 30 });
    expect(r).toMatch(/30s/);
    expect(r).toMatch(/respawn/i);
    expect(r).not.toMatch(/VIR|aparecer|visto/i);
  });

  it("fontesDoGatilho nomeia os campos reais e não promete atraso", () => {
    const d = fontesDoGatilho({ tipo: "inimigo-morto", campeao: "LeBlanc" });
    expect(d).toContain("`allPlayers[].championName`");
    expect(d).toContain("`allPlayers[].isDead`");
    // não pode carregar a ressalva de "já visto" que nível/item têm
    expect(d).not.toContain("já visto");

    const r = fontesDoGatilho({ tipo: "inimigo-respawn", segundos: 30 });
    expect(r).toContain("`allPlayers[].respawnTimer`");
    expect(r).not.toContain("já visto");
  });
});

describe("EVENTOS cobre o que o coach trata", () => {
  // ESTE TESTE EXISTE POR CAUSA DE UM ERRO REPETIDO CINCO VEZES.
  //
  // A lista do que a IA pode gerar foi escrita olhando a API, sem conferir o
  // que o ingame.ts já derivava dela. Resultado: nível de inimigo, item de
  // inimigo, timer de objetivo, morte de inimigo e HordeKill foram recusados
  // pela IA enquanto o coach já os usava. O usuário achou os quatro primeiros;
  // um agente achou o quinto.
  //
  // Recusa errada é cara: o usuário é informado de que a ideia dele não dá,
  // quando dá. Agora o desencontro falha aqui, não em uso.
  it("todo EventName tratado no ingame.ts pode virar gatilho", async () => {
    const { readFile } = await import("node:fs/promises");
    const fonte = await readFile(
      new URL("../coach/ingame.ts", import.meta.url), "utf8",
    );
    // pega tanto `EventName === "X"` quanto o regex `^(X|Y|Z)$`
    const tratados = new Set<string>();
    for (const m of fonte.matchAll(/EventName\s*===?\s*"([A-Za-z]+)"/g)) {
      tratados.add(m[1]);
    }
    for (const m of fonte.matchAll(/\^\(([A-Za-z|]+)\)\$/g)) {
      for (const nome of m[1].split("|")) tratados.add(nome);
    }
    expect(tratados.size).toBeGreaterThan(0);   // o regex ainda acha algo?

    const oferecidos = new Set<string>(EVENTOS);
    const faltando = [...tratados].filter((e) => !oferecidos.has(e));
    expect(faltando, `eventos que o coach trata mas a IA recusaria: ${faltando.join(", ")}`)
      .toEqual([]);
  });
});
