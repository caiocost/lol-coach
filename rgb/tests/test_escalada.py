"""Escalada de intensidade a partir do kill (aprovada em 28/09).

Kill -> double -> triple -> quadra -> penta usam o mesmo roteiro (tsunami,
palavras, piscada, final) e cada nível aumenta a intensidade.
"""
import pytest

from layout import BRANCO, Layout
from efeitos import DOURADO, criar_efeito

L = Layout.sintetico()


def quadro(ef, t, fundo=BRANCO):
    return (ef.teclado(t, [fundo] * len(L.teclado)),
            ef.ram(t, [fundo] * len(L.ram)),
            ef.placa(t, [fundo] * L.n_placa))


def branca(c):
    return min(c) > 200


def vermelha(c):
    return c[0] > 100 and c[1] < 120


def escura(c):
    return max(c) < 40


def dourada(c):
    return c[0] > 200 and 130 < c[1] < 210 and c[2] < 70


KILLS = [
    ("kill", {"campeao": "Pyke"}, ["PYKE", "KILL"], 3),
    ("kill", {}, ["KILL"], 3),
    ("kill", {"campeao": "Miss Fortune"}, ["MISS", "KILL"], 3),
    ("multikill", {"n": 2}, ["DOUBLE", "KILL"], 4),
    ("multikill", {"n": 3}, ["TRIPLE", "KILL"], 5),
    ("multikill", {"n": 4}, ["QUADRA", "KILL"], 6),
    ("multikill", {"n": 5}, ["PENTA", "KILL"], 8),
    ("firstblood", {}, ["FIRST", "BLOOD"], 3),
    ("shutdown", {}, ["SHUT", "DOWN"], 3),
    ("ace", {}, ["ACE"], 3),
]


@pytest.mark.parametrize("nome,params,palavras,piscadas", KILLS)
def test_escreve_as_palavras(nome, params, palavras, piscadas):
    ef = criar_efeito(nome, params, L)
    assert ef.PALAVRAS == palavras
    for palavra, fim in zip(palavras, ef.palavra_fim):
        kb, _, _ = quadro(ef, fim - 0.01)
        for ch in palavra:
            c = kb[L.teclas[ch]]
            assert (dourada(c) if nome == "shutdown" else branca(c)), (nome, palavra, ch, c)


@pytest.mark.parametrize("nome,params,palavras,piscadas", KILLS)
def test_numero_de_piscadas(nome, params, palavras, piscadas):
    assert len(criar_efeito(nome, params, L).piscadas) == piscadas


def test_duracao_escala_com_a_importancia():
    d = [criar_efeito("kill", {"campeao": "Pyke"}, L).duracao] + \
        [criar_efeito("multikill", {"n": n}, L).duracao for n in (2, 3, 4, 5)]
    assert d == sorted(d) and len(set(d)) == 5


@pytest.mark.parametrize("n", [4, 5])
def test_piscada_acelera_no_quadra_e_no_penta(n):
    duracoes = [dur for _, dur in criar_efeito("multikill", {"n": n}, L).piscadas]
    assert all(a > b for a, b in zip(duracoes, duracoes[1:]))


def meio_do_tsunami(ef):
    return (ef.intro_fim + ef.TSUNAMI) / 2


def test_double_tsunami_vem_dos_dois_lados():
    ef = criar_efeito("multikill", {"n": 2}, L)
    kb, _, _ = quadro(ef, meio_do_tsunami(ef))
    linha = [kb[2 * 23 + x] for x in range(23)]
    assert not escura(linha[0]) and not escura(linha[22])
    assert escura(linha[11])


def test_triple_tsunami_sobe_de_baixo():
    ef = criar_efeito("multikill", {"n": 3}, L)
    kb, _, _ = quadro(ef, ef.intro_fim + (ef.TSUNAMI - ef.intro_fim) * 0.3)
    assert not escura(kb[5 * 23 + 11])   # última linha já tomada
    assert escura(kb[0 * 23 + 11])       # primeira linha ainda seca


def test_triple_letra_solta_onda():
    ef = criar_efeito("multikill", {"n": 3}, L)
    t_on = ef.acende[L.teclas["T"]]
    sem, _, _ = quadro(ef, t_on - 0.01)
    com, _, _ = quadro(ef, t_on + 0.25)
    # uma tecla a ~3 de distância do T clareia quando a onda passa
    alvo = L.teclas["T"] + 3
    assert com[alvo][1] > sem[alvo][1] + 20


def test_triple_pisca_em_negativo():
    ef = criar_efeito("multikill", {"n": 3}, L)
    ini, dur = ef.piscadas[0]
    kb, _, _ = quadro(ef, ini + dur / 2)
    assert branca(kb[L.teclas["Z"]])          # fundo branco
    assert vermelha(kb[L.teclas["T"]])        # letra vermelha


