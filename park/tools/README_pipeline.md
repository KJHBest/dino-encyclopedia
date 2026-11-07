# 공룡 3D 모델 만들기 (모두 내 컴퓨터에서)

새 ComfyUI(v0.44, `D:\sd\ComfyUI_v044`, 포트 **8189**)를 씁니다. 모델 파일은 기존 ComfyUI 모델 폴더를 같이 써요.

1. **4방향 그림** (2x2: 앞 / 왼쪽 옆 / 뒤 / 오른쪽 옆, 흰 배경) → `assets_src/views/<id>.png`
   - 추천: Qwen-Image-2.1로 **티라노 그림을 다른 공룡으로 고치기** (모양·스타일이 똑같이 맞춰져요)
     ```
     python tools/comfy2.py edit "Replace the Tyrannosaurus with a Triceratops (...). Keep exactly the same 2x2 layout, ..." assets_src/views/triceratops.png --img assets_src/views/tyrannosaurus.png
     ```
   - 또는 Krea 2로 새로 그리기: `python tools/comfy2.py krea "<4방향 그림 설명>" out.png`
2. **3D 모양**: `python tools/hy3d.py <id>` → Hunyuan3D-2mv (turbo) → `assets_src/raw/<id>.glb`
   - 앞모습과 옆모습 두 장만 있어도 모양이 잘 나와요 (`--views front,left`)
3. **색칠·가볍게**: `python tools/paint.py <id> --kind biped|quad|flyer` → `models/<id>.glb`, `models/<id>.webp`, `models/meta/<id>.json`
4. **확인 그림**: `python tools/render.py models/<id>.glb -o check.png`

새 공룡을 공원에 넣으려면 `js/dinodata.js`에 추가하고 `sw.js`의 목록과 버전도 고쳐 주세요.

## 설치된 그림 모델 (새 ComfyUI)

- **Krea 2 Turbo** (글 → 그림): `krea2_turbo_fp8_scaled` + `qwen3vl_4b_fp8_scaled` + `qwen_image_vae`
- **Qwen-Image-2.1 Turbo** (글 → 그림, 그림 고치기): `qwen_image_2.1_turbo_bf16` + `qwen3vl_8b_int8_convrot` + `qwen_image_2.1_vae_bf16`
- ComfyUI 화면의 템플릿에서 "Krea-2 Turbo", "Qwen Image 2.1 Turbo Image Edit"을 열면 바로 쓸 수 있어요.
- 라이선스: Krea 2는 Krea 2 Community License, Qwen-Image-2.1은 Qwen Research License (개인·연구용)

예전 방법: Codex 그림(`genviews`), Flux/SDXL(`flux_views.py`, `sdxl_views.py`)은 앞/옆 모습이 서로 안 맞아서 잘 안 됐어요.
