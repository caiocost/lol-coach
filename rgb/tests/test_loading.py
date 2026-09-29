"""Barra de loading na tela de carregamento do jogo (pedido 28/09).

O jogo não expõe porcentagem de loading: a barra é ESTIMADA pela mediana dos
loadings reais anteriores e completa quando a partida de fato começa.
"""
import json

import pytest

from layout import BRANCO, Layout
from mixer import CINZA, HISTORICO_LOADING, LOADING_PADRAO_S, Mixer


class Relogio:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def rel():
    return Relogio()


@pytest.fixture
def mx(rel, tmp_path):
    return Mixer(Layout.sintetico(), agora=rel, pasta=tmp_path)


def preenchido(m):
    """Fração da primeira linha do teclado que está branca."""
    kb = m.quadro()[0]
    return sum(kb[x] == BRANCO for x in range(23)) / 23


def test_loading_comeca_vazio_e_enche(mx, rel):
    mx.carregar(True)
    rel.t += 1
    assert preenchido(mx) < 0.1
    rel.t += LOADING_PADRAO_S / 2 - 1
    assert 0.35 < preenchido(mx) < 0.6


def test_estimativa_usa_historico(mx, rel, tmp_path):
    (tmp_path / HISTORICO_LOADING).write_text(json.dumps([20, 20, 22, 18, 20]))
    mx.carregar(True)
    rel.t += 10
    assert 0.35 < preenchido(mx) < 0.6


def test_passou_da_estimativa_nao_enche_sozinho(mx, rel):
    mx.carregar(True)
    rel.t += LOADING_PADRAO_S * 3
    assert preenchido(mx) < 1.0


def test_partida_comecou_completa_pisca_e_grava_duracao(mx, rel, tmp_path):
    mx.carregar(True)
    rel.t += 42
    mx.estado(morto=False, respawn_em=0)        # 1º dado da partida
    assert not mx.status()["carregando"]
    assert json.loads((tmp_path / HISTORICO_LOADING).read_text())[-1] == pytest.approx(42, abs=0.1)
    rel.t += 0.15                                # meio da 1ª piscada
    assert max(mx.quadro()[0][11]) < 60
    rel.t += 2
    assert all(c == BRANCO for c in mx.quadro()[0])


def test_historico_guarda_so_os_ultimos_10(mx, rel, tmp_path):
    (tmp_path / HISTORICO_LOADING).write_text(json.dumps(list(range(10, 20))))
    mx.carregar(True)
    rel.t += 30
    mx.carregar(False)
    h = json.loads((tmp_path / HISTORICO_LOADING).read_text())
    assert len(h) == 10 and h[-1] == pytest.approx(30, abs=0.1)


def test_loading_de_teste_nao_grava_nem_mexe_na_partida(mx, rel, tmp_path):
    mx.carregar(True, teste=True)
    assert not mx.status()["partida"]
    rel.t += 15
    mx.carregar(False, teste=True)
    assert not (tmp_path / HISTORICO_LOADING).exists()


def test_loading_real_segura_o_beber_agua_mesmo_longo(mx, rel, tmp_path):
    mx.carregar(True)
    assert (tmp_path / "rgb_partida.flag").exists()
    rel.t += 120                                  # loading lento, sem /estado
    mx.quadro()
    assert mx.status()["partida"] and mx.status()["carregando"]


def test_loading_sumiu_sem_partida_nao_grava(mx, rel, tmp_path):
    # ex.: alguém não carregou e o jogo caiu; a LCU sai de InProgress
    mx.carregar(True)
    rel.t += 3
    mx.carregar(False)
    assert not (tmp_path / HISTORICO_LOADING).exists()   # curto demais para ser loading real
