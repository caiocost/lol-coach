import { describe, it, expect } from "vitest";
import {
  CAMPEOES, resolverCampeao, mesmoCampeao, normalizarCampeao,
} from "../coach/champions.js";

// Este módulo existe pra uma coisa só: impedir que uma regra valide com um
// campeão que não existe e depois nunca dispare. Os testes cobrem os dois
// lados disso — casar o que deve casar, e RECUSAR o que não existe.
describe("resolverCampeao", () => {
  it("aceita o nome exato como a API escreve", () => {
    for (const c of ["LeBlanc", "Master Yi", "Kai'Sa", "Dr. Mundo", "Pyke"]) {
      expect(resolverCampeao(c), c).toBe(c);
    }
  });

  it("perdoa caixa, acento, espaço e apóstrofo", () => {
    expect(resolverCampeao("leblanc")).toBe("LeBlanc");
    expect(resolverCampeao("LEBLANC")).toBe("LeBlanc");
    expect(resolverCampeao("  LeBlanc  ")).toBe("LeBlanc");
    expect(resolverCampeao("masteryi")).toBe("Master Yi");
    expect(resolverCampeao("kaisa")).toBe("Kai'Sa");
    expect(resolverCampeao("khazix")).toBe("Kha'Zix");
    expect(resolverCampeao("drmundo")).toBe("Dr. Mundo");
  });

  // O cliente em português devolve estes nomes. Sem os apelidos de locale, a
  // regra do usuário brasileiro não casaria com a partida dele.
  it("entende os nomes do cliente em português", () => {
    expect(resolverCampeao("Bardo")).toBe("Bard");
    expect(resolverCampeao("Nunu e Willump")).toBe("Nunu & Willump");
    expect(resolverCampeao("Nunu & Willump")).toBe("Nunu & Willump");
  });

  it("entende apelidos que as pessoas de fato usam", () => {
    expect(resolverCampeao("mf")).toBe("Miss Fortune");
    expect(resolverCampeao("tf")).toBe("Twisted Fate");
    expect(resolverCampeao("j4")).toBe("Jarvan IV");
    expect(resolverCampeao("lee")).toBe("Lee Sin");
    expect(resolverCampeao("ww")).toBe("Warwick");
  });

  // A parte que impede a regra morta e silenciosa.
  it("devolve null pro que não existe", () => {
    for (const n of ["Leblank", "jungler", "suporte", "", "   ", "123"]) {
      expect(resolverCampeao(n), n).toBeNull();
    }
    expect(resolverCampeao(undefined)).toBeNull();
    expect(resolverCampeao(42)).toBeNull();
  });
});

describe("mesmoCampeao", () => {
  it("casa o que o usuário digita com o que a API devolve", () => {
    expect(mesmoCampeao("leblanc", "LeBlanc")).toBe(true);
    expect(mesmoCampeao("LeBlanc", "Bardo")).toBe(false);
    // locale: regra em inglês, partida em português
    expect(mesmoCampeao("Bard", "Bardo")).toBe(true);
    expect(mesmoCampeao("nunu", "Nunu e Willump")).toBe(true);
  });

  it("não casa com lixo", () => {
    expect(mesmoCampeao("LeBlanc", undefined)).toBe(false);
    expect(mesmoCampeao("LeBlanc", "")).toBe(false);
    expect(mesmoCampeao("LeBlanc", "Thresh")).toBe(false);
  });

  // Campeão novo que a API já tem e esta lista ainda não: melhor casar pelo
  // nome cru do que responder "não" a um campeão que está na partida.
  it("ainda casa campeão fora da lista, comparando normalizado", () => {
    expect(mesmoCampeao("Campeaonovo", "campeão novo")).toBe(true);
    expect(mesmoCampeao("Campeaonovo", "Outro")).toBe(false);
  });
});

describe("a lista em si", () => {
  it("não tem nome repetido nem colisão depois de normalizar", () => {
    const vistos = new Map<string, string>();
    for (const c of CAMPEOES) {
      const n = normalizarCampeao(c);
      expect(vistos.has(n), `${c} colide com ${vistos.get(n)}`).toBe(false);
      vistos.set(n, c);
    }
    expect(CAMPEOES.length).toBeGreaterThan(160);
  });
});
