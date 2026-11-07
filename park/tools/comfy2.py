"""새 ComfyUI(v0.44, 포트 8189)의 Krea 2 / Qwen-Image-2.1로 그림 만들기·고치기.

사용:
  python tools/comfy2.py krea  "<영어 설명>" out.png [--w 1024 --h 1024 --seed 1]
  python tools/comfy2.py edit  "<고칠 내용>" out.png --img a.png [--img b.png ...] [--seed 1]
  python tools/comfy2.py qwen  "<영어 설명>" out.png [--w 1024 --h 1024 --seed 1]
"""
import argparse, json, shutil, time, urllib.request, uuid
from pathlib import Path

COMFY = "http://127.0.0.1:8189"
COMFY_OUT = Path("D:/sd/ComfyUI_v044/ComfyUI_windows_portable/ComfyUI/output")
QWEN_SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"


def upload(path):
    path = Path(path)
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


def run(g, out):
    req = urllib.request.Request(f"{COMFY}/prompt", data=json.dumps({"prompt": g}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req))["prompt_id"]
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()[:2000])
    t0 = time.time()
    while True:
        time.sleep(1.5)
        h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}"))
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(json.dumps(st.get("messages"), ensure_ascii=False)[:2000])
            if st.get("completed"):
                break
    img = next(o for o in h[pid]["outputs"].values() if "images" in o)["images"][0]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(COMFY_OUT / img.get("subfolder", "") / img["filename"], out)
    return time.time() - t0


def krea(prompt, w, h, seed, prefix):
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_fp8_scaled.safetensors", "type": "krea2", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["clip", 0], "text": prompt}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
        "lat": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "ks": {"class_type": "KSampler", "inputs": {
            "model": ["unet", 0], "seed": seed, "steps": 8, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
            "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["lat", 0], "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["ks", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": prefix}},
    }


def qwen(prompt, images, w, h, seed, prefix):
    """images가 있으면 고치기(edit), 없으면 새로 그리기."""
    g = {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_2.1_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "cache": {"class_type": "QwenImage21Cache", "inputs": {"model": ["unet", 0], "device": "auto", "dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_int8_convrot.safetensors", "type": "qwen_image", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
        "enc": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["clip", 0], "vae": ["vae", 0], "prompt": prompt, "negative_prompt": "", "resolution": 0 if images else 1024}},
        "guider": {"class_type": "CFGGuider", "inputs": {"model": ["cache", 0], "positive": ["enc", 0], "negative": ["enc", 1], "cfg": 1.0}},
        "sampler": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "sigmas": {"class_type": "ManualSigmas", "inputs": {"sigmas": QWEN_SIGMAS}},
        "noise": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "sca": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["noise", 0], "guider": ["guider", 0], "sampler": ["sampler", 0], "sigmas": ["sigmas", 0],
            "latent_image": ["enc", 2] if images else ["lat", 0]}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["sca", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": prefix}},
    }
    if not images:
        g["lat"] = {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}}
    for i, name in enumerate(images, start=1):
        g[f"img{i}"] = {"class_type": "LoadImage", "inputs": {"image": upload(name)}}
        g["enc"]["inputs"][f"images.image_{i}"] = [f"img{i}", 0]
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["krea", "edit", "qwen"])
    ap.add_argument("prompt")
    ap.add_argument("out")
    ap.add_argument("--img", action="append", default=[])
    ap.add_argument("--w", type=int, default=1024)
    ap.add_argument("--h", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    prefix = f"dinopark/{a.mode}_{uuid.uuid4().hex[:6]}"
    if a.mode == "krea":
        g = krea(a.prompt, a.w, a.h, a.seed, prefix)
    else:
        g = qwen(a.prompt, a.img if a.mode == "edit" else [], a.w, a.h, a.seed, prefix)
    secs = run(g, a.out)
    print(f"{a.out} ({secs:.0f}s)")


if __name__ == "__main__":
    main()
