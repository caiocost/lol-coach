// Sobe os dois servidores do coach com um comando.
//
// Sem dependência nova: `child_process` do próprio Node já faz isso, e não
// vale adicionar concurrently só para rodar dois processos.
//
// Por que um script em vez de dois terminais: o draft (7777) e o in-game
// (7778) são um só produto — a página de 7778 consulta 7777 para mostrar o
// draft. Subir um sem o outro deixa metade da tela vazia.
//
// Uso:  npm run coach          (e Ctrl+C mata os dois)
import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { existsSync } from "node:fs";
import "dotenv/config";

// Portas: padrão 7777/7778/7779, trocáveis no .env. Os filhos herdam o env,
// então o RGB_URL definido aqui é o que o draft e o in-game vão usar.
const PORTA_DRAFT = Number(process.env.DRAFT_PORT ?? 7777);
const PORTA_INGAME = Number(process.env.INGAME_PORT ?? 7778);
const PORTA_LUZ = Number(process.env.RGB_PORT ?? 7779);
process.env.RGB_URL ??= `http://127.0.0.1:${PORTA_LUZ}`;

// Executa o CLI do tsx com o próprio Node. Isso evita duas armadilhas do
// Windows: `.cmd` precisa de shell (spawn EINVAL sem ele), e shell com args
// emite aviso de depreciação no Node 24 por não escapar argumentos.
const TSX_CLI = "node_modules/tsx/dist/cli.mjs";
if (!existsSync(TSX_CLI)) {
  console.error(`
  tsx não encontrado. Rode: npm install
`);
  process.exit(1);
}

const PROCESSOS = [
  { nome: "draft ", porta: PORTA_DRAFT, arquivo: "coach/server.ts", cor: "\x1b[36m" },
  { nome: "ingame", porta: PORTA_INGAME, arquivo: "coach/ingame.ts", cor: "\x1b[33m" },
];
const RESET = "\x1b[0m";

/** Porta ocupada quase sempre é uma instância antiga esquecida rodando. */
function portaLivre(porta) {
  return new Promise((res) => {
    const s = createServer();
    s.once("error", () => res(false));
    s.once("listening", () => s.close(() => res(true)));
    s.listen(porta, "127.0.0.1");
  });
}

const filhos = [];
let encerrando = false;

function encerrar(code = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const f of filhos) { try { f.kill(); } catch {} }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => { console.log("\n  encerrando…"); encerrar(0); });
process.on("SIGTERM", () => encerrar(0));

console.log("");
for (const p of PROCESSOS) {
  if (!(await portaLivre(p.porta))) {
    console.error(`  ${p.cor}${p.nome}${RESET}  porta ${p.porta} já está em uso.`);
    console.error(`          Feche a instância antiga antes de subir de novo.\n`);
    encerrar(1);
    break;
  }
}

if (!encerrando) {
  for (const p of PROCESSOS) {
    const filho = spawn(process.execPath, [TSX_CLI, p.arquivo], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    filhos.push(filho);

    // prefixa cada linha com o nome do processo, senão os dois logs se misturam
    const prefixar = (fluxo, alvo) => {
      let resto = "";
      fluxo.on("data", (b) => {
        const linhas = (resto + b.toString()).split("\n");
        resto = linhas.pop() ?? "";
        for (const l of linhas) {
          if (l.trim()) alvo.write(`  ${p.cor}${p.nome}${RESET}  ${l}\n`);
        }
      });
    };
    prefixar(filho.stdout, process.stdout);
    prefixar(filho.stderr, process.stderr);

    filho.on("exit", (code) => {
      if (!encerrando) {
        console.error(`  ${p.cor}${p.nome}${RESET}  saiu com código ${code}`);
        encerrar(code ?? 1);
      }
    });
  }

  // Luzes RGB: opcional. Fica FORA de PROCESSOS porque lá a saída de um
  // filho derruba todos — e sem Python/OpenRGB o coach tem que seguir igual.
  const LUZ = { nome: "luzes", porta: PORTA_LUZ, cor: "\x1b[35m" };
  if (await portaLivre(LUZ.porta)) {
    // No pacote portátil o Python vem embutido em runtime/python; fora dele, o do PATH.
    const PY = existsSync("runtime/python/python.exe") ? "runtime/python/python.exe"
      : process.platform === "win32" ? "python" : "python3";
    const luz = spawn(PY, ["-u", "rgb/rgb_daemon.py", "--porta", String(LUZ.porta)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    luz.on("error", () => console.error(`  ${LUZ.cor}${LUZ.nome}${RESET}  python não encontrado — coach segue sem luzes`));
    luz.on("exit", (code) => {
      if (!encerrando) console.error(`  ${LUZ.cor}${LUZ.nome}${RESET}  daemon saiu (código ${code}) — coach segue sem luzes`);
    });
    filhos.push(luz);
    for (const [fluxo, alvo] of [[luz.stdout, process.stdout], [luz.stderr, process.stderr]]) {
      fluxo.on("data", (b) => {
        for (const l of b.toString().split("\n")) if (l.trim()) alvo.write(`  ${LUZ.cor}${LUZ.nome}${RESET}  ${l}\n`);
      });
    }
  } else {
    console.log(`  ${LUZ.cor}${LUZ.nome}${RESET}  porta ${LUZ.porta} já em uso — usando o daemon que já está rodando`);
  }

  console.log(`
  LoL Coach       http://localhost:${PORTA_INGAME}   <- deixe esta aberta
  (draft ${PORTA_DRAFT} e luzes ${PORTA_LUZ} rodam por trás)

  A página mostra o draft e a partida ao vivo, e é onde se gravam os
  áudios e se criam alertas. Ctrl+C encerra tudo.
`);
}
