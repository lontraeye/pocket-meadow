# Arbusto em bloco (decoração que bloqueia o passeio), a partir do desenho do
# usuário (art/jardim/decoracao/arbusto-bloco-base.png: topo, face esquerda,
# face direita e contorno). Rodar desta pasta:
#   python gerar-arbusto-bloco.py
# Gera arbusto-bloco.png: sombreado com luz de cima à esquerda, borda do topo
# com ondinhas e um ruído de folhinhas nas faces.
from PIL import Image

W, H = 24, 32
CONTORNO = (39, 45, 56)
# rampas (escuro → claro), da paleta de folhagem do jardim
G = [(29, 76, 31), (48, 110, 38), (78, 143, 47), (120, 176, 61), (172, 209, 85)]
FACE = {'L': 3, 'M': 2, 'D': 1}  # tom base de cada face no índice de G


def h(x, y, salt=0):
    """Ruído fixo por pixel (0..1), para o padrão não mudar a cada geração."""
    n = (x * 374761393 + y * 668265263 + salt * 2147483647) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return (n ^ (n >> 16)) / 0xFFFFFFFF


def load_faces(path):
    im = Image.open(path).convert('RGBA')
    faces = {}
    for y in range(H):
        for x in range(W):
            r, g, b, a = im.getpixel((x, y))
            if a == 0:
                continue
            c = (r, g, b)
            near = lambda ref: sum(abs(c[i] - ref[i]) for i in range(3)) < 12
            if near(CONTORNO):
                faces[(x, y)] = 'o'
            elif near(G[3]):
                faces[(x, y)] = 'L'
            elif near(G[2]):
                faces[(x, y)] = 'M'
            elif near(G[1]):
                faces[(x, y)] = 'D'
            else:
                faces[(x, y)] = '*'  # guia do chão misturada: decide abaixo
    # guia: na borda vira contorno; por dentro, a face que mais aparece em volta
    for (x, y), f in list(faces.items()):
        if f != '*':
            continue
        around = [faces.get((x + dx, y + dy)) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
        if None in around:
            faces[(x, y)] = 'o'
        else:
            greens = [a for a in around if a in FACE]
            faces[(x, y)] = max(set(greens), key=greens.count) if greens else 'o'
    return faces


def build(faces):
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = out.load()
    top = [p for p, f in faces.items() if f == 'L']
    tx0, tx1 = min(x for x, _ in top), max(x for x, _ in top)
    ty0, ty1 = min(y for _, y in top), max(y for _, y in top)
    side = [p for p, f in faces.items() if f in ('M', 'D')]
    sy0, sy1 = min(y for _, y in side), max(y for _, y in side)

    tone = {}
    for (x, y), f in faces.items():
        if f not in FACE:
            continue
        t = FACE[f]
        if f == 'L':
            # topo: cúpula com luz de cima à esquerda
            nx = (x - tx0) / max(1, tx1 - tx0) * 2 - 1
            ny = (y - ty0) / max(1, ty1 - ty0) * 2 - 1
            s = 0.6 * nx + 0.5 * ny
            if s < -0.55:
                t = 4
            elif s > 0.55:
                t = 2
        else:
            # laterais: escurecem para baixo e para fora do canto da frente
            v = (y - sy0) / max(1, sy1 - sy0)
            if v > 0.7:
                t -= 1
        tone[(x, y)] = t

    # borda do topo com ondinhas: o topo desce 1 px sobre as laterais em alguns pontos
    for (x, y), f in list(faces.items()):
        if f == 'L' and faces.get((x, y + 1)) in ('M', 'D') and (x % 3 != 0 or h(x, y, 7) < 0.3):
            tone[(x, y + 1)] = max(2, tone[(x, y)] - 1)
            # a sombra que a folhagem do topo faz logo abaixo
            if faces.get((x, y + 2)) in ('M', 'D'):
                tone[(x, y + 2)] = max(0, tone.get((x, y + 2), 1) - 1)

    # ruído de folhinhas: traço curto na diagonal, um tom abaixo, com brilho em cima
    for (x, y), t in list(tone.items()):
        f = faces[(x, y)]
        density = 0.16 if f == 'L' else 0.24
        if h(x, y, 3) > density:
            continue
        a, b = (x, y), (x + 1, y - 1)
        if b not in tone:
            continue
        tone[a] = max(0, tone[a] - 1)
        tone[b] = max(0, tone[b] - 1)
        hi = (x, y - 1)
        if hi in tone and h(x, y, 5) < 0.6:
            tone[hi] = min(4, tone[hi] + 1)

    for (x, y), f in faces.items():
        if f == 'o':
            px[x, y] = CONTORNO + (255,)
        else:
            px[x, y] = G[tone[(x, y)]] + (255,)
    return out


faces = load_faces('arbusto-bloco-base.png')
build(faces).save('arbusto-bloco.png')
print('ok')
