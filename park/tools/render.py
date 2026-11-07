"""GLB를 여러 방향에서 본 미리보기 그림을 만듭니다 (점 찍기 방식, 확인용).

사용: python tools/render.py a.glb [b.glb ...] -o sheet.png
"""
import argparse
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw


def load(path):
    s = trimesh.load(path, force="scene")
    m = s.to_geometry()
    return m


def dense_points(m, n=400_000, tex=None):
    pts, fi = trimesh.sample.sample_surface(m, n)
    nrm = m.face_normals[fi]
    col = None
    uv = getattr(m.visual, "uv", None)
    if tex is not None and uv is not None:
        bary = trimesh.triangles.points_to_barycentric(m.triangles[fi], pts)
        puv = np.einsum("ij,ijk->ik", bary, uv[m.faces[fi]])
        T = np.asarray(tex.convert("RGB"), np.float32)
        h, w, _ = T.shape
        x = np.clip((puv[:, 0] * (w - 1)).astype(int), 0, w - 1)
        y = np.clip(((1 - puv[:, 1]) * (h - 1)).astype(int), 0, h - 1)
        col = T[y, x]
    elif m.visual.kind == "vertex":
        vc = m.visual.vertex_colors[:, :3].astype(np.float32)
        col = vc[m.faces[fi]].mean(axis=1)
    return pts, nrm, col


def view(pts, nrm, col, yaw, pitch=15, size=320):
    a, b = np.radians(yaw), np.radians(pitch)
    Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    R = Rx @ Ry
    p = pts @ R.T
    n = nrm @ R.T
    c = p.mean(axis=0)
    p -= c
    s = (size * 0.45) / np.abs(p[:, :2]).max()
    x = (p[:, 0] * s + size / 2).astype(int)
    y = (size / 2 - p[:, 1] * s).astype(int)
    z = p[:, 2]
    ok = (x >= 0) & (x < size) & (y >= 0) & (y < size)
    x, y, z, n = x[ok], y[ok], z[ok], n[ok]
    shade = np.clip(n @ np.array([0.3, 0.6, 0.75]) / 1.0, 0.15, 1)
    base = col[ok] / 255 if col is not None else np.full((len(x), 3), 0.8)
    rgb = (base * shade[:, None] * 255).astype(np.uint8)
    img = np.full((size, size, 3), 235, np.uint8)
    order = np.argsort(z)  # 먼 것부터 그려서 가까운 것이 덮도록 (카메라는 +z 쪽)
    img[y[order], x[order]] = rgb[order]
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--yaws", default="0,90,180,270,45")
    a = ap.parse_args()
    yaws = [float(v) for v in a.yaws.split(",")]
    rows = []
    for f in a.files:
        m = load(f)
        tp = Path(f).with_suffix(".webp")
        pts, nrm, col = dense_points(m, tex=Image.open(tp) if tp.exists() else None)
        row = np.concatenate([view(pts, nrm, col, yw) for yw in yaws], axis=1)
        im = Image.fromarray(row)
        ImageDraw.Draw(im).text((4, 4), f"{Path(f).stem}  faces={len(m.faces)}", fill=(0, 0, 0))
        rows.append(np.array(im))
    Image.fromarray(np.concatenate(rows, axis=0)).save(a.out)
    print(a.out)


if __name__ == "__main__":
    main()
