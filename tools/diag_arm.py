# 精确定位：对比源骨架与重定向后骨架的「肩-肘-腕」世界坐标
import bpy, os
from mathutils import Vector

BASE = os.path.expanduser('~/Desktop/3d-web-game')
UAL = os.path.join(BASE, 'assets/packs/tars/quaternius.universalAnimationLibrary.standard-main/UAL1_Standard.fbx')
GLB = os.path.join(BASE, 'assets/quaternius_girl.glb')


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def chain_pos(arm, chain, frame=None):
    out = {}
    for label, name in chain:
        pb = arm.pose.bones.get(name)
        if pb is None:
            out[label] = None
            continue
        m = arm.matrix_world @ pb.matrix
        out[label] = tuple(round(v, 3) for v in m.translation)
    return out


UAL_CHAIN = [('肩', 'clavicle_l'), ('肘', 'upperarm_l'), ('腕', 'lowerarm_l'), ('手', 'hand_l')]
CH_CHAIN = [('肩', 'Shoulder.L'), ('肘', 'UpperArm.L'), ('腕', 'LowerArm.L'), ('手', 'Hand.L')]


def dist(a, b):
    if not a or not b:
        return None
    return round((Vector(a) - Vector(b)).length, 3)


print('===== 源骨架 UAL：Idle_Loop =====')
clear()
scn = bpy.context.scene
bpy.ops.import_scene.fbx(filepath=UAL, use_anim=True)
ual = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if ual.animation_data is None:
    ual.animation_data_create()
acts = {a.name.split('|')[-1]: a for a in bpy.data.actions}
ual.animation_data.action = None
scn.frame_set(1); bpy.context.view_layer.update()
print('  静止(T/A pose):', chain_pos(ual, UAL_CHAIN))
ual.animation_data.action = acts['Idle_Loop']
scn.frame_set(1); bpy.context.view_layer.update()
p = chain_pos(ual, UAL_CHAIN)
print('  Idle f1      :', p)
print('  上臂长 肘-肩=', dist(p['肘'], p['肩']), ' 前臂长 腕-肘=', dist(p['腕'], p['肘']))

print('===== 目标骨架（导出的 GLB）：Idle =====')
clear()
scn = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)
ch = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if ch.animation_data is None:
    ch.animation_data_create()
ch.animation_data.action = None
scn.frame_set(1); bpy.context.view_layer.update()
print('  静止(T/A pose):', chain_pos(ch, CH_CHAIN))
act = bpy.data.actions.get('Idle')
ch.animation_data.action = act
scn.frame_set(int(act.frame_range[0])); bpy.context.view_layer.update()
p2 = chain_pos(ch, CH_CHAIN)
print('  Idle f1      :', p2)
print('  上臂长 肘-肩=', dist(p2['肘'], p2['肩']), ' 前臂长 腕-肘=', dist(p2['腕'], p2['肘']))
print('DIAG_DONE')
