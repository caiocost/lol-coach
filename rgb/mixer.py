"""Estado das luzes durante a partida: pilha de camadas e prioridade entre efeitos.

    base branca -> camada de morte (barra de loading do respawn) -> efeito ativo

A morte inteira é uma barra de loading: o teclado enche da esquerda para a
direita (e a RAM de baixo para cima) na proporção exata do tempo de morte já
cumprido, e fica cheio no instante do respawn.

Sem rede e sem OpenRGB: recebe comandos, devolve quadros. O relógio é
injetado para os testes controlarem o tempo.

Também é aqui que mora a coordenação com o "Beber Água" agendado: enquanto há
partida, o arquivo `rgb_partida.flag` fica sendo renovado; o script agendado vê
o flag, grava `rgb_agua_pendente` e sai. O mixer toca a água na próxima morte
(ou no fim da partida), quando não há efeito rodando.
"""
from __future__ import annotations

import json
import math
import os
import statistics
import tempfile
import time
from pathlib import Path

from efeitos import Efeito, ciclo, criar_efeito
from layout import BRANCO, Layout, clamp, lerp

CINZA = (20, 20, 20)     # parte vazia da barra de loading da morte: bem apagada, contraste com o branco
FADE_MORTE = 0.4
PISCA_REVIVE = 0.3      # cada uma das 3 piscadas ao nascer (branco -> apagado -> branco)
REVIVE_S = 3 * PISCA_REVIVE
CROSSFADE = 0.08
TIMEOUT_PARTIDA = 30.0
FLAG = "rgb_partida.flag"
PENDENTE = "rgb_agua_pendente"
# Tela de loading do jogo: o jogo NÃO expõe porcentagem, então a barra é estimada
# pela mediana dos últimos loadings reais (medidos aqui) e completa quando a
# partida começa de verdade (primeiro /estado).
HISTORICO_LOADING = "rgb_loading.json"
LOADING_PADRAO_S = 60.0
LOADING_MIN_S = 8.0       # mais curto que isso não foi loading de verdade (dodge, reconexão)
LOADING_MAX = 0.98        # a estimativa nunca enche sozinha: quem completa é a partida começar


