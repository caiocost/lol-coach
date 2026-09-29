"""Arauto do Vale e Vastilarvas desenhados nas teclas (pedido 28/09)."""
from layout import BRANCO, Layout
from efeitos import Arauto, Vastilarvas, criar_efeito

L = Layout.sintetico()


def kb(ef, t):
    return ef.teclado(t, [BRANCO] * len(L.teclado))


def tecla(x, y):
    return y * 23 + x


def olho(ef):
    return [(l, c) for l, linha in enumerate(ef.SPRITE) for c, ch in enumerate(linha) if ch == "e"]


# --- arauto -------------------------------------------------------------------

def test_arauto_sprite_23x6():
    assert len(Arauto.SPRITE) == 6 and all(len(l) == 23 for l in Arauto.SPRITE)


def test_arauto_olho_fechado_depois_abre():
    ef = criar_efeito("arauto", {}, L)
    fechado = kb(ef, ef.ABRE[0] - 0.05)
    aberto = kb(ef, ef.OLHA[0] + 0.05)
    brancos_fechado = sum(min(fechado[tecla(c, l)]) > 200 for l, c in olho(ef))
    brancos_aberto = sum(min(aberto[tecla(c, l)]) > 200 for l, c in olho(ef))
    assert brancos_fechado == 0
    assert brancos_aberto >= len(olho(ef)) - 2          # tudo branco menos a pupila


def test_arauto_pupila_olha_para_os_lados():
    ef = criar_efeito("arauto", {}, L)
    a, b = ef.OLHA
    colunas = {ef.pupila(a + k * (b - a) / 10) for k in range(10)}
    assert len(colunas) >= 3


def test_arauto_fundo_escuro():
    ef = criar_efeito("arauto", {}, L)
    assert max(kb(ef, ef.OLHA[0])[tecla(0, 5)]) < 60


def test_arauto_investida_treme_e_acende_ram():
    ef = criar_efeito("arauto", {}, L)
    a, b = ef.INVESTE
    assert len({ef.tremor(a + k * 0.02) for k in range(15)}) > 1
    antes = ef.ram(ef.OLHA[0], [BRANCO] * len(L.ram))
    durante = ef.ram(a + 0.2, [BRANCO] * len(L.ram))
    assert sum(map(sum, durante)) > sum(map(sum, antes)) + 500


# --- vastilarvas ----------------------------------------------------------------

def acesas(q):
    return [i for i, c in enumerate(q) if sum(c) > 250]


def test_larvas_sprites():
    for f in Vastilarvas.LARVA:
        assert len(f) == 2 and all(len(l) == 4 for l in f)


def test_tres_larvas_rastejam_para_a_direita():
    ef = criar_efeito("vastilarvas", {}, L)
    a, b = ef.RASTEJA
    q1, q2 = kb(ef, a + (b - a) * 0.35), kb(ef, a + (b - a) * 0.6)
    c1, c2 = acesas(q1), acesas(q2)
    assert len(c1) >= 12                                   # 3 larvas de ~5-6 pixels
    media = lambda idx: sum(i % 23 for i in idx) / len(idx)
    assert media(c2) > media(c1) + 2
    linhas = {i // 23 for i in c1}
    assert len(linhas) >= 3                                # em alturas diferentes


def test_larvas_se_contorcem():
    ef = criar_efeito("vastilarvas", {}, L)
    assert ef.LARVA[0] != ef.LARVA[1]
    a, _ = ef.RASTEJA
    assert {ef.pose(a + k * 0.05) for k in range(10)} == {0, 1}


def test_larvas_estouram_no_fim():
    ef = criar_efeito("vastilarvas", {}, L)
    q = kb(ef, ef.ESTOURA[0] + 0.1)
    assert sum(sum(c) > 250 for c in q) > len(q) * 0.6    # estouro toma o teclado
