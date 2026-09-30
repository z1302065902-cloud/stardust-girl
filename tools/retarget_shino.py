# ---------------------------------------------------------------------------
# retarget_shino.py — 把 Quaternius《Universal Animation Library》(CC0) 的动画
# 重定向到 VRoid 动漫少女「千駄ヶ谷 シノ」(CC0) 的 J_Bip_* 骨架上，
# 贴图降采样 + WebP + Draco，导出可直接用于网页的 GLB。
#
# 源骨架：UE 风格 65 骨（root/pelvis/spine_01/upperarm_l/thigh_l…）
# 目标骨架：VRoid 148 骨（Root/J_Bip_C_Hips/J_Bip_L_UpperArm/J_Bip_L_UpperLeg…）
#
# 世界空间增量重定向的四条铁律（详见 skill webgl-anime-character-pipeline）：
#   1. 增量在世界空间算（两个 armature 物体的旋转约定不同）
#   2. 增量乘「静止朝向」而不是「当前朝向」（否则父级旋转被算两次）
#   3. 每帧先把全身 matrix_basis 归零（否则关键帧经父级链反馈，逐帧下沉）
#   4. 髋部竖直起伏用「绝对高度+增量」（不能 +=，否则累积）
#   5. 左右轴相反时做一次 M·D·M 镜像共轭（自动判定）
#   6. 手/手指不做朝向转移，直接跟随小臂（镜像会把手掌滚转翻成朝后）
#
# 用法：Blender -b --python tools/retarget_shino.py
# 素材许可：Quaternius CC0；VRoid「千駄ヶ谷 シノ」CC0（pixiv 官方 FAQ 确认）
# ---------------------------------------------------------------------------
import bpy
import math
import os
import sys
from mathutils import Matrix, Vector

HOME = os.path.expanduser('~')
BASE = os.path.join(HOME, 'Desktop/3d-web-game')
TARS = os.path.join(BASE, 'assets/packs/tars')
UAL_FBX = os.path.join(TARS, 'quaternius.universalAnimationLibrary.standard-main/UAL1_Standard.fbx')
CHAR_GLB = os.path.join(BASE, 'assets/packs/vrm/Sendagaya_Shino.glb')
OUT_GLB = os.path.join(BASE, 'assets/shino_girl.glb')

FPS = 30
MAX_FRAMES = 70

WANTED = [
    ('Idle', 'Idle_Loop'),
    ('Walk', 'Walk_Loop'),
    ('Run', 'Jog_Fwd_Loop'),
    ('Jump', 'Jump_Start'),
    ('Fall', 'Jump_Loop'),
    ('Spin', 'Roll'),
    ('Hurt', 'Hit_Chest'),
    ('Win', 'Dance_Loop'),
    ('Pose', 'Idle_Torch_Loop'),
]

# 贴图上限（像素）。VRoid 原包 15MB 主要是 2048 贴图
MAX_TEX = 512
FACE_TEX = 1024


def build_map():
    """UE 风格 -> VRoid J_Bip_* 的骨骼映射"""
    m = {
        'root': 'Root',
        'pelvis': 'J_Bip_C_Hips',
        'spine_01': 'J_Bip_C_Spine',
        'spine_02': 'J_Bip_C_Chest',
        'spine_03': 'J_Bip_C_UpperChest',
        'neck_01': 'J_Bip_C_Neck',
        'Head': 'J_Bip_C_Head',
    }
    for s, ue in (('l', 'L'), ('r', 'R')):
        m['clavicle_%s' % s] = 'J_Bip_%s_Shoulder' % ue
        m['upperarm_%s' % s] = 'J_Bip_%s_UpperArm' % ue
        m['lowerarm_%s' % s] = 'J_Bip_%s_LowerArm' % ue
        m['hand_%s' % s] = 'J_Bip_%s_Hand' % ue
        # 注意：VRoid 的小指叫 Little，不是 Pinky（配错会静默漏掉 6 根骨骼）
        for ue_f, vr_f in (('index', 'Index'), ('middle', 'Middle'),
                           ('pinky', 'Little'), ('ring', 'Ring'), ('thumb', 'Thumb')):
            for i in (1, 2, 3):
                m['%s_0%d_%s' % (ue_f, i, s)] = 'J_Bip_%s_%s%d' % (ue, vr_f, i)
        m['thigh_%s' % s] = 'J_Bip_%s_UpperLeg' % ue
        m['calf_%s' % s] = 'J_Bip_%s_LowerLeg' % ue
        m['foot_%s' % s] = 'J_Bip_%s_Foot' % ue
        m['ball_%s' % s] = 'J_Bip_%s_ToeBase' % ue
    return m


