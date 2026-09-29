/**
 * Eventos da Live Client API -> comandos de luz para o daemon RGB.
 *
 * Função pura sobre os eventos NOVOS de cada poll (o ingame.ts já deduplica
 * por EventID). A prioridade entre efeitos mora só no daemon: aqui devolvemos
 * tudo que aconteceu no poll e ele escolhe o maior — assim kill + multikill no
 * mesmo poll não precisam de regra de colapso duplicada nas duas linguagens.
 *
 * Shutdown não existe como evento na API: é inferido pela sequência de kills
 * sem morrer da vítima (>= SHUTDOWN_MIN), contada pelos ChampionKill vistos.
 */
export type ComandoRgb = { efeito: string; params?: Record<string, unknown> };

export type ContextoRgb = {
  /** Nome do jogador como aparece nos eventos (riotIdGameName ?? summonerName). */
  eu: string;
  meuTime: string;
  /** Nomes de todo o meu time, eu incluso. */
  aliados: Set<string>;
  /** Seu campeão: o efeito de kill escreve o nome dele no teclado. */
  campeao?: string;
};

export const SHUTDOWN_MIN = 3;
/** Evento mais velho que isto (s de jogo) só atualiza estado: luz atrasada não serve. */
export const ATRASO_MAX_S = 5;

const OBJETIVOS: Record<string, string> = {
  BaronKill: "barao",
  HeraldKill: "arauto",
  HordeKill: "vastilarvas",
};

export class RgbBridge {
  private sequencia = new Map<string, number>();

  reset(): void {
    this.sequencia.clear();
  }

  /**
   * `agora` = gameTime do poll. Sem ele tudo acende; com ele, eventos antigos
   * (coach aberto no meio da partida, histórico chegando de uma vez) só
   * alimentam a contagem de sequências.
   */
  processar(eventos: any[], ctx: ContextoRgb, agora?: number): ComandoRgb[] {
    const out: ComandoRgb[] = [];
    for (const e of eventos) {
      const antes = out.length;
      const nome = String(e?.EventName ?? "");
      switch (nome) {
        case "ChampionKill": {
          const killer = String(e.KillerName ?? "");
          const vitima = String(e.VictimName ?? "");
          const seqVitima = this.sequencia.get(vitima) ?? 0;
          this.sequencia.set(vitima, 0);
          this.sequencia.set(killer, (this.sequencia.get(killer) ?? 0) + 1);
          if (killer === ctx.eu) {
            if (seqVitima >= SHUTDOWN_MIN) out.push({ efeito: "shutdown" });
            else out.push(ctx.campeao ? { efeito: "kill", params: { campeao: ctx.campeao } } : { efeito: "kill" });
          } else if (Array.isArray(e.Assisters) && e.Assisters.includes(ctx.eu)) {
            out.push({ efeito: "assist" });
          }
          break;
        }
        case "Multikill":
          if (e.KillerName === ctx.eu) {
            out.push({ efeito: "multikill", params: { n: Number(e.KillStreak) || 2 } });
          }
          break;
        case "FirstBlood":
          if (e.Recipient === ctx.eu) out.push({ efeito: "firstblood" });
          break;
        case "Ace":
          if (e.AcingTeam === ctx.meuTime) out.push({ efeito: "ace" });
          break;
        case "DragonKill":
          if (ctx.aliados.has(String(e.KillerName ?? ""))) {
            out.push({ efeito: "dragao", params: { tipo: String(e.DragonType ?? "") } });
          }
          break;
        case "GameEnd":
          out.push({ efeito: e.Result === "Win" ? "vitoria" : "derrota" });
          break;
        default:
          if (OBJETIVOS[nome] && ctx.aliados.has(String(e.KillerName ?? ""))) {
            out.push({ efeito: OBJETIVOS[nome] });
          }
      }
      if (agora !== undefined && agora - Number(e?.EventTime ?? agora) > ATRASO_MAX_S) {
        out.length = antes;
      }
    }
    return out;
  }
}
