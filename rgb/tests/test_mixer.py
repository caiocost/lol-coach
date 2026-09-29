import os

import pytest

from layout import BRANCO, Layout
from mixer import CINZA, TIMEOUT_PARTIDA, Mixer


class Relogio:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def anda(self, dt):
        self.t += dt


@pytest.fixture
def rel():
    return Relogio()


@pytest.fixture
def mx(rel, tmp_path):
    return Mixer(Layout.sintetico(), agora=rel, pasta=tmp_path)


def teclado(m):
    return m.quadro()[0]


def cinza_fora_da_barra(kb):
    """Morte longa: a barra de loading ainda não passou da 1ª coluna."""
    return all(c == CINZA for i, c in enumerate(kb) if i % 23 >= 1)


# --- prioridade -------------------------------------------------------------

def test_efeito_maior_substitui(mx):
    assert mx.disparar("kill")
    assert mx.disparar("multikill", {"n": 3})
    assert mx.status()["efeitoAtual"] == "multikill3"


def test_efeito_igual_substitui(mx):
    mx.disparar("kill")
    assert mx.disparar("kill")


def test_efeito_menor_e_descartado(mx):
    mx.disparar("multikill", {"n": 5})
    assert not mx.disparar("kill")
    assert mx.status()["efeitoAtual"] == "multikill5"


def test_lote_escolhe_o_de_maior_prioridade(mx):
    mx.disparar_lote([{"efeito": "kill"}, {"efeito": "multikill", "params": {"n": 2}},
                      {"efeito": "assist"}])
    assert mx.status()["efeitoAtual"] == "multikill2"


def test_efeito_desconhecido_nao_derruba(mx):
    assert not mx.disparar("nada")
    assert mx.status()["efeitoAtual"] is None


def test_efeito_acaba_e_volta_ao_branco(mx, rel):
    mx.disparar("kill")
    rel.anda(0.05)
    assert teclado(mx)[mx.layout.teclas["R"]] != BRANCO
    rel.anda(mx.efeito.duracao)
    assert all(c == BRANCO for c in teclado(mx))
    assert mx.status()["efeitoAtual"] is None


def test_depois_de_acabar_efeito_menor_volta_a_ser_aceito(mx, rel):
    mx.disparar("multikill", {"n": 5})
    rel.anda(mx.efeito.duracao + 0.1)
    mx.quadro()
    assert mx.disparar("assist")


# --- idle ------------------------------------------------------------------

def test_ocioso_nao_pede_quadro_depois_do_primeiro(mx):
    assert mx.precisa_desenhar()      # primeiro quadro: pinta a base
    mx.quadro()
    assert not mx.precisa_desenhar()
    mx.disparar("kill")
    assert mx.precisa_desenhar()


# --- morte -----------------------------------------------------------------

def test_morto_vira_cinza(mx, rel):
    mx.estado(morto=True, respawn_em=300)
    rel.anda(1)
    assert cinza_fora_da_barra(teclado(mx))


def linha(m, y=0):
    kb = teclado(m)
    return [kb[y * 23 + x] for x in range(23)]


def test_barra_comeca_vazia_logo_depois_de_morrer(mx, rel):
    mx.estado(morto=True, respawn_em=20)
    rel.anda(0.5)
    assert all(c == CINZA for c in linha(mx)[2:])


def test_barra_na_metade_do_tempo_de_morte(mx, rel):
    mx.estado(morto=True, respawn_em=20)
    rel.anda(10)
    l = linha(mx)
    assert all(c == BRANCO for c in l[:10])
    assert all(c == CINZA for c in l[13:])


def test_barra_quase_cheia_antes_de_nascer(mx, rel):
    mx.estado(morto=True, respawn_em=20)
    rel.anda(19.8)
    assert all(c == BRANCO for c in linha(mx)[:22])


def test_barra_usa_o_tempo_total_da_morte_nao_o_restante(mx, rel):
    # os polls seguintes mandam o tempo que FALTA; o total é o do momento da morte
    mx.estado(morto=True, respawn_em=20)
    rel.anda(10)
    mx.estado(morto=True, respawn_em=10)
    l = linha(mx)
    assert l[5] == BRANCO and l[18] == CINZA


def test_barra_corrige_total_se_o_primeiro_poll_veio_zerado(mx, rel):
    mx.estado(morto=True, respawn_em=0)
    rel.anda(0.5)
    mx.estado(morto=True, respawn_em=19.5)   # total real = 20
    rel.anda(9.5)
    l = linha(mx)
    assert l[5] == BRANCO and l[18] == CINZA


