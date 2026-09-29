// O que este teste protege: a conversão nome-de-exibição -> chave do Data
// Dragon. É o ponto exato onde o ícone quebra sem avisar — a URL é montada,
// o <img> pede, o CDN devolve 403, e a única evidência é um retrato faltando
// para uns poucos campeões no meio de uma partida ao vivo.
//
// POR ISSO O TESTE VAI À REDE. Afirmar que a string "Kaisa" "parece certa" não
// prova nada: quem decide o nome do arquivo é a Riot, não a nossa intuição.
// Os casos difíceis são verificados pedindo a imagem de verdade e exigindo
// HTTP 200. Os testes de rede ficam separados e tolerantes a queda de conexão,
// para que a suíte continue rodável offline.

import { describe, it, expect } from "vitest";
import { chaveDeCampeao, iconeCampeao, iconeItem, DDRAGON } from "../coach/ddragon.js";
import { CAMPEOES } from "../coach/champions.js";

// Os nomes que a Live Client API escreve com pontuação, espaço, "&" ou
// simplesmente com outro nome que não a chave. Todo ícone que já quebrou neste
// projeto está nesta lista.
const DIFICEIS: Record<string, string> = {
  "Kai'Sa": "Kaisa",
  "Cho'Gath": "Chogath",
  "Vel'Koz": "Velkoz",
  "Kha'Zix": "Khazix",
  "Rek'Sai": "RekSai",
  "LeBlanc": "Leblanc",
  "Dr. Mundo": "DrMundo",
  "Jarvan IV": "JarvanIV",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  "Tahm Kench": "TahmKench",
  "Twisted Fate": "TwistedFate",
  "Aurelion Sol": "AurelionSol",
  "Nunu & Willump": "Nunu",
  "Renata Glasc": "Renata",
  "Wukong": "MonkeyKing",
  "Bel'Veth": "Belveth",
  "K'Sante": "KSante",
};

describe("chaveDeCampeao", () => {
  for (const [exibicao, chave] of Object.entries(DIFICEIS)) {
    it(`${exibicao} -> ${chave}`, () => {
      expect(chaveDeCampeao(exibicao)).toBe(chave);
    });
  }

  it("aceita a chave de volta (Match-v5 já manda a chave)", () => {
    // O caminho da Match-v5 passa championName direto. A função tem que ser
    // idempotente ali, senão haveria dois caminhos de código pra manter.
    for (const chave of Object.values(DIFICEIS)) {
      expect(chaveDeCampeao(chave)).toBe(chave);
    }
  });

  it("resolve os 173 campeões da lista para uma chave não vazia", () => {
    for (const nome of CAMPEOES) {
      expect(chaveDeCampeao(nome), nome).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("tolera locale pt_BR e apelido", () => {
    // O cliente em português manda "Nunu e Willump"; normalizar derruba o "e"
    // junto com o "&", então os dois caem na mesma chave.
    expect(chaveDeCampeao("Nunu e Willump")).toBe("Nunu");
    expect(chaveDeCampeao("nunu")).toBe("Nunu");
  });

  it("não lança para lixo — o poll roda a cada segundo", () => {
    // pollInterno() não pode ter exceção: uma já derrubou o servidor no meio
    // de uma partida. Nome desconhecido devolve palpite ou "", nunca throw.
    expect(() => chaveDeCampeao(undefined)).not.toThrow();
    expect(chaveDeCampeao(undefined)).toBe("");
    expect(chaveDeCampeao("")).toBe("");
    expect(chaveDeCampeao(42 as unknown)).toBe("");
    // Campeão que ainda não existe na lista congelada: tenta a regra geral.
    expect(chaveDeCampeao("Campeao Novo")).toBe("CampeaoNovo");
  });
});

describe("iconeItem", () => {
  it("monta a URL pelo ID numérico", () => {
    expect(iconeItem("16.18.1", 3142)).toBe(`${DDRAGON}/cdn/16.18.1/img/item/3142.png`);
  });

  it("devolve vazio para ID inválido em vez de URL quebrada", () => {
    // Slot de item vazio na Live Client API vem como 0; uma URL .../item/0.png
    // daria 403 e um ícone quebrado em vez de um espaço limpo.
    expect(iconeItem("16.18.1", 0)).toBe("");
    expect(iconeItem("16.18.1", "abc")).toBe("");
  });
});

// --- verificação contra o CDN de verdade ---
//
// Só aqui há rede. Se a conexão cair, o teste avisa e passa: não é função da
// suíte reprovar por falta de internet, mas é função dela pegar a chave errada
// quando há internet.
describe("Data Dragon responde 200 para as chaves difíceis", () => {
  it("todas as URLs de campeão existem no CDN", async () => {
    let versao: string;
    try {
      const vs = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
      versao = vs[0];
    } catch {
      console.warn("sem rede: pulando a verificação HTTP do Data Dragon");
      return;
    }

    const falhas: string[] = [];
    await Promise.all(
      Object.keys(DIFICEIS).map(async (exibicao) => {
        const url = iconeCampeao(versao, exibicao);
        try {
          const r = await fetch(url, { method: "HEAD" });
          if (r.status !== 200) falhas.push(`${exibicao} -> ${url} (HTTP ${r.status})`);
        } catch (e) {
          falhas.push(`${exibicao} -> ${url} (${(e as Error).message})`);
        }
      }),
    );
    expect(falhas, falhas.join("\n")).toEqual([]);
  }, 60_000);
});

// Regressão: "Tahm Kench" sem retrato no painel do draft.
//
// O servidor do draft mandava só `champ` (nome de exibição) e a página tinha um
// fallback `champKey || champ`. Sem a chave, a URL virava "Tahm%20Kench.png" e
// o CDN respondia 403 — o retrato sumia EM SILÊNCIO, porque o onerror da
// página remove a <img>. Só campeões de nome composto quebravam, que é por que
// passou despercebido: Veigar, Jinx e Ekko no mesmo draft apareciam normais.
describe("nome de exibição nunca vira URL", () => {
  // Os 21 nomes que a Live Client API manda e que o CDN recusa crus.
  const COMPOSTOS = [
    "Tahm Kench", "Master Yi", "Miss Fortune", "Lee Sin", "Xin Zhao",
    "Twisted Fate", "Aurelion Sol", "Jarvan IV", "Dr. Mundo", "Nunu & Willump",
    "Renata Glasc", "Kai'Sa", "Kha'Zix", "Cho'Gath", "Vel'Koz", "Kog'Maw",
    "Rek'Sai", "Bel'Veth", "K'Sante", "LeBlanc", "Wukong",
  ];

  it("chaveDeCampeao tira espaço e pontuação de todos os nomes compostos", () => {
    for (const nome of COMPOSTOS) {
      const chave = chaveDeCampeao(nome);
      expect(chave, `${nome} -> ${chave}`).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("Tahm Kench resolve para a chave que o CDN aceita", () => {
    expect(chaveDeCampeao("Tahm Kench")).toBe("TahmKench");
  });
});
