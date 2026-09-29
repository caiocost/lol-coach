// Ícones do Data Dragon: a ponte entre o NOME que se lê e o ARQUIVO que se baixa.
//
// POR QUE ESTE MÓDULO EXISTE. Duas fontes de campeão convivem no sistema e
// escrevem o nome de jeitos diferentes:
//
//   1. MATCH-V5 (o banco local, store.ts) manda `championName`, que JÁ É a
//      chave do Data Dragon ("MasterYi", "Kaisa", "MonkeyKing"). O matchList.ts
//      sempre montou a URL direto com esse campo, e está certo em fazê-lo.
//   2. LIVE CLIENT API (a partida ao vivo, ingame.ts) manda o nome de EXIBIÇÃO
//      ("Master Yi", "Kai'Sa", "Nunu & Willump") — e ainda por cima no idioma
//      do cliente. Montar a URL com esse valor dá 403 no CDN exatamente para os
//      campeões com pontuação no nome, que são os mais fáceis de não notar em
//      teste porque o resto da lista funciona.
//
// Aplicar a conversão na fonte errada quebra a outra: converter `championName`
// seria inofensivo (já resolve pra si mesmo), mas NÃO converter o nome ao vivo
// quebra silenciosamente. Por isso a conversão mora aqui, nomeada pelo que
// faz, e o caminho ao vivo a chama explicitamente.
//
// SEM REDE, SEM EXCEÇÃO. O pollInterno roda a cada segundo dentro do
// pollSeguro(); uma exceção ali já derrubou o servidor no meio de uma partida.
// Então chaveDeCampeao() é pura, síncrona, sobre uma tabela congelada, e
// devolve um palpite razoável em vez de lançar quando não conhece o nome.

import { request } from "undici";
import { CAMPEOES, normalizarCampeao, resolverCampeao } from "./champions.js";

export const DDRAGON = "https://ddragon.leagueoflegends.com";

/**
 * Os campeões cuja chave NÃO sai do nome tirando espaço e pontuação.
 *
 * ESTA TABELA FOI DERIVADA DO CDN, NÃO DEDUZIDA — e a diferença custou uma
 * rodada de teste. A regra "tire o que não é alfanumérico" parece bastar, e de
 * fato resolve 164 dos 173. Mas a Riot NÃO É CONSISTENTE no que faz com a
 * letra depois do apóstrofo, e não há regra que cubra os dois lados:
 *
 *     Kai'Sa  -> Kaisa     (minúscula)      Kog'Maw -> KogMaw  (maiúscula)
 *     Cho'Gath-> Chogath   (minúscula)      Rek'Sai -> RekSai  (maiúscula)
 *     Vel'Koz -> Velkoz    (minúscula)      K'Sante -> KSante  (maiúscula)
 *
 * Qualquer regra geral acerta uma metade e erra a outra — e o erro é mudo: a
 * URL se forma, o CDN devolve 403 e some o retrato só daqueles campeões. Por
 * isso o que vale aqui é a lista literal do champion.json (16.18.1), com o
 * teste batendo cada URL contra o CDN de verdade.
 *
 * Wukong/MonkeyKing é o caso folclórico — o nome interno nunca mudou. Nunu e
 * Renata são o mesmo fenômeno: a chave é anterior ao nome completo que o
 * campeão ganhou depois.
 */
const CHAVES_IRREGULARES: Record<string, string> = {
  belveth: "Belveth",       // Bel'Veth
  chogath: "Chogath",       // Cho'Gath
  kaisa: "Kaisa",           // Kai'Sa
  khazix: "Khazix",         // Kha'Zix
  leblanc: "Leblanc",       // LeBlanc
  nunuwillump: "Nunu",      // Nunu & Willump
  renataglasc: "Renata",    // Renata Glasc
  velkoz: "Velkoz",         // Vel'Koz
  wukong: "MonkeyKing",     // Wukong
};

