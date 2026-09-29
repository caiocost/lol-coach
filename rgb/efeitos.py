"""Catálogo de animações RGB do coach (ver spec 2026-09-28-luzes-rgb-coach-design).

Contrato de um efeito: `duracao`, `prioridade` e três métodos que recebem as
cores de FUNDO de cada LED (branco, ou cinza quando o jogador está morto) e
devolvem as cores do quadro:

    teclado(t, fundos) / ram(t, fundos) / placa(t, fundos)

A maioria dos efeitos só implementa `ponto(t, x, y, fundo)` — uma função do
plano 2D — e opcionalmente `tecla(t, idx, cor)` para escrever letras. Todo
efeito termina exatamente no fundo, então a troca para a camada de baixo não
tem salto.
"""
from __future__ import annotations

import math

from layout import (BRANCO, PLACA_POS, PRETO, Cor, Layout, add, anel, brighter,
                    escala, hex_rgb, lerp, normalize, smooth)

VERMELHO = hex_rgb("FF0000")
VERMELHO_ESCURO = hex_rgb("8B0000")
VERMELHO_QUENTE = hex_rgb("FF3030")
ROSA = hex_rgb("FF8080")
DOURADO = hex_rgb("FFB000")
ROXO_BARAO = hex_rgb("8000FF")
ROXO_CLARO = hex_rgb("C080FF")

# LED não mostra marrom (vira laranja fraco): a montanha usa âmbar-amarelo para
# não se confundir com o infernal, e o padrão (tremor) ajuda a separar.
CORES_DRAGAO = {
    "Fire": hex_rgb("FF3000"), "Water": hex_rgb("0060FF"), "Earth": hex_rgb("FFC800"),
    "Air": hex_rgb("C8E6FF"), "Hextech": hex_rgb("00E5FF"), "Chemtech": hex_rgb("40FF40"),
    "Elder": hex_rgb("A000FF"),
}

# Maior ganha. Efeito novo com prioridade >= ao ativo o substitui; menor é descartado.
PRIORIDADE = {
    "multikill5": 100, "multikill4": 90, "vitoria": 85, "derrota": 85, "multikill3": 80,
    "ace": 70, "barao": 65, "multikill2": 60, "shutdown": 55, "firstblood": 52, "kill": 50,
    "dragao": 40, "arauto": 35, "vastilarvas": 35, "agua": 30, "campeao": 25, "assist": 20,
}


class Efeito:
    nome = ""
    duracao = 1.0
    fila = False   # True: outro efeito igual espera este terminar em vez de cortá-lo

    def __init__(self, layout: Layout, params: dict | None = None):
        self.L = layout
        self.params = params or {}
        self.prioridade = PRIORIDADE[self.chave_prioridade()]

    def chave_prioridade(self) -> str:
        return self.nome

    # --- a sobrescrever ---
    def ponto(self, t: float, x: float, y: float, fundo: Cor) -> Cor:
        return fundo

    def tecla(self, t: float, idx: int, cor: Cor) -> Cor:
        return cor

    def placa_ponto(self, t: float, fundo: Cor) -> Cor:
        return self.ponto(t, *PLACA_POS, fundo)

    # --- quadro por dispositivo ---
    def teclado(self, t: float, fundos: list) -> list:
        return [self.tecla(t, i, self.ponto(t, x, y, f))
                for i, ((x, y), f) in enumerate(zip(self.L.teclado, fundos))]

    def ram(self, t: float, fundos: list) -> list:
        return [self.ponto(t, x, y, f) for (x, y), f in zip(self.L.ram, fundos)]

    def placa(self, t: float, fundos: list) -> list:
        return [self.placa_ponto(t, f) for f in fundos]


def sobre(fundo: Cor, cor: Cor, k: float) -> Cor:
    return lerp(fundo, cor, min(1.0, max(0.0, k)))


# --- kills: um roteiro, vários níveis -------------------------------------------------
#
# Todo kill segue o roteiro aprovado pelo usuário em 28/09 a partir do kill
# normal: intro -> tsunami -> palavras (cada uma entra letra a letra e apaga)
# -> piscada -> final. Cada nível só troca as peças por versões mais intensas.

ONDA_LETRA = (255, 190, 190)


def ciclo(u: float) -> float:
    """0 -> 1 -> 0 ao longo de u em [0, 1]."""
    return 0.5 - 0.5 * math.cos(2 * math.pi * u)


def batida(u: float) -> float:
    """Batida de coração (tum-tum) ao longo de u em [0, 1]."""
    return max(math.exp(-((u - 0.15) / 0.06) ** 2), 0.7 * math.exp(-((u - 0.38) / 0.06) ** 2))


