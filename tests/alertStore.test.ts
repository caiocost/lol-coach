import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { listarAlertas, salvarAlerta, apagarAlerta, ARQUIVO } from "../coach/alertStore.js";
import type { Regra } from "../coach/alertRules.js";

const caminho = fileURLToPath(ARQUIVO);

const exemplo = (id: string): Regra => ({
  id, texto: `alerta ${id}`, som: id, prioridade: 2,
  quando: { tipo: "inimigos-mortos", minimo: 2 },
});

describe("alertStore", () => {
  beforeEach(async () => { await rm(caminho, { force: true }); });
  afterEach(async () => { await rm(caminho, { force: true }); });

  it("devolve lista vazia quando o arquivo nao existe", async () => {
    expect(await listarAlertas()).toEqual([]);
  });

  it("salva e le de volta", async () => {
    await salvarAlerta(exemplo("um"));
    const lista = await listarAlertas();
    expect(lista).toHaveLength(1);
    expect(lista[0].id).toBe("um");
    expect(lista[0].criadoEm).toBeGreaterThan(0);
  });

  it("salvar o mesmo id substitui em vez de duplicar", async () => {
    await salvarAlerta(exemplo("um"));
    await salvarAlerta({ ...exemplo("um"), texto: "novo texto" });
    const lista = await listarAlertas();
    expect(lista).toHaveLength(1);
    expect(lista[0].texto).toBe("novo texto");
  });

  it("apaga pelo id", async () => {
    await salvarAlerta(exemplo("um"));
    await salvarAlerta(exemplo("dois"));
    expect(await apagarAlerta("um")).toBe(true);
    const lista = await listarAlertas();
    expect(lista.map((r) => r.id)).toEqual(["dois"]);
  });

  it("apagar id inexistente devolve false", async () => {
    expect(await apagarAlerta("fantasma")).toBe(false);
  });

  it("arquivo corrompido nao derruba: devolve vazio", async () => {
    await mkdir(fileURLToPath(new URL(".", ARQUIVO)), { recursive: true });
    await writeFile(caminho, "{ isto nao e json", "utf8");
    expect(await listarAlertas()).toEqual([]);
  });

  it("descarta entrada invalida ao ler, em vez de aceitar", async () => {
    await mkdir(fileURLToPath(new URL(".", ARQUIVO)), { recursive: true });
    await writeFile(caminho, JSON.stringify([
      exemplo("bom"),
      { id: "ruim", texto: "x", som: "x", prioridade: 2, quando: { tipo: "posicao" } },
    ]), "utf8");
    const lista = await listarAlertas();
    expect(lista.map((r) => r.id)).toEqual(["bom"]);
  });
});
