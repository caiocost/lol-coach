// Log amigável do que a API expõe AO VIVO.
//
// POR QUE ISSO EXISTE: até agora, a única forma de descobrir o que dá pra
// alertar era pedir um alerta e ver se a IA recusava. Isso é adivinhar. Este
// log inverte: mostra o inventário do que o jogo está de fato emitindo,
// em português, enquanto a partida roda — e daí as ideias de alerta nascem do
// que existe, não do que se imagina.
//
// O que NÃO é: não é dump de campo a cada segundo (o usuário recusou isso
// explicitamente — ilegível) e não é revisão pós-jogo. É um fluxo cronológico
// de EVENTOS e de TRANSIÇÕES acionáveis, rolando durante o jogo.
//
// Relação com o "Console da API" que já existe na página: aquele é o ESQUEMA
// (que campos existem, com um valor de exemplo, reescrito a cada poll); este é
// a HISTÓRIA (o que aconteceu, em ordem, acumulando). Um responde "o que dá
// pra ler", o outro "o que já aconteceu". São complementares de propósito.
//
// REGRA DE OURO DESTE ARQUIVO: nada aqui pode lançar. O chamador é o
// pollInterno(), que roda 1x/s dentro de pollSeguro(); uma exceção aqui já
// derrubou o servidor no meio de partida antes. Por isso toda função de
// formatação é defensiva (`?? `, String(), try/catch no ponto de entrada) e
// não faz I/O nem rede.

import { EVENTOS } from "./alertRules.js";

/** Uma linha do log. */
export interface LinhaLog {
  /** Chave única — usada pra deduplicar e como key de render. */
  id: string;
  /** Segundo de jogo em que aconteceu. */
  t: number;
  /** De onde veio: evento da API, transição derivada do poll, ou alerta seu. */
  fonte: "evento" | "transicao" | "alerta";
  /** Frase em português, pronta pra ler. */
  texto: string;
  /**
   * Se dá pra virar alerta, e por qual caminho.
   * `null` = a API mostra, mas não existe gatilho que case com isso.
   */
  alertavel: Alertavel | null;
}

/** Como esta linha vira alerta: o rótulo do gatilho e o pedido pré-pronto. */
export interface Alertavel {
  /** Tipo de gatilho de alertRules que cobre esta linha. */
  gatilho: string;
  /** Frase em português pra pré-preencher a caixa de criar alerta. */
  pedido: string;
}

const MAX_LINHAS = 300;

/**
 * Teto do log.
 *
 * 300 linhas. Uma partida de 40min gera ~60-120 eventos de API (medido nas
 * gravações reais: a mais movimentada, 2026-09-13T18-00-56, teve 86 em 33min)
 * mais transições e alertas — fica bem abaixo do teto no caso normal, e o teto
 * protege o caso anormal (partida longuíssima, sangrenta, com muitos alertas).
 *
 * O corte é pela FRENTE (as linhas mais antigas saem), porque o valor do log é
 * o que está acontecendo agora; o registro completo pra revisão já existe em
 * recordings/*.json, gravado pelo recorder.
 */
export const LIMITE_LINHAS = MAX_LINHAS;

