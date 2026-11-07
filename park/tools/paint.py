"""Hunyuan3D 모양(GLB)에 Codex 그림 색을 칠하고, 게임용으로 가볍게 만듭니다.

사용: python tools/paint.py <id> [--raw assets_src/raw/<id>.glb] [--faces 14000]
입력: assets_src/raw/<id>.glb, assets_src/views/<id>_{front,left,back,right}.png (hy3d.py가 만듦)
출력: models/<id>.glb (꼭짓점 색), models/meta/<id>.json (걷기 애니메이션용 치수)

모델 방향: 머리가 +Z, 위가 +Y, 발바닥이 y=0, 가로 길이(가장 긴 수평 길이)가 1.
"""
import argparse, json
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
VIEWS = ROOT / "assets_src" / "views"

# 각 그림을 찍은 카메라: (카메라가 있는 방향, 그림의 오른쪽(u) 방향)
CAMS = {
    "front": (np.array([0, 0, 1.0]), np.array([1.0, 0, 0])),
    "left": (np.array([1.0, 0, 0]), np.array([0, 0, -1.0])),
    "back": (np.array([0, 0, -1.0]), np.array([-1.0, 0, 0])),
    "right": (np.array([-1.0, 0, 0]), np.array([0, 0, 1.0])),
}


def load_mesh(path):
    m = trimesh.load(path, force="mesh", process=False)
    m.merge_vertices()
    return m


def simplify(m, faces):
    if len(m.faces) <= faces:
        return m
    v, f = fast_simplification.simplify(
        m.vertices.astype(np.float32), m.faces.astype(np.int32), 1 - faces / len(m.faces))
    out = trimesh.Trimesh(v, f, process=True)
    # 잘게 떨어진 조각 제거 (가장 큰 덩어리 + 큰 조각만)
    parts = out.split(only_watertight=False)
    if len(parts) > 1:
        big = max(len(p.faces) for p in parts)
        out = trimesh.util.concatenate([p for p in parts if len(p.faces) > big * 0.02])
    return out


def normalize(m):
    v = m.vertices.copy()
    lo, hi = v.min(0), v.max(0)
    v[:, 0] -= (lo[0] + hi[0]) / 2
    v[:, 2] -= (lo[2] + hi[2]) / 2
    v[:, 1] -= lo[1]
    s = 1.0 / max(hi[0] - lo[0], hi[2] - lo[2])
    m.vertices = v * s
    return m


def filled_view(name):
    """그림 바깥(투명) 픽셀을 가장 가까운 안쪽 색으로 채운 그림 + 마스크."""
    im = np.array(Image.open(VIEWS / f"{name}.png").convert("RGBA"))
    rgb, a = im[..., :3].astype(np.float32), im[..., 3] > 127
    inner = ndimage.binary_erosion(a, iterations=2)
    if inner.sum() < 100:
        inner = a
    _, (iy, ix) = ndimage.distance_transform_edt(~inner, return_indices=True)
    return rgb[iy, ix], a


def depth_buffer(pts, cam, right, res):
    """보이는지 확인용 깊이 버퍼 (표면 점을 찍어서)."""
    up = np.array([0, 1.0, 0])
    u, v, d = pts @ right, pts @ up, pts @ cam
    u0, u1, v0, v1 = u.min(), u.max(), v.min(), v.max()
    W = res
    H = max(8, int(res * (v1 - v0) / (u1 - u0 + 1e-9)))
    px = np.clip(((u - u0) / (u1 - u0 + 1e-9) * (W - 1)).astype(int), 0, W - 1)
    py = np.clip(((v1 - v) / (v1 - v0 + 1e-9) * (H - 1)).astype(int), 0, H - 1)
    buf = np.full((H, W), -np.inf)
    np.maximum.at(buf, (py, px), d)
    buf = ndimage.maximum_filter(buf, size=3)
    return buf, (u0, u1, v0, v1, W, H)