class Mixer:
    def __init__(self, layout: Layout, agora=time.monotonic, pasta: str | Path | None = None):
        self.layout = layout
        self.agora = agora
        self.pasta = Path(pasta or tempfile.gettempdir())
        self.efeito: Efeito | None = None
        self.fila: list = []          # efeitos com `fila=True` esperando o atual terminar
        self.efeito_desde = 0.0
        self.anterior: tuple | None = None     # último quadro, para o crossfade
        self.ultimo: tuple | None = None
        self.em_partida = False
        self.ultimo_estado = 0.0
        self.morto = False
        self.morto_desde = 0.0
        self.revive_desde = -1e9
        self.respawn_total = 0.0      # duração da morte, fixada no momento em que ela começa
        self.carregando = False
        self.carregando_desde = 0.0
        self.carregando_teste = False
        self.loading_estimado = LOADING_PADRAO_S
        self.sujo = True

    # --- comandos -------------------------------------------------------------

    def definir_layout(self, layout: Layout) -> None:
        self.layout = layout
        self.efeito = None
        self.anterior = self.ultimo = None
        self.sujo = True

    def disparar(self, nome: str, params: dict | None = None) -> bool:
        try:
            novo = criar_efeito(nome, params, self.layout)
        except (KeyError, ValueError, TypeError):
            return False
        self._expirar()
        if novo.fila and self.efeito is not None and self.efeito.fila:
            self.fila.append(novo)
            return True
        if self.efeito is not None and novo.prioridade < self.efeito.prioridade:
            return False
        self.fila.clear()
        self.anterior = self.ultimo if self.efeito is not None else None
        self.efeito = novo
        self.efeito_desde = self.agora()
        self.sujo = True
        return True

    def disparar_lote(self, lote: list) -> bool:
        """Vários eventos no mesmo poll: só o de maior prioridade importa."""
        melhor = None
        for item in lote:
            try:
                ef = criar_efeito(item.get("efeito", ""), item.get("params"), self.layout)
            except (KeyError, ValueError, TypeError):
                continue
            if melhor is None or ef.prioridade > melhor[0]:
                melhor = (ef.prioridade, item)
        return bool(melhor) and self.disparar(melhor[1]["efeito"], melhor[1].get("params"))

    def carregar(self, ativo: bool, teste: bool = False, estimativa: float | None = None) -> None:
        """Tela de loading do jogo começou/terminou. `estimativa` só para testes."""
        agora = self.agora()
        if ativo and not self.carregando:
            self.carregando, self.carregando_desde, self.carregando_teste = True, agora, teste
            self.loading_estimado = estimativa or self._estimativa_loading()
            if not teste:
                self.partida(True)
        elif not ativo and self.carregando:
            self.carregando = False
            duracao = agora - self.carregando_desde
            if not self.carregando_teste and duracao >= LOADING_MIN_S:
                self._gravar_loading(duracao)
            self.revive_desde = agora          # completa e pisca 3x, como no respawn
        self.sujo = True

    def estado(self, morto: bool, respawn_em: float, teste: bool = False) -> None:
        agora = self.agora()
        if self.carregando and not teste:
            self.carregar(False)               # 1º dado da partida: o loading acabou
        if not teste:
            self.ultimo_estado = agora
            if not self.em_partida:
                self.partida(True)
            else:
                self._renovar_flag()
        respawn_em = float(respawn_em or 0)
        if morto and not self.morto:
            self.morto_desde = agora
            self.respawn_total = respawn_em
        elif morto:
            # o primeiro poll da morte pode vir zerado; o total é o maior já visto
            self.respawn_total = max(self.respawn_total, respawn_em + (agora - self.morto_desde))
        if not morto and self.morto:
            self.revive_desde = agora
        self.morto = bool(morto)
        self.sujo = True

    def partida(self, ativa: bool) -> None:
        self.em_partida = ativa
        if ativa:
            self.ultimo_estado = self.agora()
            self._renovar_flag()
        else:
            try:
                (self.pasta / FLAG).unlink()
            except FileNotFoundError:
                pass
            if self.morto:
                self.revive_desde = self.agora()
            self.morto = False
        self.sujo = True

    def reset(self) -> None:
        self.efeito = None
        self.fila.clear()
        self.anterior = None
        self.morto = False
        self.revive_desde = -1e9
        self.sujo = True

    # --- consulta ----------------------------------------------------------------

    def status(self) -> dict:
        self._expirar()
        return {
            "efeitoAtual": self.efeito.chave_prioridade() if self.efeito else None,
            "partida": self.em_partida,
            "morto": self.morto,
            "aguaPendente": (self.pasta / PENDENTE).exists(),
            "fila": len(self.fila),
            "carregando": self.carregando,
        }

    def precisa_desenhar(self) -> bool:
        self.tick()
        agora = self.agora()
        return (self.sujo or self.efeito is not None or self.morto or self.carregando
                or agora - self.revive_desde < REVIVE_S + 0.1)

    # --- quadro --------------------------------------------------------------------

    def tick(self) -> None:
        """Manutenção que independe de desenhar: expiração, timeout e água pendente."""
        self._expirar()
        if self.carregando and not self.carregando_teste and self.agora() - self.ultimo_estado > 1:
            # loading pode passar de 30 s sem nenhum /estado: segura o flag de partida
            self.ultimo_estado = self.agora()
            self._renovar_flag()
        if self.em_partida and self.agora() - self.ultimo_estado > TIMEOUT_PARTIDA:
            self.partida(False)
        pend = self.pasta / PENDENTE
        if self.efeito is None and (self.morto or not self.em_partida) and pend.exists():
            final = "%02X%02X%02X" % CINZA if self.morto else "FFFFFF"
            if self.disparar("agua", {"final": final}):
                try:
                    pend.unlink()
                except FileNotFoundError:
                    pass

    def quadro(self) -> tuple:
        self.tick()
        agora = self.agora()
        L = self.layout
        p = self._progresso(agora)
        x0 = min((x for x, _ in L.teclado), default=0)
        n_x = max((x for x, _ in L.teclado), default=0) - x0 + 1
        f_kb = [self._fundo(agora, p * n_x - (x - x0)) for x, _ in L.teclado]
        # RAM: LED j do pente fica em y = -0.5 - 0.5j (j=0 embaixo); 12 LEDs por pente
        n_ram = max((round((-0.5 - y) / 0.5) for _, y in L.ram), default=0) + 1
        f_ram = [self._fundo(agora, p * n_ram - round((-0.5 - y) / 0.5)) for _, y in L.ram]
        f_placa = [self._fundo(agora, 0.0)] * L.n_placa

        if self.efeito is None:
            q = (f_kb, f_ram, f_placa)
        else:
            t = agora - self.efeito_desde
            q = (self.efeito.teclado(t, f_kb), self.efeito.ram(t, f_ram), self.efeito.placa(t, f_placa))
            if self.anterior is not None and t < CROSSFADE:
                k = t / CROSSFADE
                q = tuple([lerp(a, b, k) for a, b in zip(ant, novo)] for ant, novo in zip(self.anterior, q))
        q = tuple([clamp(c) for c in cores] for cores in q)
        self.ultimo = q
        self.sujo = False
        return q

    # --- internos ------------------------------------------------------------------

    def _expirar(self) -> None:
        if self.efeito is not None and self.agora() - self.efeito_desde >= self.efeito.duracao:
            self.efeito = None
            self.anterior = None
            self.sujo = True
            if self.fila:
                self.efeito = self.fila.pop(0)
                self.efeito_desde = self.agora()

    def _progresso(self, agora: float) -> float:
        """Fração da barra: morte cumprida (0 ao morrer, 1 no respawn) ou loading estimado."""
        if self.carregando:
            el, est = agora - self.carregando_desde, self.loading_estimado
            if el < est:
                return 0.95 * el / est
            return 0.95 + (LOADING_MAX - 0.95) * (1 - math.exp(-(el - est) / 20))
        if not self.morto or self.respawn_total <= 0:
            return 0.0
        return max(0.0, min(1.0, (agora - self.morto_desde) / self.respawn_total))

    def _fundo(self, agora: float, enchido: float):
        """`enchido` = quanto deste LED a barra já cobriu (<=0 nada, >=1 inteiro)."""
        if not self.morto and not self.carregando:
            u = agora - self.revive_desde
            if u >= REVIVE_S:
                return BRANCO
            return lerp(BRANCO, CINZA, ciclo((u % PISCA_REVIVE) / PISCA_REVIVE))   # nasceu: 3 piscadas
        desde = self.carregando_desde if self.carregando else self.morto_desde
        cor = lerp(BRANCO, CINZA, (agora - desde) / FADE_MORTE)
        return lerp(cor, BRANCO, max(0.0, min(1.0, enchido)))

    def _historico_loading(self) -> list:
        try:
            h = json.loads((self.pasta / HISTORICO_LOADING).read_text())
            return [float(x) for x in h if isinstance(x, (int, float)) and x > 0]
        except (OSError, ValueError):
            return []

    def _estimativa_loading(self) -> float:
        h = self._historico_loading()
        return statistics.median(h) if h else LOADING_PADRAO_S

    def _gravar_loading(self, duracao: float) -> None:
        h = (self._historico_loading() + [round(duracao, 1)])[-10:]
        try:
            (self.pasta / HISTORICO_LOADING).write_text(json.dumps(h))
        except OSError:
            pass

    def _renovar_flag(self) -> None:
        flag = self.pasta / FLAG
        try:
            if flag.exists():
                os.utime(flag)
            else:
                flag.write_text(str(os.getpid()))
        except OSError:
            pass
