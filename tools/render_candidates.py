# 渲染 VRM 候选角色（重命名为 .glb 后用 Blender 的 glTF 导入），用于比对外观
import bpy, math, os, shutil
from mathutils import Vector

BASE = os.path.expanduser('~/Desktop/3d-web-game')
VDIR = os.path.join(BASE, 'assets/packs/vrm')
OUT = os.path.join(BASE, 'research/cand')
os.makedirs(OUT, exist_ok=True)

CANDIDATES = ['Sendagaya_Shino', 'Sakurada_Fumiriya', 'Seed-san']


def render_one(name):
    src = os.path.join(VDIR, name + '.vrm')
    tmp = os.path.join(VDIR, name + '.glb')
    if not os.path.exists(tmp):
        shutil.copyfile(src, tmp)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    try:
        bpy.ops.import_scene.gltf(filepath=tmp)
    except Exception as e:
        print('  %s 导入失败: %s' % (name, e))
        return

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if not meshes:
        print('  %s 没有网格' % name)
        return
    bpy.context.view_layer.update()
    zs = []
    for m in meshes:
        for c in m.bound_box:
            zs.append((m.matrix_world @ Vector(c)).z)
    h = max(zs) - min(zs) if zs else 1.7
    bones = len(arm.data.bones) if arm else 0
    tris = 0
    imgs = 0
    for m in meshes:
        tris += len(m.data.loop_triangles) if m.data.loop_triangles else len(m.data.polygons)
    imgs = len([i for i in bpy.data.images if i.source == 'FILE'])
    print('  %-20s 高 %.3f m  网格 %d  骨骼 %d  面 %d  贴图 %d' % (name, h, len(meshes), bones, tris, imgs))

    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c'))
    scn.collection.objects.link(cam)
    cam.location = (0, -h * 2.1, h * 0.55)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scn.camera = cam
    key = bpy.data.objects.new('k', bpy.data.lights.new('k', 'AREA'))
    key.data.energy = 900
    key.data.size = 3
    key.location = (2.2, -2.6, 2.2)
    key.rotation_euler = (math.radians(58), 0, math.radians(40))
    scn.collection.objects.link(key)
    fill = bpy.data.objects.new('f', bpy.data.lights.new('f', 'AREA'))
    fill.data.energy = 300
    fill.data.size = 4
    fill.location = (-2.4, -1.6, 1.4)
    fill.rotation_euler = (math.radians(70), 0, math.radians(-50))
    scn.collection.objects.link(fill)
    scn.world = bpy.data.worlds.new('w')
    scn.world.use_nodes = True
    bg = scn.world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.16, 0.15, 0.22, 1)
    bg.inputs[1].default_value = 1.0
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x = 460
    scn.render.resolution_y = 660
    scn.render.filepath = os.path.join(OUT, 'cand_%s.png' % name)
    bpy.ops.render.render(write_still=True)
    print('  渲染完成 cand_%s.png' % name)


for c in CANDIDATES:
    render_one(c)
print('CAND_DONE')
