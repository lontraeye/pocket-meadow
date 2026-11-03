# Recolore a arte do Apricorn vermelho para as outras cores (PLANNING.md, 5.23):
# os frutos da árvore e a máquina (Apricorn virando bola). Rodar desta pasta:
#   python recolorir-apricorn.py
# Gera arvore-apricorn-frutos-<cor>.png e maquina-apricorn-<receita>.png.
from PIL import Image

APRICORN = (189, 61, 10)      # corpo do Apricorn vermelho
LIGHT = (222, 144, 31)        # brilho do Apricorn
DARK = (156, 4, 7)            # sombra do Apricorn e topo da Poké Ball
TREE_SHADE = (129, 34, 41)    # sombra do fruto na árvore
WHITE = (230, 228, 218)       # metade de baixo da bola

COLORS = {
    # cor: (corpo, brilho, sombra do fruto, sombra na máquina, topo da bola, receita)
    'azul': ((58, 112, 214), (140, 192, 250), (30, 62, 140), (34, 66, 150), (40, 84, 196), 'great'),
    'amarelo': ((232, 190, 40), (255, 236, 140), (168, 120, 20), (176, 126, 18), (46, 46, 54), 'ultra'),
}


def recolor_tree(color):
    body, light, shade, _, _, _ = COLORS[color]
    base = Image.open('arvore-apricorn.png').convert('RGBA')
    ripe = Image.open('arvore-apricorn-frutos.png').convert('RGBA')
    out = ripe.copy()
    px = out.load()
    for y in range(ripe.height):
        for x in range(ripe.width):
            if base.getpixel((x, y)) == ripe.getpixel((x, y)):
                continue
            r, g, b, a = ripe.getpixel((x, y))
            c = (r, g, b)
            if c == APRICORN:
                px[x, y] = body + (a,)
            elif c == TREE_SHADE:
                px[x, y] = shade + (a,)
    out.save(f'arvore-apricorn-frutos-{color}.png')


def recolor_machine(color):
    body, light, _, shade, ball_top, recipe = COLORS[color]
    sheet = Image.open('maquina-apricorn.png').convert('RGBA')
    out = sheet.copy()
    px = out.load()
    frames = sheet.width // 24
    for i in range(1, frames):  # o quadro 0 é a máquina parada, sem Apricorn
        x0 = i * 24
        # Antes de a bola aparecer (sem o branco), o vermelho escuro é sombra do Apricorn.
        has_ball = any(sheet.getpixel((x0 + x, y))[:3] == WHITE for y in range(32) for x in range(24))
        for y in range(32):
            for x in range(x0, x0 + 24):
                r, g, b, a = sheet.getpixel((x, y))
                c = (r, g, b)
                if a == 0:
                    continue
                if c == APRICORN:
                    px[x, y] = body + (a,)
                elif c == LIGHT:
                    px[x, y] = light + (a,)
                elif c == DARK:
                    px[x, y] = (ball_top if has_ball else shade) + (a,)
    out.save(f'maquina-apricorn-{recipe}.png')


for color in COLORS:
    recolor_tree(color)
    recolor_machine(color)
print('ok')
