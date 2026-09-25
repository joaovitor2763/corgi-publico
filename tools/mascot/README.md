# Regi asset pipeline

Reference sheets are the source of truth. Steps:

1. **Crop views** (front, side, back) from a turnaround sheet at 3x.
2. **Generate** the shape locally (Apple Silicon, no quota): clone Tencent/Hunyuan3D-2, install it
   in a venv, run `prep_views.py` (front/left/back/right at one scale, largest blob only) and
   `generate_local.py` (Hunyuan3D-2mv on MPS, ~13 min on an M3 Max). Then paint it from the sheets:
   `blender -b -P tools/mascot/texture.py -- shape.glb mv/ base.glb` (decimates to 25k faces,
   projects each view, bakes a 2K albedo). `generate.py` (TRELLIS on Hugging Face) also works but
   its Space ignores extra views and quota runs out fast.
3. **Check** it: `blender -b -P tools/mascot/turntable.py -- base.glb render/base` and compare
   front / 3-4 / side / back with the sheets. Identity first: face, ears, tricolor pattern,
   compact sitting chibi body, short tail.
4. **Landmarks**: pick pixels on `render/base-front.png` (eyes, nose, chin, chest, ear bases
   and tips, front paws) into `base.landmarks.json` (see `rig.py` header).
5. **Rig + clips + export**: `blender -b -P tools/mascot/rig.py -- base.glb base.landmarks.json regi.glb`
6. **Validate** poses and morphs: `blender -b -P tools/mascot/posecheck.py -- regi.glb render/pose`
7. **Ship**: copy to `apps/mobile/public/mascot/regi.glb` (served at `/mascot/regi.glb`).
   The shipped model used `regi.landmarks.json`.

Contract (bones, morphs, clips) is in `apps/mobile/src/mascot/README.md`.

## 2D Regi (the app's avatar)

The header and the empty chat use sprites cut from the character sheets, not the 3D model.
Run from `.openmuse/mascot/` (sheets in `ref/`, venv with hy3dgen + spandrel, Real-ESRGAN weights in `sr/`):

1. `segment_fast.py` cuts every figure and writes numbered contact sheets (`sprites/contact-N.png`).
2. `make_sprites.py [names]` upscales the chosen figures 4x (Real-ESRGAN) and re-cuts a clean alpha.
3. `frame_sprites.py` puts each pose on one square canvas with the feet on the bottom edge at a shared scale.
4. `blink.py` builds `sit-blink` (eyes inpainted, closed lids drawn).

Copy `sprites/final-*.png` into `apps/mobile/assets/regi/` (dropping the `final-` prefix). Moods and
poses are defined in `apps/mobile/src/mascot/regi-poses.ts`; open `/regi` on web to review them all.
