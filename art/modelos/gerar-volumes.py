# Volumes de base para desenhar peças do jardim (cubos e cilindros), no mesmo
# esquema do cubo-isometrico: cada casa é um losango de 24x12, uma unidade de
# altura vale 12 px, e a última linha da imagem é a ponta de baixo da base.
# Rodar desta pasta:
#   python gerar-volumes.py
# Gera volumes/*.png (1 px = 1 px do jogo) e volumes/previa.png (todos, 4x).
#
# Nomes: cubo-CxR-hA.png e cilindro-NxN-hA.png. C = casas para baixo à direita
# (a coluna), R = casas para baixo à esquerda (a linha), A = altura em unidades.
# Luz de cima à esquerda: topo claro, face esquerda média, face direita escura.
import math
import os

from PIL import Image

TILE_W, TILE_H = 24, 12
UNIT = 12  # altura de uma unidade, em px (a altura da casa)
HEADROOM = 8  # folga em cima, para desenhar o que passa do volume
CONTORNO = (39, 45, 56, 255)
TOPO = (196, 200, 206, 255)
TOPO_LINHA = (178, 183, 190, 255)  # divisão entre casas no topo, bem de leve
ESQUERDA = (150, 156, 164, 255)
DIREITA = (104, 110, 120, 255)
# Lado do cilindro, da esquerda (luz) para a direita (sombra).
LADO = [(170, 175, 182, 255), (150, 156, 164, 255), (128, 134, 143, 255), (104, 110, 120, 255)]

OUT = 'volumes'


def canvas(cols, rows, height):
    w = (cols + rows) * TILE_W // 2
    h = (cols + rows) * TILE_H // 2 + height * UNIT + HEADROOM
    # Origem: o canto (0, 0) do chão. sx = (x - y) * 12 + ox; sy = (x + y) * 6 - z * 12 + oy.
    ox = rows * TILE_W // 2
    oy = h - (cols + rows) * TILE_H // 2
    return Image.new('RGBA', (w, h), (0, 0, 0, 0)), ox, oy


def outline(im):
    src = im.copy()
    sp, px = src.load(), im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if sp[x, y][3] and any(
                not (0 <= x + dx < w and 0 <= y + dy < h) or sp[x + dx, y + dy][3] == 0
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            ):
                px[x, y] = CONTORNO


def box(cols, rows, height):
    im, ox, oy = canvas(cols, rows, height)
    px = im.load()
    w, h = im.size
    for py in range(h):
        for qx in range(w):
            sx, sy = qx + 0.5 - ox, py + 0.5 - oy
            a = sx / (TILE_W / 2)  # x - y
            # Topo (z = altura): x + y vem da linha.
            b = (sy + height * UNIT) / (TILE_H / 2)
            x, y = (a + b) / 2, (b - a) / 2
            if 0 <= x <= cols and 0 <= y <= rows:
                on_line = any(abs(x - k) < 0.06 for k in range(1, cols)) or any(abs(y - k) < 0.06 for k in range(1, rows))
                px[qx, py] = TOPO_LINHA if on_line else TOPO
                continue
            # Face esquerda (y = rows): x = a + rows.
            x = a + rows
            if 0 <= x <= cols:
                z = ((x + rows) * TILE_H / 2 - sy) / UNIT
                if 0 <= z <= height:
                    px[qx, py] = ESQUERDA
                    continue
            # Face direita (x = cols): y = cols - a.
            y = cols - a
            if 0 <= y <= rows:
                z = ((cols + y) * TILE_H / 2 - sy) / UNIT
                if 0 <= z <= height:
                    px[qx, py] = DIREITA
    outline(im)
    return im


def cylinder(n, height):
    # Cilindro de pé na base NxN: o topo é a elipse do tamanho do losango da
    # base (largura e altura inteiras), como um cilindro isométrico costuma ser.
    im, ox, oy = canvas(n, n, height)
    px = im.load()
    w, h = im.size
    c = n / 2
    r2 = n * n  # em (a, b): a² + (b - 2c)² <= n², a elipse que enche o losango
    for py in range(h):
        for qx in range(w):
            sx, sy = qx + 0.5 - ox, py + 0.5 - oy
            a = sx / (TILE_W / 2)
            if a * a > r2:
                continue
            b = (sy + height * UNIT) / (TILE_H / 2)
            if a * a + (b - 2 * c) ** 2 <= r2:
                px[qx, py] = TOPO
                continue
            # Lado: o ponto da frente do círculo nessa coluna, descendo do topo à base.
            front = 2 * c + math.sqrt(r2 - a * a)
            z = (front * TILE_H / 2 - sy) / UNIT
            if 0 <= z <= height:
                t = (a / math.sqrt(r2) + 1) / 2  # 0 = borda esquerda, 1 = direita
                px[qx, py] = LADO[min(len(LADO) - 1, int(t * len(LADO)))]
    outline(im)
    return im


models = []
for cols, rows in ((1, 1), (2, 1), (1, 2), (2, 2)):
    for height in (1, 2):
        models.append((f'cubo-{cols}x{rows}-h{height}', box(cols, rows, height)))
for n in (1, 2):
    for height in (1, 2):
        models.append((f'cilindro-{n}x{n}-h{height}', cylinder(n, height)))

os.makedirs(OUT, exist_ok=True)
for name, im in models:
    im.save(os.path.join(OUT, f'{name}.png'))

# Prévia: todos lado a lado, em 4x, alinhados pela base, num fundo de grama.
scale, gap = 4, 8
width = sum(im.size[0] for _, im in models) + gap * (len(models) + 1)
height = max(im.size[1] for _, im in models) + gap * 2
sheet = Image.new('RGBA', (width, height), (98, 152, 88, 255))
x = gap
for _, im in models:
    sheet.alpha_composite(im, (x, height - gap - im.size[1]))
    x += im.size[0] + gap
sheet.resize((width * scale, height * scale), Image.NEAREST).save(os.path.join(OUT, 'previa.png'))
print('\n'.join(f'{name}: {im.size[0]}x{im.size[1]}' for name, im in models))
