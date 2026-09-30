# ---------------------------------------------------------------------------
# retarget_girl.py — 把 Quaternius《Universal Animation Library》(CC0) 的动画
# 重定向到 Quaternius modular_women 女性角色骨架上，导出可直接用于网页的 GLB。
#
# 两套骨架命名完全不同（UAL 是 UE 风格 65 骨，角色是 GameRig 风格 51 骨），
# 所以不能用「按名套用动作」，而是做世界空间增量重定向：
#   D = W_anim * W_rest^-1        （UAL 骨骼相对静止姿态的旋转增量）
#   角色骨骼 = T(head) * D_rot * T(-head) * 当前矩阵
# 逐帧烘焙成角色自己的动作，再导出。
#
# 用法：Blender -b --python tools/retarget_girl.py
# 素材许可：Quaternius，CC0（公共领域），可商用、无需署名。
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
CHAR_GLB = os.path.join(TARS, 'quaternius-showcase-main/public/glb/modular_women/Casual.glb')
OUT_GLB = os.path.join(BASE, 'assets/quaternius_girl.glb')

FPS = 30

# 想要的动作：目标名 -> UAL 动作名（游戏里按目标名做状态映射）
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

# 目标骨骼最大帧长（太长的话网页里播放浪费）
MAX_FRAMES = 70


def build_map():
    m = {
        'root': 'Root', 'pelvis': 'Hips', 'spine_01': 'Abdomen',
        'spine_02': 'Torso', 'spine_03': 'Chest', 'neck_01': 'Neck', 'Head': 'Head',
    }
    for s, ue in (('l', 'L'), ('r', 'R')):
        m['clavicle_%s' % s] = 'Shoulder.%s' % ue
        m['upperarm_%s' % s] = 'UpperArm.%s' % ue
        m['lowerarm_%s' % s] = 'LowerArm.%s' % ue
        m['hand_%s' % s] = 'Hand.%s' % ue
        for ue_f, gr_f in (('index', 'Index'), ('middle', 'Middle'),
                           ('pinky', 'Pinky'), ('ring', 'Ring'), ('thumb', 'Thumb')):
            for i in (1, 2, 3):
                m['%s_0%d_%s' % (ue_f, i, s)] = '%s%d.%s' % (gr_f, i, ue)
        m['thigh_%s' % s] = 'UpperLeg.%s' % ue
        m['calf_%s' % s] = 'LowerLeg.%s' % ue
        m['foot_%s' % s] = 'Foot.%s' % ue
    return m


def clean_import_gltf(path):
    bpy.ops.import_scene.gltf(filepath=path)