class Roteiro(Efeito):
    PALAVRAS = ["KILL"]
    INTRO = "apagao"            # apagao | coracao
    TSUNAMI_ESTILO = "lateral"  # lateral | duplo | mare | triplo
    TSUNAMI_S = 1.2
    FUNDO = "mar"               # mar | redemoinho
    LETRA_EXTRA = None          # None | onda | batida | choque
    DT = 0.22                   # entre letras
    FADE_LETRA = 0.3            # vermelho -> cor da letra
    SEGURA = 0.35               # palavra inteira acesa
    APAGA_S = 0.3               # palavra apagando
    PAUSA = 0.15                # entre uma palavra apagar e a próxima começar
    PISCA_MODO = "letras"       # letras | negativo | strobe
    PISCA_N, PISCA_S, PISCA_ACELERA = 3, 0.4, 1.0
    PISCA_TUDO = False          # RAM e placa piscam junto
    FINAL = "fade"              # fade | estouro | chuva
    SAIDA_S = 0.8
    COR_ESPUMA = BRANCO
    COR_LETRA = BRANCO
    COR_MAR_ESCURO = VERMELHO_ESCURO
    COR_MAR = VERMELHO

    def __init__(self, layout, params=None):
        super().__init__(layout, params)
        self.intro_fim = 1.2 if self.INTRO == "coracao" else 0.3
        self.TSUNAMI = self.intro_fim + self.TSUNAMI_S

        self.palavras: list = []      # [({idx: t_on}, t_fim)] — t_fim = início do apagar
        self.acende: dict = {}        # idx -> primeira vez que a tecla acende
        t = self.TSUNAMI + 0.1
        for palavra in self.PALAVRAS:
            on: dict = {}
            for k, ch in enumerate(normalize(palavra)):
                idx = layout.teclas.get(ch)
                if idx is not None:
                    on.setdefault(idx, t + k * self.DT)   # letra repetida: a tecla já está acesa
                    self.acende.setdefault(idx, on[idx])
            fim = t + (len(palavra) - 1) * self.DT + self.FADE_LETRA + self.SEGURA
            self.palavras.append((on, fim))
            t = fim + self.APAGA_S + self.PAUSA
        self.palavra_fim = [fim for _, fim in self.palavras]
        self.teclas_frase = set(self.acende)
        self.instantes = sorted(on for m, _ in self.palavras for on in m.values())
        self.letra_pos = [(on, *layout.teclado[idx]) for m, _ in self.palavras for idx, on in m.items()]

        self.piscadas: list = []      # [(início, duração)]
        d = self.PISCA_S
        for _ in range(self.PISCA_N):
            self.piscadas.append((t, d))
            t += d
            d *= self.PISCA_ACELERA
        self.pisca_inicio = self.piscadas[0][0]
        self.pisca_fim = t

        self.saida_ini = self.pisca_fim + (0.4 if self.FINAL == "estouro" else 0.0)
        self.duracao = self.saida_ini + self.SAIDA_S

    # --- peças do roteiro ---------------------------------------------------------------

    def mar(self, t, x, y):
        w = 0.5 + 0.5 * math.sin(x * 0.6 + y * 0.4 - t * 5)
        return lerp(self.COR_MAR_ESCURO, self.COR_MAR, 0.4 + 0.6 * w)

    def intro(self, t, x, y, fundo):
        if t < 0.1 or self.INTRO == "apagao":
            return sobre(fundo, PRETO, t / 0.1)
        u = ((t - 0.1) / ((self.intro_fim - 0.1) / 2)) % 1.0   # duas batidas
        return lerp(PRETO, VERMELHO_ESCURO, batida(u))

    def espuma(self, t, x, y, frente):
        return lerp(self.mar(t, x, y), self.COR_ESPUMA, math.exp(-((x - frente) / 0.9) ** 2))

    def tsunami(self, t, x, y):
        u = (t - self.intro_fim) / self.TSUNAMI_S
        atraso = max(0.0, -y) * 0.8   # a RAM (y<0) é atingida depois das teclas da mesma coluna
        estilo = self.TSUNAMI_ESTILO
        if estilo == "duplo":
            s = smooth(0, 1, u)
            esq = -4 + 15.5 * s - atraso
            dir_ = 26 - 14.5 * s + atraso
            if esq + 1.2 < x < dir_ - 1.2:
                return PRETO
            c = self.espuma(t, x, y, esq if abs(x - esq) < abs(x - dir_) else dir_)
            choque = smooth(0.8, 1.0, u) * math.exp(-((x - 11) / 2.5) ** 2)
            return lerp(c, self.COR_ESPUMA, choque)
        if estilo == "mare":
            nivel = 6.5 + (-7.0 - 6.5) * smooth(0, 1, u) + 0.4 * math.sin(x * 0.8 + t * 8)
            if y < nivel - 0.6:
                return PRETO
            return lerp(self.mar(t, x, y), self.COR_ESPUMA, math.exp(-((y - nivel) / 0.6) ** 2))
        if estilo == "triplo":
            frentes = [-4 + 32 * smooth(0, 1, (u * self.TSUNAMI_S - k * 0.7) / 1.0) - atraso for k in range(3)]
            if x > frentes[0] + 1.2:
                return PRETO
            c = self.mar(t, x, y)
            for f in frentes:
                c = lerp(c, self.COR_ESPUMA, math.exp(-((x - f) / 0.9) ** 2))
            return c
        f = -4 + 32 * smooth(0, 1, u) - atraso
        if x > f + 1.2:
            return PRETO
        return self.espuma(t, x, y, f)

    def fundo_letras(self, t, x, y):
        if self.FUNDO == "redemoinho":
            tl = t - self.TSUNAMI
            fase = 2 * math.pi * (0.5 * tl + 0.12 * tl * tl)
            cx, cy = self.L.centro
            if y < 0:   # RAM pulsa no ritmo do giro
                k = 0.5 + 0.5 * math.sin(fase * 3)
            else:
                dx, dy = x - cx, (y - cy) * 2.2
                k = (0.5 + 0.5 * math.cos(3 * math.atan2(dy, dx) - fase + math.hypot(dx, dy) * 0.35)) ** 3
            c = lerp(VERMELHO_ESCURO, VERMELHO_QUENTE, k)
        else:
            c = self.mar(t, x, y)
        if self.LETRA_EXTRA == "batida":
            c = escala(c, 0.55 + 0.45 * batida(((t - self.TSUNAMI) / 0.8) % 1.0))
        return c

    def ondas(self, t, x, y, c):
        if self.LETRA_EXTRA == "onda":
            vel, vida, amp, cor = 12.0, 1.0, 0.7, ONDA_LETRA
        elif self.LETRA_EXTRA == "choque":
            vel, vida, amp, cor = 16.0, 1.2, 0.9, BRANCO
        else:
            return c
        k = 0.0
        for t_on, ox, oy in self.letra_pos:
            idade = t - t_on
            if 0 <= idade < vida:
                d = math.hypot(x - ox, (y - oy) * 1.2)
                k = max(k, anel(d, idade * vel, 1.0) * (1 - idade / vida) ** 1.3 * amp)
        return lerp(c, cor, k)

    def piscada(self, t) -> float:
        for ini, dur in self.piscadas:
            if ini <= t < ini + dur:
                return ciclo((t - ini) / dur)
        return 0.0

    def final(self, t, x, y, c, fundo):
        if self.FINAL == "estouro" and t < self.saida_ini:
            u = t - self.pisca_fim
            if u < 0.15:
                return BRANCO
            c = lerp(BRANCO, VERMELHO, (u - 0.15) / 0.25)
        if self.FINAL == "chuva":
            nivel = -7 + 15 * smooth(self.saida_ini, self.duracao, t) + 0.9 * math.sin(x * 1.9 + 1.3)
            return sobre(fundo, c, smooth(nivel - 0.4, nivel + 0.4, y))
        if t >= self.saida_ini:
            return sobre(fundo, c, 1 - smooth(self.saida_ini, self.duracao, t))
        return c

    # --- composição ------------------------------------------------------------------

    def ponto(self, t, x, y, fundo):
        if t < self.intro_fim:
            return self.intro(t, x, y, fundo)
        if t < self.TSUNAMI:
            c = self.tsunami(t, x, y)
        else:
            c = self.ondas(t, x, y, self.fundo_letras(t, x, y))
        if self.pisca_inicio <= t < self.pisca_fim:
            b = self.piscada(t)
            if self.PISCA_MODO == "strobe" or (self.PISCA_MODO == "negativo" and y >= 0) \
                    or (self.PISCA_TUDO and y < 0):
                c = lerp(c, BRANCO, b)
        elif t >= self.pisca_fim:
            c = self.final(t, x, y, c, fundo)
        return c

    def nivel_letra(self, t, idx) -> float:
        k = 0.0
        for on, fim in self.palavras:
            t_on = on.get(idx)
            if t_on is not None and t_on <= t <= fim + self.APAGA_S:
                k = max(k, smooth(t_on, t_on + self.FADE_LETRA, t) * (1 - smooth(fim, fim + self.APAGA_S, t)))
        return k

    def tecla(self, t, idx, cor):
        if self.pisca_inicio <= t < self.pisca_fim:
            if idx not in self.teclas_frase:
                return cor
            b = self.piscada(t)
            if self.PISCA_MODO == "negativo":
                return lerp(self.COR_LETRA, VERMELHO, b)
            if self.PISCA_MODO == "strobe":
                return self.COR_LETRA
            return lerp(cor, self.COR_LETRA, b)
        return lerp(cor, self.COR_LETRA, self.nivel_letra(t, idx))

    def placa_ponto(self, t, fundo):
        c = self.ponto(t, *PLACA_POS, fundo)
        if self.TSUNAMI <= t < self.pisca_inicio:
            flash = max((max(0.0, 1 - (t - t0) / 0.25) for t0 in self.instantes if t >= t0), default=0.0)
            c = lerp(c, self.COR_LETRA, flash)
        return c


