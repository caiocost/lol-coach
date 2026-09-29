"""Espaço 2D compartilhado pelos dispositivos RGB e utilitários de cor.

Todos os dispositivos vivem num mesmo plano: o teclado ocupa a grade 23x6
(y=0..5, de cima para baixo), os pentes de RAM ficam em pé acima dele (y<0) e a
placa-mãe é um ponto único em (11, -3). Um efeito é uma função de (t, x, y).
"""
from __future__ import annotations

import math
import time
import unicodedata
from dataclasses import dataclass, field

Cor = tuple

BRANCO: Cor = (255, 255, 255)
PRETO: Cor = (0, 0, 0)
PLACA_POS = (11.0, -3.0)


def hex_rgb(h: str) -> Cor:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a: Cor, b: Cor, t: float) -> Cor:
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def add(a: Cor, b: Cor, k: float = 1.0) -> Cor:
    return tuple(a[i] + b[i] * k for i in range(3))


def escala(c: Cor, k: float) -> Cor:
    return tuple(v * k for v in c)


def brighter(a: Cor, b: Cor) -> Cor:
    return a if sum(a) >= sum(b) else b


def clamp(c: Cor) -> Cor:
    return tuple(max(0, min(255, int(v))) for v in c)


def normalize(word: str) -> str:
    # "ÁGUA" -> "AGUA": o teclado não tem tecla acentuada
    return "".join(c for c in unicodedata.normalize("NFD", word.upper()) if c.isalnum())


@dataclass
class Layout:
    """Posições de cada LED no plano, por dispositivo, na ordem dos LEDs."""
    teclado: list = field(default_factory=list)   # [(x, y)] por LED do teclado
    teclas: dict = field(default_factory=dict)    # "R" -> índice do LED
    ram: list = field(default_factory=list)       # [(x, y)] por LED de RAM
    n_placa: int = 0

    @property
    def centro(self) -> tuple:
        if not self.teclado:
            return (11.0, 2.5)
        return (sum(x for x, _ in self.teclado) / len(self.teclado),
                sum(y for _, y in self.teclado) / len(self.teclado))

    def pos_tecla(self, nome: str, padrao=(4.0, 2.0)) -> tuple:
        idx = self.teclas.get(nome)
        return self.teclado[idx] if idx is not None else padrao

    @classmethod
    def sintetico(cls) -> "Layout":
        """Grade 23x6 aproximando o HyperX Alloy Origins, sem hardware.

        Usado nos testes e quando o OpenRGB está fora (a aba Luzes continua
        respondendo, só não acende nada).
        """
        linhas = {1: ("1234567890", 1), 2: ("QWERTYUIOP", 1), 3: ("ASDFGHJKL", 1), 4: ("ZXCVBNM", 2)}
        teclado, teclas = [], {}
        for y in range(6):
            for x in range(23):
                teclado.append((x, y))
        for y, (letras, x0) in linhas.items():
            for k, ch in enumerate(letras):
                teclas[ch] = y * 23 + x0 + k
        return cls(teclado, teclas, ram_posicoes([12, 12]), 3)

    @classmethod
    def de_dispositivos(cls, kb, ram, placa) -> "Layout":
        teclado, teclas = [], {}
        if kb is not None:
            teclado = keyboard_positions(kb)
            teclas = {led.name.removeprefix("Key: "): i for i, led in enumerate(kb.leds)}
        ram_pos = ram_posicoes([len(z.leds) for z in ram.zones]) if ram is not None else []
        return cls(teclado, teclas, ram_pos, len(placa.leds) if placa is not None else 0)


def keyboard_positions(kb) -> list:
    pos = {}
    for y, row in enumerate(kb.zones[0].matrix_map):
        for x, idx in enumerate(row):
            if idx is not None and idx not in pos:
                pos[idx] = (x, y)
    return [pos.get(i, (0, 0)) for i in range(len(kb.leds))]


def ram_posicoes(leds_por_pente: list) -> list:
    # pentes em pé acima do centro do teclado; LED 1 embaixo (direção ainda não confirmada)
    out = []
    for s, n in enumerate(leds_por_pente):
        out += [(9.5 + 3 * s, -0.5 - 0.5 * j) for j in range(n)]
    return out


# --- OpenRGB -----------------------------------------------------------------

def find(client, text):
    return next((d for d in client.devices if text in d.name), None)


def achar(client, tipo: str, env: str):
    """Dispositivo pelo nome em `env` (trecho do nome no OpenRGB) ou, sem ele,
    o primeiro do tipo (KEYBOARD, DRAM, MOTHERBOARD). Qualquer um pode faltar."""
    import os

    nome = os.environ.get(env, "").strip()
    if nome:
        return find(client, nome)
    try:
        from openrgb.utils import DeviceType
        alvo = getattr(DeviceType, tipo)
    except (ImportError, AttributeError):
        return None
    return next((d for d in client.devices if getattr(d, "type", None) == alvo), None)


def connect(timeout: float, nome: str = "lol-coach"):
    """Espera o servidor subir e terminar a detecção (o teclado aparecer)."""
    from openrgb import OpenRGBClient

    deadline = time.monotonic() + timeout
    while True:
        try:
            client = OpenRGBClient("127.0.0.1", 6742, nome)
            if achar(client, "KEYBOARD", "RGB_TECLADO"):
                return client
            client.disconnect()
        except (ConnectionError, OSError, TimeoutError):
            pass
        if time.monotonic() > deadline:
            raise SystemExit("OpenRGB server indisponível ou teclado não detectado")
        time.sleep(3)


@dataclass
class Dispositivos:
    """Os três dispositivos que animamos. Qualquer um pode faltar."""
    kb: object = None
    ram: object = None
    placa: object = None

    @classmethod
    def do_cliente(cls, client) -> "Dispositivos":
        # Sem configuração, pega o primeiro teclado, a primeira RAM e a primeira
        # placa-mãe que o OpenRGB listar. RGB_TECLADO / RGB_RAM / RGB_PLACA no
        # .env escolhem por trecho do nome quando há mais de um.
        d = cls(achar(client, "KEYBOARD", "RGB_TECLADO"),
                achar(client, "DRAM", "RGB_RAM"),
                achar(client, "MOTHERBOARD", "RGB_PLACA"))
        for dev in d.todos():
            dev.set_mode("Direct")
        return d

    def todos(self) -> list:
        return [x for x in (self.kb, self.ram, self.placa) if x is not None]

    def layout(self) -> Layout:
        return Layout.de_dispositivos(self.kb, self.ram, self.placa)

    def enviar(self, teclado: list, ram: list, placa: list) -> None:
        from openrgb.utils import RGBColor

        for dev, cores in ((self.kb, teclado), (self.ram, ram), (self.placa, placa)):
            if dev is not None and cores:
                dev.set_colors([RGBColor(*clamp(c)) for c in cores], fast=True)

    def pintar(self, cor: Cor) -> None:
        from openrgb.utils import RGBColor

        for dev in self.todos():
            dev.set_color(RGBColor(*clamp(cor)))


def anel(d: float, raio: float, largura: float) -> float:
    return math.exp(-((d - raio) / largura) ** 2)


def smooth(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
