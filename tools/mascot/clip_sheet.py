# A generated Regi clip (mp4, flat background) → transparent spritesheet for the app's avatar.
#
#   python clip_sheet.py <clip.mp4> <out_prefix> [--trim beat|enter] [--fps 20] [--size 200] [--cols 10]
#
# Every clip gets the same crop (all were generated from keyframes with the same framing), so
# Regi never shifts between clips. --trim keeps only the motion: `beat` for keyframe→keyframe clips
# (blink, glance), `enter` for keyframe→pose clips (drops the still lead-in). Writes <out>.webp and <out>.json.
import argparse, json, os, subprocess, tempfile
import cv2
import numpy as np
from PIL import Image

CROP = "crop=980:980:230:215"  # 1440² Kling output → head and shoulders, like Muse's avatar


def key(frame):
    """Transparent background: the flat backdrop, flooded in from the top and sides only, so the
    cream chest (close in color, but never touching those edges) is never keyed out."""
    im = np.asarray(frame, np.float32)
    bg = np.median(np.concatenate([im[:6].reshape(-1, 3), im[:, :6].reshape(-1, 3), im[:, -6:].reshape(-1, 3)]), axis=0)
    d = np.sqrt(((im - bg) ** 2).sum(-1))
    _, lab = cv2.connectedComponents((d < 9).astype(np.uint8), connectivity=4)
    seeds = set(np.unique(np.concatenate([lab[0], lab[:, 0], lab[:, -1]]))) - {0}
    alpha = np.clip((d - 4) / 12, 0, 1)
    alpha[~np.isin(lab, list(seeds))] = 1
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    return Image.fromarray(np.dstack([im.astype(np.uint8), (alpha * 255).astype(np.uint8)]))

ap = argparse.ArgumentParser()
ap.add_argument("clip"); ap.add_argument("out")
ap.add_argument("--trim", choices=["beat", "enter"])
ap.add_argument("--fps", type=int, default=20)
ap.add_argument("--size", type=int, default=200)
ap.add_argument("--cols", type=int, default=10)
a = ap.parse_args()

tmp = tempfile.mkdtemp()
# Key at 2x, then downscale: cleaner edges.
subprocess.run(["ffmpeg", "-loglevel", "error", "-i", a.clip, "-vf",
                f"fps={a.fps},{CROP},scale={a.size * 2}:{a.size * 2}:flags=lanczos", f"{tmp}/%04d.png"], check=True)
frames = [key(Image.open(f"{tmp}/{p}").convert("RGB")).resize((a.size, a.size), Image.LANCZOS)
          for p in sorted(os.listdir(tmp))]
if a.trim:
    # Distance of each frame from the first (the shared keyframe). Generated video is never
    # perfectly still, so the thresholds are relative to the clip's biggest change.
    # A blink moves few pixels, so measure the strongest local change (99th percentile), not the
    # mean, against the first frame (the shared keyframe).
    small = [np.asarray(f.resize((128, 128)), np.float32)[..., :3] for f in frames]
    d = np.array([np.percentile(np.abs(x - small[0]).max(-1), 99) for x in small])
    peak = d.max() or 1
    if a.trim == "beat":  # keyframe → move → keyframe: keep only the move
        idx = np.where(d > 0.3 * peak)[0]
        first, last = max(0, idx[0] - 3), min(len(frames) - 1, idx[-1] + 3)
    else:  # "enter": keyframe → pose; drop the still lead-in, keep the settle into the pose
        first = max(0, int(np.argmax(d > 0.12 * peak)) - 2)
        last = len(frames) - 1
    frames = frames[first: last + 1]
cols = a.cols; rows = (len(frames) + cols - 1) // cols
sheet = Image.new("RGBA", (cols * a.size, rows * a.size), (0, 0, 0, 0))
for i, f in enumerate(frames):
    sheet.paste(f, ((i % cols) * a.size, (i // cols) * a.size))
sheet.save(f"{a.out}.webp", "WEBP", quality=82, method=6)
json.dump({"frames": len(frames), "fps": a.fps, "cols": cols}, open(f"{a.out}.json", "w"))
print(os.path.basename(a.out), len(frames), "frames", os.path.getsize(f"{a.out}.webp") // 1024, "KB")
