"""나무처럼 어느 쪽에서 봐도 비슷한 물체: 그림 한 장으로 4방향 그림(2x2)을 만들어요.

사용: python tools/tile4.py <그림.png> <id>
출력: assets_src/views/<id>.png  (앞 / 왼쪽 / 뒤(좌우 뒤집기) / 오른쪽(좌우 뒤집기))
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src = Image.open(sys.argv[1]).convert("RGB")
vid = sys.argv[2]
w, h = src.size
# 칸 사이가 붙지 않게 흰 여백을 넣어요
pad = int(max(w, h) * 0.08)
cell = Image.new("RGB", (w + pad * 2, h + pad * 2), "white")
cell.paste(src, (pad, pad))
flip = cell.transpose(Image.FLIP_LEFT_RIGHT)
W, H = cell.size
sheet = Image.new("RGB", (W * 2, H * 2), "white")
sheet.paste(cell, (0, 0))
sheet.paste(cell, (W, 0))
sheet.paste(flip, (0, H))
sheet.paste(flip, (W, H))
out = ROOT / "assets_src" / "views" / f"{vid}.png"
sheet.save(out)
print(out)
