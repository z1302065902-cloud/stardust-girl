# 检查 Quaternius 女性角色与 UAL 动画库的骨架是否兼容
import bpy, sys, os

BASE = os.path.expanduser('~/Desktop/3d-web-game/assets/packs/tars')
UAL = os.path.join(BASE, 'quaternius-showcase-main/../quaternius.universalAnimationLibrary.standard-main/UAL1_Standard.fbx')
UAL = os.path.join(BASE, 'quaternius.universalAnimationLibrary.standard-main/UAL1_Standard.fbx')
CHAR = os.path.join(BASE, 'quaternius-showcase-main/public/glb/modular_women/Casual.glb')


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def dump_armature(label):
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    print(f"\n===== {label} =====")
    for a in arms:
        names = [b.name for b in a.data.bones]
        print(f"  armature={a.name} 骨骼数={len(names)}")
        print("  骨骼:", names[:70])
        # 层级
        roots = [b.name for b in a.data.bones if b.parent is None]
        print("  根骨骼:", roots)


def dump_actions(label):
    acts = list(bpy.data.actions)
    print(f"\n===== {label} actions: {len(acts)} =====")
    print("  名称:", [a.name for a in acts][:60])


print("UAL 文件存在:", os.path.exists(UAL), os.path.exists(CHAR))
clear()
try:
    bpy.ops.import_scene.fbx(filepath=UAL, use_anim=True)
    dump_armature("UAL FBX")
    dump_actions("UAL FBX")
except Exception as e:
    print("UAL 导入失败:", e)

clear()
try:
    bpy.ops.import_scene.gltf(filepath=CHAR)
    dump_armature("modular_women/Casual.glb")
    dump_actions("modular_women/Casual.glb")
except Exception as e:
    print("GLB 导入失败:", e)
print("\nDONE")
