"""Codex가 만든 images/*.png 원본을 웹용 WebP로 변환합니다.

- images/<id>.webp        상세 보기용 (1024px)
- images/thumb/<id>.webp  카드 목록용 (480px)
원본 PNG는 originals/ 폴더로 옮깁니다 (git에는 올리지 않음).
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
img_dir = root / "images"
thumb_dir = img_dir / "thumb"
orig_dir = root / "originals"
thumb_dir.mkdir(parents=True, exist_ok=True)
orig_dir.mkdir(exist_ok=True)

# 새로 들어온 PNG는 originals/로 옮깁니다.
for png in img_dir.glob("*.png"):
    png.replace(orig_dir / png.name)

for png in sorted(orig_dir.glob("*.png")):
    # 가로형(_wide) 그림은 전체 화면 배경이라 더 크게 저장합니다.
    big = 1600 if png.stem.endswith("_wide") else 1024
    for size, out_dir, quality in ((big, img_dir, 80), (480, thumb_dir, 78)):
        out = out_dir / (png.stem + ".webp")
        if out.exists() and out.stat().st_mtime >= png.stat().st_mtime:
            continue
        with Image.open(png) as im:
            im = im.convert("RGB")
            im.thumbnail((size, size), Image.LANCZOS)
            im.save(out, "WEBP", quality=quality, method=6)
        print(f"{png.name} -> {out.relative_to(root)} ({out.stat().st_size // 1024} KB)")
