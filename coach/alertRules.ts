// Regras de alerta: o esquema, a validação e o motor que as avalia.
//
// POR QUE ISTO É DADO E NÃO CÓDIGO: as regras são escritas por um LLM a
// partir do texto do usuário. Se o modelo gerasse JavaScript para rodar no
// servidor, um pedido mal interpretado -- ou texto colado sem querer --
// viraria código com acesso ao disco e à chave da Riot. Aqui o modelo só
// preenche uma estrutura fechada, validada antes de qualquer uso, e este
// motor escrito à mão é quem interpreta.
//
// ESTE MÓDULO É PURO: sem IO, sem rede, sem relógio. É o que permite testá-lo
// sozinho e reusá-lo no backtest sobre partidas antigas.
//
// INIMIGO: ATRASADO, NÃO IMPOSSÍVEL. Item e nível de inimigo chegam pela Live
// Client API, mas passam por fog of war -- o inimigo compra na fonte, onde
// ninguém o vê, e o dado só aparece quando ele entra na visão do seu time.
// O mecanismo é CONGELAMENTO, não ausência: `allPlayers` devolve os dez
// jogadores sempre, e o que está no escuro fica preso no último valor
// conhecido até o inimigo reaparecer.
// Isso é ATRASO, e atraso o usuário aceita depois de avisado. O que NÃO se
// aceita é esconder o atraso: por isso os campos se chamam "visto" e o
// descrever() fala em VER, nunca em "chegar ao nível" ou "comprar". Quem lê a
// confirmação tem que entender que está sendo avisado de uma OBSERVAÇÃO.
//
// OBJETIVO: PREVISÍVEL, NÃO OBSERVADO. O respawn de dragão/barão/ancião não
// vem pronto da API -- mas o ingame.ts JÁ o calcula, somando o tempo de
// respawn ao evento de morte que a Live Client API emite (DragonKill etc.), e
// já usa isso nos alertas nativos de 60s e 30s. Recusar "me avisa quando
// faltar 30s pro dragão" era errado duas vezes: o dado existe e o coach já
// agia sobre ele. Por isso `objetivos` entra no Estado.
//
// MORTE DE INIMIGO: EM TEMPO REAL, SEM RESSALVA. Aqui o fog of war NÃO se
// aplica, e escrever "visto" seria errar para o outro lado. Morte de campeão é
// anunciada globalmente em LoL -- o placar muda para os dez jogadores no mesmo
// instante --, e a Live Client API entrega `isDead` e `respawnTimer` de cada
// jogador, que o ingame.ts já lê há tempos (contagem de mortos, painel bruto).
// Por isso `inimigoMorto` e o respawn descrevem o ACONTECIMENTO ("quando a
// Leblanc morrer"), não a observação. Pôr "quando você VIR" aqui seria uma
// imprecisão tão grave quanto omiti-la em item/nível: mentiria dizendo que o
// dado é atrasado quando ele não é, e o usuário deixaria de confiar num aviso
// que na verdade chega na hora.
//
// Continua impossível o que a API realmente não expõe: posição, cooldown,
// ouro e vida alheios -- e o CS inimigo, que a Riot arredonda de propósito.

import { resolverCampeao, mesmoCampeao } from "./champions.js";

