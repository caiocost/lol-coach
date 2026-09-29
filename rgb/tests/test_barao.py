"""Barão Nashor desenhado nas teclas (pedido 28/09)."""
from layout import BRANCO, Layout
from efeitos import Barao, criar_efeito

L = Layout.sintetico()


def quadro(ef, t):
    return (ef.teclado(t, [BRANCO] * len(L.teclado)),
            ef.ram(t, [BRANCO] * len(L.ram)),
            ef.placa(t, [BRANCO] * L.n_placa))


def tecla(x, y):
    return y * 23 + x


def roxa(c):
    return c[2] > 150 and c[1] < 90


def amarela(c):
    return c[0] > 200 and c[1] > 180 and c[2] < 90


def test_sprites_tem_23x6():
    for frame in (Barao.BOCA_FECHADA, Barao.BOCA_ABERTA):
        assert len(frame) == 6 and all(len(l) == 23 for l in frame)


def test_barao_visivel_de_boca_fechada():
    ef = criar_efeito("barao", {}, L)
    kb, _, _ = quadro(ef, ef.ENCARA[0] + 0.05)
    assert roxa(kb[tecla(11, 2)])                    # testa
    for lin, col in Barao.OLHOS:
        assert amarela(kb[tecla(col, lin)])
    assert max(kb[tecla(0, 0)]) < 60                 # fundo escuro


def test_sobe_do_fosso():
    ef = criar_efeito("barao", {}, L)
    kb, _, _ = quadro(ef, ef.SOBE[0] + (ef.SOBE[1] - ef.SOBE[0]) * 0.3)
    assert max(kb[tecla(11, 0)]) < 60                # topo ainda vazio
    assert ef.deslocamento(ef.SOBE[0]) > ef.deslocamento(ef.ENCARA[0]) == 0


def test_ruge_de_boca_aberta_com_dentes():
    ef = criar_efeito("barao", {}, L)
    t = (ef.RUGE[0] + ef.RUGE[1]) / 2
    kb, _, _ = quadro(ef, t)
    dentes = [(l, c) for l, linha in enumerate(Barao.BOCA_ABERTA) for c, ch in enumerate(linha) if ch == "w"]
    assert dentes
    assert all(min(kb[tecla(c, l)]) > 200 for l, c in dentes)
    fechada, _, _ = quadro(ef, ef.ENCARA[0] + 0.05)
    boca = [(l, c) for l, linha in enumerate(Barao.BOCA_ABERTA) for c, ch in enumerate(linha) if ch == "m"]
    assert any(kb[tecla(c, l)] != fechada[tecla(c, l)] for l, c in boca)


def test_rugido_chega_na_ram_e_na_placa():
    ef = criar_efeito("barao", {}, L)
    _, ram_antes, placa_antes = quadro(ef, ef.ENCARA[0] + 0.05)
    _, ram, placa = quadro(ef, ef.RUGE[0] + 0.4)
    assert sum(map(sum, ram)) > sum(map(sum, ram_antes)) + 500
    assert sum(placa[0]) > sum(placa_antes[0])


def test_afunda_no_fim():
    ef = criar_efeito("barao", {}, L)
    assert ef.deslocamento(ef.AFUNDA[1]) >= 6
