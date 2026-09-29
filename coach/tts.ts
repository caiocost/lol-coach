// Text-to-speech: a fala do coach escrita, não gravada.
//
// POR QUE: até agora cada alerta precisava de uma gravação pelo microfone. Mas
// o catálogo em ingame.ts já carrega o TEXTO de cada um (o campo `suggestion`),
// então gravar à mão era dizer em voz alta o que já estava escrito. Com TTS o
// usuário digita (ou aceita a sugestão) e o som nasce pronto.
//
// A gravação por microfone CONTINUA valendo e tem prioridade de uso: quem quer
// a própria voz grava, quem quer praticidade digita. As duas salvam no mesmo
// lugar, com o mesmo nome-base, e o resolvedor de som não sabe a diferença.
//
// SOBRE AS VOZES: o catálogo abaixo só tem vozes de LOCUÇÃO — narrador,
// locutor, nomes comuns. O provedor also hospeda clones de personagens de
// filme/anime e de pessoas públicas; esses ficam de fora de propósito. São a
// performance de um ator real, e sintetizá-la é o mesmo problema de clonar a
// voz do dublador do campeão a partir dos arquivos do jogo.
import { writeFile, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const API = "https://api.fish.audio/v1/tts";

/**
 * Modelo gratuito sob uso justo (até 30/11/2026). Vai no HEADER, não no corpo.
 * O crédito de API do provedor é separado do crédito da plataforma e começa em
 * zero, então o modelo pago devolve 402 mesmo numa conta com plano ativo.
 */
const MODELO = process.env.FISH_MODEL ?? "s2.1-pro-free";

/** Vozes oferecidas no painel. `id` vazio = voz padrão do provedor. */
export const VOZES = [
  { id: "", nome: "Padrão do provedor (feminina, PT-PT)" },
  { id: "f105557f5588463993a92c2dab364544", nome: "Locutor impacto — masculina, BR" },
  { id: "df1fa6d2ae194b3ebcbae60df48fde35", nome: "Narrador de propaganda — masculina, BR" },
  { id: "04736e4d6a644abab81e601a7d2ae4b9", nome: "Waldo Morais — masculina, BR" },
  { id: "1a61293f8fa8441f804deb10d0b2bc95", nome: "Adam — masculina, BR" },
  { id: "1d8cb595b6284ff7aa7e8fec7b93249d", nome: "Modelo 01 — masculina, BR" },
];

export interface OpcoesTts {
  texto: string;
  vozId?: string;
  /** 0 desliga o efeito. */
  efeito?: boolean;
  /** Tom: 1 = original, menor = mais grave. Faixa útil 0.68–1. */
  tom?: number;
  /** Eco/ambiente: 0 = seco, 1 = caverna. */
  eco?: number;
}

/**
 * Cadeia de efeito: dá peso e ambiente sem imitar ninguém.
 *
 *   asetrate/aresample/atempo  abaixa o TOM sem encurtar o áudio
 *   equalizer x2               +4dB em 100Hz (peito), −3dB em 3kHz (aspereza)
 *   acompressor                nivela, pra voz não sumir sob o eco
 *   aecho                      dois reflexos curtos = ambiente
 *   loudnorm                   volume igual entre todos os arquivos
 */
function cadeia(tom: number, eco: number): string {
  const t = Math.min(1, Math.max(0.6, tom));
  const e = Math.min(1, Math.max(0, eco));
  return [
    `asetrate=44100*${t.toFixed(3)}`,
    "aresample=44100",
    `atempo=${(1 / t).toFixed(4)}`,
    "equalizer=f=100:t=q:w=1:g=4",
    "equalizer=f=3000:t=q:w=2:g=-3",
    "acompressor=threshold=-18dB:ratio=3:attack=5:release=120",
    `aecho=0.8:0.85:${Math.round(28 + e * 40)}|${Math.round(60 + e * 90)}:${(e * 0.5).toFixed(2)}|${(e * 0.28).toFixed(2)}`,
    "loudnorm=I=-16:TP=-1.5:LRA=11",
  ].join(",");
}

/** Chama a API e devolve o mp3 cru. Lança com mensagem legível em erro. */
export async function sintetizar(o: OpcoesTts): Promise<Buffer> {
  const chave = process.env.FISH_API_KEY ?? "";
  if (!chave) throw new Error("FISH_API_KEY não definida no .env");
  const texto = (o.texto ?? "").trim();
  if (!texto) throw new Error("texto vazio");
  if (texto.length > 500) throw new Error("texto longo demais (máx. 500)");

  const res = await fetch(API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${chave}`,
      "content-type": "application/json",
      model: MODELO,
    },
    body: JSON.stringify({
      text: texto,
      format: "mp3",
      ...(o.vozId ? { reference_id: o.vozId } : {}),
    }),
  });
  if (!res.ok) {
    const corpo = (await res.text()).slice(0, 200);
    if (res.status === 402) throw new Error("Sem crédito de API. O modelo gratuito é " + MODELO + ".");
    if (res.status === 401) throw new Error("Chave recusada (401). Confira FISH_API_KEY no .env.");
    throw new Error(`API ${res.status}: ${corpo}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Sintetiza e grava em sounds/ com o nome-base dado, aplicando o efeito.
 *
 * Remove gravações anteriores do mesmo alerta em QUALQUER extensão — senão o
 * resolvedor de som poderia achar a antiga primeiro, e o usuário ouviria a
 * versão velha achando que a nova falhou.
 */
export async function gerarSom(base: string, dir: URL, o: OpcoesTts): Promise<{ file: string; bytes: number; efeito: boolean }> {
  const mp3 = await sintetizar(o);

  try {
    for (const e of await readdir(new URL(".", dir))) {
      const eBase = e.replace(/(\.(mp3|wav|ogg|m4a|mp4|aac|webm|opus|flac))+$/i, "");
      if (eBase.toLowerCase() === base.toLowerCase()) {
        await unlink(new URL(encodeURIComponent(e), dir)).catch(() => {});
      }
    }
  } catch { /* pasta ausente: nada a limpar */ }

  const destino = new URL(encodeURIComponent(`${base}.mp3`), dir);
  await writeFile(destino, mp3);

  let comEfeito = false;
  if (o.efeito !== false) {
    const caminho = fileURLToPath(destino);
    const tmp = caminho.replace(/\.mp3$/, ".fx.mp3");
    try {
      await exec("ffmpeg", [
        "-y", "-loglevel", "error", "-i", caminho,
        "-af", cadeia(o.tom ?? 0.85, o.eco ?? 0.35),
        "-codec:a", "libmp3lame", "-q:a", "3", tmp,
      ]);
      const { rename } = await import("node:fs/promises");
      await rename(tmp, caminho);
      comEfeito = true;
    } catch {
      // ffmpeg ausente ou falhou: fica o mp3 cru, que já é tocável.
      await unlink(tmp).catch(() => {});
    }
  }

  const { stat } = await import("node:fs/promises");
  const s = await stat(fileURLToPath(destino));
  return { file: `${base}.mp3`, bytes: s.size, efeito: comEfeito };
}
