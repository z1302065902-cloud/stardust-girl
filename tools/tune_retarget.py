# 实验：四种「世界增量如何搬到目标骨架」的写法，各烘一遍 Idle，用数值选正确的
import bpy, math, os
from mathutils import Matrix, Vector

BASE = os.path.expanduser('~/Desktop/3d-web-game')
UAL = os.path.join(BASE, 'assets/packs/tars/quaternius.universalAnimationLibrary.standard-main/UAL1_Standard.fbx')
CHAR = os.path.join(BASE, 'assets/packs/tars/quaternius-showcase-main/public/glb/modular_women/Casual.glb')
CLIP = 'Idle_Loop'


def build_map():
    m = {'root': 'Root', 'pelvis': 'Hips', 'spine_01': 'Abdomen', 'spine_02': 'Torso',
         'spine_03': 'Chest', 'neck_01': 'Neck', 'Head': 'Head'}
    for s, ue in (('l', 'L'), ('r', 'R')):
        m['clavicle_%s' % s] = 'Shoulder.%s' % ue
        m['upperarm_%s' % s] = 'UpperArm.%s' % ue
        m['lowerarm_%s' % s] = 'LowerArm.%s' % ue
        m['hand_%s' % s] = 'Hand.%s' % ue
        for a, b in (('index', 'Index'), ('middle', 'Middle'), ('pinky', 'Pinky'), ('ring', 'Ring'), ('thumb', 'Thumb')):
            for i in (1, 2, 3):
                m['%s_0%d_%s' % (a, i, s)] = '%s%d.%s' % (b, i, ue)
        m['thigh_%s' % s] = 'UpperLeg.%s' % ue
        m['calf_%s' % s] = 'LowerLeg.%s' % ue
        m['foot_%s' % s] = 'Foot.%s' % ue
    return m


def run(mode):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=UAL, use_anim=True, global_scale=1.0)
    ual = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    acts = {a.name.split('|')[-1]: a for a in bpy.data.actions}
    bpy.ops.import_scene.gltf(filepath=CHAR)
    ch = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name != ual.name][0]

    bone_map = build_map()
    pairs = [(u, c) for u, c in bone_map.items() if u in ual.pose.bones and c in ch.pose.bones]

    def depth(n):
        d, b = 0, ch.data.bones[n]
        while b.parent:
            d += 1; b = b.parent
        return d
    pairs.sort(key=lambda p: depth(p[1]))

    MWu = ual.matrix_world.copy()
    MWc = ch.matrix_world.copy()
    Ru = MWu.to_3x3().normalized()
    Rc = MWc.to_3x3().normalized()
    if ch.animation_data is None:
        ch.animation_data_create()

    # 目标静止朝向（世界）
    ch.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    crest = {c: (MWc @ ch.pose.bones[c].matrix).to_3x3().normalized() for u, c in pairs}
    ch.data.pose_position = 'POSE'

    ual.data.pose_position = 'POSE'
    if ual.animation_data:
        ual.animation_data.action = None
    scn.frame_set(0); bpy.context.view_layer.update()
    urest = {u: (MWu @ ual.pose.bones[u].matrix) for u, c in pairs}

    # 四种候选变换
    if mode == 1:      # 骨架空间、不做修正
        T = Matrix.Identity(3); space = 'arm'
    elif mode == 2:    # 世界空间、不做修正
        T = Matrix.Identity(3); space = 'world'
    elif mode == 3:    # 世界空间 + 用两骨架物体旋转做相似变换
        T = (Rc @ Ru.inverted()).normalized(); space = 'world'
    else:              # 骨架空间 + 相似变换
        T = (Ru.inverted() @ Rc).normalized(); space = 'arm'

    ual.animation_data.action = acts[CLIP]

    new = bpy.data.actions.new('Idle')
    ch.animation_data.action = new
    f0, f1 = acts[CLIP].frame_range
    for f in range(int(f0), int(f1) + 1, 3):
        scn.frame_set(f); bpy.context.view_layer.update()
        for pb in ch.pose.bones:
            pb.matrix_basis = Matrix()
        bpy.context.view_layer.update()
        for u, c in pairs:
            ual_pb = ual.pose.bones[u]
            ch_pb = ch.pose.bones[c]
            if space == 'arm':
                d = (ual_pb.matrix @ urest[u].inverted()).to_3x3()
                newrot = (T @ d @ T.inverted() @ crest[c]).to_4x4()
                cur = ch_pb.matrix
            else:
                wa = MWu @ ual_pb.matrix
                d = (wa @ urest[u].inverted()).to_3x3()
                newrot = (T @ d @ T.inverted() @ crest[c]).to_4x4()
                cur = MWc @ ch_pb.matrix
            newrot.translation = cur.translation.copy()
            ch_pb.matrix = (MWc.inverted() @ newrot) if space == 'world' else newrot
            bpy.context.view_layer.update()
        for u, c in pairs:
            ch.pose.bones[c].keyframe_insert('rotation_quaternion', frame=f)
            ch.pose.bones[c].keyframe_insert('location', frame=f)
    # 度量：必须把刚烘好的动作挂回去再量（否则量到的是静止姿态）
    ch.animation_data.action = new
    scn.frame_set(1); bpy.context.view_layer.update()
    def wz(n):
        pb = ch.pose.bones.get(n)
        return round((MWc @ pb.matrix).translation.z, 3) if pb else None
    head, hip = wz('Head'), wz('Hips')
    hands = [wz('Hand.L'), wz('Hand.R')]
    feet = [wz('Foot.L'), wz('Foot.R')]
    # 手到身体中轴的水平距离（垂下时应接近肩宽，抬起时会很大）
    hp = ch.pose.bones['Hand.L']
    hx = round((MWc @ hp.matrix).translation.x, 3)
    print('MODE%d[%s]  头z=%s 髋z=%s 手z=%s(手x=%s) 脚z=%s' % (mode, space, head, hip, hands, hx, feet))


for m in (1, 2, 3, 4):
    try:
        run(m)
    except Exception as e:
        print('MODE%d 失败: %s' % (m, e))
print('TUNE_DONE')