class Kill(Roteiro):
    """Base: tsunami vermelho, <SEU CAMPEÃO> apaga, KILL apaga, as duas piscam 3x,
    fade. Sem `campeao` nos params, escreve só KILL. Nome composto usa a
    primeira palavra ("Miss Fortune" -> MISS): duas palavras antes do KILL
    deixariam o efeito longo demais para um abate comum."""
    nome = "kill"

    def __init__(self, layout, params=None):
        palavras = str((params or {}).get("campeao", "")).split()
        nome = normalize(palavras[0]) if palavras else ""
        self.PALAVRAS = [nome, "KILL"] if nome else ["KILL"]
        super().__init__(layout, params)


class Double(Roteiro):
    """Dois tsunamis se chocando no meio; piscada 4x mais rápida com RAM e placa."""
    nome = "multikill"
    PALAVRAS = ["DOUBLE", "KILL"]
    TSUNAMI_ESTILO = "duplo"
    PISCA_N, PISCA_S = 4, 0.32
    PISCA_TUDO = True

    def chave_prioridade(self):
        return "multikill2"


class Triple(Roteiro):
    """Maré sobe até o topo da RAM; cada letra solta uma onda; piscada 5x em negativo."""
    nome = "multikill"
    PALAVRAS = ["TRIPLE", "KILL"]
    TSUNAMI_ESTILO = "mare"
    TSUNAMI_S = 1.4
    LETRA_EXTRA = "onda"
    PISCA_MODO = "negativo"
    PISCA_N, PISCA_S = 5, 0.34
    PISCA_TUDO = True

    def chave_prioridade(self):
        return "multikill3"


