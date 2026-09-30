# 渲染 VRM 候选：按包围盒中心对准，渲正面/背面/脸特写
import bpy, math, os, sys
from mathutils import Vector

BASE = os.path.expanduser('~/Desktop/3d-web-game')
VD = os.path.join(BASE, 'assets/packs/vrm')
OUT = os.path.join(BASE, 'research/cand')
os.makedirs(OUT, exist_ok=True)

name = sys.argv[-1] if '--' not in sys.argv[-1] else 'Sendagaya_Shino'
if not os.path.exists(os.path.join(VD, name + '.glb')):
    name = 'Sendagaya_Shino'

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(VD, name + '.glb'))
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.context.view_layer.update()

mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for m in meshes:
    for c in m.bound_box:
        w = m.matrix_world @ Vector(c)
        mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
        mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
ctr = (mn + mx) / 2
size = mx - mn
h = size.z
print('BBOX min %s max %s center %s size %s' % (
    [round(v, 2) for v in mn], [round(v, 2) for v in mx],
    [round(v, 2) for v in ctr], [round(v, 2) for v in size]))

# 目标空物体放身体中心
tgt = bpy.data.objects.new('tgt', None)
scn.collection.objects.link(tgt)
tgt.location = (ctr.x, ctr.y, ctr.z)

cam_data = bpy.data.cameras.new('c')
cam_data.lens = 55
cam = bpy.data.objects.new('c', cam_data)
scn.collection.objects.link(cam)
scn.camera = cam
trk = cam.constraints.new('TRACK_TO')
trk.target = tgt
trk.track_axis = 'TRACK_NEGATIVE_Z'
trk.up_axis = 'UP_Y'

key = bpy.data.objects.new('k', bpy.data.lights.new('k', 'AREA'))
key.data.energy = 1500; key.data.size = 4
key.location = (ctr.x + 2.5, ctr.y - 3.0, ctr.z + 2.2)
scn.collection.objects.link(key)
k2 = bpy.data.objects.new('k2', bpy.data.lights.new('k2', 'AREA'))
k2.data.energy = 500; k2.data.size = 5
k2.location = (ctr.x - 2.8, ctr.y - 2.2, ctr.z + 1.0)
scn.collection.objects.link(k2)

scn.world = bpy.data.worlds.new('w'); scn.world.use_nodes = True
bg = scn.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.16, 0.15, 0.22, 1)
bg.inputs[1].default_value = 1.0
scn.render.engine = 'BLENDER_EEVEE'


def shoot(fname, cam_off, focus_dz=0.0, res=(480, 700)):
    tgt.location = (ctr.x, ctr.y, ctr.z + focus_dz)
    cam.location = (ctr.x + cam_off[0], ctr.y + cam_off[1], ctr.z + cam_off[2])
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.filepath = os.path.join(OUT, fname)
    bpy.ops.render.render(write_still=True)
    print('  saved', fname)


d = max(size.x, size.y, size.z) * 1.35
shoot('v_negY.png', (0, -d, h * 0.05))
shoot('v_posY.png', (0, d, h * 0.05))
shoot('v_face_negY.png', (0, -d * 0.34, h * 0.33), focus_dz=h * 0.33, res=(560, 560))
shoot('v_face_posY.png', (0, d * 0.34, h * 0.33), focus_dz=h * 0.33, res=(560, 560))
print('VIEWS_DONE', name)
