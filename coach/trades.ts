// Morte sem trade: a métrica, isolada e testável.
//
// POR QUE ESTE ARQUIVO EXISTE: o cálculo morava solto dentro do poll de
// ingame.ts e nunca teve teste próprio — só os consumidores do número tinham.
// Foi assim que um critério frouxo passou despercebido por muito tempo: ele
// contava como "trade" QUALQUER abate do time numa janela de ±15s, em qualquer
// lugar do mapa, feito por qualquer pessoa.
//
// Dois defeitos concretos daquele critério:
//
//   1. JANELA SIMÉTRICA. Um abate do time 14s ANTES da sua morte absolvia a
//      morte. Isso inverte a causalidade que a métrica quer medir: "morri em
//      troca de algo" só faz sentido para frente no tempo.
//
//   2. SEM ENVOLVIMENTO. O toplaner matando alguém do outro lado do mapa
//      contava como o seu trade. Em jogo movimentado, abates do time acontecem
//      o tempo todo, então mortes viravam "trade" por coincidência — e quanto
//      mais longo o jogo, mais isso acontecia. O número SUBESTIMAVA, com viés
//      de duração: exatamente o viés que já contaminou outras análises deste
//      projeto (ward total no pós-15, Quebra-Bastião).
//
// O QUE A API PERMITE CHECAR: o ChampionKill da Live Client API traz
// KillerName, VictimName e Assisters. Não traz posição. Então "mesma luta" não
// dá para verificar geometricamente — mas dá para exigir ENVOLVIMENTO, que é
// um proxy honesto e verificável:
//
//   - quem te matou morreu (vingança direta), ou
//   - quem participou de te matar (assistente) morreu, ou
//   - você mesmo participou do abate (assistência sua antes de morrer não
//     aparece aqui, mas um abate seu conta como trade do próprio confronto).
//
// O que continua de fora: o abate de um inimigo NÃO envolvido na sua morte,
// mesmo que próximo no tempo. É deliberado — era a principal fonte de falso
// "trade".

/** Uma morte sua, com o veredito de trade. */
export interface Morte {
  at: number;
  traded: boolean;
}

/** Um abate qualquer da partida, já normalizado. */
export interface Abate {
  at: number;
  killer: string;
  victim: string;
  assisters: string[];
  /** Se o autor do abate é do seu time. */
  doMeuTime: boolean;
}

/**
 * Janela para frente, em segundos.
 *
 * Só para FRENTE: a morte precisa vir antes do abate que a compensa. 15s é o
 * mesmo número do critério antigo — mudar janela e critério ao mesmo tempo
 * tornaria impossível saber qual dos dois moveu o número.
 */
export const JANELA_TRADE_S = 15;

/**
 * Janela da PARTICIPAÇÃO PRÓPRIA, em segundos, simétrica.
 *
 * O critério de envolvimento acima consertou o falso trade do aliado do outro
 * lado do mapa, mas deixou passar o caso oposto e mais óbvio: VOCÊ trocou.
 * Se você matou alguém ou deu assistência na luta em que caiu, a morte teve
 * troca por definição — não é a "morte de graça" que a métrica quer medir.
 *
 * Por que 30s e SIMÉTRICA, diferente dos 15s só-para-frente acima: a pergunta
 * é outra. Lá é "meu time vingou minha morte?", que é causal e só faz sentido
 * para frente. Aqui é "eu participei desta luta?" — e a luta começa antes de
 * você cair. Uma luta de teamfight dura mais que 15s do primeiro abate ao
 * último, então a janela precisa cobrir os dois lados.
 */
export const JANELA_PARTICIPACAO_S = 30;

/**
 * Decide quais das suas mortes foram trocadas.
 *
 * Uma morte conta como trade quando, dentro de JANELA_TRADE_S segundos DEPOIS
 * dela, seu time abate alguém que estava envolvido em te matar — o killer ou
 * um dos assistentes.
 *
 * Não lança: entrada malformada é ignorada. O chamador é o poll de 1s.
 */
export function marcarTrades(minhasMortes: Morte[], abates: Abate[], eu: string): Morte[] {
  const mortes = (minhasMortes ?? []).filter((m) => m && Number.isFinite(m.at));
  const todos = (abates ?? []).filter((a) => a && Number.isFinite(a.at));

  for (const morte of mortes) {
    // Quem me matou, nesta morte: o abate do inimigo cujo alvo fui eu no
    // instante desta morte. Sem isso não dá para exigir envolvimento.
    const oAbateQueMeMatou = todos.find(
      (a) => a.victim === eu && Math.abs(a.at - morte.at) < 1,
    );
    const envolvidos = new Set<string>();
    if (oAbateQueMeMatou) {
      if (oAbateQueMeMatou.killer) envolvidos.add(oAbateQueMeMatou.killer);
      for (const x of oAbateQueMeMatou.assisters ?? []) if (x) envolvidos.add(x);
    }

    // (a) O time vingou: alguém envolvido em me matar caiu logo depois.
    const vingado = todos.some(
      (a) =>
        a.doMeuTime &&
        a.at > morte.at &&
        a.at - morte.at <= JANELA_TRADE_S &&
        // O envolvimento é o que separa o trade real da coincidência. Sem
        // nenhum envolvido identificado (evento incompleto), nada absolve:
        // preferimos contar uma morte a mais que inventar um trade.
        envolvidos.has(a.victim),
    );

    // (b) Eu participei da luta: matei ou assisti dentro da janela simétrica.
    // A própria morte é excluída (victim === eu), senão toda morte se
    // absolveria e a métrica viraria zero constante.
    const participei = todos.some(
      (a) =>
        a.victim !== eu &&
        Math.abs(a.at - morte.at) <= JANELA_PARTICIPACAO_S &&
        (a.killer === eu || (a.assisters ?? []).includes(eu)),
    );

    morte.traded = vingado || participei;
  }
  return mortes;
}

/** Quantas mortes suas não tiveram trade. */
export function contarSemTrade(mortes: Morte[]): number {
  return (mortes ?? []).filter((m) => m && !m.traded).length;
}

/**
 * A morte já pode receber veredito, ou o julgamento ainda está em aberto?
 *
 * BUG QUE ISTO CONSERTA: o poll de 1s chamava marcarTrades assim que a morte
 * aparecia e anunciava "morte sem trade" na hora. Mas os abates que absolvem a
 * morte acontecem DEPOIS dela — nos 15s da vingança, nos 30s da participação.
 * No instante da morte esses eventos ainda não existem, então o veredito só
 * podia sair negativo. Na prática o coach anunciava "sem trade" para toda
 * morte em que nada tivesse acontecido ANTES, que é o oposto do que mede.
 *
 * Só se pode fechar o veredito depois da maior das duas janelas.
 */
export const ESPERA_VEREDITO_S = Math.max(JANELA_TRADE_S, JANELA_PARTICIPACAO_S);

/** Mortes cujo veredito já é definitivo no instante `agora`. */
export function mortesJulgaveis(mortes: Morte[], agora: number): Morte[] {
  return (mortes ?? []).filter(
    (m) => m && Number.isFinite(m.at) && agora - m.at >= ESPERA_VEREDITO_S,
  );
}
