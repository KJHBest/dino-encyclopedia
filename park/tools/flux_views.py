"""ComfyUI의 Flux로 공룡 4방향 그림(2x2)을 그립니다. (Codex 대신 쓸 수 있는 로컬 방법)

사용: python tools/flux_views.py <id> "<영어 설명>" [--seeds 1,2,3,4] [--steps 24]
출력: assets_src/flux/<id>_s<seed>.png  (마음에 드는 것을 assets_src/views/<id>.png로 복사)
"""
import argparse, json, shutil, time, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets_src" / "flux"
COMFY = "http://127.0.0.1:8188"
COMFY_OUT = Path("D:/sd/ComfyUI_windows_portable/ComfyUI/output")

TEMPLATE = (
    "A character turnaround reference sheet of ONE cute stylized 3D toy dinosaur: {desc}. "
    "Four views of the exact same dinosaur arranged in a 2x2 grid on a pure plain white background. "
    "Top-left: front view, the dinosaur looks straight at the camera. "
    "Top-right: left side profile, the head points to the left. "
    "Bottom-left: back view, seen from directly behind, tail toward the camera. "
    "Bottom-right: right side profile, the head points to the right. "
    "Same size, same colors and same neutral standing pose in all four views, mouth closed, tail straight. "
    "Smooth clay-like Pixar style 3D render, soft even studio lighting, orthographic, no shadows, no floor, "
    "no text, no labels, no grid lines."
)


def run(g):
    req = urllib.request.Request(f"{COMFY}/prompt", data=json.dumps({"prompt": g}).encode(),
                                 headers={"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(req))["prompt_id"]
    while True:
        time.sleep(2)
        h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}"))
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(json.dumps(st.get("messages"), ensure_ascii=False)[:1500])
            if st.get("completed"):
                return h[pid]["outputs"]


def graph(prompt, seed, steps, prefix):
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-dev.safetensors", "weight_dtype": "fp8_e4m3fn"}},
        "clip": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "FLUX1\\ae.safetensors"}},
        "pos": {"class_type": "CLIPTextEncodeFlux", "inputs": {"clip": ["clip", 0], "clip_l": prompt, "t5xxl": prompt, "guidance": 3.5}},
        "neg": {"class_type": "CLIPTextEncodeFlux", "inputs": {"clip": ["clip", 0], "clip_l": "", "t5xxl": "", "guidance": 3.5}},
        "lat": {"class_type": "EmptySD3LatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "ks": {"class_type": "KSampler", "inputs": {
            "model": ["unet", 0], "seed": seed, "steps": steps, "cfg": 1.0, "sampler_name": "euler",
            "scheduler": "simple", "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["lat", 0], "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["ks", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": prefix}},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("desc")
    ap.add_argument("--seeds", default="1,2,3,4")
    ap.add_argument("--steps", type=int, default=24)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    prompt = TEMPLATE.format(desc=a.desc)
    for s in [int(x) for x in a.seeds.split(",")]:
        prefix = f"dinopark/flux_{a.id}_{uuid.uuid4().hex[:6]}"
        outs = run(graph(prompt, s, a.steps, prefix))
        img = next(iter(outs.values()))["images"][0]
        src = COMFY_OUT / img.get("subfolder", "") / img["filename"]
        dst = OUT / f"{a.id}_s{s}.png"
        shutil.copy(src, dst)
        print(dst)


if __name__ == "__main__":
    main()
