# 공룡 3D 모델 만들기

1. Codex로 4방향 그림: `assets_src/views/<id>.png` (2x2: 앞 / 왼쪽 옆 / 뒤 / 오른쪽 옆, 흰 배경)
2. ComfyUI(Hunyuan3D-2mv turbo)로 모양: `python tools/hy3d.py <id>` → `assets_src/raw/<id>.glb`
3. 색칠·가볍게: `python tools/paint.py <id> --kind biped|quad|flyer` → `models/<id>.glb`, `models/<id>.webp`, `models/meta/<id>.json`
4. 확인용 그림: `python tools/render.py models/<id>.glb -o check.png`
