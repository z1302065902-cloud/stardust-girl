#!/bin/bash
# ---------------------------------------------------------------------------
# 贴图管线：程序化生成基础贴图 → Krita 工程文件(.kra) → Krita 导出最终 PNG
#
#   1) python3 tools/make_textures.py      生成基础贴图（脸部两帧 + 身体图集）
#   2) krita ... --export-filename *.kra   生成可用 Krita 手绘的工程文件
#   3) krita *.kra --export-filename *.png Krita 导出游戏实际使用的贴图
#
# 之后跑 tools/build_girl.py 时，Blender 会用 assets/tex/*.png 作为材质贴图。
# 想改画风：用 Krita 打开 krita/*.kra 手绘，再执行第 3 步即可。
# ---------------------------------------------------------------------------
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
KRITA="/Applications/krita.app/Contents/MacOS/krita"
TEX="$HERE/assets/tex"
KRA="$HERE/krita"

mkdir -p "$KRA"
echo "① 生成基础贴图…"
python3 "$HERE/tools/make_textures.py"

echo "② 生成 Krita 工程文件…"
for f in face body; do
  "$KRITA" "$TEX/$f.png" --export --export-filename "$KRA/$f.kra" 2>/dev/null || true
  echo "   → $KRA/$f.kra"
done

echo "③ Krita 导出最终贴图…"
for f in face body; do
  "$KRITA" "$KRA/$f.kra" --export --export-filename "$TEX/$f.png" 2>/dev/null || true
  echo "   → $TEX/$f.png  ($(du -h "$TEX/$f.png" | cut -f1))"
done

echo "完成。若要手绘：用 Krita 打开 krita/*.kra 修改后重跑 ③。"