// Nome canônico -> chave, construído uma vez na carga do módulo.
//
// Pré-computar em vez de resolver a cada chamada é o que mantém o poll barato:
// a página redesenha 10 jogadores por segundo, e cada um passaria por
// normalização de string à toa.
const CHAVE_POR_NORMAL = new Map<string, string>();
for (const nome of CAMPEOES) {
  const n = normalizarCampeao(nome);
  CHAVE_POR_NORMAL.set(n, CHAVES_IRREGULARES[n] ?? nome.replace(/[^A-Za-z0-9]/g, ""));
}

/**
 * Nome de exibição (ou já-chave) -> chave de arquivo do Data Dragon.
 *
 * Aceita os dois lados de propósito: passar "MasterYi" (vindo da Match-v5)
 * devolve "MasterYi", porque normalizam igual. Isso torna a função segura de
 * chamar em qualquer caminho, sem o chamador ter que saber de onde veio o dado.
 *
 * O FALLBACK NÃO LANÇA. Campeão novo sai a cada poucos meses e esta tabela é
 * congelada; quando não conhecer o nome, tira pontuação e espaço e tenta assim
 * — que é a regra que vale para a esmagadora maioria. Se ainda assim a imagem
 * não existir, o onerror da página esconde o ícone e o nome continua lá.
 */
export function chaveDeCampeao(nome: unknown): string {
  if (typeof nome !== "string" || !nome.trim()) return "";

  // Tentativa direta primeiro: cobre o nome em inglês e a chave da Match-v5.
  const direto = CHAVE_POR_NORMAL.get(normalizarCampeao(nome));
  if (direto) return direto;

  // Só então passa pelo resolvedor de apelido/locale do champions.ts. Ele é
  // quem sabe que o cliente em português manda "Nunu e Willump" (com "e", que
  // normaliza diferente de "&") e que "mf" é Miss Fortune. Deixá-lo em segundo
  // lugar, e não em primeiro, é de propósito: o caminho comum não paga a
  // segunda busca, e um nome que já é chave nunca corre risco de ser reescrito
  // por um apelido que colida.
  const canonico = resolverCampeao(nome);
  if (canonico) {
    const porCanonico = CHAVE_POR_NORMAL.get(normalizarCampeao(canonico));
    if (porCanonico) return porCanonico;
  }

  // Campeão novo que a lista congelada ainda não tem: regra geral.
  return nome.replace(/[^A-Za-z0-9]/g, "");
}

/** URL do retrato quadrado do campeão. Aceita nome de exibição ou chave. */
export function iconeCampeao(versao: string, nome: unknown): string {
  const chave = chaveDeCampeao(nome);
  return chave ? `${DDRAGON}/cdn/${versao}/img/champion/${chave}.png` : "";
}

/**
 * URL do ícone do item, pelo ID numérico.
 *
 * Item é sempre ID no nosso dado (3142, 6693...), e o arquivo do Data Dragon é
 * o próprio ID — não há conversão de nome a fazer aqui. Onde só existe o NOME
 * do item e nenhum ID, não dá para montar a URL: o Data Dragon não indexa item
 * por nome, e adivinhar produziria ícone errado (pior que nenhum).
 */
export function iconeItem(versao: string, id: number | string): string {
  const n = Number(id);
  return Number.isFinite(n) && n > 0
    ? `${DDRAGON}/cdn/${versao}/img/item/${n}.png`
    : "";
}

// --- versão do Data Dragon, cacheada por 6h ---
let ddVersion: string | null = null;
let ddVersionAt = 0;

/** Versão atual do CDN de ícones. Sem rede, devolve a última conhecida. */
export async function versaoDDragon(): Promise<string> {
  const seisHoras = 6 * 60 * 60 * 1000;
  if (ddVersion && Date.now() - ddVersionAt < seisHoras) return ddVersion;
  try {
    const vs = (await (await request(`${DDRAGON}/api/versions.json`)).body.json()) as string[];
    ddVersion = vs[0];
    ddVersionAt = Date.now();
    return ddVersion;
  } catch {
    return ddVersion ?? "16.18.1";
  }
}
