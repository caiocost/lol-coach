"""Nome do campeão escrito no teclado a cada pick do draft (pedido 28/09)."""
import pytest

from layout import BRANCO, Layout
from efeitos import DOURADO, criar_efeito
from mixer import Mixer

L = Layout.sintetico()


def kb(ef, t):
    return ef.teclado(t, [BRANCO] * len(L.teclado))


@pytest.mark.parametrize("nome,palavras", [
    ("Pyke", ["PYKE"]), ("Miss Fortune", ["MISS", "FORTUNE"]), ("Kai'Sa", ["KAISA"]),
    ("Nunu & Willump", ["NUNU", "WILLUMP"]), ("Dr. Mundo", ["DR", "MUNDO"]),
])
def test_nome_vira_palavras(nome, palavras):
    ef = criar_efeito("campeao", {"nome": nome, "lado": "aliado"}, L)
    assert ef.PALAVRAS == palavras


@pytest.mark.parametrize("lado,canal", [("aliado", 2), ("inimigo", 0)])
def test_cor_do_mar_pelo_lado(lado, canal):
    ef = criar_efeito("campeao", {"nome": "Zed", "lado": lado}, L)
    c = kb(ef, ef.palavra_fim[0] - 0.01)[L.teclas["Q"]]    # Q não está em ZED: é mar
    assert c[canal] == max(c) and c[canal] > 120


def test_meu_pick_dourado_e_com_strobe():
    ef = criar_efeito("campeao", {"nome": "Pyke", "lado": "eu"}, L)
    assert ef.COR_MAR == DOURADO and ef.PISCA_MODO == "strobe"
    outro = criar_efeito("campeao", {"nome": "Pyke", "lado": "aliado"}, L)
    assert len(ef.piscadas) > len(outro.piscadas)


def test_escreve_as_letras():
    ef = criar_efeito("campeao", {"nome": "Jinx", "lado": "inimigo"}, L)
    q = kb(ef, ef.palavra_fim[0] - 0.01)
    assert all(min(q[L.teclas[ch]]) > 200 for ch in "JINX")


def test_curto_para_caber_no_draft():
    assert criar_efeito("campeao", {"nome": "Pyke", "lado": "aliado"}, L).duracao < 4.5


# --- fila no mixer ------------------------------------------------------------

class Relogio:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_picks_seguidos_entram_na_fila(tmp_path):
    rel = Relogio()
    mx = Mixer(L, agora=rel, pasta=tmp_path)
    assert mx.disparar("campeao", {"nome": "Jinx", "lado": "aliado"})
    assert mx.disparar("campeao", {"nome": "Zed", "lado": "inimigo"})
    assert mx.status()["fila"] == 1
    primeiro = mx.efeito
    rel.t = primeiro.duracao + 0.01
    mx.quadro()
    assert mx.efeito is not primeiro and mx.efeito.PALAVRAS == ["ZED"]
    assert mx.status()["fila"] == 0


def test_reset_esvazia_a_fila(tmp_path):
    mx = Mixer(L, agora=Relogio(), pasta=tmp_path)
    mx.disparar("campeao", {"nome": "Jinx", "lado": "aliado"})
    mx.disparar("campeao", {"nome": "Zed", "lado": "inimigo"})
    mx.reset()
    assert mx.status()["fila"] == 0 and mx.status()["efeitoAtual"] is None
