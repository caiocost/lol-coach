"""Dragão desenhado nas teclas (pedido 28/09) e cores distinguíveis por tipo."""
import math

import pytest

from layout import BRANCO, Layout
from efeitos import CORES_DRAGAO, Dragao, criar_efeito

L = Layout.sintetico()
TIPOS = ["Fire", "Water", "Earth", "Air", "Hextech", "Chemtech", "Elder"]


def kb(ef, t):
    return ef.teclado(t, [BRANCO] * len(L.teclado))


def tecla(x, y):
    return y * 23 + x


def dist(a, b):
    return math.dist(a, b)


def test_sprites_tem_23x6():
    for frame in (Dragao.ASAS_CIMA, Dragao.ASAS_BAIXO):
        assert len(frame) == 6 and all(len(l) == 23 for l in frame)


def test_fogo_e_montanha_bem_diferentes():
    assert dist(CORES_DRAGAO["Fire"], CORES_DRAGAO["Earth"]) > 150


def test_todos_os_tipos_distinguiveis_entre_si():
    for i, a in enumerate(TIPOS):
        for b in TIPOS[i + 1:]:
            assert dist(CORES_DRAGAO[a], CORES_DRAGAO[b]) > 120, (a, b)


@pytest.mark.parametrize("tipo", TIPOS)
def test_dragao_pairando_aparece_desenhado(tipo):
    ef = criar_efeito("dragao", {"tipo": tipo}, L)
    t = ef.PAIRA[0] + 0.05
    q = kb(ef, t)
    corpo = q[tecla(10 + ef.PAIRA_OX, 4)]          # linha 4 do sprite é corpo nas duas poses
    vazio = q[tecla(0, 0)]
    assert dist(corpo, CORES_DRAGAO[tipo]) < 110 or tipo == "Fire", (tipo, corpo)
    assert max(vazio) < 60                          # fundo escuro, não branco


def test_asas_batem():
    ef = criar_efeito("dragao", {"tipo": "Water"}, L)
    a, b = ef.PAIRA
    quadros = {tuple(map(tuple, kb(ef, a + k * 0.05))) for k in range(int((b - a) / 0.05))}
    assert len(quadros) > 2


def test_olho_branco():
    ef = criar_efeito("dragao", {"tipo": "Elder"}, L)
    linha, col = Dragao.OLHO
    c = kb(ef, ef.PAIRA[0] + 0.05)[tecla(col + ef.PAIRA_OX, linha)]
    assert min(c) > 200


def test_sopro_sai_da_boca():
    ef = criar_efeito("dragao", {"tipo": "Water"}, L)
    antes = kb(ef, ef.SOPRO[0] - 0.05)
    durante = kb(ef, (ef.SOPRO[0] + ef.SOPRO[1]) / 2)
    alvo = tecla(22, 3)
    assert sum(durante[alvo]) > sum(antes[alvo]) + 150


def test_entra_pela_esquerda_e_sai_pela_direita():
    ef = criar_efeito("dragao", {"tipo": "Water"}, L)
    assert ef.deslocamento(ef.PAIRA[0] - 0.9) < ef.PAIRA_OX < ef.deslocamento(ef.SAI[1] - 0.05)


def test_fogo_tremula():
    ef = criar_efeito("dragao", {"tipo": "Fire"}, L)
    t = ef.PAIRA[0] + 0.05
    x = tecla(10 + ef.PAIRA_OX, 4)
    assert kb(ef, t)[x] != kb(ef, t + 0.03)[x]


def test_montanha_treme():
    ef = criar_efeito("dragao", {"tipo": "Earth"}, L)
    a, b = ef.PAIRA
    assert len({ef.deslocamento(a + k * 0.02) for k in range(20)}) > 1