/** Instantâneo da partida no momento da avaliação. */
export interface Estado {
  /** Segundos de jogo. */
  t: number;
  meuNivel: number;
  meusAbates: number;
  minhasMortes: number;
  minhasAssistencias: number;
  mortesSemTrade: number;
  cs: number;
  /** null antes dos 15min. */
  csMinPost15: number | null;
  ouro: number;
  meusItens: number[];
  inimigosMortos: number;
  /**
   * Os cinco inimigos, com nome de campeão e estado de morte.
   *
   * Existe além de `inimigosMortos` porque contagem não responde "a Leblanc
   * está morta?" nem "quanto falta pra ela voltar?" -- e as duas coisas mudam
   * a decisão de forma diferente: 2 mortos com 8s de respawn não é janela de
   * objetivo, 1 morto com 40s é.
   *
   * SEM FOG OF WAR, ao contrário de nível e item: morte é anunciada
   * globalmente, então isto é o estado REAL agora, não a última observação.
   */
  inimigos: InimigoEstado[];
  /**
   * Maior nível JÁ VISTO em algum inimigo. Passa por fog of war: se o inimigo
   * subiu de nível fora da visão, este número só cresce quando ele aparecer.
   */
  maiorNivelInimigoVisto: number;
  /**
   * Ids de item JÁ VISTOS no inventário de algum inimigo. Acumula em vez de
   * refletir o instante: sumir da visão não faz o item deixar de existir, e
   * zerar a lista faria o alerta piscar a cada ida dele pro mato.
   */
  itensInimigosVistos: number[];
  /** EventNames já vistos nesta partida. */
  eventos: string[];
  /**
   * Objetivos e seus tempos, JÁ CALCULADOS por quem chamou.
   *
   * Este módulo é puro: ele não sabe que dragão respawna em 5min nem quando o
   * último morreu. Recebe pronto de ingame.ts (objectiveState) e só compara.
   */
  objetivos: ObjetivoEstado[];
}

/**
 * Um inimigo, como a Live Client API o entrega.
 *
 * Os nomes dos campos espelham `allPlayers[]`: championName, isDead e
 * respawnTimer. Renomear aqui só criaria uma tradução a mais para errar.
 */
export interface InimigoEstado {
  /** `allPlayers[].championName` -- nome de EXIBIÇÃO ("Master Yi", "Kai'Sa"). */
  campeao: string;
  morto: boolean;
  /**
   * Segundos até renascer, de `allPlayers[].respawnTimer`.
   *
   * Zero quando vivo. É contínuo e decrescente: a API atualiza a cada poll, e
   * por isso uma regra de "mais de 30s de respawn" deixa de valer sozinha
   * quando o contador desce -- não precisa de limpeza.
   */
  respawnEm: number;
}

/** Um objetivo e quanto falta pra ele. Espelha o Objective do ingame.ts. */
export interface ObjetivoEstado {
  /** Um de OBJETIVOS (sem "qualquer", que é só do gatilho). */
  nome: string;
  /** Segundos até nascer (up=false) ou de pé há tanto tempo (up=true). */
  inSec: number;
  up: boolean;
}

/** Campos numéricos que uma regra `meu-stat` pode comparar. */
export const CAMPOS = [
  "meuNivel", "meusAbates", "minhasMortes", "minhasAssistencias",
  "mortesSemTrade", "cs", "csMinPost15", "ouro", "t",
] as const;
export type Campo = (typeof CAMPOS)[number];

export const OPS = [">=", ">", "<=", "<", "=="] as const;
export type Op = (typeof OPS)[number];

/** Eventos que a Live Client API emite e que fazem sentido como gatilho. */
export const EVENTOS = [
  "ChampionKill", "FirstBlood", "Multikill", "Ace",
  "TurretKilled", "InhibKilled", "DragonKill", "HeraldKill", "BaronKill",
  // HordeKill = voidgrubs. Faltava aqui enquanto o ingame.ts já o consumia
  // (linhas 470 e 504) — ou seja, a IA recusava um alerta sobre um evento que
  // o coach trata há semanas. Foi o quinto caso do mesmo erro: escrever a
  // lista do que é possível olhando a API, sem conferir o que o código já faz
  // com ela. Ao acrescentar evento aqui, confira o outro lado também.
  "HordeKill",
  "GameStart", "MinionsSpawning",
] as const;

/**
 * Objetivos que dá pra prever.
 *
 * Os nomes são EXATAMENTE os que objectiveState() produz em ingame.ts -- é
 * comparação de string, então divergir aqui faria a regra nunca disparar, que
 * é a pior falha possível neste sistema. "qualquer" é só do gatilho: significa
 * "o que nascer primeiro", e não é nome de objetivo nenhum.
 */
export const OBJETIVOS = [
  "Dragão", "Dragão Ancião", "Voidgrubs", "Arauto", "Barão",
] as const;
export type Objetivo = (typeof OBJETIVOS)[number];

/** Teto de antecedência: 10min antes é aviso que ninguém consegue usar. */
const OBJETIVO_EM_MAX = 600;

