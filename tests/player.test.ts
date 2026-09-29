import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolverSom } from "../coach/player.js";

// O teste CRIA os arquivos de que precisa, em vez de apontar para as
// gravações do usuário.
//
// POR QUE: a versão anterior procurava "control-ward.m4a" e "objetivo-30.wav"
// — áudios reais da voz dele. Quando ele apagou as gravações para refazê-las,
// dois testes quebraram sem que nada no código tivesse mudado. Teste que
// depende de dado pessoal quebra quando o dado muda, e o vermelho não diz
// nada sobre o código.
//
// Os nomes têm prefixo "zz-teste-" para não colidirem com alerta nenhum, e
// são removidos no fim.
const SOUNDS = new URL("../coach/sounds/", import.meta.url);
const CRIADOS = ["zz-teste-m4a.m4a", "zz-teste-wav.wav"];

beforeAll(async () => {
  await mkdir(SOUNDS, { recursive: true });
  // Conteúdo irrelevante: resolverSom olha o nome, não decodifica o áudio.
  for (const nome of CRIADOS) {
    await writeFile(new URL(nome, SOUNDS), Buffer.alloc(16));
  }
});

afterAll(async () => {
  for (const nome of CRIADOS) {
    await unlink(new URL(nome, SOUNDS)).catch(() => {});
  }
});

describe("resolverSom", () => {
  it("acha a gravacao pelo nome-base, ignorando a extensao", async () => {
    // o catálogo diz .mp3, o disco tem .m4a — a resolução é por nome-base
    expect(await resolverSom("zz-teste-m4a")).toMatch(/zz-teste-m4a\.m4a$/);
    expect(await resolverSom("zz-teste-m4a.mp3")).toMatch(/zz-teste-m4a\.m4a$/);
  });

  it("acha .wav tambem", async () => {
    expect(await resolverSom("zz-teste-wav")).toMatch(/zz-teste-wav\.wav$/);
  });

  it("devolve null quando nao ha gravacao", async () => {
    expect(await resolverSom("som-que-nao-existe")).toBeNull();
  });

  it("recusa nome com travessia de caminho", async () => {
    expect(await resolverSom("../../../etc/passwd")).toBeNull();
    expect(await resolverSom("..\\\\..\\\\segredo")).toBeNull();
  });
});
