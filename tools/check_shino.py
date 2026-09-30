# 校验 Shino 角色的重定向结果：数值（头/髋/脚/手的世界坐标）+ 渲染 5 段动作
import bpy, math, os
from mathutils import Vector

BASE = os.path.expanduser('~/Desktop/3d-web-game')
GLB = os.path.join(BASE, 'assets/shino_girl.glb')
OUT = os.path.join(BASE, 'research/shino')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('骨架 %s 骨骼 %d 网格 %s' % (arm.name, len(arm.data.bones), [m.name for m in meshes]))
print('动作 %s' % [a.name for a in bpy.data.actions])

B = dict(head='J_Bip_C_Head', hips='J_Bip_C_Hips',
         fL='J_Bip_L_Foot', fR='J_Bip_R_Foot',
         hL='J_Bip_L_Hand', hR='J_Bip_R_Hand')
missing = [k for k, v in B.items() if v not in arm.pose.bones]
print('缺失关键骨骼:', missing)
if arm.animation_data is None:
    arm.animation_data_create()


def w(bone):
    pb = arm.pose.bones.get(bone)
    if pb is None:
        return None
    return (arm.matrix_world @ pb.matrix).translation.z


print('--- 姿态数值（世界 Z，Blender 上方向）---')
bad = 0
for clip in ('Idle', 'Walk', 'Run', 'Jump', 'Win', 'Fall'):
    act = bpy.data.actions.get(clip)
    if not act:
        continue
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    for f in (int(f0), int((f0 + f1) / 2), int(f1)):
        scn.frame_set(f)
        bpy.context.view_layer.update()
        hz, pz = w(B['head']), w(B['hips'])
        fl, fr = w(B['fL']), w(B['fR'])
        hl, hr = w(B['hL']), w(B['hR'])
        ok = (hz is not None and pz is not None and hz > pz
              and fl is not None and fr is not None and -0.15 < fl < 0.95 and -0.15 < fr < 0.95
              and 0.55 < pz < 1.25)
        if not ok:
            bad += 1
        print('  %-5s f%-4d 头=%6.3f 髋=%6.3f 脚=[%6.3f,%6.3f] 手=[%6.3f,%6.3f] %s' % (
            clip, f, hz, pz, fl, fr, hl, hr, 'OK' if ok else '!! 异常'))
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = pb.matrix_basis.Identity(4)
bpy.context.view_layer.update()

# ---- 渲染 ----
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for m in meshes:
    for c in m.bound_box:
        p = m.matrix_world @ Vector(c)
        mn = Vector((min(mn.x, p.x), min(mn.y, p.y), min(mn.z, p.z)))
        mx = Vector((max(mx.x, p.x), max(mx.y, p.y), max(mx.z, p.z)))
ctr = (mn + mx) / 2
size = mx - mn
print('BBOX center %s size %s' % ([round(v, 2) for v in ctr], [round(v, 2) for v in size]))

tgt = bpy.data.objects.new('tgt', None); scn.collection.objects.link(tgt)
tgt.location = (ctr.x, ctr.y, ctr.z)
cam_data = bpy.data.cameras.new('c'); cam_data.lens = 60
cam = bpy.data.objects.new('c', cam_data); scn.collection.objects.link(cam)
scn.camera = cam
trk = cam.constraints.new('TRACK_TO'); trk.target = tgt
trk.track_axis = 'TRACK_NEGATIVE_Z'; trk.up_axis = 'UP_Y'
key = bpy.data.objects.new('k', bpy.data.lights.new('k', 'AREA'))
key.data.energy = 1600; key.data.size = 4
key.location = (ctr.x + 2.4, ctr.y - 3.0, ctr.z + 2.4); scn.collection.objects.link(key)
k2 = bpy.data.objects.new('k2', bpy.data.lights.new('k2', 'AREA'))
k2.data.energy = 600; k2.data.size = 5
k2.location = (ctr.x - 2.8, ctr.y - 2.2, ctr.z + 1.2); scn.collection.objects.link(k2)
scn.world = bpy.data.worlds.new('w'); scn.world.use_nodes = True
bg = scn.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.16, 0.15, 0.22, 1); bg.inputs[1].default_value = 1.0
scn.render.engine = 'BLENDER_EEVEE'
scn.render.resolution_x, scn.render.resolution_y = 420, 640
d = max(size.x, size.y, size.z) * 1.30
# 相机放在 +Y 侧：这个 VRoid 模型的正脸朝 +Y（-Y 侧看到的是后脑勺）
cam.location = (ctr.x, ctr.y + d, ctr.z + size.z * 0.05)
for clip in ('Idle', 'Walk', 'Run', 'Win'):
    act = bpy.data.actions.get(clip)
    if not act:
        continue
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    scn.frame_set(int((f0 + f1) / 2))
    bpy.context.view_layer.update()
    scn.render.filepath = os.path.join(OUT, 'sh_%s.png' % clip)
    bpy.ops.render.render(write_still=True)
    print('  渲染 sh_%s.png' % clip)
tgt.location = (ctr.x, ctr.y, ctr.z + size.z * 0.34)
cam.location = (ctr.x, ctr.y + d * 0.42, ctr.z + size.z * 0.34)
arm.animation_data.action = bpy.data.actions.get('Idle')
scn.frame_set(1); bpy.context.view_layer.update()
scn.render.resolution_x, scn.render.resolution_y = 520, 520
scn.render.filepath = os.path.join(OUT, 'sh_face.png')
bpy.ops.render.render(write_still=True)
print('  渲染 sh_face.png')
print('BAD_COUNT %d' % bad)
print('SHINO_CHECK_DONE')