def prev_render(scn, char_arm, meshes, made):
    """把烘好的几段动作各渲染一帧，用于人工/视觉核对姿态是否正常"""
    total_z = []
    for m in meshes:
        for c in m.bound_box:
            total_z.append((m.matrix_world @ Vector(c)).z)
    h = max(total_z) - min(total_z)
    cam_z = h * 0.55
    cam_d = h * 2.4

    cam_data = bpy.data.cameras.new('chkcam')
    cam = bpy.data.objects.new('chkcam', cam_data)
    scn.collection.objects.link(cam)
    cam.location = (0, -cam_d, cam_z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scn.camera = cam

    sun = bpy.data.objects.new('chksun', bpy.data.lights.new('chksun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    scn.collection.objects.link(sun)
    scn.world = bpy.data.worlds.new('chkw')
    scn.world.use_nodes = True
    scn.world.node_tree.nodes['Background'].inputs[0].default_value = (0.10, 0.10, 0.16, 1)
    scn.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0

    scn.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'SceneEEVEE') else 'BLENDER_WORKBENCH'
    scn.render.resolution_x = 420
    scn.render.resolution_y = 620
    scn.render.film_transparent = False
    OUT = os.path.join(BASE, 'research')
    for name in ('Idle', 'Walk', 'Run'):
        act = bpy.data.actions.get(name)
        if not act:
            continue
        char_arm.animation_data.action = act
        f0, f1 = act.frame_range
        scn.frame_set(int((f0 + f1) / 2))
        bpy.context.view_layer.update()
        scn.render.filepath = os.path.join(OUT, 'retarget_%s.png' % name)
        bpy.ops.render.render(write_still=True)
        print('  校验图 research/retarget_%s.png' % name)
    char_arm.animation_data.action = None


def main():
    print('=== 清场 ===')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = FPS

    print('=== 导入 UAL 动画库 ===')
    bpy.ops.import_scene.fbx(filepath=UAL_FBX, use_anim=True, global_scale=1.0)
    ual_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    ual_actions = {a.name.split('|')[-1]: a for a in bpy.data.actions}
    print('  UAL 骨架 %s，%d 根骨骼，%d 个动作' % (ual_arm.name, len(ual_arm.data.bones), len(ual_actions)))

    print('=== 导入外部女性角色（CC0）===')
    clean_import_gltf(CHAR_GLB)
    char_arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    char_arm = [o for o in char_arms if o.name != ual_arm.name][0]
    # 只取挂在角色骨架下的网格（UAL 自带的麦架网格不要）
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == char_arm]
    junk = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent != char_arm]
    for o in junk:
        print('  丢弃无关网格:', o.name)
        bpy.data.objects.remove(o, do_unlink=True)
    print('  角色骨架 %s，%d 根骨骼，网格 %s' % (
        char_arm.name, len(char_arm.data.bones), [m.name for m in meshes]))

    # 角色原始高度（用于对齐游戏里的 1.62m）
    bpy.context.view_layer.update()
    zs = []
    for m in meshes:
        for c in m.bound_box:
            zs.append((m.matrix_world @ Vector(c)).z)
    print('  角色高度 %.3f m' % (max(zs) - min(zs)))

    bone_map = build_map()
    pairs = [(u, c) for u, c in bone_map.items()
             if u in ual_arm.pose.bones and c in char_arm.pose.bones]
    missing = [u for u, c in bone_map.items() if u not in ual_arm.pose.bones or c not in char_arm.pose.bones]
    print('  骨骼配对数 %d，缺失 %s' % (len(pairs), missing))

    # 层级顺序（父先子后），设置 pose matrix 必须按这个顺序
    def depth(name):
        d = 0
        b = char_arm.data.bones[name]
        while b.parent:
            d += 1
            b = b.parent
        return d
    pairs.sort(key=lambda p: depth(p[1]))

    # 两套骨架的 armature 空间上轴约定可能不同（glTF 导入 vs FBX 导入），
    # 所以增量必须放到「世界空间」里算，再转回各自骨架空间。
    MW_ual = ual_arm.matrix_world.copy()
    MW_char = char_arm.matrix_world.copy()
    MWc_inv = MW_char.inverted()
    # 两套 rig 的左右轴相反（源骨架左手在 -X、目标在 +X，两个角色朝向相差 180°）。
    # 世界空间增量必须在 X 上做一次镜像共轭 M·D·M（M=diag(-1,1,1)）：
    # 手臂的「抬起/放下」是绕 Y 的旋转，镜像后正好变对；
    # 腿部的前后摆动是绕 X 的旋转，镜像不影响，所以腿不会被搞坏。
    MIRROR = Matrix(((-1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))).to_3x3()
    print('  UAL 物体矩阵旋转:', [round(v, 3) for v in MW_ual.to_euler()])
    print('  角色物体矩阵旋转:', [round(v, 3) for v in MW_char.to_euler()])

    # 角色静止时的世界朝向
    char_arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    char_rest_rot = {c: (MW_char @ char_arm.pose.bones[c].matrix).to_3x3() for u, c in pairs}
    char_arm.data.pose_position = 'POSE'
    bpy.context.view_layer.update()

    ual_arm.data.pose_position = 'POSE'
    if ual_arm.animation_data:
        ual_arm.animation_data.action = None
    scn.frame_set(0)
    bpy.context.view_layer.update()
    # UAL 各骨骼的世界空间静止姿态
    ual_rest = {u: (MW_ual @ ual_arm.pose.bones[u].matrix).copy() for u, c in pairs}

    # 髋部起伏的尺度比例：两套骨架单位可能不同（UAL 是 UE 导出的 FBX）
    hip_pair = next(((u, c) for u, c in pairs if c == 'Hips'), None)
    if hip_pair:
        u0 = ual_rest[hip_pair[0]].translation.z
        c0 = char_rest_rot and None  # 占位，下面用 pose 空间取
    hip_scale = 1.0
    char_hip_rest_z = 1.0
    if hip_pair:
        _u = ual_rest[hip_pair[0]].translation.z
        _c = (MW_char @ char_arm.pose.bones[hip_pair[1]].matrix).translation.z
        if abs(_u) > 0.2:
            hip_scale = _c / _u
        char_hip_rest_z = _c
        print('  髋部高度 UAL=%.3f 角色=%.3f → 起伏比例 %.3f' % (_u, _c, hip_scale))

    if char_arm.animation_data is None:
        char_arm.animation_data_create()

    # 手/手指：不转移朝向，保持静止相对姿态（跟随小臂）
    RIGID_FOLLOW = {'Hand.L', 'Hand.R'}
    for side in ('L', 'R'):
        for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
            for i in (1, 2, 3):
                RIGID_FOLLOW.add('%s%d.%s' % (f, i, side))
    print('  手部跟随（不转移朝向）的骨骼数:', len(RIGID_FOLLOW))

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
        print('  -> %s <= %s  帧 %s..%s（共 %d 帧，取 %d 帧）' %
              (target, src, int(f0), int(f1), total, len(frames)))

        new_act = bpy.data.actions.new(name=target)
        char_arm.animation_data.action = new_act
        for f in frames:
            scn.frame_set(f)
            bpy.context.view_layer.update()
            # 关键：每帧先把角色全身骨骼归零。否则上一帧写进去的关键帧会通过父级链
            # 反馈到这一帧的 cur_w.translation 上，髋部高度会逐帧累积下沉。
            for pb in char_arm.pose.bones:
                pb.matrix_basis = Matrix()
            bpy.context.view_layer.update()
            for u, c in pairs:
                if c in RIGID_FOLLOW:
                    continue                      # 手部保持静止相对姿态
                ual_pb = ual_arm.pose.bones[u]
                char_pb = char_arm.pose.bones[c]
                w_anim = MW_ual @ ual_pb.matrix
                d_rot = (w_anim @ ual_rest[u].inverted()).to_3x3()        # 世界空间旋转增量
                d_rot = MIRROR @ d_rot @ MIRROR                            # 左右轴镜像
                cur_w = MW_char @ char_pb.matrix
                # 目标朝向 = 骨骼「静止朝向」× 自身世界增量。
                # 必须用静止朝向：当前朝向里已经含了父级这次刚被赋的旋转，再乘一次就重复了。
                new_w = (d_rot @ char_rest_rot[c]).to_4x4()
                new_w.translation = cur_w.translation.copy()               # 位置仍由父级链决定
                if c == 'Hips':
                    # 只搬「上下」这一轴，水平位移不要（动画必须是原地循环）。
                    # 用绝对高度 + 增量，不能 +=，否则逐帧累计。
                    dz = (w_anim.translation.z - ual_rest[u].translation.z) * hip_scale
                    new_w.translation.z = char_hip_rest_z + max(-0.30, min(0.30, dz))
                char_pb.matrix = MWc_inv @ new_w
                bpy.context.view_layer.update()
            # 逐骨骼打关键帧
            for u, c in pairs:
                pb = char_arm.pose.bones[c]
                pb.keyframe_insert('rotation_quaternion', frame=f)
                pb.keyframe_insert('location', frame=f)
        # 根骨骼的位移也带上（跳跃的上下起伏）
        for u, c in pairs:
            if c in ('Root', 'Hips'):
                pass
        new_act.use_fake_user = True
        made.append((target, len(frames), round((frames[-1] - frames[0]) / FPS, 2)))
        char_arm.animation_data.action = None

    # 回到静止姿态导出
    char_arm.animation_data.action = None
    for pb in char_arm.pose.bones:
        pb.matrix_basis = Matrix()
    bpy.context.view_layer.update()

    # 只保留需要的 9 段动画：UAL 原厂的 45 段会把文件从 0.4MB 吹到 1.6MB
    keep = {t for t, _ in WANTED}
    removed = 0
    for a in list(bpy.data.actions):
        if a.name not in keep:
            bpy.data.actions.remove(a)
            removed += 1
    print('  清理多余动作 %d 个，保留 %d 个' % (removed, len(bpy.data.actions)))
    # UAL 骨架本体也不需要导出
    ual_arm.hide_render = True
    bpy.data.objects.remove(ual_arm, do_unlink=True)

    print('=== 导出前校验渲染 ===')
    try:
        prev_render(scn, char_arm, meshes, made)
    except Exception as e:
        print('  校验渲染失败:', e)

    print('=== 导出 GLB ===')
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
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )
    size = os.path.getsize(OUT_GLB)
    print('EXPORTED %s %d bytes' % (OUT_GLB, size))
    for t, n, sec in made:
        print('  clip %-6s %3d 帧  %.2fs' % (t, n, sec))
    print('RETARGET_DONE')


main()
