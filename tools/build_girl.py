"""
Blender 角色构建 v2 —— 结构化重做版
  · 修正人体结构（肩、肘、手、膝、小腿、脚、裙摆）
  · 全套 UV 展开 + 贴图材质（脸部 / 身体图集，贴图走 Krita 管线）
  · 骨架绑定、关键帧动画
  · Draco 压缩导出 glTF(.glb) + 预览渲染

用法：
  blender -b --python tools/build_girl.py -- [--preview] [--tag=v1] [--no-export] [--no-draco]
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Euler

PI = math.pi
TAU = math.pi * 2

OUT_DIR = os.path.expanduser("~/Desktop/3d-web-game")
ASSETS = os.path.join(OUT_DIR, "assets")
RESEARCH = os.path.join(OUT_DIR, "research")
TEXDIR = os.path.join(ASSETS, "tex")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(RESEARCH, exist_ok=True)

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_EXPORT = "--no-export" not in ARGV
DO_PREVIEW = "--preview" in ARGV
DO_DRACO = "--no-draco" not in ARGV
PREVIEW_TAG = "v"
for a in ARGV:
    if a.startswith("--tag="):
        PREVIEW_TAG = a.split("=", 1)[1]

# ===========================================================================
# 图集分区（UV 空间，原点左下）
# ===========================================================================
R_HAIR = (0.50, 0.50, 0.50, 0.50)      # 头发（沿长度渐变 + 发丝）
R_TOP = (0.00, 0.00, 0.50, 0.50)       # 上衣（圆柱展开，画水手领描边）
R_SKIRT = (0.50, 0.00, 0.25, 0.25)     # 裙子（圆柱展开，画褶阴影）
R_SKIN = (0.75, 0.25, 0.25, 0.25)      # 四肢皮肤（沿长度柔和渐变）
R_COLLAR = (0.75, 0.00, 0.25, 0.25)    # 深蓝（袜子等）
PATCH_CELL = 0.125


def patch_center(i):
    return (0.0625 + (i % 4) * PATCH_CELL, 0.9375 - (i // 4) * PATCH_CELL)


PATCH = {
    'skin': patch_center(0), 'cloth': patch_center(1), 'navy': patch_center(2),
    'navy_dark': patch_center(3), 'trim': patch_center(4), 'bow': patch_center(5),
    'ribbon': patch_center(6), 'sock': patch_center(7), 'shoe': patch_center(8),
    'skin_shade': patch_center(9), 'hair_dark': patch_center(10), 'hair_light': patch_center(11),
}


def clamp(v, a, b):
    return max(a, min(b, v))


# ===========================================================================
# 基础工具
# ===========================================================================
def obj_from_bm(name, bm, uv_mode=None, uv_region=None, uv_patch=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob["_uv_mode"] = uv_mode or 'flat'
    if uv_region:
        ob["_uv_region"] = uv_region
    if uv_patch:
        ob["_uv_patch"] = uv_patch
    return ob


def revolve(name, profile, segments=24, sx=1.0, sy=1.0,
            arc=(0.0, TAU), pleat=None, cap_ends=True, **uv):
    a0, a1 = arc
    full = abs((a1 - a0) - TAU) < 1e-6
    count = segments if full else segments + 1
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
            continue
        ring = []
        for i in range(count):
            a = a0 + (a1 - a0) * (i / float(segments))
            rr = r
            if pleat:
                pc, depth, zt, zb = pleat
                t = clamp((zt - z) / max(zt - zb, 1e-6), 0.0, 1.0)
                rr = r * (1.0 + depth * t * math.cos(pc * a))
            ring.append(bm.verts.new((math.cos(a) * rr * sx, math.sin(a) * rr * sy, z)))
        rings.append(ring)

    def idx(n, j):
        return (j + 1) % n if full else j + 1

    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        if len(A) == 1:
            n = len(B)
            for j in range(n if full else n - 1):
                bm.faces.new((A[0], B[idx(n, j)], B[j]))
        elif len(B) == 1:
            n = len(A)
            for j in range(n if full else n - 1):
                bm.faces.new((A[j], A[idx(n, j)], B[0]))
        else:
            n = len(A)
            for j in range(n if full else n - 1):
                k = idx(n, j)
                bm.faces.new((A[j], A[k], B[k], B[j]))
    if cap_ends:
        if len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
    return obj_from_bm(name, bm, **uv)


def tube(name, pts, radii, segments=12, cap=True, squash=None, **uv):
    bm = bmesh.new()
    n = len(pts)
    P = [Vector(p) for p in pts]
    rings = []
    for i in range(n):
        if i == 0:
            t = P[1] - P[0]
        elif i == n - 1:
            t = P[-1] - P[-2]
        else:
            t = P[i + 1] - P[i - 1]
        t.normalize()
        up = Vector((0.0, 0.0, 1.0))
        if abs(t.dot(up)) > 0.94:
            up = Vector((0.0, 1.0, 0.0))
        xax = t.cross(up).normalized()
        yax = t.cross(xax).normalized()
        r = radii[i]
        s = squash[i] if squash else (1.0, 1.0)
        ring = []
        for k in range(segments):
            a = TAU * k / segments
            ring.append(bm.verts.new(P[i] + xax * (math.cos(a) * r * s[0]) + yax * (math.sin(a) * r * s[1])))
        rings.append(ring)
    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        for j in range(segments):
            k = (j + 1) % segments
            bm.faces.new((A[j], A[k], B[k], B[j]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return obj_from_bm(name, bm, **uv)


def ball(name, center, radii, seg=20, ring=14, rot=None, **uv):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1.0)
    for v in bm.verts:
        v.co.x *= radii[0]
        v.co.y *= radii[1]
        v.co.z *= radii[2]
        if rot:
            v.co = Euler(rot, 'XYZ').to_matrix() @ v.co
        v.co += Vector(center)
    return obj_from_bm(name, bm, **uv)


def box(name, center, size, rot=None, **uv):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
        if rot:
            v.co = Euler(rot, 'XYZ').to_matrix() @ v.co
        v.co += Vector(center)
    return obj_from_bm(name, bm, **uv)


PARTS = []


def part(ob, sub=1):
    ob["_sub"] = sub
    PARTS.append(ob)
    return ob


def uv_unwrap(ob):
    """按部件生成 UV。角度以角色正面(-Y)为 0，接缝留在背后。"""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uvl = me.uv_layers[0]
    mode = ob.get("_uv_mode", 'flat')
    mw = ob.matrix_world
    coords = [mw @ v.co for v in me.vertices]
    zs = [c.z for c in coords]
    zmin, zmax = (min(zs), max(zs)) if zs else (0.0, 1.0)
    span = max(zmax - zmin, 1e-6)
    region = ob.get("_uv_region") or R_SKIN
    x0, y0, w, h = region
    patch = tuple(ob.get("_uv_patch")) if ob.get("_uv_patch") else (0.5, 0.5)
    for poly in me.polygons:
        for li in poly.loop_indices:
            c = coords[me.loops[li].vertex_index]
            if mode == 'flat':
                u, v = patch
            elif mode == 'head':
                # 前密后疏的角度映射（与 make_textures.py 的 head_uv 一致）
                a = math.atan2(c.x, -c.y) / PI
                u = 0.5 + 0.5 * math.copysign(abs(a) ** 0.5, a)
                v = (c.z - zmin) / span
            else:
                u = 0.5 + math.atan2(c.x, -c.y) / TAU
                v = (c.z - zmin) / span
            uvl.data[li].uv = (x0 + u * w, y0 + v * h)


def inset_region(region, inset=0.006):
    x0, y0, w, h = region
    return (x0 + inset, y0 + inset, max(w - inset * 2, 1e-4), max(h - inset * 2, 1e-4))


# ===========================================================================
# 材质
# ===========================================================================
MATS = {}


def make_image_material(name, image_path, fallback_color=0xffffff, rough=0.72):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if image_path and os.path.exists(image_path):
        img = bpy.data.images.load(image_path, check_existing=True)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.interpolation = 'Linear'
        tex.location = (-400, 200)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        print("TEXTURE:", name, "<-", image_path)
    else:
        r = ((fallback_color >> 16) & 255) / 255.0
        g = ((fallback_color >> 8) & 255) / 255.0
        b = (fallback_color & 255) / 255.0
        bsdf.inputs['Base Color'].default_value = (r, g, b, 1)
        print("TEXTURE MISSING for", name, "- 用平色代替")
    for key, val in (('Roughness', rough), ('Metallic', 0.0),
                     ('Specular IOR Level', 0.25), ('Specular', 0.25)):
        if key in bsdf.inputs:
            try:
                bsdf.inputs[key].default_value = val
            except Exception:
                pass
    return m


def build_materials():
    MATS['body'] = make_image_material('M_Body', os.path.join(TEXDIR, "body.png"), 0xFFE2D6, 0.78)
    MATS['face'] = make_image_material('M_Face', os.path.join(TEXDIR, "face.png"), 0xFFE2D6, 0.55)


# ===========================================================================
# 身体
# ===========================================================================
def build_body():
    part(revolve('torso', [
        (0.000, 0.770), (0.056, 0.782), (0.086, 0.812), (0.100, 0.852),
        (0.098, 0.892), (0.090, 0.928), (0.082, 0.962), (0.079, 0.996),
        (0.084, 1.032), (0.093, 1.072), (0.101, 1.108), (0.104, 1.142),
        (0.105, 1.176), (0.106, 1.208), (0.105, 1.238), (0.098, 1.266),
        (0.082, 1.290), (0.055, 1.306), (0.000, 1.314),
    ], segments=28, sy=0.74, uv_mode='flat', uv_patch=PATCH['skin']), sub=2)

    for sign in (1, -1):
        part(ball('trap_%d' % sign, (sign * 0.056, 0.002, 1.256), (0.050, 0.042, 0.032),
                  seg=16, ring=12, uv_mode='flat', uv_patch=PATCH['skin']), sub=1)

    part(revolve('neck', [
        (0.000, 1.276), (0.044, 1.286), (0.046, 1.312), (0.044, 1.340),
        (0.042, 1.366), (0.040, 1.382), (0.000, 1.390),
    ], segments=16, sy=0.94, uv_mode='cyl', uv_region=R_SKIN), sub=1)

    for sign, side in ((1, 'L'), (-1, 'R')):
        x = sign * 0.104
        o = part(revolve('upperarm_%s' % side, [
            (0.000, 1.300), (0.043, 1.292), (0.044, 1.262), (0.041, 1.222),
            (0.037, 1.180), (0.033, 1.136), (0.030, 1.092), (0.029, 1.072), (0.000, 1.066),
        ], segments=16, uv_mode='cyl', uv_region=R_SKIN), sub=1)
        o.location = (x, 0.0, 0.0)
        o.rotation_euler = (0.0, sign * 0.045, 0.0)

        o = part(revolve('forearm_%s' % side, [
            (0.000, 1.080), (0.031, 1.072), (0.032, 1.040), (0.030, 0.998),
            (0.027, 0.955), (0.025, 0.906), (0.024, 0.876), (0.000, 0.870),
        ], segments=16, uv_mode='cyl', uv_region=R_SKIN), sub=1)
        o.location = (x + sign * 0.006, 0.0, 0.0)

        o = part(ball('palm_%s' % side, (x + sign * 0.008, -0.004, 0.838), (0.027, 0.018, 0.042),
                      seg=16, ring=12, uv_mode='flat', uv_patch=PATCH['skin']), sub=1)
        o.rotation_euler = (0.0, 0.0, sign * 0.12)
        part(ball('thumb_%s' % side, (x - sign * 0.012, -0.020, 0.848), (0.013, 0.012, 0.018),
                  seg=10, ring=8, rot=(0.0, 0.0, sign * 0.5),
                  uv_mode='flat', uv_patch=PATCH['skin']), sub=1)

    for sign, side in ((1, 'L'), (-1, 'R')):
        x = sign * 0.062
        o = part(revolve('thigh_%s' % side, [
            (0.000, 0.884), (0.052, 0.874), (0.064, 0.840), (0.064, 0.792),
            (0.059, 0.720), (0.052, 0.628), (0.046, 0.530), (0.042, 0.470),
            (0.040, 0.442), (0.000, 0.434),
        ], segments=18, uv_mode='cyl', uv_region=R_SKIN), sub=1)
        o.location = (x, 0.0, 0.0)
        o = part(revolve('shin_%s' % side, [
            (0.000, 0.452), (0.043, 0.444), (0.046, 0.412), (0.044, 0.360),
            (0.039, 0.300), (0.032, 0.230), (0.026, 0.160), (0.023, 0.098),
            (0.021, 0.062), (0.000, 0.054),
        ], segments=16, uv_mode='cyl', uv_region=R_SKIN), sub=1)
        o.location = (x + sign * 0.002, 0.0, 0.0)

    o = part(revolve('head', [
        (0.000, 1.358), (0.040, 1.369), (0.060, 1.385), (0.075, 1.405),
        (0.086, 1.429), (0.092, 1.453), (0.0955, 1.479), (0.096, 1.506),
        (0.094, 1.533), (0.087, 1.557), (0.073, 1.577), (0.046, 1.591),
        (0.000, 1.599),
    ], segments=28, sy=0.965, uv_mode='head', uv_region=(0.0, 0.5, 1.0, 0.5)), sub=2)
    for v in o.data.vertices:
        if v.co.z < 1.45:
            t = clamp((1.45 - v.co.z) / 0.095, 0.0, 1.0)
            v.co.x *= (1.0 - 0.34 * t)
            v.co.y *= (1.0 - 0.20 * t)
        if v.co.y > 0.02:
            v.co.y *= 1.06


def build_clothes():
    part(revolve('top', [
        (0.000, 0.950), (0.090, 0.956), (0.096, 0.984), (0.098, 1.020),
        (0.104, 1.058), (0.113, 1.100), (0.118, 1.138), (0.117, 1.178),
        (0.112, 1.214), (0.106, 1.246), (0.098, 1.274), (0.082, 1.298),
        (0.054, 1.312), (0.000, 1.318),
    ], segments=28, sy=0.76, uv_mode='cyl', uv_region=inset_region(R_TOP, 0.004)), sub=2)

    # 后领片
    part(revolve('collar_back', [
        (0.044, 1.272), (0.082, 1.280), (0.110, 1.296), (0.132, 1.316), (0.142, 1.332),
    ], segments=24, sx=1.06, sy=0.90, arc=(PI * 0.10, PI * 0.90),
        uv_mode='flat', uv_patch=PATCH['navy']), sub=2)
    # 左右前襟（中间留出 V 形开口）
    for sign in (1, -1):
        a0 = PI * 1.06 if sign > 0 else PI * 1.50
        a1 = PI * 1.44 if sign > 0 else PI * 1.94
        part(revolve('collar_front_%d' % sign, [
            (0.106, 1.292), (0.122, 1.300), (0.136, 1.290), (0.140, 1.268), (0.132, 1.246),
        ], segments=14, sx=1.04, sy=0.84, arc=(a0, a1),
            uv_mode='flat', uv_patch=PATCH['navy']), sub=2)
        # 领角小白边
        part(revolve('collar_edge_%d' % sign, [
            (0.138, 1.286), (0.146, 1.286), (0.146, 1.274), (0.138, 1.274),
        ], segments=14, sx=1.02, sy=0.84, arc=(a0, a1), cap_ends=False,
            uv_mode='flat', uv_patch=PATCH['trim']), sub=1)

    part(ball('bow_knot', (0.0, -0.090, 1.246), (0.018, 0.017, 0.015), seg=14, ring=10,
              uv_mode='flat', uv_patch=PATCH['ribbon']), sub=1)
    for sign in (1, -1):
        part(ball('bow_wing_%d' % sign, (sign * 0.038, -0.084, 1.246), (0.034, 0.020, 0.022),
                  seg=14, ring=10, rot=(0.0, 0.0, -sign * 0.35),
                  uv_mode='flat', uv_patch=PATCH['bow']), sub=1)
        part(tube('bow_tail_%d' % sign, [
            (sign * 0.016, -0.082, 1.232), (sign * 0.030, -0.074, 1.176), (sign * 0.035, -0.066, 1.110),
        ], [0.011, 0.010, 0.008], segments=8,
            uv_mode='flat', uv_patch=PATCH['trim']), sub=1)

    part(revolve('skirt', [
        (0.100, 0.952), (0.106, 0.928), (0.118, 0.896), (0.136, 0.852),
        (0.160, 0.806), (0.186, 0.762), (0.208, 0.722), (0.222, 0.700),
    ], segments=40, sy=0.88, pleat=(20, 0.06, 0.952, 0.700), cap_ends=False,
        uv_mode='cyl', uv_region=inset_region(R_SKIRT, 0.004)), sub=2)
    part(revolve('belt', [
        (0.000, 0.956), (0.104, 0.958), (0.108, 0.972), (0.104, 0.986), (0.000, 0.988),
    ], segments=24, sy=0.82, uv_mode='flat', uv_patch=PATCH['navy_dark']), sub=1)

    for sign, side in ((1, 'L'), (-1, 'R')):
        part(ball('sleeve_%s' % side, (sign * 0.106, 0.0, 1.270), (0.050, 0.045, 0.048),
                  seg=16, ring=12, uv_mode='flat', uv_patch=PATCH['cloth']), sub=1)
        o = part(revolve('cuff_%s' % side, [
            (0.000, 1.236), (0.045, 1.234), (0.047, 1.224), (0.043, 1.212), (0.000, 1.210),
        ], segments=14, uv_mode='flat', uv_patch=PATCH['trim']), sub=1)
        o.location = (sign * 0.106, 0.0, 0.0)

    for sign, side in ((1, 'L'), (-1, 'R')):
        o = part(revolve('sock_%s' % side, [
            (0.000, 0.486), (0.049, 0.480), (0.048, 0.446), (0.046, 0.396),
            (0.040, 0.316), (0.033, 0.216), (0.028, 0.120), (0.027, 0.070),
            (0.000, 0.060),
        ], segments=16, uv_mode='cyl', uv_region=R_COLLAR), sub=1)
        o.location = (sign * 0.063, 0.0, 0.0)
        o = part(revolve('sockband_%s' % side, [
            (0.000, 0.490), (0.050, 0.488), (0.052, 0.480), (0.050, 0.472), (0.000, 0.470),
        ], segments=16, uv_mode='flat', uv_patch=PATCH['trim']), sub=1)
        o.location = (sign * 0.063, 0.0, 0.0)

    for sign, side in ((1, 'L'), (-1, 'R')):
        x = sign * 0.063
        part(ball('foot_%s' % side, (x, -0.014, 0.040), (0.038, 0.062, 0.034),
                  seg=18, ring=12, rot=(0.05, 0, 0), uv_mode='flat', uv_patch=PATCH['skin']), sub=1)
        part(ball('shoe_%s' % side, (x, -0.020, 0.034), (0.043, 0.073, 0.031),
                  seg=18, ring=12, rot=(0.05, 0, 0), uv_mode='flat', uv_patch=PATCH['shoe']), sub=1)
        part(ball('shoe_toe_%s' % side, (x, -0.076, 0.028), (0.037, 0.031, 0.025),
                  seg=14, ring=10, uv_mode='flat', uv_patch=PATCH['shoe']), sub=1)
        part(box('shoe_sole_%s' % side, (x, -0.026, 0.012), (0.092, 0.166, 0.021),
                 uv_mode='flat', uv_patch=PATCH['navy_dark']), sub=1)
        part(box('shoe_strap_%s' % side, (x, -0.030, 0.053), (0.088, 0.032, 0.016),
                 uv_mode='flat', uv_patch=PATCH['trim']), sub=1)


def build_hair():
    part(revolve('hair_dome', [
        (0.000, 1.500), (0.062, 1.505), (0.092, 1.517), (0.108, 1.534),
        (0.116, 1.556), (0.113, 1.576), (0.098, 1.594), (0.068, 1.608),
        (0.032, 1.616), (0.000, 1.619),
    ], segments=28, sy=0.99, uv_mode='cyl', uv_region=R_HAIR), sub=2)

    part(revolve('hair_back', [
        (0.026, 1.268), (0.070, 1.286), (0.106, 1.318), (0.124, 1.366),
        (0.132, 1.420), (0.133, 1.470), (0.128, 1.506), (0.116, 1.530),
    ], segments=20, sy=0.99, arc=(PI * 0.16, PI * 0.84),
        uv_mode='cyl', uv_region=R_HAIR), sub=2)

    n = 13
    for i in range(n):
        t = (i / (n - 1.0)) * 2 - 1
        ang = t * 1.32
        x = math.sin(ang) * 0.100
        y = -math.cos(ang) * 0.094 + 0.004
        length = 0.102 - abs(t) * 0.030 + (i % 3) * 0.008
        z_top = 1.562 - abs(t) * 0.012
        bend = 0.012 * (1 - abs(t))
        pts = [
            (x * 0.84, y * 0.80, z_top + 0.018),
            (x * 0.94, y * 0.94, z_top - length * 0.30),
            (x * 1.04, y * 1.02 + bend, z_top - length * 0.62),
            (x * 1.06, y * 1.00 + bend, z_top - length * 0.88),
            (x * 1.02, y * 0.92 + bend, z_top - length),
        ]
        r = 0.0225 - abs(t) * 0.007
        part(tube('bang_%d' % i, pts, [r * 1.02, r, r * 0.80, r * 0.50, r * 0.10],
                  segments=9, uv_mode='cyl', uv_region=R_HAIR), sub=1)

    for sign in (1, -1):
        part(tube('sidelock_%d' % sign, [
            (sign * 0.096, -0.032, 1.556), (sign * 0.108, -0.008, 1.478),
            (sign * 0.106, 0.014, 1.392), (sign * 0.098, 0.028, 1.306),
            (sign * 0.092, 0.032, 1.248),
        ], [0.027, 0.026, 0.020, 0.013, 0.004], segments=10,
            uv_mode='cyl', uv_region=R_HAIR), sub=1)
        part(tube('sidelock2_%d' % sign, [
            (sign * 0.084, -0.056, 1.564), (sign * 0.094, -0.038, 1.506),
            (sign * 0.096, -0.020, 1.452), (sign * 0.094, -0.006, 1.404),
        ], [0.020, 0.016, 0.010, 0.003], segments=9,
            uv_mode='cyl', uv_region=R_HAIR), sub=1)

    part(tube('ahoge', [
        (0.014, 0.008, 1.612), (0.024, 0.020, 1.664), (0.004, 0.004, 1.706),
    ], [0.010, 0.007, 0.0015], segments=8, uv_mode='cyl', uv_region=R_HAIR), sub=1)

    for sign, side in ((1, 'L'), (-1, 'R')):
        pts = [
            (sign * 0.088, 0.046, 1.520), (sign * 0.126, 0.070, 1.458),
            (sign * 0.150, 0.088, 1.366), (sign * 0.164, 0.096, 1.246),
            (sign * 0.166, 0.098, 1.112), (sign * 0.158, 0.092, 0.984),
            (sign * 0.148, 0.084, 0.880),
        ]
        radii = [0.044, 0.047, 0.043, 0.037, 0.029, 0.020, 0.007]
        part(tube('tail_%s' % side, pts, radii, segments=12,
                  uv_mode='cyl', uv_region=R_HAIR), sub=1)
        o = part(revolve('tie_%s' % side, [
            (0.000, -0.014), (0.032, -0.012), (0.036, 0.000), (0.032, 0.012), (0.000, 0.014),
        ], segments=12, uv_mode='flat', uv_patch=PATCH['bow']), sub=1)
        o.location = (sign * 0.090, 0.048, 1.518)
        o.rotation_euler = (1.15, 0.0, sign * 0.34)


# ===========================================================================
# 骨架
# ===========================================================================
def build_bones():
    bones = [
        ("root", (0, 0, 0.00), (0, 0.14, 0.00), None, False),
        ("hips", (0, 0, 0.870), (0, 0, 1.000), "root", False),
        ("spine", (0, 0, 1.000), (0, 0, 1.140), "hips", True),
        ("chest", (0, 0, 1.140), (0, 0, 1.290), "spine", True),
        ("neck", (0, 0, 1.290), (0, 0, 1.375), "chest", True),
        ("head", (0, 0, 1.375), (0, 0, 1.590), "neck", True),
    ]
    for s, side in ((1, 'L'), (-1, 'R')):
        bones += [
            ("shoulder.%s" % side, (s * 0.024, 0, 1.270), (s * 0.104, 0, 1.288), "chest", False),
            ("upper_arm.%s" % side, (s * 0.104, 0, 1.288), (s * 0.110, 0, 1.074), "shoulder.%s" % side, True),
            ("forearm.%s" % side, (s * 0.110, 0, 1.074), (s * 0.113, 0, 0.872), "upper_arm.%s" % side, True),
            ("hand.%s" % side, (s * 0.113, 0, 0.872), (s * 0.113, 0, 0.800), "forearm.%s" % side, True),
            ("thigh.%s" % side, (s * 0.062, 0, 0.866), (s * 0.064, 0, 0.452), "hips", False),
            ("shin.%s" % side, (s * 0.064, 0, 0.452), (s * 0.065, 0, 0.070), "thigh.%s" % side, True),
            ("foot.%s" % side, (s * 0.065, 0, 0.070), (s * 0.065, -0.100, 0.028), "shin.%s" % side, True),
        ]
    tail = {
        'L': [(0.088, 0.046, 1.520), (0.126, 0.070, 1.458), (0.150, 0.088, 1.366),
              (0.164, 0.096, 1.246), (0.166, 0.098, 1.112), (0.158, 0.092, 0.984),
              (0.148, 0.084, 0.880)],
    }
    tail['R'] = [(-x, y, z) for (x, y, z) in tail['L']]
    for side in ('L', 'R'):
        p = tail[side]
        segs = [(p[0], p[1]), (p[1], p[3]), (p[3], p[5]), (p[5], p[6])]
        for i, (a, b) in enumerate(segs):
            bones.append(("hair.%s.%d" % (side, i + 1), a, b,
                          "head" if i == 0 else "hair.%s.%d" % (side, i), i != 0))
    for s, side in ((1, 'L'), (-1, 'R')):
        bones.append(("sidelock.%s" % side, (s * 0.096, -0.032, 1.556), (s * 0.092, 0.032, 1.248), "head", False))
    return bones


def build_armature(bones):
    arm_data = bpy.data.armatures.new("GirlRig")
    arm_obj = bpy.data.objects.new("GirlRig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='EDIT')
    created = {}
    for (name, head, tail, parent, conn) in bones:
        b = arm_data.edit_bones.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        b.roll = 0.0
        created[name] = b
    for (name, head, tail, parent, conn) in bones:
        if parent:
            created[name].parent = created[parent]
            created[name].use_connect = bool(conn)
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm_obj


# ===========================================================================
# 动画
# ===========================================================================
def d(x):
    return math.radians(x)


def anim_idle(t, T):
    p = t * TAU
    return {
        'hips': dict(loc=(0, 0.006 * math.sin(p), 0), rot=(0, 0, 2.0 * math.sin(p))),
        'spine': dict(rot=(1.6 - 0.9 * math.sin(p), 0, 1.6 * math.sin(p))),
        'chest': dict(rot=(-1.6 + 1.1 * math.sin(p), 0, -1.3 * math.sin(p))),
        'neck': dict(rot=(0, 0, -1.0 * math.sin(p))),
        'head': dict(rot=(1.0 * math.sin(p * 0.7), 6.0 * math.sin(p * 0.5), -1.2 * math.sin(p))),
        'upper_arm.L': dict(rot=(2.2 * math.sin(p), 0, 4.0 - 1.2 * math.sin(p))),
        'upper_arm.R': dict(rot=(2.2 * math.sin(p + 0.5), 0, -4.0 + 1.2 * math.sin(p + 0.5))),
        'forearm.L': dict(rot=(-5 + 1.8 * math.sin(p), 0, -4.5)),
        'forearm.R': dict(rot=(-5 + 1.8 * math.sin(p + 0.5), 0, 4.5)),
        'thigh.L': dict(rot=(0.8 * math.sin(p), 0, 0)),
        'thigh.R': dict(rot=(-0.8 * math.sin(p), 0, 0)),
    }


def _gait(t, T, amp, lean, arm_amp, knee, bob, hip_sw):
    p = t * TAU
    sw, sw2 = math.sin(p), math.sin(p + PI)
    s = {
        'hips': dict(loc=(0, (abs(math.cos(p)) * 2 - 1) * bob, 0), rot=(0, -sw * hip_sw, math.sin(p) * 2.0)),
        'spine': dict(rot=(lean, sw * hip_sw * 0.5, 0)),
        'chest': dict(rot=(-lean * 0.25, sw * hip_sw * 0.8, 0)),
        'neck': dict(rot=(-lean * 0.3, -sw * 3.5, 0)),
        'head': dict(rot=(-lean * 0.6, -sw * 4.0, 0)),
        'thigh.L': dict(rot=(sw * amp, 0, 1.5)),
        'thigh.R': dict(rot=(sw2 * amp, 0, -1.5)),
        'shin.L': dict(rot=(-max(0.0, -math.sin(p - 0.9)) * knee, 0, 0)),
        'shin.R': dict(rot=(-max(0.0, -math.sin(p + PI - 0.9)) * knee, 0, 0)),
        'foot.L': dict(rot=(math.sin(p + 1.1) * 14, 0, 0)),
        'foot.R': dict(rot=(math.sin(p + PI + 1.1) * 14, 0, 0)),
        'upper_arm.L': dict(rot=(-sw * arm_amp, 0, 7)),
        'upper_arm.R': dict(rot=(-sw2 * arm_amp, 0, -7)),
        'forearm.L': dict(rot=(-(20 + arm_amp * 0.5) - max(0.0, -sw) * 22, 0, -8)),
        'forearm.R': dict(rot=(-(20 + arm_amp * 0.5) - max(0.0, -sw2) * 22, 0, 8)),
    }
    for side in ('L', 'R'):
        for i in range(1, 5):
            s['hair.%s.%d' % (side, i)] = dict(rot=(-lean * 0.25 - sw * (2.0 + i * 1.4), 0,
                                                   (1 if side == 'L' else -1) * (2.0 + i * 1.2)))
    return s


def anim_walk(t, T):
    return _gait(t, T, amp=26, lean=3.5, arm_amp=28, knee=42, bob=0.014, hip_sw=7)


def anim_run(t, T):
    return _gait(t, T, amp=46, lean=16, arm_amp=52, knee=76, bob=0.030, hip_sw=11)


def anim_jump(t, T):
    k = clamp(t * 2.4, 0, 1)
    s = {'hips': dict(loc=(0, 0.02 * k, 0), rot=(0, 0, 0)),
         'spine': dict(rot=(-6 * k, 0, 0)), 'chest': dict(rot=(-4 * k, 0, 0)),
         'head': dict(rot=(-10 * k, 0, 0)),
         'thigh.L': dict(rot=(-38 * k, 0, 3)), 'thigh.R': dict(rot=(-18 * k, 0, -3)),
         'shin.L': dict(rot=(56 * k, 0, 0)), 'shin.R': dict(rot=(22 * k, 0, 0)),
         'upper_arm.L': dict(rot=(-62 * k, 0, 30 * k)), 'upper_arm.R': dict(rot=(-62 * k, 0, -30 * k)),
         'forearm.L': dict(rot=(-32 * k, 0, -10)), 'forearm.R': dict(rot=(-32 * k, 0, 10))}
    for side in ('L', 'R'):
        for i in range(1, 5):
            s['hair.%s.%d' % (side, i)] = dict(rot=(-6 * k - i * 2.5 * k, 0, 0))
    return s


def anim_fall(t, T):
    p = t * TAU
    s = {'spine': dict(rot=(6 + math.sin(p) * 1.5, 0, 0)), 'head': dict(rot=(7, 0, 0)),
         'thigh.L': dict(rot=(-14, 0, 4)), 'thigh.R': dict(rot=(20, 0, -4)),
         'shin.L': dict(rot=(24, 0, 0)), 'shin.R': dict(rot=(38, 0, 0)),
         'upper_arm.L': dict(rot=(32, 0, 34)), 'upper_arm.R': dict(rot=(32, 0, -34)),
         'forearm.L': dict(rot=(-30, 0, -12)), 'forearm.R': dict(rot=(-30, 0, 12))}
    for side in ('L', 'R'):
        for i in range(1, 5):
            s['hair.%s.%d' % (side, i)] = dict(rot=(-8 + math.sin(p + i * 0.6) * 3, 0, 0))
    return s


def anim_spin(t, T):
    k = 1 - t
    s = {'hips': dict(rot=(0, t * 720, 0)), 'spine': dict(rot=(20 * k, 0, 0)),
         'head': dict(rot=(-12, 18 * k, 0)),
         'upper_arm.L': dict(rot=(-12, 0, 78 * k + 7)), 'upper_arm.R': dict(rot=(-12, 0, -78 * k - 7)),
         'forearm.L': dict(rot=(-14, 0, -10)), 'forearm.R': dict(rot=(-14, 0, 10)),
         'thigh.L': dict(rot=(-16, 0, 4)), 'thigh.R': dict(rot=(18, 0, -4)),
         'shin.L': dict(rot=(32, 0, 0)), 'shin.R': dict(rot=(44, 0, 0))}
    for side in ('L', 'R'):
        for i in range(1, 5):
            s['hair.%s.%d' % (side, i)] = dict(rot=(-10 * k - i * 4 * k, 0,
                                                   (1 if side == 'L' else -1) * (14 * k + i * 5 * k)))
    return s


def anim_hurt(t, T):
    k = 1 - t
    return {
        'hips': dict(loc=(0, -0.012 * k, 0), rot=(0, 0, 0)),
        'spine': dict(rot=(-26 * k, 0, 0)), 'chest': dict(rot=(-10 * k, 0, 0)),
        'head': dict(rot=(-22 * k, 0, 0)),
        'upper_arm.L': dict(rot=(-52 * k, 0, 34 * k + 7)), 'upper_arm.R': dict(rot=(-52 * k, 0, -34 * k - 7)),
        'forearm.L': dict(rot=(-52 * k, 0, -10)), 'forearm.R': dict(rot=(-52 * k, 0, 10)),
        'thigh.L': dict(rot=(14 * k, 0, 3)), 'thigh.R': dict(rot=(-18 * k, 0, -3)),
        'shin.L': dict(rot=(32 * k, 0, 0)), 'shin.R': dict(rot=(26 * k, 0, 0)),
    }


def anim_win(t, T):
    p = t * TAU
    b = abs(math.sin(p))
    s = {'hips': dict(loc=(0, b * 0.055, 0), rot=(0, 0, 0)),
         'spine': dict(rot=(-6, 0, 0)), 'chest': dict(rot=(-3, 0, 0)),
         'head': dict(rot=(-13 + math.sin(p * 2) * 3, 0, 0)),
         'upper_arm.L': dict(rot=(-134 - math.sin(p) * 10, 0, 42)),
         'upper_arm.R': dict(rot=(-134 - math.sin(p + 0.6) * 10, 0, -42)),
         'forearm.L': dict(rot=(-26 + math.sin(p) * 14, 0, -20)),
         'forearm.R': dict(rot=(-26 + math.sin(p + 0.6) * 14, 0, 20)),
         'thigh.L': dict(rot=(-7 * b, 0, 3)), 'thigh.R': dict(rot=(-7 * b, 0, -3)),
         'shin.L': dict(rot=(14 * b, 0, 0)), 'shin.R': dict(rot=(14 * b, 0, 0))}
    for side in ('L', 'R'):
        for i in range(1, 5):
            s['hair.%s.%d' % (side, i)] = dict(rot=(-4 - b * (3 + i), 0,
                                                   (1 if side == 'L' else -1) * (3 + i)))
    return s


def anim_pose(t, T):
    p = t * TAU
    s = {'hips': dict(loc=(0, math.sin(p) * 0.006, 0), rot=(0, 0, 3.5)),
         'spine': dict(rot=(0, 0, -2.5)),
         'chest': dict(rot=(0, 8 * math.sin(p * 0.6), 1.5)),
         'head': dict(rot=(2, 8 * math.sin(p * 0.4), -6)),
         'upper_arm.R': dict(rot=(-104 + math.sin(p) * 6, 0, -20)),
         'forearm.R': dict(rot=(-22, 0, 30 + math.sin(p) * 14)),
         'upper_arm.L': dict(rot=(6, 0, 10)), 'forearm.L': dict(rot=(-14, 0, -10)),
         'thigh.L': dict(rot=(-6, 0, 4)), 'thigh.R': dict(rot=(4, 0, -4)),
         'shin.R': dict(rot=(13, 0, 0))}
    for side in ('L', 'R'):
        for i in range(1, 5):
            s['hair.%s.%d' % (side, i)] = dict(rot=(math.sin(p + i * 0.5) * 4 - 2, 0,
                                                   (1 if side == 'L' else -1) * (3 + i * 1.5)))
    return s


ANIMS = [
    ("Idle", 60, anim_idle, True),
    ("Walk", 26, anim_walk, True),
    ("Run", 18, anim_run, True),
    ("Jump", 20, anim_jump, False),
    ("Fall", 26, anim_fall, True),
    ("Spin", 20, anim_spin, False),
    ("Hurt", 16, anim_hurt, False),
    ("Win", 44, anim_win, True),
    ("Pose", 60, anim_pose, True),
]


def action_fcurves(act):
    try:
        return list(act.fcurves)
    except AttributeError:
        pass
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for cb in getattr(strip, 'channelbags', []):
                out.extend(cb.fcurves)
    return out


def build_animations(arm_obj):
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = 'XYZ'
    if arm_obj.animation_data is None:
        arm_obj.animation_data_create()

    for (name, frames, fn, loop) in ANIMS:
        act = bpy.data.actions.new(name)
        arm_obj.animation_data.action = act
        for f in range(1, frames + 1):
            t = ((f - 1) / float(frames)) if loop else ((f - 1) / float(max(frames - 1, 1)))
            s = fn(t, frames)
            for pb in arm_obj.pose.bones:
                pb.rotation_euler = (0, 0, 0)
                pb.location = (0, 0, 0)
            for bone_name, vals in s.items():
                pb = arm_obj.pose.bones.get(bone_name)
                if pb is None:
                    continue
                if 'rot' in vals:
                    r = vals['rot']
                    pb.rotation_euler = (d(r[0]), d(r[1]), d(r[2]))
                if 'loc' in vals:
                    pb.location = Vector(vals['loc'])
            for pb in arm_obj.pose.bones:
                pb.keyframe_insert('rotation_euler', frame=f)
                pb.keyframe_insert('location', frame=f)
        for fc in action_fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        act.use_fake_user = True
        try:
            track = arm_obj.animation_data.nla_tracks.new()
            track.name = name
            strip = track.strips.new(name, 1, act)
            strip.name = name
            track.mute = True
        except Exception as e:
            print("NLA push skipped:", name, e)
        arm_obj.animation_data.action = None
    bpy.ops.object.mode_set(mode='OBJECT')


# ===========================================================================
# 预览渲染
# ===========================================================================
def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 28
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 430
    scene.render.resolution_y = 520
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds[0] if len(bpy.data.worlds) else bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.20, 0.24, 0.33, 1.0)
    bg.inputs[1].default_value = 0.6

    def add_light(name, loc, energy, size, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = energy
        ld.size = size
        ld.color = color
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        bpy.context.collection.objects.link(lo)
        c = lo.constraints.new('TRACK_TO')
        c.target = bpy.data.objects.get('GirlRig')
        c.track_axis = 'TRACK_NEGATIVE_Z'
        c.up_axis = 'UP_Y'

    add_light('key', (2.2, -2.8, 3.0), 95, 2.2, (1.0, 0.96, 0.93))
    add_light('fill', (-2.8, -1.8, 1.7), 36, 2.6, (0.86, 0.9, 1.0))
    add_light('rim', (-0.8, 3.2, 2.6), 60, 2.0, (0.9, 0.95, 1.0))
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    gp = bpy.context.active_object
    gp.name = 'PreviewFloor'
    gm = bpy.data.materials.new('M_PreviewFloor')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.35, 0.45, 1)
    gp.data.materials.append(gm)


def pose_for_preview(arm, name='Idle', frame=6):
    if arm.animation_data is None:
        return
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    act = bpy.data.actions.get(name)
    if act is None:
        return
    try:
        arm.animation_data.action = act
        slots = getattr(act, 'slots', None)
        if slots:
            arm.animation_data.action_slot = slots[0]
    except Exception as e:
        print('preview pose failed:', e)
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def render_views(tag):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    views = [
        ("front", (0.0, -3.1, 1.30), (0, 0, 1.00), 60),
        ("face", (0.30, -1.05, 1.49), (0, 0, 1.455), 90),
        ("back", (0.0, 3.1, 1.30), (0, 0, 1.00), 60),
        ("threequarter", (2.2, -2.2, 1.55), (0, 0, 0.98), 60),
    ]
    for (name, loc, look, lens) in views:
        cam_data.lens = lens
        cam.location = Vector(loc)
        cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(RESEARCH, "blender_%s_%s.png" % (tag, name))
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


# ===========================================================================
def rigid_bind(mesh_obj, mapping):
    """把指定部件（用 PART_<name> 顶点组标记）刚性绑定到某一根骨骼"""
    groups = {g.name: g for g in mesh_obj.vertex_groups}
    stats = []
    for pname, bone in mapping:
        vg = groups.get('PART_' + pname)
        if vg is None:
            stats.append((pname, bone, 'MISSING'))
            continue
        gi = vg.index
        idxs = []
        for v in mesh_obj.data.vertices:
            for g in v.groups:
                if g.group == gi and g.weight > 0.5:
                    idxs.append(v.index)
                    break
        if not idxs:
            stats.append((pname, bone, 0))
            continue
        bo = groups.get(bone) or mesh_obj.vertex_groups.new(name=bone)
        groups[bone] = bo
        for name, og in list(groups.items()):
            if name.startswith('PART_') or og is bo:
                continue
            try:
                og.remove(idxs)
            except Exception:
                pass
        bo.add(idxs, 1.0, 'REPLACE')
        stats.append((pname, bone, len(idxs)))
    for (pname, bone, n) in stats:
        print("  刚性绑定 %-18s -> %-14s %s 顶点" % (pname, bone, n))


def strip_foreign_weights(mesh_obj, part_names, allowed_bones):
    """躯干/服装只能跟随脊柱链：把不该影响它们的骨骼权重清掉，再归一化。
    自动权重会让肩部的手臂骨渗进上衣和领子，抬手臂时会把布料拽成薄片。"""
    groups = {g.name: g for g in mesh_obj.vertex_groups}
    allowed = set(allowed_bones)
    foreign = [g for name, g in groups.items()
               if not name.startswith('PART_') and name not in allowed]
    touched = 0
    for pname in part_names:
        vg = groups.get('PART_' + pname)
        if vg is None:
            continue
        gi = vg.index
        idxs = []
        for v in mesh_obj.data.vertices:
            for g in v.groups:
                if g.group == gi and g.weight > 0.5:
                    idxs.append(v.index)
                    break
        if not idxs:
            continue
        for og in foreign:
            try:
                og.remove(idxs)
            except Exception:
                pass
        touched += len(idxs)
    # 清理后重新归一化，保证权重和仍为 1
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    print("  清理外来权重：%d 个顶点（只保留脊柱链权重）" % touched)


def main():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for item in list(c):
            try:
                c.remove(item)
            except Exception:
                pass

    build_materials()
    build_body()
    build_clothes()
    build_hair()

    print("PARTS:", len(PARTS))
    for p in PARTS:
        uv_unwrap(p)
        sub = p.get("_sub", 1)
        if sub:
            m = p.modifiers.new("subsurf", 'SUBSURF')
            m.levels = sub
            m.render_levels = sub
        p.data.materials.clear()
        p.data.materials.append(MATS['face'] if p.name == 'head' else MATS['body'])

    for p in PARTS:
        bpy.context.view_layer.objects.active = p
        for m in list(p.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=m.name)
            except Exception as e:
                print("modifier apply failed", p.name, e)
        for poly in p.data.polygons:
            poly.use_smooth = True

    # 给每个部件打一个 PART_* 顶点组，join 之后仍能精确知道每个顶点属于哪个部件
    for p in PARTS:
        if not p.data.vertices:
            continue
        vg = p.vertex_groups.new(name='PART_' + p.name)
        vg.add([v.index for v in p.data.vertices], 1.0, 'REPLACE')

    for o in bpy.context.selected_objects:
        o.select_set(False)
    for p in PARTS:
        p.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    girl = bpy.context.view_layer.objects.active
    girl.name = "Girl"
    girl.data.name = "GirlMesh"
    girl.data.calc_loop_triangles()
    print("Verts:", len(girl.data.vertices), "Tris:", len(girl.data.loop_triangles),
          "UV:", [u.name for u in girl.data.uv_layers], "Mats:", [m.name for m in girl.data.materials])

    arm = build_armature(build_bones())

    bpy.ops.object.select_all(action='DESELECT')
    girl.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        print("Skinned: AUTO")
    except Exception as e:
        print("AUTO weights failed:", e)
        bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')
        print("Skinned: ENVELOPE")

    # glTF 每个顶点最多支持 4 根骨骼影响；自动权重常常超过 4 根，
    # 不在导出前裁剪的话，Blender 里看到的蒙皮会和浏览器实际渲染的不一致。
    bpy.ops.object.select_all(action='DESELECT')
    girl.select_set(True)
    bpy.context.view_layer.objects.active = girl
    try:
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
        print("权重已裁剪到每顶点最多 4 根骨骼并归一化")
    except Exception as e:
        print("权重裁剪失败:", e)

    # 自动权重会把领子/袖口这类靠近肩部的附件分给手臂骨 —— 抬手臂时被拽出尖刺。
    # 这里把它们刚性绑定到真正该跟随的骨骼上。
    hard_map = []
    for pname in ('collar_back', 'bow_knot'):
        hard_map.append((pname, 'chest'))
    for sg in ('1', '-1'):
        hard_map.append(('collar_front_%s' % sg, 'chest'))
        hard_map.append(('collar_edge_%s' % sg, 'chest'))
        hard_map.append(('bow_wing_%s' % sg, 'chest'))
        hard_map.append(('bow_tail_%s' % sg, 'chest'))
    hard_map.append(('belt', 'hips'))
    for side in ('L', 'R'):
        bone = 'upper_arm.%s' % side
        hard_map.append(('sleeve_%s' % side, bone))
        hard_map.append(('cuff_%s' % side, bone))
        hard_map.append(('sockband_%s' % side, 'shin.%s' % side))
        for pre in ('foot_', 'shoe_', 'shoe_toe_', 'shoe_sole_', 'shoe_strap_'):
            hard_map.append((pre + side, 'foot.%s' % side))

    try:
        rigid_bind(girl, hard_map)
        print("硬质附件已刚性绑定：领子 -> chest、袖口 -> upper_arm、鞋 -> foot")
    except Exception as e:
        print("刚性绑定失败:", e)

    # 躯干与服装只能跟随脊柱链，避免被四肢骨骼拽出薄片
    TORSO_PARTS = ['torso', 'neck', 'top', 'skirt', 'belt',
                   'collar_back', 'collar_front_1', 'collar_front_-1',
                   'collar_edge_1', 'collar_edge_-1', 'bow_knot',
                   'bow_wing_1', 'bow_wing_-1', 'bow_tail_1', 'bow_tail_-1',
                   'trap_1', 'trap_-1', 'bust_1', 'bust_-1']
    try:
        strip_foreign_weights(girl, TORSO_PARTS, ('root', 'hips', 'spine', 'chest', 'neck', 'head'))
    except Exception as e:
        print("权重清理失败:", e)

    # 清掉辅助用的 PART_* 顶点组（不删的话会污染导出数据）
    for g in list(girl.vertex_groups):
        if g.name.startswith('PART_'):
            girl.vertex_groups.remove(g)

    build_animations(arm)

    if DO_EXPORT:
        out = os.path.join(ASSETS, "girl.glb")
        kwargs = dict(filepath=out, export_format='GLB', export_apply=False,
                      export_animations=True, export_skins=True, export_yup=True,
                      use_selection=False, export_animation_mode='ACTIONS',
                      export_bake_animation=False, export_image_format='AUTO')
        if DO_DRACO:
            kwargs.update(dict(
                export_draco_mesh_compression_enable=True,
                export_draco_mesh_compression_level=6,
                export_draco_position_quantization=14,
                export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=12,
            ))
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError as e:
            print("export kwargs rejected:", e)
            bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
        print("EXPORTED", out, os.path.getsize(out), "bytes (draco=%s)" % DO_DRACO)

    blend = os.path.join(ASSETS, "girl.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("SAVED", blend)

    if DO_PREVIEW:
        setup_render()
        pose_for_preview(arm)
        render_views(PREVIEW_TAG)


main()