class Quadra(Roteiro):
    """Tsunami e redemoinho por baixo das letras, em batida de coração; 6 piscadas
    acelerando e um estouro branco -> vermelho no fim."""
    nome = "multikill"
    PALAVRAS = ["QUADRA", "KILL"]
    FUNDO = "redemoinho"
    LETRA_EXTRA = "batida"
    PISCA_N, PISCA_S, PISCA_ACELERA = 6, 0.45, 0.82
    PISCA_TUDO = True
    FINAL = "estouro"

    def chave_prioridade(self):
        return "multikill4"


class Penta(Roteiro):
    """O show: apagão com batida, 3 tsunamis, onda de choque por letra, strobe
    acelerando em tudo e o vermelho escorrendo como chuva."""
    nome = "multikill"
    PALAVRAS = ["PENTA", "KILL"]
    INTRO = "coracao"
    TSUNAMI_ESTILO = "triplo"
    TSUNAMI_S = 2.4
    LETRA_EXTRA = "choque"
    DT, SEGURA = 0.26, 0.5
    PISCA_MODO = "strobe"
    PISCA_N, PISCA_S, PISCA_ACELERA = 8, 0.36, 0.86
    FINAL = "chuva"
    SAIDA_S = 1.6

    def chave_prioridade(self):
        return "multikill5"


class FirstBlood(Roteiro):
    nome = "firstblood"
    PALAVRAS = ["FIRST", "BLOOD"]


class Shutdown(Roteiro):
    """Tsunami dourado e SHUT DOWN em dourado sobre o vermelho (o ouro da recompensa)."""
    nome = "shutdown"
    PALAVRAS = ["SHUT", "DOWN"]
    COR_ESPUMA = DOURADO
    COR_LETRA = DOURADO


class Ace(Roteiro):
    nome = "ace"
    PALAVRAS = ["ACE"]


# --- outros eventos --------------------------------------------------------------

class Assist(Efeito):
    """Assistência em três tempos (~1,9 s, curto: suporte dá muita assistência):
    1. corrente vermelha/branca dispara do Q e fisga (impacto na ponta);
    2. puxa o alvo (bola brilhante) de volta até o Q;
    3. chegada: onda de choque + flash na RAM, e chuva de moedas de ouro."""
    nome = "assist"
    FISGA = 0.3           # ponta chega no alcance máximo e fisga
    CHEGA = 0.75          # alvo puxado chegou no Q
    OURO = (0.85, 1.85)   # chuva de moedas
    ALCANCE = 16.0        # teclas à direita do Q
    duracao = 1.9
    # moedas: (coluna, atraso) — espalhadas e defasadas, caindo a 9 linhas/s
    MOEDAS = [(2, 0.0), (5, 0.08), (8, 0.16), (11, 0.04), (14, 0.12),
              (17, 0.2), (20, 0.28), (4, 0.32), (13, 0.24), (19, 0.36)]
    QUEDA = 9.0

    def __init__(self, layout, params=None):
        super().__init__(layout, params)
        self.q = layout.pos_tecla("Q", (1, 2))

    def ponta(self, t) -> float:
        if t < self.FISGA:
            return self.q[0] + self.ALCANCE * (1 - (1 - t / self.FISGA) ** 2)   # dispara e freia
        return self.q[0] + self.ALCANCE * (1 - smooth(self.FISGA, self.CHEGA, t))

    def moedas(self, t) -> dict:
        """(coluna, linha) -> intensidade das moedas visíveis neste instante."""
        a, b = self.OURO
        if not (a <= t < b):
            return {}
        some = 1 - smooth(b - 0.15, b, t)
        out = {}
        for col, atraso in self.MOEDAS:
            y = -0.5 + self.QUEDA * (t - a - atraso)
            if 0 <= y <= 5.5:
                out[(col, round(y))] = some
                if round(y) - 1 >= 0:
                    out.setdefault((col, round(y) - 1), 0.4 * some)   # rastro
        return out

    def ponto(self, t, x, y, fundo):
        if t < self.CHEGA:
            if abs(y - self.q[1]) > 0.5 or x < self.q[0]:
                return fundo
            p = self.ponta(t)
            # impacto ao fisgar: anel vermelho em volta da ponta, miolo branco
            if self.FISGA <= t < self.FISGA + 0.15:
                idade = t - self.FISGA
                if abs(x - p) < 0.5:
                    return BRANCO
                k = anel(abs(x - p), idade * 12, 0.8) * (1 - idade / 0.15)
                if k > 0.05 and x > p:
                    return sobre(fundo, VERMELHO_QUENTE, k)
            if x > p + 0.5:
                return fundo
            if t >= self.FISGA and abs(x - p) < 1.0:
                return lerp((255, 60, 60), BRANCO, 1 - abs(x - p))     # alvo fisgado sendo puxado
            return VERMELHO if int(round(x - self.q[0])) % 2 == 0 else BRANCO   # elos da corrente
        idade = t - self.CHEGA
        d = math.hypot(x - self.q[0], (y - self.q[1]) * 1.2)
        k = max(anel(d, idade * 30, 1.6) * max(0.0, 1 - idade / 0.7),
                0.35 * max(0.0, 1 - idade / 0.35))
        c = sobre(fundo, lerp(VERMELHO, ROSA, min(1.0, d / 12)), k)
        return c

    def teclado(self, t, fundos):
        out = super().teclado(t, fundos)
        moedas = self.moedas(t)
        if moedas:
            for i, (x, y) in enumerate(self.L.teclado):
                k = moedas.get((round(x), round(y)))
                if k:
                    out[i] = lerp(out[i], DOURADO, k)
        return out

    def placa_ponto(self, t, fundo):
        if t < self.CHEGA:
            return fundo
        a, b = self.OURO
        ouro = 0.8 * (1 - smooth(a, b, t)) if t >= a else 0.0
        flash = max(0.0, 1 - (t - self.CHEGA) / 0.3)
        return sobre(sobre(fundo, DOURADO, ouro), VERMELHO, flash)


