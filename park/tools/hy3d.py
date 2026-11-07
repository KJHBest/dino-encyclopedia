"""Codex 4방향 그림(2x2) → ComfyUI Hunyuan3D-2mv → GLB 모양.

사용: python tools/hy3d.py <id> [--steps 10 --cfg 5 --seed 1 --octree 256]
입력: assets_src/views/<id>.png  (왼쪽 위=앞, 오른쪽 위=왼쪽 옆, 왼쪽 아래=뒤, 오른쪽 아래=오른쪽 옆)
출력: assets_src/views/<id>_<면>.png (잘라낸 그림), assets_src/raw/<id>.glb (색 없는 모양)
"""
import argparse, json, shutil, time, urllib.request, uuid
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
VIEWS = ROOT / "assets_src" / "views"
RAW = ROOT / "assets_src" / "raw"
COMFY = "http://127.0.0.1:8188"
COMFY_OUT = Path("D:/sd/ComfyUI_windows_portable/ComfyUI/output")
CKPT = "hunyuan3d-dit-v2-mv-turbo_fp16.safetensors"
PANELS = {"front": (0, 0), "left": (1, 0), "back": (0, 1), "right": (1, 1)}


def object_mask(rgb):
    """흰 배경에서 동물 부분만 True. 가장자리와 이어진 흰색만 배경으로 봅니다."""
    a = rgb.astype(np.int16)
    whiteish = (a.min(axis=2) > 232) & (a.max(axis=2) - a.min(axis=2) < 18)
    lab, _ = ndimage.label(whiteish)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    fg = ~bg
    fg = ndimage.binary_opening(fg, iterations=1)
    # 가장 큰 덩어리만 남기기 (먼지 제거)
    lab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        fg = lab == (1 + int(np.argmax(sizes)))
    return ndimage.binary_fill_holes(fg)


def quadrant_masks(im):
    """그림 전체에서 동물 덩어리를 찾아, 덩어리 가운데가 어느 칸에 있는지로 나눕니다.
    (그림이 칸 경계를 살짝 넘어가도 잘리지 않아요)"""
    H, W, _ = im.shape
    a = im.astype(np.int16)
    whiteish = (a.min(axis=2) > 232) & (a.max(axis=2) - a.min(axis=2) < 18)
    lab, _ = ndimage.label(whiteish)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ~np.isin(lab, list(edge))
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg)
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    centers = ndimage.center_of_mass(fg, lab, range(1, n + 1))
    masks = {k: np.zeros((H, W), bool) for k in PANELS}
    big = sizes.max() if n else 0
    for i, (sz, (cy, cx)) in enumerate(zip(sizes, centers), start=1):
        if sz < big * 0.003:
            continue  # 먼지
        q = (int(cx >= W / 2), int(cy >= H / 2))
        name = next(k for k, v in PANELS.items() if v == q)
        masks[name] |= lab == i
    return {k: ndimage.binary_fill_holes(m) for k, m in masks.items()}


def split_views(vid):
    """2x2 그림을 네 장으로 나누고, 동물만 잘라 흰 배경 정사각형(512)으로 만듭니다."""
    im = np.array(Image.open(VIEWS / f"{vid}.png").convert("RGB"))
    out = {}
    for name, m in quadrant_masks(im).items():
        ys, xs = np.nonzero(m)
        if len(ys) == 0:
            raise RuntimeError(f"{vid}: {name} 그림을 못 찾았어요")
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = im[y0:y1, x0:x1].copy()
        cm = m[y0:y1, x0:x1]
        crop[~cm] = 255
        # 색칠용: 잘라낸 그림 + 마스크(알파)를 그대로 저장
        rgba = np.dstack([crop, (cm * 255).astype(np.uint8)])
        Image.fromarray(rgba, "RGBA").save(VIEWS / f"{vid}_{name}.png")
        # Hunyuan3D 입력용: 가운데 정렬, 테두리 15%
        side = int(max(crop.shape[:2]) / 0.85)
        canvas = np.full((side, side, 3), 255, np.uint8)
        oy, ox = (side - crop.shape[0]) // 2, (side - crop.shape[1]) // 2
        canvas[oy:oy + crop.shape[0], ox:ox + crop.shape[1]] = crop
        sq = Image.fromarray(canvas).resize((512, 512), Image.LANCZOS)
        p = VIEWS / f"{vid}_{name}_in.png"
        sq.save(p)
        out[name] = p
    return out


