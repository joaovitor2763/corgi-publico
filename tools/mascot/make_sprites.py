# Chosen sheet poses → 4x upscaled, clean-alpha, uniformly framed sprites for the app.
import cv2, json, numpy as np, sys, torch
from PIL import Image
from spandrel import ModelLoader
from hy3dgen.rembg import BackgroundRemover
PICKS = {  # name: (figure, relative scale)
  "sit": ("s3_39", 1.0), "sit-happy": ("s5_39", 1.0), "sit-tilt": ("s3_11", 1.0),
  "wave": ("s5_37", 1.0), "jump": ("s3_03", 1.0), "laptop": ("s2_34", 1.0),
  "typing": ("s2_28", 1.0), "think": ("s5_34", 1.0), "idea": ("s2_29", 1.0),
  "run": ("s5_36", 1.0), "sleep": ("s2_27", 1.0), "lie": ("s3_43", 1.0),
  "listen": ("s5_30", 1.0), "read": ("s5_29", 1.0), "coffee": ("s3_18", 1.0),
}
only = sys.argv[1:]
idx = {i["name"]: i for i in json.load(open("sprites/all/index.json"))}
dev = "mps" if torch.backends.mps.is_available() else "cpu"
sr = ModelLoader().load_from_file("sr/RealESRGAN_x4plus.pth").to(dev).eval()
rm = BackgroundRemover()
out = {}
for name, (fig, _) in PICKS.items():
    if only and name not in only: continue
    it = idx[fig]; n = it["sheet"]; x, y, w, h = it["box"]
    src = np.array(Image.open(f"ref/ChatGPT Image Sep 23, 2026 at 02_01_11 PM ({n}).png").convert("RGB"))
    alpha = np.load(f"sprites/masks/{n}.npy")
    P = 10; X0, Y0 = max(0, x - P), max(0, y - P); X1, Y1 = min(src.shape[1], x + w + P), min(src.shape[0], y + h + P)
    # Keep only this figure: its component of the sheet mask, dilated a little.
    m = (alpha > 60).astype(np.uint8); m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    _, lab = cv2.connectedComponents(m, connectivity=8)
    cy, cx = y + h // 2, x + w // 2
    ids, counts = np.unique(lab[y:y+h, x:x+w][lab[y:y+h, x:x+w] > 0], return_counts=True)
    own = cv2.dilate(np.isin(lab, ids[counts >= 40]).astype(np.uint8), np.ones((9, 9), np.uint8))[Y0:Y1, X0:X1]
    crop = src[Y0:Y1, X0:X1]
    with torch.no_grad():
        t = torch.from_numpy(crop).permute(2, 0, 1).float().div(255).unsqueeze(0).to(dev)
        big = (sr(t).clamp(0, 1)[0].permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)
    H, W = big.shape[:2]
    a = np.array(rm(Image.fromarray(big)))[..., 3].astype(np.float32)
    keep = cv2.resize(own, (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    a = a * keep
    # Largest blob only, soft edge preserved.
    hard = (a > 40).astype(np.uint8); cnt, l2, st, _ = cv2.connectedComponentsWithStats(hard, 8)
    if cnt > 1:
        # The figure plus its props (bulb, "…" bubble); specks from neighbours are dropped.
        areas = st[1:, cv2.CC_STAT_AREA]; keep_ids = [i + 1 for i, v in enumerate(areas) if v >= areas.max() * 0.004]
        a = a * cv2.dilate(np.isin(l2, keep_ids).astype(np.uint8), np.ones((5, 5), np.uint8))
    rgba = Image.fromarray(np.dstack([big, a.clip(0, 255).astype(np.uint8)]))
    rgba = rgba.crop(rgba.getbbox())
    rgba.save(f"sprites/raw-{name}.png"); out[name] = rgba.size
    print(name, rgba.size, flush=True)