class Dragao(Efeito):
    """Dragão em pixel art no teclado (23x6): entra voando pela esquerda, paira
    batendo as asas, solta um sopro na cor do tipo e sai pela direita. Fundo
    escuro para a cor do tipo aparecer; RAM e placa pulsam no ritmo das asas."""
    nome = "dragao"
    # '#' corpo, 'o' olho. Cabeça à direita, cauda à esquerda.
    ASAS_CIMA = [
        ".....#.........#.......",
        "......##......##.......",
        ".......###..###.....#o.",
        "#.......######.....###.",
        ".##....############....",
        "...####..#...#.........",
    ]
    ASAS_BAIXO = [
        ".......................",
        ".......................",
        "....................#o.",
        "#.......######.....###.",
        ".##....############....",
        "...####.###...###......",
    ]
    OLHO = (2, 21)                 # (linha, coluna) no sprite
    ENTRA = (0.3, 1.3)
    PAIRA = (1.3, 2.6)
    SOPRO = (1.8, 2.6)
    SAI = (2.6, 3.3)
    PAIRA_OX = -3                  # recuado para sobrar espaço ao sopro à direita da boca
    BATIDA_ASA = 0.2
    duracao = 3.7

    def __init__(self, layout, params=None):
        super().__init__(layout, params)
        self.tipo = str(self.params.get("tipo", ""))
        self.cor = CORES_DRAGAO.get(self.tipo, CORES_DRAGAO["Fire"])
        self.escuro = escala(self.cor, 0.1)

    def deslocamento(self, t) -> int:
        if t < self.PAIRA[0]:
            return round(-23 + (self.PAIRA_OX + 23) * smooth(*self.ENTRA, t))
        if t < self.SAI[0]:
            if self.tipo == "Earth":   # tremor de terremoto
                return self.PAIRA_OX + round(math.sin(t * 55))
            return self.PAIRA_OX
        return round(self.PAIRA_OX + (23 - self.PAIRA_OX) * smooth(*self.SAI, t))

    def asas_cima(self, t) -> bool:
        return int(t / self.BATIDA_ASA) % 2 == 0

    def envelope(self, t) -> float:
        return smooth(0, 0.3, t) * (1 - smooth(self.SAI[1], self.duracao, t))

    def cor_corpo(self, t, x, y):
        if self.tipo == "Fire":   # chama tremulando
            return lerp(self.cor, (255, 190, 0), 0.5 + 0.5 * math.sin(x * 2.1 + y * 1.3 + t * 17))
        return self.cor

    def sopro(self, t, x, y, ox) -> float:
        a, b = self.SOPRO
        boca = ox + 22           # coluna logo à direita da cabeça
        if not (a <= t < b) or x < boca or not (2 <= y <= 4):
            return 0.0
        alcance = boca + (23 - boca) * smooth(a, a + 0.25, t)
        if x > alcance:
            return 0.0
        chama = 0.7 + 0.3 * math.sin(x * 3.1 + y * 2.3 + t * 30)
        return chama * (1 - smooth(b - 0.2, b, t)) * (1.0 if y == 3 else 0.6)

    def teclado(self, t, fundos):
        ox = self.deslocamento(t)
        sprite = self.ASAS_CIMA if self.asas_cima(t) else self.ASAS_BAIXO
        env = self.envelope(t)
        out = []
        for (x, y), f in zip(self.L.teclado, fundos):
            col, lin = round(x) - ox, round(y)
            px = sprite[lin][col] if 0 <= lin < 6 and 0 <= col < 23 else "."
            if px == "o":
                c = BRANCO
            elif px == "#":
                c = self.cor_corpo(t, x, y)
            else:
                c = lerp(self.escuro, lerp(self.cor, BRANCO, 0.4), self.sopro(t, round(x), lin, ox))
            out.append(sobre(f, c, env))
        return out

    def ponto(self, t, x, y, fundo):
        # RAM e placa: pulsam com as asas, acendem forte no sopro
        k = 0.25 + (0.45 if self.asas_cima(t) else 0.0)
        if self.SOPRO[0] <= t < self.SOPRO[1]:
            k = 1.0
        return sobre(fundo, lerp(self.escuro, self.cor, k), self.envelope(t))