/**
 * Teto do respawn pedido, em segundos.
 *
 * O timer de morte do LoL cresce com o nível e passa de 60s só no fim de jogo
 * (chega perto de 80s no nível 18). Pedir "mais de 90s de respawn" seria uma
 * regra que nunca dispara -- e regra que valida e nunca dispara é a falha que
 * este módulo inteiro existe pra evitar. 80 é o teto observado no jogo, então
 * é onde a validação corta.
 */
const RESPAWN_MAX = 80;

export type Gatilho =
  | { tipo: "meu-stat"; campo: Campo; op: Op; valor: number }
  | { tipo: "meu-nivel"; minimo: number }
  | { tipo: "meu-item"; itens: number[] }
  | { tipo: "inimigos-mortos"; minimo: number }
  | { tipo: "inimigo-morto"; campeao: string }
  | { tipo: "inimigo-respawn"; segundos: number; campeao?: string }
  | { tipo: "inimigo-nivel"; minimo: number }
  | { tipo: "inimigo-item"; itens: number[] }
  | { tipo: "objetivo-em"; objetivo: Objetivo | "qualquer"; emSegundos: number }
  | { tipo: "tempo"; aosSegundos: number }
  | { tipo: "evento"; evento: string }
  | { tipo: "e"; partes: Gatilho[] }
  | { tipo: "ou"; partes: Gatilho[] };

export interface Regra {
  /** Identidade e nome-base do arquivo de som. */
  id: string;
  /** O que aparece na tela quando dispara. */
  texto: string;
  /** Nome-base da gravação em sounds/. Normalmente igual ao id. */
  som: string;
  /** 1 = mais importante. */
  prioridade: number;
  quando: Gatilho;
  /** O pedido original, em português. Guardado para o usuário lembrar. */
  pedido?: string;
  criadoEm?: number;
}

/** Aninhamento além disto é sinal de resposta malformada, não de intenção. */
const PROFUNDIDADE_MAX = 5;

export interface Validacao { ok: boolean; erro?: string }

/**
 * Valida uma regra vinda do modelo.
 *
 * Rejeita em vez de corrigir: "consertar" o JSON adivinhando a intenção
 * produziria uma regra que o usuário não pediu -- e ele só descobriria em
 * partida, quando o alerta errado disparasse (ou nunca disparasse).
 */
export function validarRegra(r: unknown): Validacao {
  if (!r || typeof r !== "object") return { ok: false, erro: "regra não é um objeto" };
  const o = r as Record<string, unknown>;

  const id = o.id;
  // O id vira nome de arquivo de som; nunca confie nele sem checar.
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) {
    return { ok: false, erro: "id deve ter só letras minúsculas, números e hífen" };
  }
  const som = o.som;
  if (typeof som !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(som)) {
    return { ok: false, erro: "som deve ter só letras minúsculas, números e hífen" };
  }
  if (typeof o.texto !== "string" || !o.texto.trim() || o.texto.length > 140) {
    return { ok: false, erro: "texto vazio ou longo demais" };
  }
  const p = o.prioridade;
  if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > 3) {
    return { ok: false, erro: "prioridade deve ser 1, 2 ou 3" };
  }
  return validarGatilho(o.quando, 0);
}