def upload(path):
    boundary = uuid.uuid4().hex
    data = path.read_bytes()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\n"
        f"Content-Type: image/png\r\n\r\n").encode() + data + (
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue"
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\ndinopark"
        f"\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(f"{COMFY}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    r = json.load(urllib.request.urlopen(req))
    return f"{r['subfolder']}/{r['name']}" if r.get("subfolder") else r["name"]


def graph(images, prefix, steps, cfg, seed, octree, shift, use):
    g = {
        "ckpt": {"class_type": "ImageOnlyCheckpointLoader", "inputs": {"ckpt_name": CKPT}},
        "cond": {"class_type": "Hunyuan3Dv2ConditioningMultiView", "inputs": {}},
        "ms": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["ckpt", 0], "shift": shift}},
        "lat": {"class_type": "EmptyLatentHunyuan3Dv2", "inputs": {"resolution": 3072, "batch_size": 1}},
        "ks": {"class_type": "KSampler", "inputs": {
            "model": ["ms", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler",
            "scheduler": "normal", "positive": ["cond", 0], "negative": ["cond", 1],
            "latent_image": ["lat", 0], "denoise": 1.0}},
        "dec": {"class_type": "VAEDecodeHunyuan3D", "inputs": {
            "samples": ["ks", 0], "vae": ["ckpt", 2], "num_chunks": 8000, "octree_resolution": octree}},
        "mesh": {"class_type": "VoxelToMesh", "inputs": {"voxel": ["dec", 0], "algorithm": "surface net", "threshold": 0.6}},
        "save": {"class_type": "SaveGLB", "inputs": {"mesh": ["mesh", 0], "filename_prefix": prefix}},
    }
    for name in use:
        g[f"img_{name}"] = {"class_type": "LoadImage", "inputs": {"image": images[name]}}
        g[f"enc_{name}"] = {"class_type": "CLIPVisionEncode",
                            "inputs": {"clip_vision": ["ckpt", 1], "image": [f"img_{name}", 0], "crop": "none"}}
        g["cond"]["inputs"][name] = [f"enc_{name}", 0]
    return g


def run(g):
    req = urllib.request.Request(f"{COMFY}/prompt", data=json.dumps({"prompt": g}).encode(),
                                 headers={"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(req))["prompt_id"]
    t0 = time.time()
    while True:
        time.sleep(2)
        h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}"))
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(json.dumps(st.get("messages"), ensure_ascii=False)[:2000])
            if st.get("completed"):
                break
        if time.time() - t0 > 900:
            raise TimeoutError(pid)
    return time.time() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--cfg", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--octree", type=int, default=256)
    ap.add_argument("--shift", type=float, default=1.0)
    ap.add_argument("--views", default="front,left,back,right")
    ap.add_argument("--swap", action="store_true", help="왼쪽/오른쪽 그림을 바꿔서 넣기")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    paths = split_views(a.id)
    names = {k: upload(p) for k, p in paths.items()}
    if a.swap:
        names["left"], names["right"] = names["right"], names["left"]
    use = [v for v in a.views.split(",") if v]
    tag = a.out or a.id
    prefix = f"dinopark/{tag}_{uuid.uuid4().hex[:6]}"
    secs = run(graph(names, prefix, a.steps, a.cfg, a.seed, a.octree, a.shift, use))
    files = sorted((COMFY_OUT / "dinopark").glob(f"{Path(prefix).name}*.glb"))
    RAW.mkdir(parents=True, exist_ok=True)
    dst = RAW / f"{tag}.glb"
    shutil.copy(files[-1], dst)
    print(f"{tag}: {dst} ({dst.stat().st_size // 1024} KB, {secs:.0f}s)")


if __name__ == "__main__":
    main()
