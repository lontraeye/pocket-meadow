# Esqueletos de arte para editar no Piskel (PLANNING.md, 5.22/5.23). Rodar desta pasta:
#   python gerar-modelos.py
# Gera cubo-isometrico.piskel e graminha.piskel (e PNGs de prévia). Tudo em
# 24x32, com a última linha na ponta de baixo do losango do chão (24x12), como
# a máquina: assim o jogo encaixa sem ajuste.
import base64
import io
import json

from PIL import Image

W, H = 24, 32
CONTORNO = (39, 45, 56, 255)


def diamond_rows(y0):
    """Linhas do losango 24x12 a partir de y0: (y, x_ini, x_fim)."""
    for i in range(12):
        half = 2 * (i + 1) if i < 6 else 2 * (12 - i)
        yield y0 + i, 12 - half, 12 + half - 1


def floor_guide():
    # Contorno do losango do chão (linhas 20-31), para alinhar a peça.
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    for y, a, b in diamond_rows(20):
        px[a, y] = (255, 64, 160, 255)
        px[b, y] = (255, 64, 160, 255)
    return im


def cube_guide(height=10):
    # Cubo: topo (claro), face esquerda (média), face direita (escura). A base
    # é o losango do chão; o topo sobe `height` pixels.
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    top, left, right = (196, 200, 206, 255), (150, 156, 164, 255), (104, 110, 120, 255)

    def foot_low(x):
        return 26 + (x // 2 if x < 12 else (23 - x) // 2)

    for x in range(W):
        lo = foot_low(x)
        for y in range(lo - height + 1, lo + 1):
            px[x, y] = left if x < 12 else right
    for y, a, b in diamond_rows(20 - height):
        for x in range(a, b + 1):
            px[x, y] = top
    src = im.copy()
    sp = src.load()
    for y in range(H):
        for x in range(W):
            if sp[x, y][3] and any(
                not (0 <= x + dx < W and 0 <= y + dy < H) or sp[x + dx, y + dy][3] == 0
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            ):
                px[x, y] = CONTORNO
    return im


def grass_layers():
    # Fios de grama de exemplo: os que nascem na metade de trás do losango vão
    # para "Trás" (atrás do Pokémon); os da metade da frente, para "Frente"
    # (por cima dos pés dele). Luz de cima à esquerda.
    back = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    front = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dark, mid, light = (46, 112, 68, 255), (67, 145, 76, 255), (103, 178, 95, 255)
    blades = [
        (6, 24, 4), (9, 23, 6), (12, 22, 5), (15, 23, 6), (18, 24, 4),  # trás
        (4, 26, 3), (8, 27, 5), (11, 28, 6), (14, 27, 5), (17, 28, 4), (20, 26, 3), (10, 30, 3), (13, 30, 4),  # frente
    ]
    center = 25.5
    for x, base, h in blades:
        layer = back if base < center else front
        px = layer.load()
        for k in range(h):
            y = base - k
            c = light if k == h - 1 else (mid if k > 0 else dark)
            px[x, y] = c
            if k < h // 2:
                px[x + 1, y] = dark  # o lado direito na sombra
    return back, front


def b64(im):
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def piskel(name, layers):
    data = {
        'modelVersion': 2,
        'piskel': {
            'name': name,
            'description': '',
            'fps': 12,
            'height': H,
            'width': W,
            'layers': [
                json.dumps({'name': lname, 'opacity': op, 'frameCount': 1, 'chunks': [{'layout': [[0]], 'base64PNG': b64(im)}]})
                for lname, im, op in layers
            ],
            'hiddenFrames': [''],
        },
    }
    with open(f'{name}.piskel', 'w') as f:
        json.dump(data, f)


empty = Image.new('RGBA', (W, H), (0, 0, 0, 0))
floor = floor_guide()
cube = cube_guide()
back, front = grass_layers()

piskel('cubo-isometrico', [('Chão (guia)', floor, 0.6), ('Cubo (guia)', cube, 0.5), ('Desenho', empty, 1)])
piskel('graminha', [('Chão (guia)', floor, 0.6), ('Trás', back, 1), ('Frente', front, 1)])

prev = Image.new('RGBA', (W, H), (0, 0, 0, 0))
prev.alpha_composite(cube)
prev.save('cubo-isometrico.png')
prev = Image.new('RGBA', (W, H), (0, 0, 0, 0))
prev.alpha_composite(back)
prev.alpha_composite(front)
prev.save('graminha.png')
print('ok')