function validarGatilho(g: unknown, nivel: number): Validacao {
  if (nivel > PROFUNDIDADE_MAX) return { ok: false, erro: "regra aninhada demais" };
  if (!g || typeof g !== "object") return { ok: false, erro: "gatilho não é um objeto" };
  const o = g as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

  switch (o.tipo) {
    case "meu-stat":
      if (!CAMPOS.includes(o.campo as Campo)) return { ok: false, erro: `campo desconhecido: ${String(o.campo)}` };
      if (!OPS.includes(o.op as Op)) return { ok: false, erro: `operador desconhecido: ${String(o.op)}` };
      if (!num(o.valor)) return { ok: false, erro: "valor deve ser número" };
      return { ok: true };

    case "meu-nivel":
      if (!num(o.minimo) || (o.minimo as number) < 1 || (o.minimo as number) > 18) {
        return { ok: false, erro: "nível deve estar entre 1 e 18" };
      }
      return { ok: true };

    case "meu-item":
      if (!Array.isArray(o.itens) || !o.itens.length || !o.itens.every(num)) {
        return { ok: false, erro: "itens deve ser uma lista de ids numéricos" };
      }
      return { ok: true };

    case "inimigos-mortos":
      if (!num(o.minimo) || (o.minimo as number) < 1 || (o.minimo as number) > 5) {
        return { ok: false, erro: "inimigos mortos deve estar entre 1 e 5" };
      }
      return { ok: true };

    // O nome do campeão é CONFERIDO contra a lista, não aceito como veio. Um
    // nome que não existe ("Leblank") produziria uma regra perfeitamente
    // válida que nunca dispara — o usuário gravaria a voz, confiaria e
    // esperaria a partida inteira. Recusar na criação é o único momento em que
    // ele ainda pode corrigir.
    case "inimigo-morto": {
      const c = resolverCampeao(o.campeao);
      if (!c) return { ok: false, erro: `campeão desconhecido: ${String(o.campeao)}` };
      return { ok: true };
    }

    case "inimigo-respawn": {
      if (!num(o.segundos) || (o.segundos as number) <= 0 || (o.segundos as number) > RESPAWN_MAX) {
        return { ok: false, erro: `respawn deve estar entre 1 e ${RESPAWN_MAX} segundos` };
      }
      // campeao é opcional aqui: "qualquer inimigo com 30s de respawn" é o
      // pedido comum (é a janela de objetivo), e exigir um nome transformaria
      // o gatilho geral em cinco regras.
      if (o.campeao !== undefined && !resolverCampeao(o.campeao)) {
        return { ok: false, erro: `campeão desconhecido: ${String(o.campeao)}` };
      }
      return { ok: true };
    }

    case "inimigo-nivel":
      if (!num(o.minimo) || (o.minimo as number) < 1 || (o.minimo as number) > 18) {
        return { ok: false, erro: "nível deve estar entre 1 e 18" };
      }
      return { ok: true };

    case "inimigo-item":
      if (!Array.isArray(o.itens) || !o.itens.length || !o.itens.every(num)) {
        return { ok: false, erro: "itens deve ser uma lista de ids numéricos" };
      }
      return { ok: true };

    case "objetivo-em":
      if (o.objetivo !== "qualquer" && !OBJETIVOS.includes(o.objetivo as Objetivo)) {
        return { ok: false, erro: `objetivo desconhecido: ${String(o.objetivo)}` };
      }
      if (!num(o.emSegundos) || (o.emSegundos as number) <= 0 || (o.emSegundos as number) > OBJETIVO_EM_MAX) {
        return { ok: false, erro: `antecedência deve estar entre 1 e ${OBJETIVO_EM_MAX} segundos` };
      }
      return { ok: true };

    case "tempo":
      if (!num(o.aosSegundos) || (o.aosSegundos as number) < 0) {
        return { ok: false, erro: "aosSegundos deve ser número positivo" };
      }
      return { ok: true };

    case "evento":
      if (typeof o.evento !== "string" || !EVENTOS.includes(o.evento as any)) {
        return { ok: false, erro: `evento desconhecido: ${String(o.evento)}` };
      }
      return { ok: true };

    case "e":
    case "ou": {
      if (!Array.isArray(o.partes) || o.partes.length < 2 || o.partes.length > 5) {
        return { ok: false, erro: `"${o.tipo}" precisa de 2 a 5 partes` };
      }
      for (const parte of o.partes) {
        const v = validarGatilho(parte, nivel + 1);
        if (!v.ok) return v;
      }
      return { ok: true };
    }

    default:
      return { ok: false, erro: `tipo de gatilho desconhecido: ${String(o.tipo)}` };
  }
}

/** Avalia a regra. Sem efeitos colaterais; nunca lança. */
export function avaliar(regra: Regra, e: Estado): boolean {
  return avaliarGatilho(regra.quando, e);
}