def project(points, normals, m, vid):
    """3D 점마다 네 방향 그림에서 색을 가져와 섞습니다. (색, 가중치 합) 반환."""
    surf, _ = trimesh.sample.sample_surface(m, 400_000)
    acc = np.zeros((len(points), 3))
    wsum = np.zeros(len(points))
    up = np.array([0, 1.0, 0])
    depth_span = np.ptp(m.vertices, axis=0).max()
    for name, (cam, right) in CAMS.items():
        img, mask = filled_view(f"{vid}_{name}")
        ih, iw = mask.shape
        buf, (u0, u1, v0, v1, W, H) = depth_buffer(surf, cam, right, 384)
        u, v, d = points @ right, points @ up, points @ cam
        bx = np.clip(((u - u0) / (u1 - u0) * (W - 1)).astype(int), 0, W - 1)
        by = np.clip(((v1 - v) / (v1 - v0) * (H - 1)).astype(int), 0, H - 1)
        visible = d >= buf[by, bx] - depth_span * 0.02
        facing = np.clip(normals @ cam, 0, 1)
        w = np.where(visible, facing ** 3, 0)
        # 그림 좌표 (그림은 동물에 딱 맞게 잘려 있어요)
        x = np.clip(((u - u0) / (u1 - u0) * (iw - 1)).round().astype(int), 0, iw - 1)
        y = np.clip(((v1 - v) / (v1 - v0) * (ih - 1)).round().astype(int), 0, ih - 1)
        acc += img[y, x] * w[:, None]
        wsum += w
    return acc, wsum


def rasterize_uv(uv, faces, pos, nrm, T):
    """UV 공간에 삼각형을 그려, 텍스처 픽셀마다 3D 위치와 법선을 구합니다."""
    P = np.zeros((T, T, 3), np.float32)
    N = np.zeros((T, T, 3), np.float32)
    filled = np.zeros((T, T), bool)
    tuv = uv[faces] * (T - 1)
    tuv[..., 1] = (T - 1) - tuv[..., 1]  # 이미지 위쪽이 v=1
    for f, t in enumerate(tuv):
        x0, y0 = np.floor(t.min(0)).astype(int)
        x1, y1 = np.ceil(t.max(0)).astype(int) + 1
        xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, T)), np.arange(max(y0, 0), min(y1, T)))
        if xs.size == 0:
            continue
        px, py = xs.ravel() + 0.0, ys.ravel() + 0.0
        (ax, ay), (bx, by), (cx, cy) = t
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
        l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
        l3 = 1 - l1 - l2
        eps = -0.02
        ok = (l1 >= eps) & (l2 >= eps) & (l3 >= eps)
        if not ok.any():
            continue
        L = np.stack([l1[ok], l2[ok], l3[ok]], 1)
        iy, ix = ys.ravel()[ok], xs.ravel()[ok]
        tri = faces[f]
        P[iy, ix] = L @ pos[tri]
        N[iy, ix] = L @ nrm[tri]
        filled[iy, ix] = True
    N /= np.linalg.norm(N, axis=2, keepdims=True) + 1e-9
    return P, N, filled


def bake(m, vid, T):
    """UV를 펴고, 그림 색을 텍스처로 구워 냅니다."""
    import xatlas
    vmap, idx, uv = xatlas.parametrize(m.vertices.astype(np.float32), m.faces.astype(np.uint32))
    pos = m.vertices[vmap]
    nrm = m.vertex_normals[vmap]
    P, N, filled = rasterize_uv(uv, idx.astype(np.int64), pos, nrm, T)
    pts, nms = P[filled], N[filled]
    acc, wsum = project(pts, nms, m, vid)
    tex = np.zeros((T, T, 3), np.float32)
    good = np.zeros((T, T), bool)
    col = np.zeros((len(pts), 3))
    ok = wsum > 0.02
    col[ok] = acc[ok] / wsum[ok, None]
    tex[filled] = col
    good[filled] = ok
    # 어느 그림에서도 안 보이는 곳(배 아래, 발바닥): 3D에서 가장 가까운 칠해진 점 색으로
    if (~ok).any() and ok.any():
        from scipy.spatial import cKDTree
        tree = cKDTree(pts[ok])
        _, j = tree.query(pts[~ok])
        col[~ok] = col[ok][j]
        tex[filled] = col
    # 섬 바깥으로 색을 번지게 (이음새가 안 보이도록)
    _, (iy, ix) = ndimage.distance_transform_edt(~filled, return_indices=True)
    tex = tex[iy, ix]
    # 그림에 이미 그림자가 들어 있어서 조금 밝게
    tex = np.clip(tex * 1.04 + 6, 0, 255).astype(np.uint8)
    return pos, idx.astype(np.int64), uv, nrm, Image.fromarray(tex)


