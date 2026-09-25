# Generates Regi clips on Higgsfield (Kling O3 first/last frame) from keyframes.
#
#   python tools/mascot/hf_video.py <name> <first.png> <last.png|-> <seconds> "<motion prompt>"
#
# Needs HF_CREDENTIALS="key_id:key_secret" in the environment. Writes clips/<name>.mp4.
import json, os, sys, time, urllib.request

API = "https://api.higgsfield.ai"
AUTH = {
    "Authorization": f"Key {os.environ['HF_CREDENTIALS']}",
    "Content-Type": "application/json",
    "User-Agent": "openmuse-mascot/1.0",  # the default Python agent is blocked
}
STYLE = (
    "Soft 3D plush toy illustration of Regi, a chibi tricolor corgi (black, white and caramel) "
    "with huge upright ears and big glossy eyes. Static locked-off camera, no zoom, no pan, "
    "no cuts. Plain flat light gray-green background, nothing else in frame. Gentle, cute, "
    "smooth natural motion; keep the character exactly as drawn."
)

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers=AUTH,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def upload(path):
    u = call("POST", "/files/generate-upload-url", {"content_type": "image/png"})
    with open(path, "rb") as f:
        req = urllib.request.Request(u["upload_url"], method="PUT", data=f.read(), headers=u["upload_headers"])
    urllib.request.urlopen(req, timeout=120).read()
    return u["public_url"]

def main(name, first, last, seconds, motion, out_dir):
    body = {
        "prompt": f"{motion} {STYLE}",
        "first_frame_url": upload(first),
        "multi_shots": False,
        "duration": int(seconds),
        "aspect_ratio": "1:1",
        "mode": os.environ.get("HF_MODE", "pro"),
        "sound": "off",
    }
    if last != "-":
        body["last_frame_url"] = upload(last)
    job = call("POST", "/kling-video/o3/first-last-frame", body)
    rid = job["request_id"]
    print(name, "queued", rid, flush=True)
    while True:
        time.sleep(8)
        st = call("GET", f"/requests/{rid}/status")
        if st["status"] in ("completed", "failed", "nsfw", "cancelled"):
            break
    if st["status"] != "completed":
        print(name, st["status"], json.dumps(st)[:400], flush=True)
        sys.exit(1)
    url = (st.get("video") or {}).get("url") or st["videos"][0]["url"]
    urllib.request.urlretrieve(url, os.path.join(out_dir, f"{name}.mp4"))
    print(name, "done", flush=True)

if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], a[2], a[3], a[4], os.environ.get("OUT", "."))
