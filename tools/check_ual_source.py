# 量 UAL 源动画本身的关键骨骼世界坐标，判断问题在源还是在重定向
import bpy, os

BASE = os.path.expanduser('~/Desktop/3d-web-game')
UAL = os.path.join(BASE, 'assets/packs/tars/quaternius.universalAnimationLibrary.standard-main/UAL1_Standard.fbx')

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.fbx(filepath=UAL, use_anim=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
print('骨架上轴/物体旋转:', [round(v, 3) for v in arm.matrix_world.to_euler()])
if arm.animation_data is None:
    arm.animation_data_create()

names = {b.name.lower(): b.name for b in arm.pose.bones}
print('UAL 骨骼样例:', list(names.values())[:10])
head = names.get('head')
hip = names.get('pelvis')
hands = [names.get(k) for k in ('hand_l', 'hand_r') if k in names]
feet = [names.get(k) for k in ('foot_l', 'foot_r') if k in names]

acts = {a.name.split('|')[-1]: a for a in bpy.data.actions}
for clip in ('Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Jump_Loop'):
    act = acts.get(clip)
    if not act:
        print('缺少', clip); continue
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    print(f"{clip}  帧 {int(f0)}-{int(f1)}")
    for f in (int(f0), int((f0 + f1) / 2), int(f1)):
        scn.frame_set(f)
        bpy.context.view_layer.update()
        def wz(n):
            return round(arm.pose.bones[n].matrix.translation.z, 3) if n else None
        print('    f%-4d 头z=%s 髋z=%s 手z=%s 脚z=%s' % (
            f, wz(head), wz(hip), [wz(h) for h in hands], [wz(x) for x in feet]))
arm.animation_data.action = None
print('SRCCHECK_DONE')
