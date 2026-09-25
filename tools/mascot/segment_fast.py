# One background-removal pass per sheet; figures are cut from that mask (fast contact sheets).
import cv2, json, numpy as np, os
from PIL import Image, ImageDraw
from hy3dgen.rembg import BackgroundRemover
rm = BackgroundRemover()
index = []
for n in range(1, 7):
    src = Image.open(f"ref/ChatGPT Image Sep 23, 2026 at 02_01_11 PM ({n}).png").convert("RGB")
    alpha = np.array(rm(src))[..., 3]
    np.save(f"sprites/masks/{n}.npy", alpha)
    mask = (alpha > 60).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    count, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    for i in range(1, count):
        x, y, w, h, a = stats[i]
        if a < 3000 or h < 50: continue
        rgba = np.dstack([np.array(src), np.where(labels == i, alpha, 0)])[y:y+h, x:x+w]
        name = f"s{n}_{len([k for k in index if k['sheet']==n]):02d}"
        Image.fromarray(rgba.astype(np.uint8)).save(f"sprites/all/{name}.png")
        index.append({"name": name, "sheet": n, "box": [int(x), int(y), int(w), int(h)]})
    print("sheet", n, len([k for k in index if k['sheet']==n]), flush=True)
json.dump(index, open("sprites/all/index.json", "w"))
for n in range(1, 7):
    items = sorted([i for i in index if i["sheet"] == n], key=lambda i: (i["box"][1] // 120, i["box"][0]))
    cols, W = 8, 170
    sheet = Image.new("RGB", (cols * W, max(1, (len(items) + cols - 1) // cols) * (W + 16)), "white")
    d = ImageDraw.Draw(sheet)
    for k, it in enumerate(items):
        im = Image.open(f"sprites/all/{it['name']}.png"); im.thumbnail((W - 8, W - 8))
        x, y = (k % cols) * W, (k // cols) * (W + 16)
        sheet.paste(im, (x + (W - im.width) // 2, y + (W - im.height) // 2), im)
        d.text((x + 4, y + W), it["name"], fill=(200, 0, 0))
    sheet.save(f"sprites/contact-{n}.png")
