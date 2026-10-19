"""Genera le icone della PWA in public/icons/ (python3 scripts/crea-icone.py)."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
NAVY = (31, 42, 68)
TOP, LEFT, RIGHT, AMBRA = (245, 247, 252), (196, 205, 225), (150, 162, 192), (242, 169, 59)

def disegna(n):
    k = 4  # supercampionamento per bordi lisci
    S = n * k
    im = Image.new('RGB', (S, S), NAVY)
    d = ImageDraw.Draw(im)
    c = S / 2
    r = S * 0.27            # lato dell'esagono: tiene tutto nella zona sicura (maschera)
    h = r * 0.866
    cy = c + r * 0.02
    P = lambda dx, dy: (c + dx * r, cy + dy * r)
    top = [P(0, -1), P(.866, -.5), P(0, 0), P(-.866, -.5)]
    left = [P(-.866, -.5), P(0, 0), P(0, 1), P(-.866, .5)]
    right = [P(.866, -.5), P(0, 0), P(0, 1), P(.866, .5)]
    d.polygon(top, fill=TOP)
    d.polygon(left, fill=LEFT)
    d.polygon(right, fill=RIGHT)
    # etichetta ambra sul lato sinistro
    d.polygon([P(-.62, -.14), P(-.30, .04), P(-.30, .38), P(-.62, .20)], fill=AMBRA)
    return im.resize((n, n), Image.LANCZOS)

for nome, n in [('icon-192.png', 192), ('icon-512.png', 512), ('icon-maskable-512.png', 512),
                ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
    disegna(n).save(os.path.join(OUT, nome))
print('icone create')