function avaliarGatilho(g: Gatilho, e: Estado): boolean {
  switch (g.tipo) {
    case "meu-stat": {
      const v = e[g.campo];
      // Campo ainda não medido (csMinPost15 antes dos 15min) não dispara:
      // tratar null como 0 faria o alerta soar no minuto 1.
      if (v === null || v === undefined) return false;
      switch (g.op) {
        case ">=": return v >= g.valor;
        case ">":  return v >  g.valor;
        case "<=": return v <= g.valor;
        case "<":  return v <  g.valor;
        case "==": return v === g.valor;
      }
      return false;
    }
    case "meu-nivel":       return e.meuNivel >= g.minimo;
    case "meu-item":        return g.itens.some((i) => e.meusItens.includes(i));
    case "inimigos-mortos": return e.inimigosMortos >= g.minimo;
    case "inimigo-morto":
      return e.inimigos.some((i) => i.morto && mesmoCampeao(g.campeao, i.campeao));
    // `morto` é exigido junto com o tempo de propósito: respawnTimer de jogador
    // vivo é 0, mas depender disso seria confiar num detalhe da API que pode
    // mudar. Exigir os dois deixa a intenção explícita — "morto E com tanto
    // tempo pra voltar".
    case "inimigo-respawn":
      return e.inimigos.some((i) =>
        i.morto &&
        i.respawnEm >= g.segundos &&
        (g.campeao === undefined || mesmoCampeao(g.campeao, i.campeao)));
    case "inimigo-nivel":   return e.maiorNivelInimigoVisto >= g.minimo;
    case "inimigo-item":    return g.itens.some((i) => e.itensInimigosVistos.includes(i));
    // OBJETIVO DE PÉ NÃO CONTA, de propósito. "faltar 30 segundos" é pedido de
    // ANTECIPAÇÃO -- tempo de andar até o rio e por visão. Um dragão que já
    // nasceu não tem o que antecipar, e o coach já tem alerta nativo para
    // objetivo disponível. Deixar up=true satisfazer faria o alerta ficar
    // verdadeiro a partida inteira depois do primeiro spawn.
    case "objetivo-em":
      return e.objetivos.some((o) =>
        !o.up &&
        (g.objetivo === "qualquer" || o.nome === g.objetivo) &&
        o.inSec <= g.emSegundos);
    case "tempo":           return e.t >= g.aosSegundos;
    case "evento":          return e.eventos.includes(g.evento);
    case "e":               return g.partes.every((p) => avaliarGatilho(p, e));
    case "ou":              return g.partes.some((p) => avaliarGatilho(p, e));
  }
}

const NOME_CAMPO: Record<Campo, string> = {
  meuNivel: "seu nível", meusAbates: "seus abates", minhasMortes: "suas mortes",
  minhasAssistencias: "suas assistências", mortesSemTrade: "mortes sem trade",
  cs: "seu cs", csMinPost15: "cs por minuto pós-15", ouro: "seu ouro",
  t: "tempo de jogo",
};

const NOME_EVENTO: Record<string, string> = {
  ChampionKill: "alguém morrer", FirstBlood: "sair o first blood",
  Multikill: "sair um multikill", Ace: "sair um ace",
  TurretKilled: "cair uma torre", InhibKilled: "cair um inibidor",
  DragonKill: "morrer um dragão", HeraldKill: "morrer o arauto",
  BaronKill: "morrer o Barão", HordeKill: "o time pegar os voidgrubs", GameStart: "a partida começar",
  MinionsSpawning: "os minions saírem",
};

/**
 * Descreve o gatilho em português.
 *
 * Existe para o usuário CONFERIR o que a IA entendeu antes de aceitar. Ler
 * JSON não é conferência: é aqui que ele percebe que pediu uma coisa e saiu
 * outra.
 */
