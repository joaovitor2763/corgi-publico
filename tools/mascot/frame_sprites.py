# Uniform frame: square canvas, feet on the bottom edge, centered; shared scale across poses.
import json, sys
from PIL import Image, ImageDraw
SCALE = {"sit-tilt": 0.86, "jump": 0.72, "laptop": 0.86, "typing": 0.9, "think": 1.18, "idea": 0.86, "sleep": 0.8, "lie": 0.8, "coffee": 0.82, "run": 0.95}
C, OUT = 800, 384
names = ["sit","sit-happy","sit-tilt","wave","jump","laptop","typing","think","idea","run","sleep","lie","listen","read","coffee"]
line = Image.new("RGB", (len(names) * 200, 230), "white"); d = ImageDraw.Draw(line)
for i, n in enumerate(names):
    im = Image.open(f"sprites/raw-{n}.png"); k = SCALE.get(n, 1.0)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    canvas = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    canvas.paste(im, ((C - im.width) // 2, C - im.height - 12), im)
    final = canvas.resize((OUT, OUT), Image.LANCZOS)
    final.save(f"sprites/final-{n}.png", optimize=True)
    th = canvas.resize((200, 200), Image.LANCZOS); line.paste(th, (i * 200, 0), th)
    d.line([(i*200, 199), (i*200+199, 199)], fill=(220,220,220)); d.text((i * 200 + 6, 208), n, fill=(200, 0, 0))
line.save("sprites/lineup.png")
