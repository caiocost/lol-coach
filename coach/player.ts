// Toca um arquivo de audio pelo sistema operacional, fora do navegador.
//
// POR QUE NAO PELO NAVEGADOR: o usuario relatou SpeechSynthesis e Audio()
// falhando JUNTOS -- o processo de audio do Chrome inteiro. Tocar pelo SO tira
// o navegador do caminho critico.
//
// POR QUE POR NOME-BASE: o catalogo declara ".mp3", mas o disco tem ".m4a" e
// ".wav" -- o MediaRecorder do navegador grava no formato que ele escolhe. O
// Audio() do Chrome tolerava a divergencia; aqui a resolucao e explicita.
//
// CUIDADO COM FORMATO: medido, o Windows NAO decodifica .webm (Opus/Vorbis)
// pelo Media Foundation -- e falha em silencio, sem excecao. Por isso as
// gravacoes foram convertidas para WAV e a ordem de preferencia abaixo nao
// inclui webm.

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOUNDS = new URL("./sounds/", import.meta.url);

/** Formatos que o tocador do Windows decodifica, em ordem de preferencia. */
const EXTENSOES = [".wav", ".m4a", ".mp3"];

/**
 * Acha a gravacao do usuario para uma chave, ignorando a extensao.
 * Devolve o caminho absoluto, ou null se nao houver gravacao.
 */
export async function resolverSom(chave: string): Promise<string | null> {
  // A chave vem do catalogo, mas nunca confie: ela alimenta um caminho.
  const base = chave.replace(/\.[a-z0-9]+$/i, "");
  if (!base || /[\\/]|\.\./.test(base)) return null;

  let arquivos: string[];
  try {
    arquivos = await readdir(SOUNDS);
  } catch {
    return null;              // pasta ainda nao existe
  }

  for (const ext of EXTENSOES) {
    const alvo = base + ext;
    const achado = arquivos.find((a) => a.toLowerCase() === alvo.toLowerCase());
    if (achado) return fileURLToPath(new URL(achado, SOUNDS));
  }
  return null;
}

/**
 * Converte um áudio qualquer (o .webm do MediaRecorder, na prática) para WAV.
 *
 * MORA AQUI, e não na rota, porque é a mesma questão de que EXTENSOES trata: o
 * que o tocador do Windows consegue decodificar. Quem mexer numa das duas
 * precisa ver a outra.
 *
 * Devolve `false` quando não há ffmpeg — e quem chama TEM que tratar, porque
 * gravar o webm cru é gravar um som que nunca vai tocar. Não lança: falha de
 * conversão é condição esperada, não erro de programação.
 */
export function paraWav(entrada: Buffer, destinoWav: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // `-i pipe:0` lê da stdin: evita escrever o webm temporário em disco só
      // para apagar depois. 44,1kHz mono é o suficiente para voz e mantém o
      // arquivo pequeno.
      const proc = spawn("ffmpeg", [
        "-y", "-loglevel", "error", "-i", "pipe:0",
        "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", destinoWav,
      ], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });

      let fechou = false;
      const fim = (ok: boolean) => { if (!fechou) { fechou = true; resolve(ok); } };
      proc.on("exit", (code) => fim(code === 0));
      proc.on("error", () => fim(false));       // ffmpeg ausente cai aqui
      proc.stdin.on("error", () => fim(false)); // EPIPE se ele morrer antes
      proc.stdin.end(entrada);
      setTimeout(() => { try { proc.kill(); } catch {} fim(false); }, 20000);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Toca um arquivo e resolve quando ele termina.
 *
 * Esperar o fim importa: e assim que a fila sabe quando pode falar de novo.
 * O cooldown antigo era um palpite sobre a duracao da fala; aqui a duracao e
 * conhecida.
 */
export function tocar(caminho: string, volume = 1): Promise<void> {
  return new Promise((resolve) => {
    // MediaPlayer e assincrono: Open() retorna antes de decodificar, entao o
    // script espera NaturalDuration aparecer, toca, e dorme a duracao exata.
    const ps = `
Add-Type -AssemblyName presentationCore
$p = New-Object System.Windows.Media.MediaPlayer
$p.Open([uri]'${caminho.replace(/'/g, "''")}')
$p.Volume = ${Math.max(0, Math.min(1, volume))}
for ($i=0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 40
  if ($p.NaturalDuration.HasTimeSpan) { break }
}
if (-not $p.NaturalDuration.HasTimeSpan) { $p.Close(); exit 1 }
$dur = $p.NaturalDuration.TimeSpan.TotalMilliseconds
$p.Play()
Start-Sleep -Milliseconds ([int]$dur + 250)
$p.Close()
`.trim();

    let acabou = false;
    const fim = () => { if (!acabou) { acabou = true; resolve(); } };

    try {
      const proc = spawn(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { stdio: "ignore", windowsHide: true },
      );
      proc.on("exit", fim);
      proc.on("error", fim);
      // Nenhum alerta do coach passa de 30s; se passou, algo travou.
      setTimeout(() => { try { proc.kill(); } catch {} fim(); }, 30000);
    } catch {
      fim();
    }
  });
}