class Barao(Efeito):
    """Barão Nashor de frente em pixel art: sobe do fosso, encara, abre a boca e
    ruge (onda de choque pelo teclado, RAM e placa), fecha e afunda de volta."""
    nome = "barao"
    # '#' corpo, 'o' olho, 'w' dente, 'm' dentro da boca
    BOCA_FECHADA = [
        ".....##.........##.....",
        "......####...####......",
        ".....#############.....",
        "....##o####.####o##....",
        "....###############....",
        ".....#############.....",
    ]
    BOCA_ABERTA = [
        ".....##.........##.....",
        "......####...####......",
        ".....#############.....",
        "....##o####.####o##....",
        "....##wmwmwmwmwmwm##...",
        ".....#mwmwmwmwmwm#.....",
    ]
    OLHOS = [(3, 6), (3, 16)]
    SOBE = (0.3, 1.3)
    ENCARA = (1.3, 1.8)
    RUGE = (1.8, 3.0)
    AFUNDA = (3.0, 3.5)
    duracao = 3.9
    BOCA = (11.0, 4.5)
    OLHO_COR = hex_rgb("FFE000")

    def __init__(self, layout, params=None):
        super().__init__(layout, params)
        self.escuro = escala(ROXO_BARAO, 0.1)

    def deslocamento(self, t) -> int:
        """Quantas linhas o sprite está abaixo da posição final (6 = dentro do fosso)."""
        if t < self.ENCARA[0]:
            return round(6 - 6 * smooth(*self.SOBE, t))
        if t < self.AFUNDA[0]:
            return 0
        return round(6 * smooth(*self.AFUNDA, t))

    def rugindo(self, t) -> bool:
        return self.RUGE[0] <= t < self.RUGE[1]

    def envelope(self, t) -> float:
        return smooth(0, 0.3, t) * (1 - smooth(self.AFUNDA[1], self.duracao, t))

    def choque(self, t, x, y) -> float:
        if not self.rugindo(t):
            return 0.0
        k = 0.0
        for t0 in (0.0, 0.4, 0.8):
            idade = t - self.RUGE[0] - t0
            if 0 <= idade < 1.0:
                d = math.hypot(x - self.BOCA[0], (y - self.BOCA[1]) * 1.2)
                k = max(k, anel(d, idade * 14, 1.3) * (1 - idade))
        return k

    def teclado(self, t, fundos):
        oy = self.deslocamento(t)
        sprite = self.BOCA_ABERTA if self.rugindo(t) else self.BOCA_FECHADA
        env = self.envelope(t)
        pulso = 0.5 + 0.5 * math.sin(t * 25)
        out = []
        for (x, y), f in zip(self.L.teclado, fundos):
            col, lin = round(x), round(y) - oy
            px = sprite[lin][col] if 0 <= lin < 6 and 0 <= col < 23 else "."
            if px == "w":
                c = BRANCO
            elif px == "o":
                c = lerp(self.OLHO_COR, BRANCO, 0.5 * pulso) if self.rugindo(t) else self.OLHO_COR
            elif px == "m":
                c = lerp((120, 0, 120), (255, 60, 255), pulso)
            elif px == "#":
                c = lerp(ROXO_BARAO, (80, 0, 180), lin / 5)      # sombra para baixo
            else:
                c = lerp(self.escuro, ROXO_CLARO, self.choque(t, x, y))
            out.append(sobre(f, c, env))
        return out

    def ponto(self, t, x, y, fundo):
        # RAM e placa: acendem conforme ele sobe e explodem no rugido
        if self.rugindo(t):
            k = 0.8 + 0.2 * math.sin(t * 25)
        else:
            k = 0.35 * (1 - self.deslocamento(t) / 6)
        c = lerp(self.escuro, ROXO_BARAO, k)
        c = lerp(c, ROXO_CLARO, self.choque(t, x, y))
        return sobre(fundo, c, self.envelope(t))


class Arauto(Efeito):
    """Arauto do Vale de frente: se materializa de olho fechado, abre o olho, a
    pupila olha para os lados e ele dá a investida (treme + onda de choque)."""
    nome = "arauto"
    # '#' corpo, 'e' olho (pálpebra quando fechado; branco com pupila quando aberto)
    SPRITE = [
        "......#...........#....",
        ".....###.........###...",
        "......####.###.####....",
        ".......###eeeee###.....",
        "........##eeeee##......",
        ".......#.#.....#.#.....",
    ]
    MATERIALIZA = (0.3, 0.9)
    ABRE = (0.9, 1.2)
    OLHA = (1.2, 2.0)
    INVESTE = (2.0, 2.6)
    duracao = 3.1
    CORPO = (150, 60, 255)
    PALPEBRA = (90, 30, 170)
    PUPILA = (40, 0, 60)
    CENTRO_OLHO = (12.0, 3.5)

    def __init__(self, layout, params=None):
        super().__init__(layout, params)
        self.escuro = escala(self.CORPO, 0.08)

    def pupila(self, t) -> int:
        a, b = self.OLHA
        if not (a <= t < b):
            return 12
        return 12 + round(2 * math.sin(2 * math.pi * (t - a) / (b - a)))

    def tremor(self, t) -> int:
        a, b = self.INVESTE
        return round(math.sin(t * 60)) if a <= t < b else 0

    def envelope(self, t) -> float:
        return smooth(0, 0.3, t) * (1 - smooth(self.INVESTE[1], self.duracao, t))

    def choque(self, t, x, y) -> float:
        idade = t - self.INVESTE[0]
        if not (0 <= idade < 0.9):
            return 0.0
        d = math.hypot(x - self.CENTRO_OLHO[0], (y - self.CENTRO_OLHO[1]) * 1.2)
        return anel(d, idade * 16, 1.4) * (1 - idade / 0.9)

    def teclado(self, t, fundos):
        dx = self.tremor(t)
        visivel = smooth(*self.MATERIALIZA, t)
        abertura = smooth(*self.ABRE, t)
        pup = self.pupila(t)
        env = self.envelope(t)
        out = []
        for (x, y), f in zip(self.L.teclado, fundos):
            col, lin = round(x) - dx, round(y)
            px = self.SPRITE[lin][col] if 0 <= lin < 6 and 0 <= col < 23 else "."
            fundo_cena = lerp(self.escuro, ROXO_CLARO, self.choque(t, x, y))
            if px == "#":
                c = lerp(fundo_cena, self.CORPO, visivel)
            elif px == "e":
                olho = self.PUPILA if col == pup else BRANCO
                if self.INVESTE[0] <= t and col != pup:
                    olho = lerp(BRANCO, (255, 80, 200), 0.5)          # olho injetado na investida
                c = lerp(fundo_cena, lerp(self.PALPEBRA, olho, abertura), visivel)
            else:
                c = fundo_cena
            out.append(sobre(f, c, env))
        return out

    def ponto(self, t, x, y, fundo):
        k = 0.25 * smooth(*self.MATERIALIZA, t)
        if self.INVESTE[0] <= t < self.INVESTE[1]:
            k = 1.0
        c = lerp(lerp(self.escuro, self.CORPO, k), ROXO_CLARO, self.choque(t, x, y))
        return sobre(fundo, c, self.envelope(t))


