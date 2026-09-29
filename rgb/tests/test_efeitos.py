import pytest

from layout import BRANCO, Layout
from efeitos import PRIORIDADE, criar_efeito

L = Layout.sintetico()

# (nome, params) de todo efeito do catálogo do spec
CATALOGO = [
    ("kill", {}), ("assist", {}), ("firstblood", {}), ("shutdown", {}), ("ace", {}),
    ("multikill", {"n": 2}), ("multikill", {"n": 3}), ("multikill", {"n": 4}), ("multikill", {"n": 5}),
    ("dragao", {"tipo": "Fire"}), ("dragao", {"tipo": "Elder"}), ("dragao", {"tipo": "Desconhecido"}),
    ("barao", {}), ("arauto", {}), ("vastilarvas", {}),
    ("vitoria", {}), ("derrota", {}), ("agua", {}),
]


def quadro(ef, t, fundo=BRANCO):
    return (ef.teclado(t, [fundo] * len(L.teclado)),
            ef.ram(t, [fundo] * len(L.ram)),
            ef.placa(t, [fundo] * L.n_placa))


def validas(cores):
    return all(len(c) == 3 and all(0 <= v <= 255 for v in c) for c in cores)


@pytest.mark.parametrize("nome,params", CATALOGO)
def test_cores_validas_ao_longo_do_efeito(nome, params):
    ef = criar_efeito(nome, params, L)
    assert ef.duracao > 0
    for t in (0.0, ef.duracao * 0.25, ef.duracao * 0.5, ef.duracao * 0.75):
        kb, ram, placa = quadro(ef, t)
        assert len(kb) == len(L.teclado) and len(ram) == len(L.ram) and len(placa) == L.n_placa
        assert validas(kb + ram + placa), (nome, t)


@pytest.mark.parametrize("nome,params", CATALOGO)
def test_termina_no_fundo(nome, params):
    ef = criar_efeito(nome, params, L)
    kb, ram, placa = quadro(ef, ef.duracao)
    for c in kb + ram + placa:
        assert all(abs(v - 255) <= 3 for v in c), (nome, c)


@pytest.mark.parametrize("nome,params", [c for c in CATALOGO if c[0] != "agua"])
def test_respeita_fundo_diferente_do_branco(nome, params):
    # Efeito sobre a camada de morte (cinza) tem que terminar cinza, não branco.
    cinza = (51, 51, 51)
    ef = criar_efeito(nome, params, L)
    kb, _, _ = quadro(ef, ef.duracao, cinza)
    assert all(all(abs(v - 51) <= 3 for v in c) for c in kb), nome


def branca(c):
    return min(c) > 200


def vermelha(c):
    return c[0] > 100 and c[1] < 120


def test_kill_escreve_campeao_apaga_escreve_kill_apaga():
    ef = criar_efeito("kill", {"campeao": "Pyke"}, L)
    pyke_fim, kill_fim = ef.palavra_fim
    # PYKE inteiro aceso; KILL ainda não começou
    kb, _, _ = quadro(ef, pyke_fim - 0.01)
    for ch in "PYKE":
        assert branca(kb[L.teclas[ch]]), ch
    assert vermelha(kb[L.teclas["I"]])
    # PYKE apagou antes do KILL começar
    kb, _, _ = quadro(ef, ef.acende[L.teclas["I"]] - ef.DT - 0.01)
    for ch in "PYKE":
        assert vermelha(kb[L.teclas[ch]]), ch
    # KILL inteiro aceso, PYKE (exceto o K, que é compartilhado) apagado
    kb, _, _ = quadro(ef, kill_fim - 0.01)
    for ch in "KIL":
        assert branca(kb[L.teclas[ch]]), ch
    for ch in "PYE":
        assert vermelha(kb[L.teclas[ch]]), ch
    # KILL apagou antes de piscar
    kb, _, _ = quadro(ef, ef.pisca_inicio - 0.01)
    for ch in "PYKEIL":
        assert vermelha(kb[L.teclas[ch]]), ch
    assert vermelha(kb[L.teclas["Z"]])


def test_kill_letra_entra_com_fade():
    ef = criar_efeito("kill", {"campeao": "Pyke"}, L)
    p = L.teclas["P"]
    meio, _, _ = quadro(ef, ef.acende[p] + ef.FADE_LETRA / 2)
    c = meio[p]
    assert not branca(c) and not vermelha(c)    # a meio caminho entre vermelho e branco


def test_kill_pisca_3x_as_duas_palavras_juntas():
    ef = criar_efeito("kill", {"campeao": "Pyke"}, L)
    for ch in "PYKEIL":
        idx = L.teclas[ch]
        acesas = [quadro(ef, ef.pisca_inicio + (i + 0.5) * ef.PISCA_S)[0][idx] for i in range(3)]
        apagadas = [quadro(ef, ef.pisca_inicio + (i + 1) * ef.PISCA_S - 0.01)[0][idx] for i in range(3)]
        assert all(branca(c) for c in acesas), ch
        assert all(vermelha(c) for c in apagadas), ch
    assert vermelha(quadro(ef, ef.pisca_inicio + 0.5 * ef.PISCA_S)[0][L.teclas["Z"]])


def test_kill_depois_de_piscar_faz_fade_para_o_fundo():
    ef = criar_efeito("kill", {"campeao": "Pyke"}, L)
    z = L.teclas["Z"]
    antes = quadro(ef, ef.pisca_fim + 0.01)[0][z]
    meio = quadro(ef, (ef.pisca_fim + ef.duracao) / 2)[0][z]
    assert vermelha(antes)
    assert antes[1] < meio[1] < 250             # verde subindo = vermelho clareando para o branco


def test_kill_comeca_com_apagao():
    ef = criar_efeito("kill", {"campeao": "Pyke"}, L)
    kb, _, _ = quadro(ef, 0.2)
    assert all(max(c) < 30 for c in kb)


def test_prioridades_do_spec():
    p = PRIORIDADE
    assert p["multikill5"] > p["multikill4"] > p["vitoria"] == p["derrota"] > p["multikill3"]
    assert p["multikill3"] > p["ace"] > p["barao"] > p["multikill2"] > p["shutdown"]
    assert p["shutdown"] > p["firstblood"] > p["kill"] > p["dragao"] > p["arauto"] == p["vastilarvas"]
    assert p["vastilarvas"] > p["agua"] > p["assist"]


def test_prioridade_do_multikill_depende_de_n():
    assert criar_efeito("multikill", {"n": 5}, L).prioridade == PRIORIDADE["multikill5"]
    assert criar_efeito("multikill", {"n": 9}, L).prioridade == PRIORIDADE["multikill5"]


def test_nome_desconhecido():
    with pytest.raises(KeyError):
        criar_efeito("nada", {}, L)
