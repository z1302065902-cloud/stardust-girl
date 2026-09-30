# 渲染导出后的角色 GLB，核对重定向后的姿态是否正常
import bpy, math, os
from mathutils import Vector

BASE = os.path.expanduser('~/Desktop/3d-web-game')
GLB = os.path.join(BASE, 'assets/quaternius_girl.glb')
OUT = os.path.join(BASE, 'research')

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('骨架', arm.name, '网格', [m.name for m in meshes])
print('动作', [a.name for a in bpy.data.actions])

# 尺寸
zs = []
for m in meshes:
    for c in m.bound_box:
        zs.append((m.matrix_world @ Vector(c)).z)
h = max(zs) - min(zs)
print('角色高度 %.3f' % h)

cam = bpy.data.objects.new('c', bpy.data.cameras.new('c'))
scn.collection.objects.link(cam)
cam.location = (0, -h * 2.2, h * 0.55)
cam.rotation_euler = (math.radians(90), 0, 0)
scn.camera = cam

sun = bpy.data.objects.new('s', bpy.data.lights.new('s', 'SUN'))
sun.data.energy = 4.5
sun.rotation_euler = (math.radians(52), 0, math.radians(35))
scn.collection.objects.link(sun)

scn.world = bpy.data.worlds.new('w')
scn.world.use_nodes = True
bg = scn.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.09, 0.08, 0.15, 1)
bg.inputs[1].default_value = 1.0

scn.render.engine = 'BLENDER_EEVEE'
scn.render.resolution_x = 420
scn.render.resolution_y = 640
scn.render.film_transparent = False

if arm.animation_data is None:
    arm.animation_data_create()
for name in ('Idle', 'Walk', 'Run', 'Jump', 'Win'):
    act = bpy.data.actions.get(name)
    if not act:
        continue
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    scn.frame_set(int((f0 + f1) / 2))
    bpy.context.view_layer.update()
    scn.render.filepath = os.path.join(OUT, 'chk_%s.png' % name)
    bpy.ops.render.render(write_still=True)
    print('渲染 chk_%s.png' % name)
print('CHECK_DONE')
