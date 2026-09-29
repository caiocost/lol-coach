import { beforeEach, describe, expect, it } from "vitest";
import { RgbBridge, type ContextoRgb } from "../coach/rgbBridge.js";

const EU = "Jogador";
const ctx: ContextoRgb = { eu: EU, meuTime: "ORDER", aliados: new Set([EU, "Caitlyn", "Malphite", "Viego", "Ahri"]) };

let id = 0;
const ev = (EventName: string, extra: Record<string, unknown> = {}) => ({ EventID: id++, EventName, EventTime: 100, ...extra });
const kill = (KillerName: string, VictimName: string, Assisters: string[] = []) =>
  ev("ChampionKill", { KillerName, VictimName, Assisters });

let b: RgbBridge;
beforeEach(() => { b = new RgbBridge(); id = 0; });

const nomes = (cmds: { efeito: string }[]) => cmds.map((c) => c.efeito);

describe("rgbBridge", () => {
  it("kill próprio vira kill; kill de aliado não acende nada", () => {
    expect(nomes(b.processar([kill(EU, "Zed")], ctx))).toEqual(["kill"]);
    expect(b.processar([kill("Caitlyn", "Lux")], ctx)).toEqual([]);
  });

  it("assist quando estou em Assisters", () => {
    expect(nomes(b.processar([kill("Caitlyn", "Lux", [EU, "Viego"])], ctx))).toEqual(["assist"]);
  });

  it("multikill no mesmo poll do kill leva os dois (o daemon escolhe o maior)", () => {
    const cmds = b.processar([kill(EU, "Zed"), ev("Multikill", { KillerName: EU, KillStreak: 3 })], ctx);
    expect(cmds).toContainEqual({ efeito: "multikill", params: { n: 3 } });
  });

  it("multikill de outro jogador é ignorado", () => {
    expect(b.processar([ev("Multikill", { KillerName: "Caitlyn", KillStreak: 5 })], ctx)).toEqual([]);
  });

  it("first blood meu", () => {
    const cmds = b.processar([kill(EU, "Zed"), ev("FirstBlood", { Recipient: EU })], ctx);
    expect(nomes(cmds)).toContain("firstblood");
    expect(b.processar([ev("FirstBlood", { Recipient: "Caitlyn" })], ctx)).toEqual([]);
  });

  it("shutdown quando a vítima vinha de 3 kills sem morrer", () => {
    b.processar([kill("Zed", "Caitlyn"), kill("Zed", "Malphite")], ctx);
    expect(nomes(b.processar([kill("Zed", "Viego")], ctx))).toEqual([]);
    expect(nomes(b.processar([kill(EU, "Zed")], ctx))).toEqual(["shutdown"]);
  });

  it("sequência zera quando o campeão morre", () => {
    b.processar([kill("Zed", "Caitlyn"), kill("Zed", "Malphite"), kill("Caitlyn", "Zed")], ctx);
    b.processar([kill("Zed", "Viego")], ctx);
    expect(nomes(b.processar([kill(EU, "Zed")], ctx))).toEqual(["kill"]);
  });

  it("ace só do meu time", () => {
    expect(nomes(b.processar([ev("Ace", { Acer: "Caitlyn", AcingTeam: "ORDER" })], ctx))).toEqual(["ace"]);
    expect(b.processar([ev("Ace", { Acer: "Zed", AcingTeam: "CHAOS" })], ctx)).toEqual([]);
  });

  it("objetivos só quando um aliado mata", () => {
    expect(b.processar([ev("DragonKill", { KillerName: "Viego", DragonType: "Water" })], ctx))
      .toEqual([{ efeito: "dragao", params: { tipo: "Water" } }]);
    expect(b.processar([ev("DragonKill", { KillerName: "Zed", DragonType: "Fire" })], ctx)).toEqual([]);
    expect(nomes(b.processar([ev("BaronKill", { KillerName: "Viego" })], ctx))).toEqual(["barao"]);
    expect(nomes(b.processar([ev("HeraldKill", { KillerName: "Ahri" })], ctx))).toEqual(["arauto"]);
    expect(nomes(b.processar([ev("HordeKill", { KillerName: EU })], ctx))).toEqual(["vastilarvas"]);
  });

  it("fim de partida: vitória ou derrota", () => {
    expect(nomes(b.processar([ev("GameEnd", { Result: "Win" })], ctx))).toEqual(["vitoria"]);
    expect(nomes(b.processar([ev("GameEnd", { Result: "Lose" })], ctx))).toEqual(["derrota"]);
  });

  it("evento antigo (coach aberto no meio da partida) conta sequência mas não acende", () => {
    const velho = (e: any) => ({ ...e, EventTime: 10 });
    const cmds = b.processar([velho(kill("Zed", "Caitlyn")), velho(kill("Zed", "Malphite")),
      velho(kill("Zed", "Viego")), velho(ev("Multikill", { KillerName: EU, KillStreak: 5 }))], ctx, 600);
    expect(cmds).toEqual([]);
    expect(nomes(b.processar([{ ...kill(EU, "Zed"), EventTime: 599 }], ctx, 600))).toEqual(["shutdown"]);
  });

  it("reset esquece as sequências da partida anterior", () => {
    b.processar([kill("Zed", "Caitlyn"), kill("Zed", "Malphite"), kill("Zed", "Viego")], ctx);
    b.reset();
    expect(nomes(b.processar([kill(EU, "Zed")], ctx))).toEqual(["kill"]);
  });
});

describe("RgbBridge — nome do campeão no kill", () => {
  it("leva o seu campeão para o efeito de kill quando o contexto tem", () => {
    const b = new RgbBridge();
    const ctx = { eu: "Eu", meuTime: "ORDER", aliados: new Set(["Eu"]), campeao: "Ahri" };
    const out = b.processar([{ EventName: "ChampionKill", KillerName: "Eu", VictimName: "X", Assisters: [] }], ctx);
    expect(out).toEqual([{ efeito: "kill", params: { campeao: "Ahri" } }]);
  });
});