export function descrever(g: Gatilho): string {
  switch (g.tipo) {
    case "meu-stat": {
      const op = { ">=": "for pelo menos", ">": "passar de",
                   "<=": "for no máximo", "<": "for menos que",
                   "==": "for exatamente" }[g.op];
      return `quando ${NOME_CAMPO[g.campo]} ${op} ${g.valor}`;
    }
    case "meu-nivel":       return `quando você chegar ao nível ${g.minimo}`;
    case "meu-item":        return `quando você tiver o item ${g.itens.join(" ou ")}`;
    case "inimigos-mortos": return `quando ${g.minimo} inimigos ou mais estiverem mortos`;
    // SEM "VIR" AQUI, ao contrário de nível e item: morte é anunciada pro mapa
    // inteiro, então o aviso chega na hora. Escrever "quando você VIR a
    // Leblanc morrer" prometeria menos do que se entrega.
    case "inimigo-morto":
      return `quando ${resolverCampeao(g.campeao) ?? g.campeao} morrer`;
    case "inimigo-respawn": {
      const quem = g.campeao
        ? `${resolverCampeao(g.campeao) ?? g.campeao} estiver morta`
        : "um inimigo estiver morto";
      return `quando ${quem} com ${g.segundos}s ou mais de respawn`;
    }
    // "VIR", não "chegar": o dado passa por fog of war, então o que se promete
    // é a OBSERVAÇÃO, não o evento. Quem lê isto antes de aceitar precisa
    // entender que o inimigo pode ter subido de nível minutos antes.
    case "inimigo-nivel":
      return `quando você VIR um inimigo no nível ${g.minimo} ou mais (vale quando ele aparecer, não quando ele subir)`;
    case "inimigo-item":
      return `quando você VIR um inimigo com o item ${g.itens.join(" ou ")} (vale quando ele aparecer, não quando ele comprar)`;
    case "objetivo-em": {
      // "faltarem 30s" lê melhor que "30 segundos antes"; e minuto redondo vira
      // minuto, porque foi assim que o usuário pediu.
      const s = g.emSegundos;
      const redondo = s % 60 === 0 && s >= 60;
      const quanto = redondo ? `${s / 60} ${s === 60 ? "minuto" : "minutos"}` : `${s}s`;
      // Concordância: "faltar 1 minuto", mas "faltarem 30s"/"2 minutos".
      const verbo = s === 60 ? "faltar" : "faltarem";
      const alvo = g.objetivo === "qualquer" ? "o próximo objetivo" : `o ${g.objetivo}`;
      return `quando ${verbo} ${quanto} para ${alvo} nascer`;
    }
    case "tempo": {
      const m = Math.floor(g.aosSegundos / 60);
      const s = g.aosSegundos % 60;
      return `aos ${m}:${String(s).padStart(2, "0")} de jogo`;
    }
    case "evento":          return `quando ${NOME_EVENTO[g.evento] ?? g.evento}`;
    case "e":               return g.partes.map(descrever).join(" E ");
    case "ou":              return g.partes.map(descrever).join(" OU ");
  }
}

/** Campo da Live Client API que alimenta cada `meu-stat`. Traçado a partir do
 *  estadoRegras de ingame.ts, não inventado. */
const FONTE_CAMPO: Record<Campo, string> = {
  meuNivel: "`allPlayers[você].level`",
  meusAbates: "`allPlayers[você].scores.kills`",
  minhasMortes: "`allPlayers[você].scores.deaths`",
  minhasAssistencias: "`allPlayers[você].scores.assists`",
  // Não é campo da API: sai do cruzamento dos eventos de morte com os abates
  // do time numa janela de 15s, feito no ingame.ts.
  mortesSemTrade: "`events.Events[]` do tipo ChampionKill (suas mortes sem abate do time em 15s)",
  cs: "`allPlayers[você].scores.creepScore`",
  csMinPost15: "`allPlayers[você].scores.creepScore` comparado ao valor congelado aos 15:00",
  ouro: "`activePlayer.currentGold`",
  t: "`gameData.gameTime`",
};

/**
 * De ONDE o gatilho lê, em nomes de campo reais da Live Client API.
 *
 * DETERMINÍSTICO, NÃO GERADO PELO MODELO: o mapa de gatilho -> campo é fixo e
 * conhecido no código. Pedir isto à IA abriria espaço pra ela inventar um
 * caminho de JSON que não existe, e o usuário confiaria — justamente na tela
 * que existe pra ele CONFERIR. O `confirmo` do modelo continua vindo junto,
 * como segunda opinião; divergir dos dois é o sinal de que algo está errado.
 *
 * O sufixo "a cada segundo" não é enfeite: é o período real do poll do
 * ingame.ts, e é o que explica por que o alerta não é instantâneo.
 */