def main():
    print('=== 清场 ===')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = FPS

    print('=== 导入 UAL 动画库 ===')
    bpy.ops.import_scene.fbx(filepath=UAL_FBX, use_anim=True, global_scale=1.0)
    ual_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    ual_actions = {a.name.split('|')[-1]: a for a in bpy.data.actions}
    print('  UAL %s 骨骼 %d 动作 %d' % (ual_arm.name, len(ual_arm.data.bones), len(ual_actions)))

    print('=== 导入 VRoid 动漫少女（CC0）===')
    bpy.ops.import_scene.gltf(filepath=CHAR_GLB)
    char_arm = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name != ual_arm.name][0]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == char_arm]
    junk = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent != char_arm]
    for o in junk:
        print('  丢弃无关网格:', o.name)
        bpy.data.objects.remove(o, do_unlink=True)
    print('  角色 %s 骨骼 %d 网格 %s' % (char_arm.name, len(char_arm.data.bones), [m.name for m in meshes]))

    bone_map = build_map()
    pairs = [(u, c) for u, c in bone_map.items()
             if u in ual_arm.pose.bones and c in char_arm.pose.bones]
    missing = [u for u, c in bone_map.items()
               if u not in ual_arm.pose.bones or c not in char_arm.pose.bones]
    print('  配对数 %d 缺失 %s' % (len(pairs), missing))

    def depth(n):
        d, b = 0, char_arm.data.bones[n]
        while b.parent:
            d += 1
            b = b.parent
        return d
    pairs.sort(key=lambda p: depth(p[1]))

    MW_ual = ual_arm.matrix_world.copy()
    MW_char = char_arm.matrix_world.copy()
    MWc_inv = MW_char.inverted()
    print('  UAL 物体旋转 %s  角色物体旋转 %s' % (
        [round(v, 3) for v in MW_ual.to_euler()], [round(v, 3) for v in MW_char.to_euler()]))

    # 目标静止朝向（世界）
    char_arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    char_rest_rot = {c: (MW_char @ char_arm.pose.bones[c].matrix).to_3x3().normalized() for u, c in pairs}
    char_rest_pos = {c: (MW_char @ char_arm.pose.bones[c].matrix).translation.copy() for u, c in pairs}
    char_arm.data.pose_position = 'POSE'
    bpy.context.view_layer.update()

    # 源静止姿态
    ual_arm.data.pose_position = 'POSE'
    if ual_arm.animation_data and ual_arm.animation_data.action:
        ual_arm.animation_data.action = None
    scn.frame_set(0)
    bpy.context.view_layer.update()
    ual_rest = {u: (MW_ual @ ual_arm.pose.bones[u].matrix) for u, c in pairs}

    # ---- 左右轴镜像的自动判定：比较源与目标的「左手」在世界空间里的 X 符号 ----
    def hand_x(arm, MW, name):
        pb = arm.pose.bones.get(name)
        return (MW @ pb.matrix).translation.x if pb else None
    sx = hand_x(ual_arm, MW_ual, 'hand_l')
    tx = hand_x(char_arm, MW_char, 'J_Bip_L_Hand')
    mirror = (sx is not None and tx is not None and (sx * tx) < 0)
    MIRROR = Matrix(((-1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))).to_3x3() if mirror else Matrix.Identity(3)
    print('  左手世界X  源=%.3f 目标=%.3f → %s' % (sx or 0, tx or 0, '需要左右镜像' if mirror else '不用镜像'))

    # 髋部起伏
    hip_pair = next(((u, c) for u, c in pairs if c in ('J_Bip_C_Hips', 'Hips')), None)
    hip_scale, char_hip_rest_z = 1.0, 1.0
    if hip_pair:
        u_h = ual_rest[hip_pair[0]].translation.z
        c_h = char_rest_pos[hip_pair[1]].z
        char_hip_rest_z = c_h
        if abs(u_h) > 0.2:
            hip_scale = c_h / u_h
        print('  髋高 源=%.3f 目标=%.3f 比例=%.3f' % (u_h, c_h, hip_scale))

    RIGID_FOLLOW = {'J_Bip_L_Hand', 'J_Bip_R_Hand'}
    for side in ('L', 'R'):
        for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
            for i in (1, 2, 3):
                RIGID_FOLLOW.add('J_Bip_%s_%s%d' % (side, f, i))

    if char_arm.animation_data is None:
        char_arm.animation_data_create()

    made = []
    for target, src in WANTED:
        act = ual_actions.get(src)
        if act is None:
            print('  !! 找不到动作', src)
            continue
        if ual_arm.animation_data is None:
            ual_arm.animation_data_create()
        ual_arm.animation_data.action = act
        f0, f1 = act.frame_range
        total = int(round(f1 - f0)) + 1
        step = max(1, int(math.ceil(total / MAX_FRAMES)))
        frames = list(range(int(round(f0)), int(round(f1)) + 1, step))
        print('  -> %s <= %s  %d 帧取 %d' % (target, src, total, len(frames)))

        new_act = bpy.data.actions.new(name=target)
        char_arm.animation_data.action = new_act
        for f in frames:
            scn.frame_set(f)
            bpy.context.view_layer.update()
            for pb in char_arm.pose.bones:          # 铁律 3
                pb.matrix_basis = Matrix()
            bpy.context.view_layer.update()
            for u, c in pairs:
                if c in RIGID_FOLLOW:               # 铁律 6
                    continue
                ual_pb = ual_arm.pose.bones[u]
                char_pb = char_arm.pose.bones[c]
                w_anim = MW_ual @ ual_pb.matrix
                d_rot = (w_anim @ ual_rest[u].inverted()).to_3x3().normalized()   # 铁律 1
                if mirror:
                    d_rot = MIRROR @ d_rot @ MIRROR
                cur_w = MW_char @ char_pb.matrix
                new_w = (d_rot @ char_rest_rot[c]).to_4x4()                        # 铁律 2
                new_w.translation = cur_w.translation.copy()
                if hip_pair and c == hip_pair[1]:                                  # 铁律 4
                    dz = (w_anim.translation.z - ual_rest[u].translation.z) * hip_scale
                    new_w.translation.z = char_hip_rest_z + max(-0.25, min(0.25, dz))
                char_pb.matrix = MWc_inv @ new_w
                bpy.context.view_layer.update()
            for u, c in pairs:
                pb = char_arm.pose.bones[c]
                pb.keyframe_insert('rotation_quaternion', frame=f)
                pb.keyframe_insert('location', frame=f)
        new_act.use_fake_user = True
        made.append((target, len(frames)))
        char_arm.animation_data.action = None

    char_arm.animation_data.action = None
    for pb in char_arm.pose.bones:
        pb.matrix_basis = Matrix()
    bpy.context.view_layer.update()

    # ---- 瘦身：贴图降采样 + WebP ----
    print('=== 贴图瘦身 ===')
    total_before = 0
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        w, h = img.size
        cap = FACE_TEX if ('face' in img.name.lower() or 'Face' in img.name) else MAX_TEX
        if max(w, h) > cap:
            k = cap / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
        try:
            img.file_format = 'WEBP'
        except Exception:
            pass
        print('  %-28s %dx%d -> %s' % (img.name[:28], w, h, img.file_format))

    # ---- 导出 ----
    keep = {t for t, _ in WANTED}
    removed = 0
    for a in list(bpy.data.actions):
        if a.name not in keep:
            bpy.data.actions.remove(a)
            removed += 1
    print('  清理多余动作 %d 个' % removed)
    bpy.data.objects.remove(ual_arm, do_unlink=True)

    bpy.ops.object.select_all(action='DESELECT')
    char_arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = char_arm
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_image_format='WEBP',
        export_image_quality=80,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )
    print('EXPORTED %s %d bytes (%.2f MB)' % (OUT_GLB, os.path.getsize(OUT_GLB), os.path.getsize(OUT_GLB) / 1048576))
    for t, n in made:
        print('  clip %-6s %d 帧' % (t, n))
    print('SHINO_RETARGET_DONE')


main()
