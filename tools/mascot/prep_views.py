# Builds consistent 512px RGBA views for multi-view generation from sheet crops.
import cv2, numpy as np
from PIL import Image, ImageOps
from hy3dgen.rembg import BackgroundRemover

def largest(im):
    """Keep only the largest connected blob: crops of a sheet catch bits of neighbors."""
    a = np.array(im)
    n, labels, stats, _ = cv2.connectedComponentsWithStats((a[..., 3] > 40).astype(np.uint8), 8)
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    a[..., 3] = np.where(labels == keep, a[..., 3], 0)
    out = Image.fromarray(a)
    return out.crop(out.getbbox())

rm = BackgroundRemover()
cut = {k: largest(rm(Image.open(f"ref/crop-s5-{k}.png").convert("RGB"))) for k in ["front", "left", "back"]}
cut["right"] = ImageOps.mirror(cut["left"])  # symmetric plush; the sheet's right view was clipped
H = max(v.height for v in cut.values())
side = int(max(H * 1.18, max(v.width for v in cut.values()) * 1.06))
sheet = Image.new("RGB", (4 * 300, 300), "white")
for i, k in enumerate(["front", "left", "back", "right"]):
    v = cut[k].resize((int(cut[k].width * H / cut[k].height), H), Image.LANCZOS)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(v, ((side - v.width) // 2, side - v.height - (side - H) // 2))  # same scale, same floor
    canvas = canvas.resize((512, 512), Image.LANCZOS)
    canvas.save(f"mv/{k}.png")
    bg = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
    bg.alpha_composite(canvas)
    sheet.paste(bg.convert("RGB").resize((300, 300)), (i * 300, 0))
sheet.save("mv/contact.png")
import json
# Framing for projection: the model's height spans H/side of each square image, centered.
json.dump({"height_fraction": H / side, "views": {"front": 0, "left": 90, "back": 180, "right": 270}},
          open("mv/views.json", "w"))
print("ok")
