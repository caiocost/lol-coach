// Onde os alertas do usuário moram.
//
// SEPARADO DO SOUND_CATALOG de propósito: o catálogo embutido é código, e
// muda quando eu mudo o código. Estes são do usuário, e não podem sumir numa
// atualização do projeto.
//
// Fica em data/ junto com o banco de partidas, que já é gitignored -- é dado
// pessoal, não fonte.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { validarRegra, type Regra } from "./alertRules.js";

export const ARQUIVO = new URL("../data/alertas.json", import.meta.url);

/**
 * Lê os alertas salvos.
 *
 * Valida na LEITURA, não só na escrita: o arquivo pode ter sido editado à mão
 * ou escrito por uma versão anterior do esquema. Entrada inválida é
 * descartada com aviso -- carregar uma regra malformada faria o motor avaliar
 * lixo a cada segundo de partida.
 */
export async function listarAlertas(): Promise<Regra[]> {
  try {
    const cru = JSON.parse(await readFile(ARQUIVO, "utf8"));
    if (!Array.isArray(cru)) return [];
    const bons: Regra[] = [];
    for (const r of cru) {
      const v = validarRegra(r);
      if (v.ok) bons.push(r as Regra);
      else console.error(`  [alertas] descartando "${r?.id ?? "?"}": ${v.erro}`);
    }
    return bons;
  } catch {
    // Arquivo ausente é o caso normal na primeira execução.
    return [];
  }
}

/** Salva um alerta. Mesmo id substitui. */
export async function salvarAlerta(regra: Regra): Promise<void> {
  const v = validarRegra(regra);
  if (!v.ok) throw new Error(`regra inválida: ${v.erro}`);

  const lista = await listarAlertas();
  const semEle = lista.filter((r) => r.id !== regra.id);
  semEle.push({ ...regra, criadoEm: regra.criadoEm ?? Date.now() });
  await escrever(semEle);
}

export async function apagarAlerta(id: string): Promise<boolean> {
  const lista = await listarAlertas();
  const semEle = lista.filter((r) => r.id !== id);
  if (semEle.length === lista.length) return false;
  await escrever(semEle);
  return true;
}

/**
 * Escreve de forma ATÔMICA: arquivo temporário e depois rename.
 *
 * POR QUE: writeFile TRUNCA o destino antes de escrever. Se o processo morre
 * nesse instante, sobra um arquivo de zero bytes — e foi exatamente o que
 * aconteceu DUAS VEZES nesta sessão. O usuário criou e gravou os alertas, o
 * servidor foi reiniciado, e o alertas.json amanheceu vazio: as gravações
 * dele no disco e nenhuma regra pra usá-las.
 *
 * rename é atômico no mesmo volume: ou o arquivo antigo continua inteiro, ou
 * o novo aparece inteiro. Nunca um estado pela metade.
 */
async function escrever(lista: Regra[]) {
  await mkdir(new URL(".", ARQUIVO), { recursive: true });
  const temp = new URL(`alertas.json.tmp-${process.pid}`, ARQUIVO);
  await writeFile(temp, JSON.stringify(lista, null, 2), "utf8");
  await rename(temp, ARQUIVO);
}