def measure(m, kind):
    """걷기 애니메이션용: 배 높이(다리 끝), 엉덩이·어깨 위치, 꼬리·머리 끝."""
    v = m.vertices
    height = float(v[:, 1].max())
    xw = float(v[:, 0].max() - v[:, 0].min())
    zmin, zmax = float(v[:, 2].min()), float(v[:, 2].max())
    meta = {"height": height, "width": xw, "tailZ": zmin, "headZ": zmax}
    if kind == "flyer":
        meta.update(bellyY=height * 0.5, hipZ=0.0, shoulderZ=0.0, bodyHalfX=xw * 0.12)
        return meta
    # 다리: 아래쪽 25%에 있는 점들
    low = v[v[:, 1] < height * 0.25]
    # 배: 몸 가운데 줄(|x| 작음)에서 다리 사이 가장 낮은 점
    mid = v[np.abs(v[:, 0]) < xw * 0.08]
    zc = np.median(low[:, 2]) if len(low) else 0.0
    if kind == "quad" and len(low) > 20:
        zs = np.sort(low[:, 2])
        gaps = np.diff(zs)
        k = int(np.argmax(gaps))
        front, back = zs[k + 1:], zs[:k + 1]
        hipZ, shoulderZ = float(np.median(back)), float(np.median(front))
        span = (hipZ - 0.05, shoulderZ + 0.05)
    else:
        hipZ = shoulderZ = float(zc)
        span = (hipZ - 0.08, hipZ + 0.08)
    belly = mid[(mid[:, 2] > span[0]) & (mid[:, 2] < span[1])]
    bellyY = float(belly[:, 1].min()) if len(belly) else height * 0.4
    bellyY = float(np.clip(bellyY, height * 0.15, height * 0.6))
    meta.update(bellyY=bellyY, hipZ=hipZ, shoulderZ=shoulderZ, bodyHalfX=xw * 0.25)
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--raw")
    ap.add_argument("--faces", type=int, default=14000)
    ap.add_argument("--kind", default="biped")
    ap.add_argument("--tex", type=int, default=1024)
    a = ap.parse_args()
    raw = Path(a.raw) if a.raw else ROOT / "assets_src" / "raw" / f"{a.id}.glb"
    m = normalize(simplify(load_mesh(raw), a.faces))
    meta = measure(m, a.kind)
    pos, idx, uv, nrm, tex = bake(m, a.id, a.tex)
    out = ROOT / "models" / f"{a.id}.glb"
    out.parent.mkdir(exist_ok=True)
    # 모양(GLB, UV 포함)과 텍스처(WebP)를 따로 저장해서 가볍게 만듭니다.
    tm = trimesh.Trimesh(pos, idx, vertex_normals=nrm, process=False,
                         visual=trimesh.visual.TextureVisuals(uv=uv))
    tm.export(out)
    tex.save(ROOT / "models" / f"{a.id}.webp", "WEBP", quality=82, method=6)
    (ROOT / "models" / "meta").mkdir(exist_ok=True)
    (ROOT / "models" / "meta" / f"{a.id}.json").write_text(json.dumps({k: round(x, 4) for k, x in meta.items()}))
    kb = (out.stat().st_size + (ROOT / "models" / f"{a.id}.webp").stat().st_size) // 1024
    print(f"{a.id}: {len(m.faces)} faces, {kb} KB, meta={json.dumps({k: round(x, 3) for k, x in meta.items()})}")


if __name__ == "__main__":
    main()
