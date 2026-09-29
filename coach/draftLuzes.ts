/**
 * Picks travados no champ select -> nome do campeão escrito no teclado.
 *
 * Lê `session.actions` da LCU (fases de ações; cada uma { id, actorCellId,
 * championId, type, completed }). Só pick COMPLETO acende: hover e ban não.
 * A primeira leitura de um draft só memoriza o que já estava travado — coach
 * aberto no meio do draft não despeja cinco nomes de uma vez.
 */
import type { ComandoRgb } from "./rgbBridge.js";

export type LadoPick = "eu" | "aliado" | "inimigo";

export class DraftLuzes {
  private vistos = new Set<number>();
  private primeira = true;

  reset(): void {
    this.vistos.clear();
    this.primeira = true;
  }

  processar(session: any, champById: Record<number, string>): ComandoRgb[] {
    const meus = new Set<number>((session?.myTeam ?? []).map((p: any) => p.cellId));
    const eu = session?.localPlayerCellId;
    const out: ComandoRgb[] = [];
    for (const a of (session?.actions ?? []).flat()) {
      if (!a || a.type !== "pick" || !a.completed || this.vistos.has(a.id)) continue;
      this.vistos.add(a.id);
      const nome = champById[a.championId];
      if (this.primeira || !nome) continue;
      const lado: LadoPick = a.actorCellId === eu ? "eu" : meus.has(a.actorCellId) ? "aliado" : "inimigo";
      out.push({ efeito: "campeao", params: { nome, lado } });
    }
    this.primeira = false;
    return out;
  }
}

/**
 * Tela de loading do jogo pela fase da LCU. O jogo não expõe porcentagem: o
 * daemon estima a barra pelos loadings anteriores e completa quando chega o
 * primeiro dado da partida (o /estado do in-game). Aqui só o início e o fim.
 *
 * `anterior` null = primeira leitura (coach aberto agora): não dá para saber
 * se é loading ou partida em andamento, então não liga a barra.
 */
export function transicaoLoading(anterior: string | null, atual: string): "inicio" | "fim" | null {
  if (atual === "InProgress" && anterior !== null && anterior !== "InProgress") return "inicio";
  if (anterior === "InProgress" && atual !== "InProgress") return "fim";
  return null;
}