class Vastilarvas(Efeito):
    """Três larvas do Vazio rastejam pelo teclado, se contorcendo, e estouram
    em magenta no fim."""
    nome = "vastilarvas"
    LARVA = [
        [".##o",
         "####"],
        ["##.o",
         ".###"],
    ]
    # (posição inicial em x, linha de cima, defasagem da contorção)
    LARVAS = [(0, 0, 0), (-6, 2, 1), (-3, 4, 0)]
    RASTEJA = (0.3, 2.3)
    ESTOURA = (2.3, 2.7)
    VEL = 15.0
    duracao = 3.1
    CORPO = (190, 40, 255)
    OLHO = (255, 120, 220)
    FLASH = (230, 80, 255)

    def __init__(self, layout, params=None):
        super().__init__(layout, params)
        self.escuro = escala(self.CORPO, 0.08)

    def pose(self, t, defasagem=0) -> int:
        return (int((t - self.RASTEJA[0]) / 0.15) + defasagem) % 2

    def posicao(self, t, x0) -> float:
        return x0 - 4 + self.VEL * (min(t, self.RASTEJA[1]) - self.RASTEJA[0])

    def envelope(self, t) -> float:
        return smooth(0, 0.3, t) * (1 - smooth(self.ESTOURA[1], self.duracao, t))

    def estouro(self, t) -> float:
        a, b = self.ESTOURA
        return max(0.0, 1 - (t - a) / (b - a)) if a <= t else 0.0

    def teclado(self, t, fundos):
        env = self.envelope(t)
        base = lerp(self.escuro, self.FLASH, self.estouro(t))
        pixels = {}
        if t < self.RASTEJA[1]:
            for x0, linha, fase in self.LARVAS:
                px0 = round(self.posicao(t, x0))
                frame = self.LARVA[self.pose(t, fase)]
                for dl, row in enumerate(frame):
                    for dc, ch in enumerate(row):
                        if ch != ".":
                            pixels[(px0 + dc, linha + dl)] = self.OLHO if ch == "o" else self.CORPO
        out = []
        for (x, y), f in zip(self.L.teclado, fundos):
            c = pixels.get((round(x), round(y)), base)
            out.append(sobre(f, c, env))
        return out

    def ponto(self, t, x, y, fundo):
        k = 0.2 + 0.3 * self.pose(t) if t < self.RASTEJA[1] else 0.2
        c = lerp(lerp(self.escuro, self.CORPO, k), self.FLASH, self.estouro(t))
        return sobre(fundo, c, self.envelope(t))


class Campeao(Roteiro):
    """Pick travado no draft: o nome do campeão no roteiro dos kills, curto.
    Azul = aliado, vermelho = inimigo, dourado com strobe = o seu pick.
    Picks seguidos esperam na fila do mixer em vez de se atropelarem."""
    nome = "campeao"
    fila = True
    TSUNAMI_S = 0.6
    DT, SEGURA = 0.18, 0.3
    PISCA_N, PISCA_S = 2, 0.3
    SAIDA_S = 0.6
    LADOS = {
        "aliado": ((0, 20, 90), (0, 90, 255), "letras", 2),
        "inimigo": (VERMELHO_ESCURO, VERMELHO, "letras", 2),
        "eu": ((120, 70, 0), DOURADO, "strobe", 4),
    }

    def __init__(self, layout, params=None):
        p = params or {}
        self.PALAVRAS = [w for w in (normalize(x) for x in str(p.get("nome", "")).split()) if w] or ["?"]
        self.COR_MAR_ESCURO, self.COR_MAR, self.PISCA_MODO, self.PISCA_N =             self.LADOS.get(str(p.get("lado", "")), self.LADOS["aliado"])
        super().__init__(layout, params)


class Vitoria(Roteiro):
    """Roteiro dos kills em dourado: tsunami, VITORIA letra a letra e strobe
    dourado/branco acelerando em tudo."""
    nome = "vitoria"
    PALAVRAS = ["VITORIA"]
    COR_MAR_ESCURO = (120, 70, 0)
    COR_MAR = DOURADO
    PISCA_MODO = "strobe"
    PISCA_N, PISCA_S, PISCA_ACELERA = 10, 0.36, 0.9
    SAIDA_S = 1.0


class Derrota(Efeito):
    nome = "derrota"
    duracao = 3.0

    def ponto(self, t, x, y, fundo):
        k = smooth(0, 0.3, t) * (1 - smooth(0.3, 3.0, t))
        return sobre(fundo, VERMELHO_ESCURO, k)


# --- água (Beber Água, herdado do teclado_palavras.py) -------------------------------

