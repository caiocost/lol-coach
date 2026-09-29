import { describe, it, expect } from "vitest";
import { interpretarResposta } from "../coach/alertAuthor.js";

describe("interpretarResposta", () => {
  it("aceita uma regra valida", () => {
    const r = interpretarResposta(JSON.stringify({
      id: "dois-mortos", texto: "Dois inimigos mortos", som: "dois-mortos",
      prioridade: 2, quando: { tipo: "inimigos-mortos", minimo: 2 },
    }), "quando 2 inimigos morrerem");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.regra.id).toBe("dois-mortos");
      // guarda o pedido original para o usuario lembrar o que pediu
      expect(r.regra.pedido).toBe("quando 2 inimigos morrerem");
    }
  });

  it("repassa a recusa do modelo quando o pedido e impossivel", () => {
    const r = interpretarResposta(JSON.stringify({
      impossivel: "a API não expõe posição dos jogadores",
    }), "quando o jungler entrar no meu mato");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/posição/i);
  });

  it("extrai o JSON quando o modelo embrulha em cerca de codigo", () => {
    const cru = "```json\n" + JSON.stringify({
      id: "nivel-6", texto: "Nivel 6", som: "nivel-6", prioridade: 2,
      quando: { tipo: "meu-nivel", minimo: 6 },
    }) + "\n```";
    expect(interpretarResposta(cru, "quando eu chegar no 6").ok).toBe(true);
  });

  it("recusa resposta que nao e json", () => {
    const r = interpretarResposta("desculpe, nao entendi", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/não devolveu|resposta/i);
  });

  it("recusa regra fora do esquema, citando o erro", () => {
    const r = interpretarResposta(JSON.stringify({
      id: "x", texto: "t", som: "x", prioridade: 2,
      quando: { tipo: "cooldown-da-ult", champ: "Yasuo" },
    }), "quando o Yasuo estiver sem ult");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/tipo de gatilho/i);
  });
});

// O defeito real: o modelo respondia conversando, o extrator pescava um trecho
// entre chaves da prosa e a validação reprovava no `id` -- culpando o usuário
// por um campo que ele nunca escreveu.
describe("interpretarResposta com resposta fora do formato", () => {
  // O caso exato do defeito: a prosa contém um objeto que PARSEIA, e o extrator
  // o pescava. Antes isto virava "id deve ter só letras minúsculas".
  it("nao culpa o id quando a prosa tem um objeto parseavel", () => {
    const cru = [
      "Essa frase parece estar incompleta. Você poderia reformular ou dar mais contexto?",
      'Por exemplo: {"exemplo": "quando eu terminar meu primeiro item"}',
      "Assim eu consigo te ajudar melhor!",
    ].join("\n");
    const r = interpretarResposta(cru, "quando eu terminar meu primeiro item");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toMatch(/não seguiu o formato/i);
      expect(r.motivo).not.toMatch(/\bid\b/i);
    }
  });

  it("nao culpa o id quando a prosa tem chaves que nem parseiam", () => {
    const cru = [
      "Essa frase parece estar incompleta. Você poderia reformular?",
      'Por exemplo: {"quando eu terminar meu primeiro item, vou começar o segundo"}',
    ].join("\n");
    const r = interpretarResposta(cru, "quando eu terminar meu primeiro item");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).not.toMatch(/\bid\b/i);
  });

  it("recusa prosa sem chave nenhuma", () => {
    const r = interpretarResposta(
      "Quando o suporte inimigo some do mapa geralmente significa roaming.",
      "quando o suporte inimigo sumir do mapa",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/não devolveu JSON/i);
  });

  it("recusa JSON valido que nao e do nosso formato", () => {
    const r = interpretarResposta(JSON.stringify({ resposta: "sei lá" }), "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toMatch(/não seguiu o formato/i);
      expect(r.motivo).not.toMatch(/\bid\b/i);
    }
  });

  it("recusa prosa embrulhada em markdown", () => {
    const cru = [
      "### 1. Com rotação",
      "```",
      'O suporte {inimigo} pode estar indo pro mato {do jungler}.',
      "```",
    ].join("\n");
    const r = interpretarResposta(cru, "quando o suporte inimigo sumir do mapa");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).not.toMatch(/\bid\b/i);
  });

  // A checagem de formato não pode engolir um erro de esquema de verdade: aí o
  // campo específico é justamente a informação útil.
  it("ainda cita o campo quando o JSON e do nosso formato mas viola o esquema", () => {
    const r = interpretarResposta(JSON.stringify({
      id: "ID_MAIUSCULO", texto: "t", som: "x", prioridade: 2,
      quando: { tipo: "meu-nivel", minimo: 6 },
    }), "quando eu chegar no 6");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/id deve ter/i);
  });
});

// O modelo declara que consegue entregar; a declaração é conferida, não crida.
describe("confirmacao do gatilho", () => {
  const regra = (extra: object) => JSON.stringify({
    id: "dois-mortos", texto: "Dois mortos", som: "dois-mortos", prioridade: 1,
    quando: { tipo: "inimigos-mortos", minimo: 2 }, ...extra,
  });

  it("devolve o confirmo quando ele bate com o gatilho", () => {
    const r = interpretarResposta(
      regra({ confirmo: "uso inimigos-mortos, que a API expõe pelo isDead" }),
      "quando 2 inimigos morrerem",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.confirmo).toMatch(/inimigos-mortos/);
      // confirmo é metadado da revisão, não parte da regra gravada
      expect("confirmo" in r.regra).toBe(false);
    }
  });

  it("recusa quando o modelo declara um gatilho e monta outro", () => {
    const r = interpretarResposta(
      regra({ confirmo: "uso tempo, disparando aos 20 minutos" }),
      "quando 2 inimigos morrerem",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/outro gatilho/i);
  });

  it("aceita regra sem confirmo, porque a validacao continua sendo o portao", () => {
    const r = interpretarResposta(regra({}), "quando 2 inimigos morrerem");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.confirmo).toBeUndefined();
  });
});
