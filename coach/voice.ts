// A unica coisa que fala. Dona da fila, do cooldown e do dedup.
//
// POR QUE ISSO SAIU DA PAGINA: hoje o navegador decide QUANDO falar (dedup
// via spokenIds/firedIds) e COMO (voz, rate, watchdog). Duas consequencias
// ruins: (1) quando o audio do Chrome trava, nada fala; (2) recarregar a
// pagina no meio da partida zera o dedup e tudo pode ser falado de novo.
//
// Aqui a fila vive tanto quanto a partida.
//
// SO GRAVACAO: se existe sounds/<chave>.*, toca a gravacao do usuario; se nao
// existe, NAO SAI SOM NENHUM -- o alerta ainda aparece na tela.
//
// (removido) havia aqui um fallback de TTS que sintetizava o `texto` quando
// faltava gravacao. Saiu de proposito: o coach so fala com a voz do proprio
// usuario. Um alerta mudo e o sinal de que falta gravar aquele som -- o painel
// de sons marca quais faltam. Nao reintroduza voz sintetica como tapa-buraco.
//
// COOLDOWN REAL: tocar() so resolve quando o som acaba, entao o intervalo
// entre falas parte da duracao verdadeira. O cooldown de 9s da versao antiga
// era um palpite sobre quanto tempo a fala levaria no Chrome.

export interface Fala {
  /** Identidade para dedup. Uma ocorrencia so e falada uma vez. */
  chave: string;
  /**
   * Nome-base da gravacao a procurar em sounds/. Separado da `chave` porque
   * a chave identifica a OCORRENCIA (ex.: "objexp-Dragao-1234") enquanto a
   * gravacao e por TIPO de alerta (ex.: "objetivo-30") -- o mesmo arquivo
   * serve varias ocorrencias. Sem `som`, nao ha gravacao a procurar.
   */
  som?: string;
  /**
   * O texto do alerta. Nao e mais falado -- serve so pro historico, que a
   * pagina mostra pra dizer QUAL alerta acabou de sair no alto-falante.
   */
  texto: string;
  /** 1 = mais importante. Num teamfight, decide quem fala. */
  prioridade?: number;
  /** Depois disto a fala perdeu o sentido. */
  expiraEm?: number;
}

// Sem campo `fonte`: com o TTS fora existe uma unica origem possivel (a
// gravacao do usuario), entao o campo seria uma constante disfarcada de dado.
export interface FalaDita {
  chave: string;
  texto: string;
  wall: number;
}

interface Deps {
  resolverSom: (chave: string) => Promise<string | null>;
  tocar: (caminho: string, volume?: number) => Promise<void>;
  cooldownMs?: number;
  maxHistorico?: number;
}

export class VoiceQueue {
  private pendentes: (Fala & { prioridade: number })[] = [];
  private vistas = new Set<string>();
  private falando = false;
  private ultimaEm = 0;
  // Encadeia todo bombear() agendado, na ordem em que foi agendado. drenar()
  // espera nisto em vez de reler pendentes.length, entao nunca larga uma
  // fala que ja saiu da fila mas ainda esta em voo (resolvendo a gravacao).
  private ciclo: Promise<void> = Promise.resolve();

  public historico: FalaDita[] = [];
  public habilitado = true;
  public volume = 1;

  private readonly cooldownMs: number;
  private readonly maxHistorico: number;

  constructor(private deps: Deps) {
    this.cooldownMs = deps.cooldownMs ?? 1500;
    this.maxHistorico = deps.maxHistorico ?? 40;
  }

  /** Enfileira. Nao espera a fala sair. */
  async falar(f: Fala) {
    if (!this.habilitado) return;
    if (this.vistas.has(f.chave)) return;
    this.vistas.add(f.chave);
    this.pendentes.push({ ...f, prioridade: f.prioridade ?? 2 });
    // O dedup nao pode crescer sem limite numa partida longa.
    if (this.vistas.size > 500) this.vistas.clear();
    this.agendar();
  }

  /** Fala tudo que der. Usado nos testes; em producao bombear() basta. */
  async drenar() {
    let antes: Promise<void> | null = null;
    // O ciclo muda de identidade a cada bombear() agendado (inclusive os
    // disparados de dentro do proprio bombear() quando ha mais na fila).
    // Comparar por identidade -- em vez de olhar so pendentes.length --
    // garante que uma fala ja tirada da fila mas ainda em voo seja esperada.
    while (antes !== this.ciclo) {
      antes = this.ciclo;
      await antes;
    }
  }

  /** Agenda o proximo bombear(), encadeado no ciclo atual. */
  private agendar() {
    this.ciclo = this.ciclo.then(
      () =>
        new Promise<void>((resolve) => {
          // Adiado (nao chamado direto): duas falar() seguidas -- ex. um
          // teamfight que gera "torre" e depois "barao" -- precisam estar
          // AMBAS na fila antes do sort por prioridade rodar. Resolver aqui
          // sincronamente faria a primeira chegada vencer, nao a mais
          // importante.
          setTimeout(() => { void this.bombear().then(resolve); }, 0);
        }),
    );
  }

  private async bombear(): Promise<void> {
    if (this.falando || !this.habilitado) return;
    if (Date.now() - this.ultimaEm < this.cooldownMs) return;

    const agora = Date.now();
    this.pendentes = this.pendentes.filter((p) => !p.expiraEm || p.expiraEm > agora);
    if (!this.pendentes.length) return;

    this.pendentes.sort((a, b) => a.prioridade - b.prioridade);
    const proxima = this.pendentes.shift()!;

    // Prioridade 1 esvazia o resto: depois de um Barao, ninguem quer ouvir
    // sobre uma torre de 20s atras.
    if (proxima.prioridade === 1) {
      this.pendentes = this.pendentes.filter((p) => p.prioridade <= 2);
    }

    this.falando = true;
    try {
      // Sem gravacao, sem som. O alerta ja esta na tela; o silencio e o aviso
      // de que aquele som ainda nao foi gravado.
      const caminho = proxima.som ? await this.deps.resolverSom(proxima.som) : null;
      if (caminho) {
        await this.deps.tocar(caminho, this.volume);
        this.historico.unshift({
          chave: proxima.chave,
          texto: proxima.texto,
          wall: Date.now(),
        });
        if (this.historico.length > this.maxHistorico) this.historico.pop();
      }
      this.ultimaEm = Date.now();
    } catch {
      // Uma fala que falha nao pode derrubar a partida.
      this.ultimaEm = Date.now();
    } finally {
      this.falando = false;
    }

    if (this.pendentes.length) this.agendar();
  }

  reset() {
    this.pendentes = [];
    this.vistas = new Set();
    this.historico = [];
    this.ultimaEm = 0;
  }

  get status() {
    return {
      habilitado: this.habilitado,
      pendentes: this.pendentes.length,
      ultima: this.historico[0] ?? null,
    };
  }
}