def test_ram_enche_de_baixo_para_cima(mx, rel):
    mx.estado(morto=True, respawn_em=20)
    rel.anda(10)
    ram = mx.quadro()[1]
    pente = ram[:12]          # LED 0 embaixo
    assert pente[0] == BRANCO and pente[11] == CINZA


def test_nascer_pisca_3_vezes(mx, rel):
    from mixer import PISCA_REVIVE
    mx.estado(morto=True, respawn_em=5)
    rel.anda(5)
    mx.estado(morto=False, respawn_em=0)
    apagados, acesos = [], []
    for i in range(3):
        rel.anda(PISCA_REVIVE / 2)
        apagados.append(teclado(mx)[11])
        assert mx.precisa_desenhar()
        rel.anda(PISCA_REVIVE / 2 - 0.001)
        acesos.append(teclado(mx)[11])
        rel.anda(0.001)
    assert all(max(c) < 60 for c in apagados)
    assert all(min(c) > 240 for c in acesos)


def test_revive_volta_ao_branco(mx, rel):
    mx.estado(morto=True, respawn_em=5)
    rel.anda(2)
    mx.estado(morto=False, respawn_em=0)
    rel.anda(1)
    assert all(c == BRANCO for c in teclado(mx))


def test_efeito_roda_por_cima_do_cinza_e_termina_cinza(mx, rel):
    mx.estado(morto=True, respawn_em=300)
    rel.anda(1)
    mx.disparar("kill")
    rel.anda(mx.efeito.duracao + 0.1)
    assert cinza_fora_da_barra(teclado(mx))


# --- partida / flag -----------------------------------------------------------

def test_estado_cria_e_renova_o_flag(mx, rel, tmp_path):
    mx.estado(morto=False, respawn_em=0)
    flag = tmp_path / "rgb_partida.flag"
    assert flag.exists()
    assert mx.status()["partida"]


def test_fim_de_partida_apaga_flag(mx, tmp_path):
    mx.estado(morto=False, respawn_em=0)
    mx.partida(False)
    assert not (tmp_path / "rgb_partida.flag").exists()


def test_sem_estado_por_30s_encerra_partida(mx, rel, tmp_path):
    mx.estado(morto=True, respawn_em=10)
    rel.anda(TIMEOUT_PARTIDA + 1)
    mx.quadro()
    assert not mx.status()["partida"]
    assert not mx.status()["morto"]
    assert not (tmp_path / "rgb_partida.flag").exists()


def test_estado_de_teste_nao_mexe_na_partida(mx, tmp_path):
    mx.estado(morto=True, respawn_em=10, teste=True)
    assert not mx.status()["partida"]
    assert not (tmp_path / "rgb_partida.flag").exists()


# --- água pendente --------------------------------------------------------------

def pendente(tmp_path):
    (tmp_path / "rgb_agua_pendente").write_text("1")


def test_agua_pendente_espera_a_morte(mx, rel, tmp_path):
    mx.estado(morto=False, respawn_em=0)
    pendente(tmp_path)
    mx.quadro()
    assert mx.status()["efeitoAtual"] is None
    mx.estado(morto=True, respawn_em=25)
    mx.quadro()
    assert mx.status()["efeitoAtual"] == "agua"
    assert not (tmp_path / "rgb_agua_pendente").exists()


def test_agua_pendente_espera_efeito_maior_acabar(mx, rel, tmp_path):
    mx.estado(morto=True, respawn_em=25)
    mx.disparar("multikill", {"n": 4})
    pendente(tmp_path)
    mx.quadro()
    assert mx.status()["efeitoAtual"] == "multikill4"
    rel.anda(mx.efeito.duracao + 0.1)
    mx.estado(morto=True, respawn_em=10)
    mx.quadro()
    mx.quadro()
    assert mx.status()["efeitoAtual"] == "agua"


def test_agua_pendente_toca_no_fim_da_partida(mx, rel, tmp_path):
    mx.estado(morto=False, respawn_em=0)
    pendente(tmp_path)
    mx.partida(False)
    mx.quadro()
    assert mx.status()["efeitoAtual"] == "agua"


def test_agua_sobre_cinza_termina_cinza(mx, rel, tmp_path):
    mx.estado(morto=True, respawn_em=3000)
    pendente(tmp_path)
    mx.quadro()
    rel.anda(20)
    mx.estado(morto=True, respawn_em=2980)
    assert cinza_fora_da_barra(teclado(mx))


def test_reset_limpa_tudo(mx, rel):
    mx.estado(morto=True, respawn_em=10, teste=True)
    mx.disparar("kill")
    mx.reset()
    assert mx.status()["efeitoAtual"] is None and not mx.status()["morto"]
    assert all(c == BRANCO for c in teclado(mx))
