# A generated Regi clip (mp4 on a flat background) → transparent spritesheet for the app.
#
#   python clip_to_sheet.py <clip.mp4> <out_prefix> [--fps 20] [--size 256] [--cols 8] [--trim a:b]
#
# Frames are matted one by one, then the alpha is smoothed over time (median of 5 frames) so fur
# edges don't shimmer. Every frame keeps the clip's framing (no per-frame crop), so the character
# never jumps. Writes <out_prefix>.webp (grid of frames) and <out_prefix>.json (frame count, fps,
# cols, cell size) plus <out_prefix>-preview.png (first/middle/last frames on white).
import argparse, json, os, subprocess, tempfile
import cv2, numpy as np
from PIL import Image
from hy3dgen.rembg import BackgroundRemover

ap = argparse.ArgumentParser()
ap.add_argument("clip"); ap.add_argument("out")
ap.add_argument("--fps", type=int, default=20)
ap.add_argument("--size", type=int, default=256)
ap.add_argument("--cols", type=int, default=8)
ap.add_argument("--trim", default="")  # seconds "a:b"
ap.add_argument("--box", default="")   # crop "x,y,w,h" in source pixels, shared by every frame
a = ap.parse_args()

tmp = tempfile.mkdtemp()
cmd = ["ffmpeg", "-loglevel", "error", "-i", a.clip]
if a.trim:
    s, e = a.trim.split(":"); cmd[3:3] = ["-ss", s, "-to", e]
vf = f"fps={a.fps}"
if a.box:
    bx, by, bw, bh = map(int, a.box.split(","))
    vf += f",crop={bw}:{bh}:{bx}:{by},scale={a.size * 2}:{a.size * 2}:flags=lanczos"
subprocess.run(cmd + ["-vf", vf, f"{tmp}/%04d.png"], check=True)
paths = sorted(os.listdir(tmp))
rm = BackgroundRemover()
rgb, alpha = [], []
for p in paths:
    im = Image.open(f"{tmp}/{p}").convert("RGB")
    rgb.append(np.array(im)); alpha.append(np.array(rm(im))[..., 3].astype(np.float32))
alpha = np.stack(alpha)
# Temporal median on the alpha, then keep only the main blob per frame (drops stray specks).
smooth = np.stack([np.median(alpha[max(0, i - 2): i + 3], axis=0) for i in range(len(alpha))])
for i in range(len(smooth)):
    hard = (smooth[i] > 40).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(hard, 8)
    if n > 1:
        keep = [k + 1 for k, v in enumerate(st[1:, cv2.CC_STAT_AREA]) if v >= st[1:, cv2.CC_STAT_AREA].max() * 0.01]
        smooth[i] *= cv2.dilate(np.isin(lab, keep).astype(np.uint8), np.ones((5, 5), np.uint8))

# One crop for the whole clip: the union of all frames' bounds, squared, feet on the bottom.
if a.box:
    x, y, w, h = 0, 0, alpha.shape[2], alpha.shape[1]  # already cropped by ffmpeg
else:
    ys, xs = np.where((smooth > 40).any(axis=0))
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    side = int(max(x1 - x0, y1 - y0) * 1.04)
    cx = (x0 + x1) // 2
    x, y, w, h = cx - side // 2, y1 - side + int(side * 0.02), side, side
H, W = alpha.shape[1:]
cells = []
for i in range(len(rgb)):
    rgba = np.dstack([rgb[i], smooth[i].clip(0, 255).astype(np.uint8)])
    canvas = np.zeros((h, w, 4), np.uint8)
    sx0, sy0, sx1, sy1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    canvas[sy0 - y: sy1 - y, sx0 - x: sx1 - x] = rgba[sy0:sy1, sx0:sx1]
    cells.append(Image.fromarray(canvas).resize((a.size, a.size), Image.LANCZOS))
cols = a.cols; rows = (len(cells) + cols - 1) // cols
sheet = Image.new("RGBA", (cols * a.size, rows * a.size), (0, 0, 0, 0))
for i, c in enumerate(cells):
    sheet.paste(c, ((i % cols) * a.size, (i // cols) * a.size))
sheet.save(f"{a.out}.webp", "WEBP", quality=86, method=6)
json.dump({"frames": len(cells), "fps": a.fps, "cols": cols, "cell": a.size, "box": [int(x), int(y), int(w), int(h)]},
          open(f"{a.out}.json", "w"))
prev = Image.new("RGB", (a.size * 3, a.size), "white")
for k, i in enumerate([0, len(cells) // 2, len(cells) - 1]):
    prev.paste(cells[i], (k * a.size, 0), cells[i])
prev.save(f"{a.out}-preview.png")
print(a.out, len(cells), "frames", os.path.getsize(f"{a.out}.webp") // 1024, "KB", "box", x, y, w, h)