const mmss = (s: number) => {
  const n = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

/** Formata o relógio de uma linha, pra página não ter que repetir a lógica. */
export const relogio = mmss;

const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Nomes dos eventos que a lista de gatilhos de alertRules aceita. */
const EVENTOS_ALERTAVEIS = new Set<string>(EVENTOS as readonly string[]);

/**
 * Como cada evento da API se lê em português, e qual pedido de alerta ele
 * sugere.
 *
 * O pedido é escrito em PRIMEIRA PESSOA e no mesmo registro que o usuário já
 * digita na caixa ("me avisa quando...") — é o texto que vai pro alertAuthor,
 * então precisa ser algo que o autor de regras saiba transformar em gatilho.
 * Ver alertRules.EVENTOS: todo pedido aqui cai num gatilho { tipo: "evento" }.
 */
function descreverEvento(e: any): { texto: string; pedido: string | null } {
  const nome = txt(e?.EventName);
  const killer = txt(e?.KillerName) || "alguém";
  const vitima = txt(e?.VictimName) || "alguém";
  const assists: string[] = Array.isArray(e?.Assisters) ? e.Assisters.map(txt).filter(Boolean) : [];
  const ajuda = assists.length ? ` (assist: ${assists.join(", ")})` : "";

  switch (nome) {
    case "GameStart":
      return { texto: "Partida começou", pedido: "me avisa quando a partida começar" };
    case "MinionsSpawning":
      return { texto: "Minions saíram da base — a lane abriu", pedido: "me avisa quando os minions nascerem" };
    case "FirstBlood":
      return { texto: `Primeiro sangue: ${txt(e?.Recipient) || killer}`, pedido: "me avisa quando sair o primeiro sangue" };
    case "ChampionKill":
      return { texto: `${killer} matou ${vitima}${ajuda}`, pedido: "me avisa quando alguém morrer" };
    case "Multikill": {
      // O campo é KillStreak: 2 = double, 3 = triple, 4 = quadra, 5 = penta.
      const n = Number(e?.KillStreak ?? 0);
      const nomes: Record<number, string> = { 2: "Double Kill", 3: "Triple Kill", 4: "Quadra Kill", 5: "Penta Kill" };
      return { texto: `${killer} fez ${nomes[n] ?? `${n} abates seguidos`}`, pedido: "me avisa quando alguém fizer multikill" };
    }
    case "Ace":
      return { texto: `Ace — ${txt(e?.Acer) || "alguém"} zerou o time inimigo`, pedido: "me avisa quando sair um ace" };
    case "TurretKilled":
      // TurretKilled traz o nome interno da estrutura (Turret_T1_C_05_A). Não
      // traduzimos pra lane: o mapeamento do nome interno pra "torre de cima"
      // é frágil e errar aqui é pior que mostrar o nome cru.
      return { texto: `${killer} derrubou uma torre (${txt(e?.TurretKilled) || "?"})`, pedido: "me avisa quando cair uma torre" };
    case "InhibKilled":
      return { texto: `${killer} destruiu um inibidor (${txt(e?.InhibKilled) || "?"})`, pedido: "me avisa quando cair um inibidor" };
    case "InhibRespawned":
      return { texto: `Inibidor voltou (${txt(e?.InhibRespawned) || "?"})`, pedido: null };
    case "FirstBrick":
      // ACHADO DO PRÓPRIO LOG: FirstBrick aparece nas gravações reais
      // (2026-09-13T18-00-56, aos 16:54) e NÃO está em alertRules.EVENTOS.
      // Descrever aqui e deixar sem pedido é honesto: a API expõe, mas hoje
      // nenhum gatilho cobre. Se virar alerta um dia, entra lá primeiro.
      return { texto: `Primeira torre da partida caiu (${txt(e?.KillerName) || "?"})`, pedido: null };
    case "DragonKill": {
      const tipo = txt(e?.DragonType);
      const qual = tipo === "Elder" ? "Dragão Ancião" : tipo ? `Dragão de ${tipo}` : "Dragão";
      const roubo = e?.Stolen === "True" || e?.Stolen === true ? " — ROUBADO" : "";
      return { texto: `${killer} pegou o ${qual}${roubo}`, pedido: "me avisa quando o dragão morrer" };
    }
    case "BaronKill": {
      const roubo = e?.Stolen === "True" || e?.Stolen === true ? " — ROUBADO" : "";
      return { texto: `${killer} pegou o Barão${roubo}${ajuda}`, pedido: "me avisa quando o barão morrer" };
    }
    case "HeraldKill": {
      const roubo = e?.Stolen === "True" || e?.Stolen === true ? " — ROUBADO" : "";
      return { texto: `${killer} pegou o Arauto${roubo}`, pedido: "me avisa quando o arauto morrer" };
    }
    case "HordeKill":
      // HordeKill = voidgrub. A API emite um por larva, não um por leva.
      return { texto: `${killer} pegou uma Voidgrub`, pedido: "me avisa quando alguém pegar voidgrub" };
    case "GameEnd":
      return { texto: `Partida terminou — ${txt(e?.Result) === "Win" ? "vitória" : "derrota"}`, pedido: null };
    default:
      // Evento que a API emite e este arquivo ainda não conhece. Mostrar o
      // nome cru é melhor que esconder: é exatamente o tipo de descoberta que
      // o log existe pra permitir.
      return { texto: `Evento ${nome || "sem nome"} (ainda sem descrição amigável)`, pedido: null };
  }
}

/** Transforma um evento cru da Live Client API numa linha do log. */
export function linhaDeEvento(e: any, tAgora: number): LinhaLog {
  const nome = txt(e?.EventName);
  const { texto, pedido } = descreverEvento(e);
  const t = Number.isFinite(Number(e?.EventTime)) ? Number(e.EventTime) : tAgora;
  return {
    id: `ev-${txt(e?.EventID) || `${nome}-${Math.round(t)}`}`,
    t,
    fonte: "evento",
    texto,
    // Só marca como alertável se o nome do evento estiver de fato em
    // alertRules.EVENTOS. Prometer um alerta que a validação vai recusar é
    // pior que não prometer nada — foi esse o defeito do HordeKill.
    alertavel: pedido && EVENTOS_ALERTAVEIS.has(nome) ? { gatilho: "evento", pedido } : null,
  };
}

/** Estado por poll que as transições comparam. Só leitura, nunca mutado aqui. */
export interface FotoPoll {
  t: number;
  /** Nível de cada jogador nesta leitura. */
  niveis: { nome: string; champ: string; nivel: number; inimigo: boolean }[];
  /** Itens (id + nome) de cada jogador nesta leitura. */
  itens: { nome: string; champ: string; inimigo: boolean; itens: { id: number; nome: string }[] }[];
  /** Inimigos e se estão mortos agora. */
  inimigos: { campeao: string; morto: boolean; respawnEm: number }[];
  /** Objetivos como objectiveState() os devolve. */
  objetivos: { name: string; inSec: number; up: boolean }[];
  /** Indicadores próprios que o poll já calcula — não recalcular aqui. */
  mortesSemTrade?: number;
  ctrlWards?: number;
}

/**
 * Memória entre polls.
 *
 * Vive fora do gerador porque a transição SÓ existe na comparação com a
 * leitura anterior — a Live Client API não emite "subiu de nível", só expõe o
 * nível atual. Mesma razão pela qual ingame.ts já mantém prevLevels.
 */
export interface MemoriaLog {
  niveis: Map<string, number>;
  itens: Map<string, Set<number>>;
  mortos: Set<string>;
  janelasObj: Set<string>;
  mortesSemTrade: number;
  csAlto: boolean;
  ctrlWards: number;
  /** Primeira leitura da partida: só registra as bases, sem gerar linha. */
  iniciada: boolean;
}

export function memoriaVazia(): MemoriaLog {
  return {
    niveis: new Map(), itens: new Map(), mortos: new Set(), janelasObj: new Set(),
    mortesSemTrade: 0, csAlto: false, ctrlWards: 0, iniciada: false,
  };
}

/**
 * Compara a foto atual com a anterior e devolve as transições acionáveis.
 *
 * "Acionável" é o critério de corte: entra o que muda o que você faria agora
 * (alguém tem ult, o inimigo comprou Zhonya, o dragão nasce em 60s, você
 * morreu sem trade). Fica de fora ouro, HP, posição de câmera e todo campo
 * que muda a cada segundo — é isso que o usuário chamou de ilegível.
 *
 * Na PRIMEIRA leitura da partida nada é gerado: se você abre o coach com o
 * jogo em andamento, ninguém "acabou de" fazer nada, e despejar cinco níveis 6
 * de uma vez seria ruído — o mesmo cuidado que o alerta ult6 já toma.
 */
export function transicoes(foto: FotoPoll, mem: MemoriaLog): LinhaLog[] {
  const out: LinhaLog[] = [];
  const t = Number.isFinite(foto?.t) ? foto.t : 0;
  const primeira = !mem.iniciada;
  const push = (id: string, texto: string, alertavel: Alertavel | null) => {
    if (!primeira) out.push({ id: `${id}@${Math.round(t)}`, t, fonte: "transicao", texto, alertavel });
  };

  // ---- níveis ----
  for (const p of foto.niveis ?? []) {
    const antes = mem.niveis.get(p.nome);
    mem.niveis.set(p.nome, p.nivel);
    if (antes === undefined || p.nivel <= antes) continue;
    const lado = p.inimigo ? "inimigo" : "aliado";
    if (p.nivel === 6 || p.nivel === 11 || p.nivel === 16) {
      // 6/11/16 são os pontos de ult; o resto vira ruído se logado.
      push(`lvl-${p.nome}-${p.nivel}`,
        `${p.champ} (${lado}) chegou ao nível ${p.nivel} — ultimate ${p.nivel === 6 ? "disponível" : `rank ${p.nivel === 11 ? 2 : 3}`}`,
        p.inimigo
          ? { gatilho: "inimigo-nivel", pedido: `me avisa quando um inimigo chegar ao nível ${p.nivel}` }
          : { gatilho: "meu-nivel", pedido: `me avisa quando eu chegar ao nível ${p.nivel}` });
    } else {
      push(`lvl-${p.nome}-${p.nivel}`, `${p.champ} (${lado}) subiu para o nível ${p.nivel}`,
        p.inimigo
          ? { gatilho: "inimigo-nivel", pedido: `me avisa quando um inimigo chegar ao nível ${p.nivel}` }
          : { gatilho: "meu-nivel", pedido: `me avisa quando eu chegar ao nível ${p.nivel}` });
    }
  }

  // ---- itens novos no inventário ----
  // A API não emite "comprou item": ela expõe o inventário. Item que aparece é
  // compra (ou upgrade); item que some é consumível usado, e não logamos isso
  // porque a control ward sozinha produziria uma linha por ida à base.
  for (const p of foto.itens ?? []) {
    const antes = mem.itens.get(p.nome);
    const agora = new Set((p.itens ?? []).map((i) => i?.id).filter((n): n is number => Number.isFinite(n)));
    mem.itens.set(p.nome, agora);
    if (antes === undefined) continue;
    for (const it of p.itens ?? []) {
      if (!it?.id || antes.has(it.id)) continue;
      const lado = p.inimigo ? "inimigo" : "aliado";
      push(`item-${p.nome}-${it.id}`,
        `${p.champ} (${lado}) apareceu com ${it.nome || `item ${it.id}`}`,
        p.inimigo
          ? { gatilho: "inimigo-item", pedido: `me avisa quando um inimigo comprar ${it.nome || `item ${it.id}`}` }
          : { gatilho: "meu-item", pedido: `me avisa quando eu comprar ${it.nome || `item ${it.id}`}` });
    }
  }

  // ---- morte e volta dos inimigos ----
  // Instantâneo de propósito (isDead/respawnTimer), sem acumular: morte é
  // global, então o instante É o estado real — a mesma decisão que estadoRegras
  // já toma em ingame.ts.
  const vivosAgora = new Set<string>();
  for (const i of foto.inimigos ?? []) {
    const c = txt(i?.campeao);
    if (!c) continue;
    if (i.morto) {
      vivosAgora.add(c);
      if (!mem.mortos.has(c)) {
        mem.mortos.add(c);
        push(`morte-${c}`, `${c} (inimigo) morreu — volta em ${Math.round(i.respawnEm)}s`,
          { gatilho: "inimigo-morto", pedido: `me avisa quando ${c} morrer` });
      }
    }
  }
  for (const c of [...mem.mortos]) {
    if (vivosAgora.has(c)) continue;
    mem.mortos.delete(c);
    push(`respawn-${c}`, `${c} (inimigo) voltou ao mapa`,
      { gatilho: "inimigo-respawn", pedido: `me avisa quando ${c} estiver a 10 segundos de voltar` });
  }

  // ---- janelas de objetivo ----
  // As MESMAS janelas que os alertas nativos obj-60/obj-30 usam. A chave
  // ancora no spawn (t + inSec), não no minuto do relógio — sem isso a linha
  // se repetiria a cada virada de minuto, que foi um bug real dos alertas.
  for (const o of foto.objetivos ?? []) {
    if (!o || o.up) continue;
    const spawn = Math.round(t + o.inSec);
    const janela = o.inSec <= 30 ? 30 : o.inSec <= 60 ? 60 : null;
    if (janela === null) continue;
    const chave = `obj-${o.name}-${spawn}-${janela}`;
    if (mem.janelasObj.has(chave)) continue;
    // Este Set cresce com o jogo (uma chave por spawn por janela). Num jogo de
    // 40min com dragão de 5 em 5min são ~50 chaves — irrisório, mas o teto
    // existe pra que nenhum cenário estranho (respawn rápido, muitos
    // objetivos) o faça crescer sem limite dentro do poll de 1s.
    if (mem.janelasObj.size > 200) mem.janelasObj.clear();
    mem.janelasObj.add(chave);
    push(chave, `${o.name} nasce em ${o.inSec}s — janela de ${janela}s aberta`,
      { gatilho: "objetivo-em", pedido: `me avisa quando faltar ${janela} segundos pro ${o.name.toLowerCase()}` });
  }

  // ---- seus próprios indicadores cruzando limiar ----
  const nt = Number(foto.mortesSemTrade ?? 0);
  if (nt > mem.mortesSemTrade) {
    push(`notrade-${nt}`, `Você já tem ${nt} morte${nt > 1 ? "s" : ""} sem trade nesta partida`,
      { gatilho: "meu-stat", pedido: `me avisa quando eu tiver ${nt + 1} mortes sem trade` });
  }
  mem.mortesSemTrade = nt;

  const cw = Number(foto.ctrlWards ?? 0);
  if (cw > mem.ctrlWards) {
    push(`ward-${cw}`, `Você comprou uma control ward (${cw} na partida)`,
      { gatilho: "meu-item", pedido: "me avisa quando eu comprar uma control ward" });
  }
  mem.ctrlWards = cw;

  mem.iniciada = true;
  return out;
}

/**
 * Reconstrói o log de uma partida a partir da GRAVAÇÃO em disco.
 *
 * POR QUE RECONSTRUIR EM VEZ DE GUARDAR AS LINHAS PRONTAS: o recorder já
 * persiste todo evento cru em recordings/*.json. Guardar a frase formatada
 * junto criaria duas cópias do mesmo fato, que divergem na primeira vez que
 * alguém melhorar `descreverEvento` — e a partida antiga ficaria congelada no
 * texto velho. Passando o evento cru pelo MESMO formatador do ao vivo, melhorar
 * o formatador melhora retroativamente todas as 13 gravações.
 *
 * O QUE NÃO DÁ PRA RECONSTRUIR — e o log reconstruído NÃO TEM: as linhas de
 * `transicoes()` (nível, item que apareceu no inventário, inimigo que
 * morreu/voltou, janela de objetivo, seus indicadores cruzando limiar). A Live
 * Client API não EMITE nada disso; a linha só existe na comparação entre dois
 * polls, e o disco guarda amostras a cada 15s, do jogador ativo apenas — nível
 * de inimigo e item de inimigo simplesmente não estão lá.
 *
 * QUANTO ISSO CUSTA, MEDIDO (não estimado no olho): na gravação
 * 2026-09-13T21-42-36 (43min), a reconstrução devolve 280 linhas contra ~756
 * que o log ao vivo teve — cerca de 37%. O que sobrevive é evento de API
 * (abate, dragão, barão, torre, inibidor, ace, multikill) e alerta disparado;
 * some a transição.
 *
 * POR QUE NÃO GRAVAR A TRANSIÇÃO JÁ FORMATADA pra fechar a lacuna: seria uma
 * segunda cópia do mesmo fato, que diverge da primeira assim que o formatador
 * melhorar. Preferimos 37% honesto a 100% que apodrece — e quem chama tem que
 * DIZER isso ao usuário (a página diz, em cima do log).
 *
 * Não lança: qualquer evento malformado é pulado. É chamada sob demanda por
 * rota HTTP ou no boot, nunca pelo poll.
 */
export function reconstruirLog(rec: {
  events?: { t: number; kind: string; data?: unknown }[];
} | null | undefined): { linhas: LinhaLog[]; soEventos: boolean } {
  const linhas: LinhaLog[] = [];
  try {
    for (const ev of rec?.events ?? []) {
      if (!ev || typeof ev.kind !== "string") continue;
      const t = Number.isFinite(Number(ev.t)) ? Number(ev.t) : 0;
      const d = (ev.data ?? {}) as any;
      if (ev.kind === "alerta") {
        // O recorder grava {id, level, text} — o fireId (chave de ocorrência)
        // fica de fora. Sem ele, dois "2 mortes sem trade" no mesmo jogo teriam
        // o mesmo id e o segundo sumiria na dedup. O segundo entra na chave.
        linhas.push(linhaDeAlerta(
          { id: txt(d?.id), fireId: `${txt(d?.id)}-${Math.round(t)}`, text: txt(d?.text) }, t));
      } else if (ev.kind === "leitura") {
        // "leitura" é a composição do início: contexto do recorder, não linha
        // do log — o painel de leitura da partida já mostra isso.
        continue;
      } else if (d?.EventName) {
        // Evento cru da API: mesmo caminho do ao vivo.
        linhas.push(linhaDeEvento(d, t));
      }
    }
  } catch { /* gravação corrompida: devolve o que deu, nunca lança */ }
  // Mais recente primeiro, igual ao ao vivo. Ordena por tempo porque alerta e
  // evento entram intercalados e o EventTime da API pode diferir do t do poll.
  linhas.sort((a, b) => b.t - a.t);
  // `soEventos` é sempre true hoje — existe pra que quem chama tenha que
  // ESCOLHER mostrar ou esconder o aviso, em vez de esquecer que ele existe.
  return { linhas, soEventos: true };
}

/** Uma linha pra um alerta que disparou — pro usuário ver o seu no mesmo fluxo. */
export function linhaDeAlerta(a: { id: string; fireId: string; text: string }, t: number): LinhaLog {
  return {
    id: `al-${txt(a?.fireId) || txt(a?.id)}`,
    t: Number.isFinite(t) ? t : 0,
    fonte: "alerta",
    texto: `ALERTA: ${txt(a?.text)}`,
    // Já é um alerta; oferecer "criar alerta disto" seria circular.
    alertavel: null,
  };
}

/**
 * O log em si. Acumula, deduplica e corta pelo teto.
 *
 * Classe e não módulo com estado global porque o teste precisa de instâncias
 * independentes, e porque o reset de partida fica explícito.
 */
export class EventLog {
  private linhas: LinhaLog[] = [];
  private vistas = new Set<string>();
  mem: MemoriaLog = memoriaVazia();

  /** Partida nova: zera tudo, inclusive a memória de transição. */
  reset() {
    this.linhas = [];
    this.vistas = new Set();
    this.mem = memoriaVazia();
  }

  /**
   * Acrescenta linhas, ignorando as já vistas.
   *
   * Nunca lança: se uma linha vier malformada ela é pulada, porque o chamador
   * é o poll de 1s e uma exceção aqui derrubaria o servidor em partida.
   */
  adicionar(novas: LinhaLog[]) {
    try {
      for (const l of novas ?? []) {
        if (!l || typeof l.id !== "string" || this.vistas.has(l.id)) continue;
        this.vistas.add(l.id);
        this.linhas.push(l);
      }
      if (this.linhas.length > MAX_LINHAS) {
        const cortadas = this.linhas.splice(0, this.linhas.length - MAX_LINHAS);
        // As chaves das cortadas saem junto: sem isso o Set cresceria sem
        // limite mesmo com o array limitado — vazamento silencioso.
        for (const c of cortadas) this.vistas.delete(c.id);
      }
    } catch { /* log é acessório: nunca pode derrubar o poll */ }
  }

  /** Mais recente primeiro — é assim que a página quer ler. */
  recentes(n = MAX_LINHAS): LinhaLog[] {
    return this.linhas.slice(-n).reverse();
  }

  get tamanho() { return this.linhas.length; }
}
