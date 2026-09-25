# sit-blink: the sitting pose with its eyes closed (inpaint the eyes, draw closed lids).
import cv2, numpy as np
from PIL import Image
im = np.array(Image.open("sprites/final-sit.png"))
rgb = cv2.cvtColor(im[..., :3], cv2.COLOR_RGB2BGR)
mask = np.zeros(rgb.shape[:2], np.uint8)
EYES = [(150, 178), (226, 178)]
for cx, cy in EYES:
    cv2.ellipse(mask, (cx, cy), (15, 16), 0, 0, 360, 255, -1)
filled = cv2.inpaint(rgb, mask, 7, cv2.INPAINT_TELEA)
filled = cv2.GaussianBlur(filled, (5, 5), 0) * (mask[..., None] / 255.0) + filled * (1 - mask[..., None] / 255.0)
filled = filled.astype(np.uint8)
# Closed lids: a soft downward arc with a tiny lash tick at the outer corner, drawn at 4x for AA.
S = 4
big = cv2.resize(filled, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
for i, (cx, cy) in enumerate(EYES):
    side = -1 if i == 0 else 1
    pts = np.array([[(cx + t * 12) * S, (cy + 2 + 5 * (1 - t * t)) * S] for t in np.linspace(-1, 1, 24)], np.int32)
    cv2.polylines(big, [pts], False, (22, 18, 18), 3 * S, cv2.LINE_AA)
out = cv2.resize(big, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_AREA)
res = np.dstack([cv2.cvtColor(out, cv2.COLOR_BGR2RGB), im[..., 3]])
Image.fromarray(res).save("sprites/final-sit-blink.png", optimize=True)
bg = Image.new("RGBA", (384, 384), "white"); bg.alpha_composite(Image.fromarray(res))
bg.crop((100, 100, 290, 240)).resize((380, 280)).save("sprites/blink-preview.png")