def test_quadra_termina_com_estouro():
    ef = criar_efeito("multikill", {"n": 4}, L)
    kb, ram, placa = quadro(ef, ef.pisca_fim + 0.05)
    assert all(branca(c) for c in kb + ram + placa)


def test_penta_intro_escura_com_batida():
    ef = criar_efeito("multikill", {"n": 5}, L)
    assert ef.intro_fim >= 1.0
    batida = max(quadro(ef, t / 100)[0][0][0] for t in range(15, int(ef.intro_fim * 100)))
    kb, _, _ = quadro(ef, 0.12)
    assert all(escura(c) for c in kb)
    assert 60 < batida < 200                  # pulso vermelho escuro, não vermelho cheio


def test_penta_strobe_toma_tudo():
    ef = criar_efeito("multikill", {"n": 5}, L)
    ini, dur = ef.piscadas[0]
    kb, ram, placa = quadro(ef, ini + dur / 2)
    assert all(branca(c) for c in kb + ram + placa)


def test_penta_chuva_escorre_para_baixo():
    ef = criar_efeito("multikill", {"n": 5}, L)
    t = ef.pisca_fim + (ef.duracao - ef.pisca_fim) * 0.5
    kb, _, _ = quadro(ef, t)
    assert branca(kb[0 * 23 + 11])            # topo já limpo
    assert vermelha(kb[5 * 23 + 11])          # base ainda vermelha


def test_shutdown_tsunami_dourado():
    ef = criar_efeito("shutdown", {}, L)
    assert ef.COR_ESPUMA == DOURADO


# --- vitória e assist (revisão 28/09: "vitória tinha que piscar mais", "assist tá fraquinho")

def test_vitoria_escreve_e_pisca_bastante_em_dourado():
    ef = criar_efeito("vitoria", {}, L)
    assert ef.PALAVRAS == ["VITORIA"]
    assert len(ef.piscadas) >= 8
    kb, _, _ = quadro(ef, ef.palavra_fim[0] - 0.01)
    assert branca(kb[L.teclas["V"]])
    assert kb[L.teclas["Z"]][0] > 150 and kb[L.teclas["Z"]][2] < 80   # mar dourado, não vermelho
    ini, dur = ef.piscadas[0]
    kb, ram, placa = quadro(ef, ini + dur / 2)
    assert all(branca(c) for c in kb + ram + placa)                  # strobe toma tudo


def test_assist_curto():
    ef = criar_efeito("assist", {}, L)
    assert 1.5 <= ef.duracao <= 2.2


def test_assist_gancho_e_uma_corrente_que_sai_do_q():
    ef = criar_efeito("assist", {}, L)
    q = L.teclas["Q"]
    kb, _, _ = quadro(ef, ef.FISGA - 0.01)
    elos = [kb[q + k] for k in range(2, 12)]
    assert any(vermelha(c) for c in elos) and any(branca(c) for c in elos)   # vermelho e branco alternando
    assert not vermelha(quadro(ef, 0.02)[0][q + 10])                       # e não estava lá no começo


def test_assist_impacto_na_ponta_ao_fisgar():
    ef = criar_efeito("assist", {}, L)
    kb, _, _ = quadro(ef, ef.FISGA + 0.03)
    ponta = L.teclas["Q"] + round(ef.ALCANCE)
    assert branca(kb[ponta])


def test_assist_puxa_o_alvo_de_volta():
    ef = criar_efeito("assist", {}, L)
    a, b = ef.FISGA, ef.CHEGA
    assert ef.ponta(a + 0.01) > ef.ponta((a + b) / 2) > ef.ponta(b - 0.01)


def test_assist_chegada_onda_de_choque_e_ram():
    ef = criar_efeito("assist", {}, L)
    antes, ram_antes, _ = quadro(ef, ef.CHEGA - 0.01)
    depois, ram, _ = quadro(ef, ef.CHEGA + 0.25)
    canto = L.teclas["M"] + 8
    assert depois[canto] != antes[canto]
    assert sum(map(sum, ram)) != sum(map(sum, ram_antes))


def test_assist_chuva_de_ouro():
    ef = criar_efeito("assist", {}, L)
    t = (ef.OURO[0] + ef.OURO[1]) / 2
    kb, _, placa = quadro(ef, t)
    moedas = [c for c in kb if dourada(c)]
    assert 3 <= len(moedas) <= 30
    assert placa[0][0] > placa[0][2] + 60        # placa puxando para o dourado


def test_assist_moedas_caem():
    ef = criar_efeito("assist", {}, L)
    a, b = ef.OURO

    def altura(t):
        linhas = [i // 23 for i, c in enumerate(quadro(ef, t)[0]) if dourada(c)]
        return sum(linhas) / max(1, len(linhas))

    assert altura(a + (b - a) * 0.7) > altura(a + (b - a) * 0.2)