DEEP = (0, 6, 24)          # fundo azul escuro
WAVE = (0, 40, 120)        # crista das ondas de fundo
RIPPLE = (40, 140, 255)    # ondas que saem das letras
FLASH = (255, 255, 255)    # brilho no instante em que a letra acende
INTRO = 1.0                # entrada: fundo -> água
FADE = 0.6                 # letras apagando
GAP = 0.3                  # pausa entre palavras
FILL = 1.3                 # água subindo no final (teclado e depois RAM)
CROSS = 0.7                # água -> cor final
FLASH_T = 0.35             # duração do brilho de cada letra
RIPPLE_LIFE = 1.4
RIPPLE_SPEED = 11.0        # teclas por segundo
FILL_TOP = -7.0            # até onde a água sobe (topo da RAM)


class WaterAnimation(Efeito):
    """Escreve palavras em água. Ignora o fundo: entra e sai pela cor `final`."""
    nome = "agua"

    def __init__(self, layout, params=None):
        super().__init__(layout, params)
        p = self.params
        words = [normalize(w) for w in p.get("palavras", ["TOMAR", "AGUA"])]
        self.letter = hex_rgb(p.get("cor", "00FFFF"))
        self.final = hex_rgb(p.get("final", "FFFFFF"))
        letter_dt = float(p.get("letra", 0.35))
        hold = float(p.get("palavra", 2.0))
        self.kb_pos = layout.teclado
        cx = layout.centro[0]
        self.ripples = [(INTRO * 0.3, cx, 2.5)]   # (t0, x, y): gota inicial no meio
        self.words = []                           # (t_start, t_end, {idx: t_on})
        self.flashes = []                         # instantes em que alguma letra acende
        t = INTRO
        for word in words:
            on = {}
            for k, ch in enumerate(word):
                idx = layout.teclas.get(ch)
                if idx is None:
                    continue
                t_on = t + k * letter_dt
                on.setdefault(idx, t_on)
                self.ripples.append((t_on, *self.kb_pos[idx]))
                self.flashes.append(t_on)
            end = t + len(word) * letter_dt + hold
            self.words.append((t, end, on))
            t = end + FADE + GAP
        self.outro = t
        self.duracao = t + FILL + CROSS

    def ambient(self, t, x, y):
        w = 0.5 + 0.5 * math.sin(x * 0.55 + y * 0.3 - t * 2.6)
        return lerp(DEEP, WAVE, w * w)

    def ripple_light(self, t, x, y):
        k = 0.0
        for t0, ox, oy in self.ripples:
            age = t - t0
            if 0 <= age < RIPPLE_LIFE:
                d = math.hypot(x - ox, (y - oy) * 1.2)
                k += anel(d, age * RIPPLE_SPEED, 1.1) * (1 - age / RIPPLE_LIFE) ** 1.5
        return min(k, 1.0)

    def letter_light(self, t, idx):
        for start, end, on in self.words:
            if idx not in on or t < on[idx] or t > end + FADE:
                continue
            age = t - on[idx]
            col = lerp(FLASH, self.letter, age / FLASH_T)
            if age > FLASH_T:
                col = escala(col, 0.78 + 0.22 * math.sin((t - start) * 5.0))
            if t > end:
                col = escala(col, 1 - (t - end) / FADE)
            return col
        return None

    def flash_level(self, t):
        return max((1 - (t - t0) / FLASH_T for t0 in self.flashes if 0 <= t - t0 < FLASH_T), default=0.0)

    def envelope(self, t, x, y, c):
        """Entrada (final -> água) e saída (água sobe, depois vai para a cor final)."""
        if t < INTRO * 0.5:
            c = lerp(self.final, c, t / (INTRO * 0.5))
        if t >= self.outro:
            level = 6 + (FILL_TOP - 6) * (t - self.outro) / FILL
            if y >= level:
                c = lerp(c, RIPPLE, 0.8)
            if t >= self.outro + FILL:
                c = lerp(c, self.final, (t - self.outro - FILL) / CROSS)
        return c

    def water(self, t, x, y):
        return add(self.ambient(t, x, y), RIPPLE, self.ripple_light(t, x, y))

    def teclado(self, t, fundos):
        out = []
        for idx, (x, y) in enumerate(self.kb_pos):
            c = self.water(t, x, y)
            lit = self.letter_light(t, idx)
            if lit:
                c = brighter(lit, c)
            out.append(self.envelope(t, x, y, c))
        return out

    def ram(self, t, fundos):
        return [self.envelope(t, x, y, self.water(t, x, y)) for x, y in self.L.ram]

    def placa(self, t, fundos):
        x, y = PLACA_POS
        c = lerp(self.water(t, x, y), self.letter, self.flash_level(t))
        return [self.envelope(t, x, y, c)] * len(fundos)


# --- fábrica ---------------------------------------------------------------------

_POR_NOME = {c.nome: c for c in (Kill, Campeao, Assist, FirstBlood, Shutdown, Ace, Dragao, Barao,
                                 Arauto, Vastilarvas, Vitoria, Derrota, WaterAnimation)}
_MULTI = {2: Double, 3: Triple, 4: Quadra, 5: Penta}


def criar_efeito(nome: str, params: dict | None, layout: Layout) -> Efeito:
    params = params or {}
    if nome == "multikill":
        n = max(2, min(5, int(params.get("n", 2))))
        return _MULTI[n](layout, params)
    return _POR_NOME[nome](layout, params)


def nomes_de_efeito() -> list:
    return sorted(_POR_NOME) + ["multikill"]
