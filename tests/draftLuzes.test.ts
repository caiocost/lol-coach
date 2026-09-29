import { beforeEach, describe, expect, it } from "vitest";
import { DraftLuzes, transicaoLoading } from "../coach/draftLuzes.js";

const champById: Record<number, string> = { 555: "Pyke", 222: "Jinx", 145: "Kai'Sa", 21: "Miss Fortune", 238: "Zed" };

let id = 0;
const pick = (actorCellId: number, championId: number, completed = true) =>
  ({ id: id++, actorCellId, championId, type: "pick", completed });
const ban = (actorCellId: number, championId: number) =>
  ({ id: id++, actorCellId, championId, type: "ban", completed: true });

/** Meu time: células 0-4, eu na 2. Inimigos: 5-9. */
const sessao = (...fases: any[][]) => ({
  localPlayerCellId: 2,
  myTeam: [0, 1, 2, 3, 4].map((cellId) => ({ cellId })),
  actions: fases,
});

let d: DraftLuzes;
beforeEach(() => { d = new DraftLuzes(); id = 0; });

describe("draftLuzes", () => {
  it("draft começando vazio: cada pick travado vira um nome", () => {
    expect(d.processar(sessao([]), champById)).toEqual([]);
    const s = sessao([pick(0, 222)]);
    expect(d.processar(s, champById)).toEqual([{ efeito: "campeao", params: { nome: "Jinx", lado: "aliado" } }]);
    // mesmo pick no poll seguinte não repete
    expect(d.processar(s, champById)).toEqual([]);
  });

  it("lado: eu, aliado e inimigo", () => {
    d.processar(sessao([]), champById);
    const cmds = d.processar(sessao([pick(2, 555), pick(1, 145), pick(7, 238)]), champById);
    expect(cmds.map((c) => c.params)).toEqual([
      { nome: "Pyke", lado: "eu" },
      { nome: "Kai'Sa", lado: "aliado" },
      { nome: "Zed", lado: "inimigo" },
    ]);
  });

  it("hover (pick não travado) e ban não acendem", () => {
    d.processar(sessao([]), champById);
    expect(d.processar(sessao([ban(0, 21), ban(6, 238)], [pick(3, 21, false)]), champById)).toEqual([]);
  });

  it("hover que depois trava acende quando trava", () => {
    d.processar(sessao([]), champById);
    const hover = pick(3, 21, false);
    d.processar(sessao([hover]), champById);
    expect(d.processar(sessao([{ ...hover, completed: true }]), champById))
      .toEqual([{ efeito: "campeao", params: { nome: "Miss Fortune", lado: "aliado" } }]);
  });

  it("coach aberto com o draft em andamento não reescreve os picks antigos", () => {
    const antigos = [pick(0, 222), pick(7, 238)];   // mesmos ids nos dois polls, como na LCU
    expect(d.processar(sessao(antigos), champById)).toEqual([]);
    expect(d.processar(sessao([...antigos, pick(2, 555)]), champById))
      .toEqual([{ efeito: "campeao", params: { nome: "Pyke", lado: "eu" } }]);
  });

  it("reset (saiu do draft) começa de novo no próximo", () => {
    d.processar(sessao([]), champById);
    d.processar(sessao([pick(0, 222)]), champById);
    d.reset();
    d.processar(sessao([]), champById);
    id = 0;   // ids de ação reiniciam num draft novo
    expect(d.processar(sessao([pick(0, 222)]), champById)).toHaveLength(1);
  });

  it("campeão desconhecido não acende", () => {
    d.processar(sessao([]), champById);
    expect(d.processar(sessao([pick(0, 99999)]), champById)).toEqual([]);
  });
});


describe("transicaoLoading", () => {
  it("entrar em InProgress vindo do draft/GameStart começa o loading", () => {
    expect(transicaoLoading("GameStart", "InProgress")).toBe("inicio");
    expect(transicaoLoading("ChampSelect", "InProgress")).toBe("inicio");
  });
  it("coach aberto já com a partida rolando não liga a barra", () => {
    expect(transicaoLoading(null, "InProgress")).toBeNull();
  });
  it("continuar em InProgress não repete", () => {
    expect(transicaoLoading("InProgress", "InProgress")).toBeNull();
  });
  it("sair de InProgress encerra (fim de jogo, dodge, queda)", () => {
    expect(transicaoLoading("InProgress", "EndOfGame")).toBe("fim");
    expect(transicaoLoading("InProgress", "None")).toBe("fim");
  });
  it("outras transições não mexem", () => {
    expect(transicaoLoading("Lobby", "ChampSelect")).toBeNull();
  });
});
