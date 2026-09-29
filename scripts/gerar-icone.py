"""Gera coach/assets/icone.ico: arco dourado de cronometro sobre fundo escuro.

Desenhado em 4x e reduzido, para as bordas sairem suaves ate em 16 px.
Uso: python scripts/gerar-icone.py
"""
from PIL import Image, ImageDraw

FUNDO, OURO, OURO_ESCURO = (16, 20, 26, 255), (217, 164, 65, 255), (74, 58, 30, 255)


def quadro(lado: int) -> Image.Image:
    s = lado * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=FUNDO)
    m, w = s * 0.2, max(4, int(s * 0.11))
    caixa = [m, m, s - m, s - m]
    d.arc(caixa, 0, 360, fill=OURO_ESCURO, width=w)      # trilho
    d.arc(caixa, -90, 180, fill=OURO, width=w)           # 3/4 do tempo
    r = s * 0.09
    d.ellipse([s / 2 - r, s / 2 - r, s / 2 + r, s / 2 + r], fill=OURO)
    return img.resize((lado, lado), Image.LANCZOS)


tamanhos = [256, 64, 48, 32, 24, 16]
quadro(256).save("coach/assets/icone.ico", sizes=[(t, t) for t in tamanhos],
                 append_images=[quadro(t) for t in tamanhos[1:]])
quadro(256).save("coach/assets/icone.png")
print("coach/assets/icone.ico")
