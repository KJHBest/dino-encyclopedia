"""ComfyUI SDXL로 공룡 그림(앞모습 + 옆모습)을 그립니다. Hunyuan3D-2mv는 이 두 장이면 모양을 잘 만들어요.

사용:
  python tools/sdxl_views.py <id> "<영어 설명>" [--seeds 1,2,3,4] [--mode pair|side|front --ref side.png]
  - pair : 한 장에 왼쪽=앞모습, 오른쪽=옆모습(머리가 왼쪽)  (1536x768)
  - side : 옆모습만 (1216x832)
  - front: 앞모습만, --ref 그림(옆모습)의 색과 무늬를 IPAdapter로 따라 그려요 (1024x1024)
출력: assets_src/sdxl/<id>_<mode>_s<seed>.png
"""
import argparse, json, shutil, time, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets_src" / "sdxl"
COMFY = "http://127.0.0.1:8188"
COMFY_OUT = Path("D:/sd/ComfyUI_windows_portable/ComfyUI/output")
CKPT = "sdxl\\dreamshaperXL_sfwV2TurboDPMSDE.safetensors"

STYLE = ("cute stylized 3D toy figure for a children's game, smooth clay-like Pixar style 3D render, "
         "bold clear color pattern, darker back and lighter belly, soft even studio lighting, "
         "isolated on a pure plain white background, full body visible, centered, no shadow, no floor")
NEG = ("text, letters, watermark, logo, frame, border, grid lines, scenery, landscape, grass, ground, floor, shadow, "
       "human, person, cropped, cut off, out of frame, multiple animals, extra legs, extra heads, deformed, blurry, "
       "anthropomorphic, standing upright like a human, clothes")
PROMPTS = {
    "pair": ("character reference sheet of ONE {desc}, exactly two views of the same dinosaur side by side: "
             "on the left a front view facing the camera, on the right a full side profile view with the head pointing left, "
             "same size, same colors, neutral standing pose, mouth closed, " + STYLE),
    "side": ("exact side view, profile shot at 90 degrees, camera perpendicular to the body, of ONE {desc}, the head points to the left and the tail to the right, "
             "neutral standing pose, mouth closed, tail straight out, all legs visible, " + STYLE),
    "front": ("head-on front view, the camera looks straight at the face, perfectly symmetric, of ONE {desc}, "
              "neutral standing pose, mouth closed, " + STYLE),
}
SIZES = {"pair": (1536, 768), "side": (1216, 832), "front": (1024, 1024)}


def run(g):
    req = urllib.request.Request(f"{COMFY}/prompt", data=json.dumps({"prompt": g}).encode(),
                                 headers={"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(req))["prompt_id"]
    while True:
        time.sleep(1.5)
        h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}"))
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(json.dumps(st.get("messages"), ensure_ascii=False)[:1500])
            if st.get("completed"):
                return h[pid]["outputs"]


def upload(path):
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + path.read_bytes() + (
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue"
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\ndinopark"
        f"\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(f"{COMFY}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    r = json.load(urllib.request.urlopen(req))
    return f"{r['subfolder']}/{r['name']}"


def graph(prompt, seed, size, prefix, ref=None, ref_weight=0.75):
    w, h = size
    g = {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["ckpt", 1], "text": prompt}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["ckpt", 1], "text": NEG}},
        "lat": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "ks": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "seed": seed, "steps": 30, "cfg": 5.5, "sampler_name": "dpmpp_2m",
            "scheduler": "karras", "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["lat", 0], "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["ks", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": prefix}},
    }
    if ref:
        # 옆모습 그림의 색·무늬를 따라 그리도록 (IPAdapter)
        g["ipl"] = {"class_type": "IPAdapterUnifiedLoader", "inputs": {"model": ["ckpt", 0], "preset": "PLUS (high strength)"}}
        g["refimg"] = {"class_type": "LoadImage", "inputs": {"image": ref}}
        g["ipa"] = {"class_type": "IPAdapterAdvanced", "inputs": {
            "model": ["ipl", 0], "ipadapter": ["ipl", 1], "image": ["refimg", 0], "weight": ref_weight,
            "weight_type": "style transfer", "combine_embeds": "concat", "start_at": 0.0, "end_at": 1.0,
            "embeds_scaling": "V only"}}
        g["ks"]["inputs"]["model"] = ["ipa", 0]
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("desc")
    ap.add_argument("--seeds", default="1,2,3,4")
    ap.add_argument("--mode", default="pair", choices=list(PROMPTS))
    ap.add_argument("--ref", help="front 모드: 따라 그릴 옆모습 그림")
    ap.add_argument("--ref-weight", type=float, default=0.75)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    prompt = PROMPTS[a.mode].format(desc=a.desc)
    ref = upload(Path(a.ref)) if a.ref else None
    for s in [int(x) for x in a.seeds.split(",")]:
        prefix = f"dinopark/sdxl_{a.id}_{a.mode}_{uuid.uuid4().hex[:6]}"
        outs = run(graph(prompt, s, SIZES[a.mode], prefix, ref, a.ref_weight))
        img = next(iter(outs.values()))["images"][0]
        dst = OUT / f"{a.id}_{a.mode}_s{s}.png"
        shutil.copy(COMFY_OUT / img.get("subfolder", "") / img["filename"], dst)
        print(dst)


if __name__ == "__main__":
    main()
