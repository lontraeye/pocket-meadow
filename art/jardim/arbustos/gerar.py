# Arbustos de berry: perfil da copa por camadas, sombreado com luz de cima à
# esquerda, raízes em losango no chão (centro 2 px acima da última linha).
import sys
from PIL import Image
OUT = sys.argv[1]
W, H = 24, 32
C = 11.5  # centro
CONTORNO = (39, 45, 56)

# Perfis: lista de camadas; cada camada = lista de meias-larguras por linha.
PROFILES = {
    # o do usuário: cone em camadas
    'cone': dict(top=4, tiers=[[1, 2, 3, 4, 5, 6], [5, 6, 5], [7, 8, 7], [5, 7, 8, 7]], tips=[-3, 0, 3]),
    # redondo (Pinap): menos camadas, mais cheio
    'redondo': dict(top=5, tiers=[[2, 4, 5, 6, 7], [6, 7, 8, 8, 7], [7, 8, 8, 7, 5]], tips=[-4, -1, 2, 5]),
    # alto e fino (Nanab)
    'alto': dict(top=2, tiers=[[1, 2, 3, 4], [3, 4, 5], [4, 5, 6], [5, 6, 7], [5, 6, 6, 5]], tips=[-2, 1]),
}

# Mudas: o mesmo formato, menor, com tronco curto e raízes pequenas.
MUDAS = {
    'cone': dict(top=17, tiers=[[1, 2, 3], [2, 3, 4, 3]], tips=[], roots=(1, 2, 2, 1)),
    'redondo': dict(top=18, tiers=[[2, 3, 4], [4, 4, 3]], tips=[], roots=(1, 2, 2, 1)),
    'alto': dict(top=15, tiers=[[1, 2], [2, 3], [2, 3, 3]], tips=[], roots=(1, 2, 2, 1)),
}

TERRA = [(89, 52, 37), (128, 85, 52), (166, 129, 76)]

def seed(fruit):
    # Semente: um montinho de terra no centro do bloco com um pixel da semente
    # (na cor da berry) aparecendo. Última linha = 31, como os arbustos.
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    mound = {29: (10, 13), 30: (9, 14), 31: (10, 13)}
    for yy, (a, b) in mound.items():
        for x in range(a, b + 1):
            t = (x - a) / max(1, b - a)
            px[x, yy] = (TERRA[2] if t < 0.4 and yy < 31 else TERRA[1] if t < 0.75 else TERRA[0]) + (255,)
    for yy, (a, b) in mound.items():
        px[a, yy] = CONTORNO + (255,)
        px[b, yy] = CONTORNO + (255,)
    for x in range(11, 13):
        px[x, 28] = CONTORNO + (255,)
    px[11, 29] = fruit[1] + (255,)
    px[12, 29] = fruit[0] + (255,)
    return im

