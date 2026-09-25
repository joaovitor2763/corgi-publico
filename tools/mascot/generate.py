"""Generate the Regi base mesh from reference views with TRELLIS (Hugging Face Space).

    python tools/mascot/generate.py front.png side.png back.png out.glb [--seed 7]

Uses several views at once: a single front view makes the model invent the body
(TRELLIS gave a long lying dog with a curled tail from the front view alone).
Set HF_TOKEN for ZeroGPU quota; anonymous quota is about one generation a day.
"""
import argparse, os, shutil
from gradio_client import Client, handle_file

parser = argparse.ArgumentParser()
parser.add_argument("views", nargs="+", help="front first, then other angles")
parser.add_argument("out")
parser.add_argument("--seed", type=int, default=7)
parser.add_argument("--algo", default="stochastic", choices=["stochastic", "multidiffusion"])
args = parser.parse_args()

client = Client("trellis-community/TRELLIS", token=os.environ.get("HF_TOKEN"), verbose=False)
client.predict(api_name="/start_session")
prepared = [client.predict(image=handle_file(v), api_name="/preprocess_image") for v in args.views]
video, glb, _ = client.predict(
    image=handle_file(prepared[0]),
    multiimages=[{"image": handle_file(p), "caption": None} for p in prepared] if len(prepared) > 1 else [],
    seed=args.seed,
    ss_guidance_strength=7.5,
    ss_sampling_steps=12,
    slat_guidance_strength=3.0,
    slat_sampling_steps=12,
    multiimage_algo=args.algo,
    mesh_simplify=0.9,
    texture_size=2048,
    api_name="/generate_and_extract_glb",
)
shutil.copy(glb, args.out)
print("saved", args.out)
