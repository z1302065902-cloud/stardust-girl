# 数值核验：每段动画里关键骨骼的世界坐标是否正常（头在上、脚落地）
import bpy, os
from mathutils import Vector

BASE = os.path.expanduser('~/Desktop/3d-web-game')
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(BASE, 'assets/quaternius_girl.glb'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if arm.animation_data is None:
    arm.animation_data_create()

# 角色骨架是 Z-up（Blender），取头/双脚/髋
names = {b.name.lower(): b.name for b in arm.pose.bones}
print('骨骼名样例:', list(names.values())[:12])
head = names.get('head')
hip = names.get('hips') or names.get('pelvis')
feet = [names.get(k) for k in ('foot.l', 'foot.r') if k in names]
print('取用:', 'head=', head, 'hips=', hip, 'feet=', feet)

hands = [names.get(k) for k in ('hand.l', 'hand.r') if k in names]
uarms = [names.get(k) for k in ('upperarm.l', 'upperarm.r') if k in names]

for clip in ('Idle', 'Walk', 'Run', 'Jump', 'Win', 'Fall'):
    act = bpy.data.actions.get(clip)
    if not act:
        continue
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    rows = []
    for f in (int(f0), int((f0 + f1) / 2), int(f1)):
        scn.frame_set(f)
        bpy.context.view_layer.update()
        def wz(n):
            return round((arm.matrix_world @ arm.pose.bones[n].matrix).translation.z, 3)
        hy = wz(head) if head else None
        hz = [wz(h) for h in hands]
        uz = [wz(h) for h in uarms]
        pp = wz(hip) if hip else None
        fz = [wz(f) for f in feet]
        rows.append((f, hy, pp, fz))
    print(f"{clip:6s} 帧范围 {int(f0)}-{int(f1)}")
    for (f, hy, pp, fz) in rows:
        ok = (hy is not None and pp is not None and hy > pp
              and all(-0.15 < z < 0.95 for z in fz)
              and 0.55 < pp < 1.30)
        print(f"    f{f:4d}  头z={hy:6.3f}  髋z={pp:6.3f}  脚z={fz}  手z={hz}  上臂z={uz}  {'OK' if ok else '!! 异常'}")
arm.animation_data.action = None
print('NUMCHECK_DONE')