export function fontesDoGatilho(g: Gatilho): string {
  switch (g.tipo) {
    case "meu-stat":
      return `leio ${FONTE_CAMPO[g.campo]} a cada segundo e comparo com ${g.valor}`;
    case "meu-nivel":
      return `leio \`allPlayers[você].level\` a cada segundo e comparo com ${g.minimo}`;
    case "meu-item":
      return `leio \`allPlayers[você].items[].itemID\` a cada segundo e procuro ${g.itens.join(" ou ")}`;
    case "inimigos-mortos":
      return "leio `allPlayers[].isDead` e `allPlayers[].team` a cada segundo e conto os mortos do time inimigo";
    // Sem a ressalva de "acumulado"/"já visto" que nível e item carregam: aqui
    // o valor lido É o estado atual, porque morte não passa por fog of war.
    case "inimigo-morto":
      return `leio \`allPlayers[].championName\`, \`allPlayers[].isDead\` e \`allPlayers[].team\` a cada segundo e procuro ${resolverCampeao(g.campeao) ?? g.campeao} morto no time inimigo (morte é anunciada pro mapa todo, então não depende de você estar vendo)`;
    case "inimigo-respawn": {
      const quem = g.campeao
        ? `${resolverCampeao(g.campeao) ?? g.campeao}`
        : "algum inimigo";
      return `leio \`allPlayers[].isDead\` e \`allPlayers[].respawnTimer\` a cada segundo e disparo quando ${quem} estiver morto com ${g.segundos}s ou mais no contador`;
    }
    // "acumulado" é a parte honesta, mas o MECANISMO não é o que estava escrito
    // aqui: a API NÃO omite quem está fora de visão. `allPlayers` devolve os
    // dez jogadores sempre; o que passa por fog of war é o VALOR, que congela
    // no último conhecido enquanto o inimigo está no escuro e salta quando ele
    // reaparece.
    //
    // Verificado nas 13 gravações em recordings/: todas com 10 jogadores,
    // inclusive as iniciadas já com 15min de partida.
    //
    // A conclusão para o usuário é a mesma (o número é a última observação, não
    // o estado atual), e é por isso que o texto abaixo não mudou — ele já falava
    // em "já visto", que descreve o congelamento tão bem quanto descreveria a
    // omissão. Mas o comentário precisava parar de afirmar algo falso sobre a
    // API, já que é daqui que sai a explicação mostrada na criação do alerta.
    case "inimigo-nivel":
      return `leio \`allPlayers[].level\` e \`allPlayers[].team\` a cada segundo, guardo o maior nível já visto num inimigo e comparo com ${g.minimo}`;
    case "inimigo-item":
      return `leio \`allPlayers[].items[].itemID\` e \`allPlayers[].team\` a cada segundo, acumulo os itens já vistos nos inimigos e procuro ${g.itens.join(" ou ")}`;
    // Não vem pronto da API: o coach deriva do evento de morte + tempo de
    // respawn. Dizer "leio o timer" seria mentira.
    case "objetivo-em": {
      const alvo = g.objetivo === "qualquer" ? "qualquer objetivo" : g.objetivo;
      return `não vem pronto da API: calculo o respawn de ${alvo} somando o tempo de renascimento ao último evento de morte em \`events.Events[]\` (DragonKill/HeraldKill/BaronKill), comparo com \`gameData.gameTime\` e disparo quando faltarem ${g.emSegundos}s ou menos`;
    }
    case "tempo":
      return `leio \`gameData.gameTime\` a cada segundo e comparo com ${g.aosSegundos}s`;
    case "evento":
      return `leio \`events.Events[].EventName\` a cada segundo e procuro \`${g.evento}\` (fica valendo depois que aparece)`;
    case "e":
      return g.partes.map(fontesDoGatilho).join("; e também ");
    case "ou":
      return g.partes.map(fontesDoGatilho).join("; ou então ");
  }
}