def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def build(profile, leaves, wood, fruit=None):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    L0, L1, L2, L3, L4 = leaves  # escuro → claro
    occ = {}
    tiers = profile['tiers']
    total_rows = sum(len(t) for t in tiers)
    max_hw = max(max(t) for t in tiers)
    canopy_top = profile['top']
    # Linha de cada camada (de cima para baixo).
    starts = []
    y = canopy_top
    for tier in tiers:
        starts.append(y)
        y += len(tier)
    canopy_bottom = y - 1

    def tone_at(x, yy, hw, i, n):
        # Volume arredondado com luz de cima à esquerda.
        nx = (x + 0.5 - C) / max_hw
        ny = ((yy - canopy_top) / max(1, total_rows - 1)) * 2 - 1
        lx = (x + 0.5 - C) / max(1, hw)
        s_ = 0.55 * nx + 0.35 * ny
        if i == 0 and abs(lx) < 0.7:
            s_ -= 0.25
        if s_ < -0.45:
            return 4
        if s_ < -0.1:
            return 3
        if s_ < 0.3:
            return 2
        if s_ < 0.65:
            return 1
        return 0

    # De baixo para cima: cada camada passa por cima do topo da de baixo com a
    # borda de baixo em arco (desce no meio, sobe nas pontas) e umas ondinhas,
    # como uma saia vista um pouco de cima. A divisória escura segue essa borda.
    for t in range(len(tiers) - 1, -1, -1):
        tier = tiers[t]
        n = len(tier)
        y0 = starts[t]
        for i, hw in enumerate(tier):
            yy = y0 + i
            left = int(C + 0.5 - hw)
            right = int(C + 0.5 + hw) - 1
            for x in range(left, right + 1):
                occ[(x, yy)] = leaves[tone_at(x, yy, hw, i, n)]
        # saia em arco embaixo da camada
        hw = tier[-1]
        yb = y0 + n - 1
        left = int(C + 0.5 - hw)
        right = int(C + 0.5 + hw) - 1
        last = t == len(tiers) - 1
        for x in range(left + 1, right):
            lx = (x + 0.5 - C) / max(1, hw)
            depth = 1 if abs(lx) < 0.55 else 0
            if abs(lx) < 0.85 and (x - left) % 4 in (1, 2):
                depth += 1
            # A saia leva a cor da própria camada; só a ponta de baixo é a
            # divisória (um tom abaixo), que assim acompanha a curva.
            for d in range(0, depth):
                occ[(x, yb + d)] = leaves[tone_at(x, yb + d, hw, n - 1, n)]
            tone = tone_at(x, yb + depth, hw, n - 1, n)
            occ[(x, yb + depth)] = leaves[max(0, min(tone, 2) - 1)]
        canopy_bottom = max(canopy_bottom, yb + (1 if last else 0))
    # tronco: 2 de largura até o pé
    trunk_top = canopy_bottom + 1
    trunk = set()
    # O tronco começa colado na copa (na linha das pontas), sem buraco entre os dois.
    roots = profile.get('roots', (2, 3, 4, 3, 1))
    roots_top = 32 - len(roots)
    for yy in range(trunk_top, roots_top):
        for x, c in ((10, CONTORNO), (11, wood[2]), (12, wood[1]), (13, CONTORNO)):
            if (x, yy) not in occ:
                occ[(x, yy)] = c
                trunk.add((x, yy))
    # raízes: losango pequeno no chão (até a linha 31)
    for yy, hw in zip(range(roots_top, 32), roots):
        left = int(C + 0.5 - hw)
        right = int(C + 0.5 + hw) - 1
        for x in range(left, right + 1):
            t = (x - left) / max(1, right - left)
            occ[(x, yy)] = wood[2] if t < 0.45 else wood[1] if t < 0.8 else wood[0]
    # contorno por fora da silhueta (folhas: o tom mais escuro; madeira: contorno)
    for (x, yy), c in occ.items():
        px[x, yy] = c + (255,)
    final = im.copy()
    fp = final.load()
    for (x, yy) in occ:
        if (x, yy) in trunk:
            continue
        edge = any((x + dx, yy + dy) not in occ for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            isleaf = yy <= canopy_bottom + 1
            fp[x, yy] = (L0 if isleaf else CONTORNO) + (255,)
    # frutas: 2x2 com brilho, em lugares da copa
    if fruit:
        main, light, dark = fruit
        spots = profile.get('fruits') or auto_spots(occ, canopy_bottom, profile)
        for (x, yy) in spots:
            fp[x, yy] = light + (255,)
            fp[x + 1, yy] = main + (255,)
            fp[x, yy + 1] = main + (255,)
            fp[x + 1, yy + 1] = dark + (255,)
    return final

def auto_spots(occ, bottom, profile):
    # 5 frutas: espalhadas pela copa, longe da borda
    rows = sorted({y for (_, y) in occ if y <= bottom})
    top, bot = rows[0], bottom
    picks = []
    targets = [(0.35, -3), (0.35, 2), (0.6, -5), (0.6, 0), (0.6, 4), (0.85, -2), (0.85, 3)]
    for fy, fx in targets:
        y = round(top + (bot - top) * fy)
        x = int(C + 0.5 + fx) - 1
        ok = all((x + dx, y + dy) in occ for dx in (-1, 0, 1, 2) for dy in (0, 1))
        if ok and all(abs(x - px_) > 2 or abs(y - py_) > 2 for px_, py_ in picks):
            picks.append((x, y))
    return picks[:6]

WOOD = [(51, 27, 23), (89, 52, 37), (128, 85, 52)]
GRAY_WOOD = [(58, 62, 71), (94, 103, 116), (129, 148, 161)]
BERRIES = {
    'oran': dict(shape='cone', leaves=[(20, 58, 60), (30, 96, 88), (48, 136, 108), (86, 176, 128), (148, 214, 160)],
                 fruit=[(64, 112, 216), (140, 190, 255), (34, 60, 140)], wood=WOOD),
    'razz': dict(shape='cone', leaves=[(62, 28, 40), (44, 90, 50), (62, 130, 60), (102, 170, 80), (162, 210, 120)],
                 fruit=[(206, 40, 72), (255, 130, 150), (120, 18, 44)], wood=WOOD),
    'lum': dict(shape='cone', leaves=[(18, 46, 30), (30, 80, 44), (46, 116, 58), (78, 156, 74), (128, 194, 100)],
                fruit=[(150, 222, 70), (215, 250, 150), (70, 140, 40)], wood=WOOD),
    'golden-razz': dict(shape='cone', leaves=[(60, 48, 20), (100, 88, 30), (140, 128, 42), (186, 170, 70), (230, 214, 130)],
                        fruit=[(250, 196, 50), (255, 240, 170), (180, 120, 24)], wood=WOOD),
    'pinap': dict(shape='redondo', leaves=[(40, 68, 26), (70, 108, 32), (108, 148, 42), (158, 188, 62), (208, 224, 110)],
                  fruit=[(244, 204, 40), (255, 242, 150), (176, 128, 18)], wood=WOOD),
    'silver-pinap': dict(shape='redondo', leaves=[(40, 50, 56), (78, 98, 94), (118, 138, 128), (164, 184, 170), (214, 228, 216)],
                         fruit=[(214, 218, 228), (252, 252, 255), (136, 142, 158)], wood=GRAY_WOOD),
    'nanab': dict(shape='alto', leaves=[(52, 38, 60), (60, 100, 70), (88, 140, 90), (140, 186, 120), (200, 226, 170)],
                  fruit=[(244, 130, 172), (255, 204, 222), (168, 66, 110)], wood=WOOD),
}

def dead():
    # Arbusto seco (um só para todas as berries), num formato próprio e baixo:
    # tronco curto, três galhos pelados abrindo em leque e tufinhos de folha
    # seca nas pontas, com uma folha caída no chão. Luz de cima à esquerda.
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    twig_l, twig_d = (138, 118, 98), (96, 80, 66)
    dry = [(104, 76, 46), (150, 112, 64), (192, 156, 96)]  # escuro, meio, claro
    occ = {}

    def line(x0, y0, x1, y1, light):
        n = max(abs(x1 - x0), abs(y1 - y0))
        for k in range(n + 1):
            x = round(x0 + (x1 - x0) * k / n)
            y = round(y0 + (y1 - y0) * k / n)
            occ[(x, y)] = twig_l if light else twig_d

    # tronco (2 de largura, claro à esquerda) e um leve torto
    for y in range(22, 28):
        occ[(11, y)] = twig_l
        occ[(12, y)] = twig_d
    occ[(12, 21)] = twig_d
    occ[(11, 21)] = twig_l
    # galhos
    line(11, 21, 6, 16, True)
    line(12, 21, 13, 14, False)
    line(12, 22, 17, 17, False)
    line(8, 18, 5, 19, True)  # galhinho de lado

    def tuft(cx, cy, shape):
        for dx, dy in shape:
            tone = 2 if dx < 0 and dy < 0 else 0 if dx > 0 and dy >= 0 else 1
            occ[(cx + dx, cy + dy)] = dry[tone]

    tuft(6, 15, [(-1, 0), (0, 0), (1, 0), (0, -1), (-1, -1), (0, 1)])
    tuft(13, 13, [(-1, 0), (0, 0), (1, 0), (0, -1), (1, -1)])
    tuft(17, 16, [(0, 0), (1, 0), (0, -1), (1, 1), (-1, 0)])
    tuft(4, 19, [(0, 0), (1, 0)])
    # folha caída no chão, à direita
    occ[(16, 29)] = dry[1]
    occ[(17, 29)] = dry[0]
    # raízes pequenas
    for y, (a_, b_) in {28: (10, 13), 29: (9, 14), 30: (10, 13)}.items():
        for x in range(a_, b_ + 1):
            occ[(x, y)] = twig_l if x < 12 else twig_d
    for (x, y), c in occ.items():
        px[x, y] = c + (255,)
    # contorno por fora de tudo
    out = im.copy()
    op = out.load()
    for y in range(H):
        for x in range(W):
            if px[x, y][3] == 0 and any(
                0 <= x + dx < W and 0 <= y + dy < H and px[x + dx, y + dy][3] > 0
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            ):
                op[x, y] = CONTORNO + (255,)
    return out

dead().save(f'{OUT}/arbusto-seco.png')

for key, b in BERRIES.items():
    prof = PROFILES[b['shape']]
    build(prof, b['leaves'], b['wood']).save(f'{OUT}/arbusto-{key}.png')
    build(prof, b['leaves'], b['wood'], b['fruit']).save(f'{OUT}/arbusto-{key}-frutos.png')
    build(MUDAS[b['shape']], b['leaves'], b['wood']).save(f'{OUT}/arbusto-{key}-muda.png')
    seed(b['fruit']).save(f'{OUT}/arbusto-{key}-semente.png')
print('ok', len(BERRIES))
