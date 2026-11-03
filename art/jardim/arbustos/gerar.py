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

def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def build(profile, leaves, wood, fruit=None):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    L0, L1, L2, L3, L4 = leaves  # escuro → claro
    occ = {}
    y = profile['top']
    canopy_bottom = None
    tiers = profile['tiers']
    total_rows = sum(len(t) for t in tiers)
    max_hw = max(max(t) for t in tiers)
    canopy_top = profile['top']
    for tier in tiers:
        n = len(tier)
        for i, hw in enumerate(tier):
            left = int(C + 0.5 - hw)
            right = int(C + 0.5 + hw) - 1
            for x in range(left, right + 1):
                # Volume arredondado com luz de cima à esquerda: posição na copa
                # inteira (nx, ny de -1 a 1) e, na camada, o arco da sombra de
                # baixo (mais grosso nas pontas, fino no meio, como um disco visto de cima).
                nx = (x + 0.5 - C) / max_hw
                ny = ((y - canopy_top) / max(1, total_rows - 1)) * 2 - 1
                lx = (x + 0.5 - C) / max(1, hw)
                v = i / max(1, n - 1) if n > 1 else 0.0
                s_ = 0.55 * nx + 0.35 * ny
                lit_until = 0.45 + 0.4 * (1 - lx * lx)
                if n > 1 and v > lit_until:
                    s_ += 0.55
                if i == 0 and abs(lx) < 0.7:
                    s_ -= 0.25
                if s_ < -0.45:
                    tone = 4
                elif s_ < -0.1:
                    tone = 3
                elif s_ < 0.3:
                    tone = 2
                elif s_ < 0.65:
                    tone = 1
                else:
                    tone = 0
                occ[(x, y)] = leaves[tone]
            y += 1
        canopy_bottom = y - 1
    # pontas caídas embaixo da copa
    for dx in profile['tips']:
        x = int(C + 0.5 + dx) - 1
        for xx in (x, x + 1):
            occ[(xx, canopy_bottom + 1)] = L1 if dx > 0 else L2
    # tronco: 2 de largura até o pé
    trunk_top = canopy_bottom + 1
    trunk = set()
    # O tronco começa colado na copa (na linha das pontas), sem buraco entre os dois.
    for yy in range(trunk_top, 27):
        for x, c in ((10, CONTORNO), (11, wood[2]), (12, wood[1]), (13, CONTORNO)):
            if (x, yy) not in occ:
                occ[(x, yy)] = c
                trunk.add((x, yy))
    # raízes: losango pequeno no chão (linhas 27-31)
    for yy, hw in zip(range(27, 32), (2, 3, 4, 3, 1)):
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

for key, b in BERRIES.items():
    prof = PROFILES[b['shape']]
    build(prof, b['leaves'], b['wood']).save(f'{OUT}/arbusto-{key}.png')
    build(prof, b['leaves'], b['wood'], b['fruit']).save(f'{OUT}/arbusto-{key}-frutos.png')
print('ok', len(BERRIES))
