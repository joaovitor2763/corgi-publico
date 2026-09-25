# Local multi-view shape generation with Hunyuan3D-2mv on Apple Silicon (MPS).
import sys, time, torch
from PIL import Image
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline, FloaterRemover, DegenerateFaceRemover

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 12345
octree = int(sys.argv[2]) if len(sys.argv) > 2 else 256
images = {k: Image.open(f"mv/{k}.png").convert("RGBA") for k in ["front", "left", "back", "right"]}
t = time.time()
pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
    "tencent/Hunyuan3D-2mv", subfolder="hunyuan3d-dit-v2-mv", variant="fp16", device="mps"
)
print("loaded", round(time.time() - t, 1), flush=True)
t = time.time()
mesh = pipe(image=images, num_inference_steps=50, octree_resolution=octree, num_chunks=20000,
            generator=torch.manual_seed(seed), output_type="trimesh")[0]
mesh = FloaterRemover()(mesh)
mesh = DegenerateFaceRemover()(mesh)
print("generated", round(time.time() - t, 1), "faces", len(mesh.faces), flush=True)
mesh.export(f"gen/hy-mv-{seed}.glb")
