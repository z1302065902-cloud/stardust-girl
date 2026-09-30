#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
程序化生成角色贴图（与 build_girl.py 的 UV 布局严格对应）
  assets/tex/face.png   2048 x 4096  —— 上下两帧（睁眼 / 闭眼），头部专用
  assets/tex/body.png   2048 x 2048  —— 头发 / 上衣 / 裙子 / 皮肤 / 平色补丁 图集

绘制思路：脸部先在「平面正视坐标系」里以米为单位画好（精确、不受 UV 拉伸影响），
再按头部圆柱 + 前密后疏的 UV 映射重采样进贴图 —— 这样贴到球面上不会变形。

用法：python3 tools/make_textures.py
"""
import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = os.path.expanduser("~/Desktop/3d-web-game/assets/tex")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------------------
# 头部几何参数（必须与 build_girl.py 一致）
# ---------------------------------------------------------------------------
HEAD_ZMIN, HEAD_ZMAX = 1.358, 1.599
HEAD_YS = 0.965
HEAD_PROFILE = [
    (0.000, 1.358), (0.040, 1.369), (0.060, 1.385), (0.075, 1.405),
    (0.086, 1.429), (0.092, 1.453), (0.0955, 1.479), (0.096, 1.506),
    (0.094, 1.533), (0.087, 1.557), (0.073, 1.577), (0.046, 1.591), (0.000, 1.599),
]


def head_radius(z):
    """头部在该高度的半径（线性插值剖面）"""
    pts = HEAD_PROFILE
    if z <= pts[0][1]:
        return pts[0][0]
    if z >= pts[-1][1]:
        return pts[-1][0]
    for i in range(len(pts) - 1):
        z0, z1 = pts[i][1], pts[i + 1][1]
        if z0 <= z <= z1:
            t = (z - z0) / max(z1 - z0, 1e-9)
            return pts[i][0] * (1 - t) + pts[i + 1][0] * t
    return 0.09


def head_uv(x, y, z):
    """世界坐标 -> 头部 UV（与 Blender 端 uv_mode='head' 完全一致）"""
    phi = math.atan2(x, -y)
    a = phi / math.pi
    u = 0.5 + 0.5 * math.copysign(abs(a) ** 0.5, a)
    v = (z - HEAD_ZMIN) / (HEAD_ZMAX - HEAD_ZMIN)
    return u, v


# ---------------------------------------------------------------------------
# 通用绘制工具
# ---------------------------------------------------------------------------
SKIN = (255, 226, 214)
SKIN_SHADE = (240, 196, 182)
SKIN_DEEP = (226, 168, 156)
HAIR = (255, 158, 199)
HAIR_LIGHT = (255, 196, 222)
HAIR_DARK = (240, 111, 168)
LASH = (58, 36, 54)
IRIS = (102, 211, 255)
IRIS_DEEP = (47, 143, 214)
IRIS_DARK = (26, 74, 122)
WHITE = (255, 255, 255)
MOUTH = (201, 83, 107)
BLUSH = (255, 139, 166)
CLOTH = (255, 255, 255)
NAVY = (61, 74, 122)
NAVY_DARK = (44, 53, 89)
TRIM = (255, 143, 184)
BOW = (255, 111, 165)
RIBBON = (255, 209, 102)
SOCK = (47, 58, 99)
SHOE = (74, 58, 92)

FRAME = 2048          # 每帧边长
PXM = 3600.0          # 平面脸：每米像素数


def face_plane():
    """平面正视图画布：x ∈ [-0.25, 0.25] m，z ∈ [1.33, 1.63] m"""
    w = int(0.5 * PXM)
    h = int(0.30 * PXM)
    return Image.new("RGB", (w, h), SKIN), w, h


def to_plane(canvas_wh, x_m, z_m):
    w, h = canvas_wh
    px = (x_m + 0.25) * PXM
    py = (1.33 + 0.30 - z_m) * PXM
    return px, py


def pm(v):
    """米 -> 平面画布像素"""
    return v * PXM


def ellipse_pt(cx, cy, rx, ry, t):
    return cx + rx * math.cos(t), cy + ry * math.sin(t)


def draw_soft_ellipse(img, cx, cy, rx, ry, color, blur=6, alpha=255):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(layer) if img.mode == "RGBA" else img.paste(
        Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))


# ---------------------------------------------------------------------------
# 画一只动漫眼（平面坐标，单位米）
# ---------------------------------------------------------------------------
def draw_eye(d, CX, CZ, side, open_eye=True, scale=1.0):
    """side: +1 左眼(画面右侧)，-1 右眼"""
    w = 0.060 * scale
    h = 0.082 * scale
    cx = CX + side * w * 0.62          # 眼睛中心（相对脸中线）
    # --- 眼窝阴影 ---
    d.ellipse((cx - w * 0.62, cz(cx) if False else CZ - h * 0.62,
               cx + w * 0.62, CZ + h * 0.58), fill=(236, 196, 186))
    if not open_eye:
        # 闭眼：一条上挑的睫毛弧线
        pts = []
        for i in range(21):
            t = i / 20.0
            x = cx - w * 0.55 + w * 1.10 * t
            y = CZ - math.sin(t * math.pi) * h * 0.16 + (t - 0.5) * h * 0.20
            pts.append((x, y))
        for k in range(6):
            off = (k - 2.5) * 0.0042
            d.line([(x, y + off) for (x, y) in pts], fill=LASH if k == 2 or k == 3 else LASH,
                   width=int(pm(0.0075)), joint="curve")
        return

    # --- 深色眼眶（动漫眼线） ---
    box = (cx - w * 0.60, CZ - h * 0.60, cx + w * 0.60, CZ + h * 0.56)
    d.ellipse(box, fill=LASH)
    # --- 眼白 ---
    box = (cx - w * 0.50, CZ - h * 0.44, cx + w * 0.50, CZ + h * 0.48)
    d.ellipse(box, fill=WHITE)
    # --- 虹膜（上深下浅） ---
    ir = w * 0.44
    irh = h * 0.46
    box = (cx - ir, CZ - irh * 0.86, cx + ir, CZ + irh * 0.94)
    d.ellipse(box, fill=IRIS)
    d.ellipse((cx - ir * 0.99, CZ + irh * 0.05, cx + ir * 0.99, CZ + irh * 0.98), fill=IRIS_DEEP)
    d.ellipse((cx - ir * 0.80, CZ + irh * 0.32, cx + ir * 0.80, CZ + irh * 0.92),
              fill=(150, 233, 255))
    # 虹膜上缘压深
    d.ellipse((cx - ir * 1.02, CZ - irh * 1.02, cx + ir * 1.02, CZ - irh * 0.10),
              fill=IRIS_DARK)
    d.ellipse((cx - ir * 0.92, CZ - irh * 0.86, cx + ir * 0.92, CZ + irh * 0.30), fill=IRIS)
    # --- 瞳孔 ---
    pr, prh = w * 0.19, h * 0.25
    d.ellipse((cx - pr, CZ - prh * 0.9, cx + pr, CZ + prh * 1.1), fill=(28, 20, 34))
    # --- 高光 ---
    d.ellipse((cx - w * 0.34, CZ + h * 0.06, cx - w * 0.06, CZ + h * 0.34), fill=WHITE)
    d.ellipse((cx + w * 0.12, CZ - h * 0.28, cx + w * 0.28, CZ - h * 0.12), fill=WHITE)
    # --- 上睫毛加粗（外眼角上挑） ---
    pts = []
    for i in range(19):
        t = i / 18.0
        x = cx - w * 0.62 + w * 1.28 * t
        y = CZ - h * 0.52 + math.sin(t * math.pi * 0.92) * h * 0.10 - (t ** 2) * h * 0.16
        pts.append((x, y))
    d.line(pts, fill=LASH, width=int(pm(0.0100)), joint="curve")
    pts2 = [(x + side * pm(0.010), y - pm(0.006)) for (x, y) in pts[-4:]]
    d.line(pts2, fill=LASH, width=int(pm(0.0075)), joint="curve")
    # --- 下眼线（淡） ---
    pts = []
    for i in range(13):
        t = i / 12.0
        x = cx - w * 0.44 + w * 0.90 * t
        y = CZ + h * 0.42 + math.sin(t * math.pi) * h * 0.06
        pts.append((x, y))
    d.line(pts, fill=(214, 168, 158), width=int(pm(0.0040)), joint="curve")


def draw_brow(d, CX, CZ, side, scale=1.0):
    w = 0.072 * scale
    cx = CX + side * w * 0.60
    pts = []
    for i in range(15):
        t = i / 14.0
        x = cx - w * 0.52 + w * 1.04 * t
        y = CZ - math.sin(t * math.pi * 0.8) * 0.012 - (t - 0.5) * 0.010
        pts.append((x, y))
    d.line(pts, fill=(214, 130, 158), width=int(pm(0.0085)), joint="curve")


def build_face_frame(open_eye=True):
    """返回 2048x2048 的正脸视图（已经是 UV 空间的一帧）"""
    plane, W, H = face_plane()
    d = ImageDraw.Draw(plane)

    # 面部柔和明暗：侧脸收窄处压暗
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    for i in range(60):
        t = i / 59.0
        x = -0.25 + 0.5 * t
        a = int(46 * (t ** 2.4)) + int(46 * ((1 - t) ** 2.4))
        sd.line([(pm(x + 0.25), 0), (pm(x + 0.25), H)], fill=a)
    shade = shade.filter(ImageFilter.GaussianBlur(24))
    up = Image.new("RGBA", (W, H), (198, 140, 128, 0))
    up.putalpha(shade)
    plane = Image.alpha_composite(plane.convert("RGBA"), up).convert("RGB")
    d = ImageDraw.Draw(plane)

    EZ = 1.4635                        # 眼睛高度
    CZb = 1.5120                       # 眉毛高度
    MZ = 1.4110                        # 嘴的高度

    px = lambda x, z: (pm(x + 0.25), pm(1.63 - z))

    # 额头 / 下巴的柔和过渡
    draw_soft_ellipse(plane, pm(0.0 + 0.25), pm(1.63 - 1.575), pm(0.14), pm(0.045),
                      (255, 236, 228), blur=26, alpha=150)
    plane = plane.convert("RGBA")
    d = ImageDraw.Draw(plane)

    for side in (1, -1):
        ex = side * 0.0455
        cx, cy = px(ex, EZ)
        # 用画布像素直接绘制
        w = pm(0.060)
        h = pm(0.082)
        sc = 1.0
        _eye_pix(d, cx, cy, w, h, side, open_eye)
        # 眉毛
        bx, bz = px(ex, CZb)
        bw = pm(0.072)
        pts = []
        for i in range(15):
            t = i / 14.0
            x = bx - bw * 0.52 + bw * 1.04 * t
            y = bz - math.sin(t * math.pi * 0.8) * pm(0.012) - (t - 0.5) * pm(0.010)
            pts.append((x, y))
        d.line(pts, fill=(214, 130, 158), width=int(pm(0.0085)), joint="curve")
        # 腮红
        blx, blz = px(side * 0.068, 1.4290)
        blush = Image.new("RGBA", plane.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(blush)
        bd.ellipse((blx - pm(0.030), blz - pm(0.018), blx + pm(0.030), blz + pm(0.018)),
                   fill=BLUSH + (110,))
        blush = blush.filter(ImageFilter.GaussianBlur(12))
        plane = Image.alpha_composite(plane, blush)
        d = ImageDraw.Draw(plane)

    # 嘴
    mx, mz = px(0.0, MZ)
    if open_eye:
        pts = []
        for i in range(17):
            t = i / 16.0
            x = mx - pm(0.013) + pm(0.026) * t
            y = mz + math.sin(t * math.pi) * pm(0.0055)
            pts.append((x, y))
        d.line(pts, fill=MOUTH, width=int(pm(0.0042)), joint="curve")
        d.ellipse((mx - pm(0.007), mz + pm(0.003), mx + pm(0.007), mz + pm(0.010)),
                  fill=(190, 70, 92))
    else:
        pts = []
        for i in range(13):
            t = i / 12.0
            x = mx - pm(0.010) + pm(0.020) * t
            y = mz + math.sin(t * math.pi) * pm(0.0028)
            pts.append((x, y))
        d.line(pts, fill=MOUTH, width=int(pm(0.0032)), joint="curve")

    # 鼻影
    nx, nz = px(0.0, 1.4330)
    d.ellipse((nx - pm(0.0055), nz - pm(0.0035), nx + pm(0.0055), nz + pm(0.0045)),
              fill=(236, 190, 178))

    plane = plane.convert("RGB")

    # ---- 平面 -> 头部圆柱 UV 重采样 ----
    frame = Image.new("RGB", (FRAME, FRAME), SKIN)
    arr = np.asarray(plane, dtype=np.float32)
    ph, pw = arr.shape[:2]
    out = np.zeros((FRAME, FRAME, 3), dtype=np.float32)
    ys, xs = np.mgrid[0:FRAME, 0:FRAME]
    u = (xs + 0.5) / FRAME
    v = (ys + 0.5) / FRAME
    vv = 1.0 - v                       # 图像行 -> v
    # 反解 u -> phi
    du = u - 0.5
    aref = (2.0 * np.abs(du)) ** 2
    phi = math.pi * np.sign(du) * aref
    z = HEAD_ZMIN + vv * (HEAD_ZMAX - HEAD_ZMIN)
    r = np.interp(z, [p[1] for p in HEAD_PROFILE], [p[0] for p in HEAD_PROFILE])
    xw = r * np.sin(phi)
    yw = -HEAD_YS * r * np.cos(phi)
    # 平面画布坐标
    pxc = (xw + 0.25) * PXM
    pyc = (1.63 - z) * PXM
    xi = np.clip(pxc.astype(np.int32), 0, pw - 1)
    yi = np.clip(pyc.astype(np.int32), 0, ph - 1)
    out = arr[yi, xi]
    # 背面（|phi| > 1.6）用纯肤色，反正被头发盖住
    back = np.abs(phi) > 1.55
    out[back] = np.array(SKIN, dtype=np.float32)
    img = Image.fromarray(out.astype(np.uint8), "RGB")
    # 轻微柔化，避免重采样锯齿
    return img.filter(ImageFilter.GaussianBlur(0.8))


def _eye_pix(d, cx, cy, w, h, side, open_eye):
    """在画布像素坐标下画一只眼睛（w/h 为像素半宽的 2 倍）"""
    if not open_eye:
        pts = []
        for i in range(21):
            t = i / 20.0
            x = cx - w * 0.55 + w * 1.10 * t
            y = cy - math.sin(t * math.pi) * h * 0.14 + (t - 0.5) * h * 0.18
            pts.append((x, y))
        d.line(pts, fill=LASH, width=max(2, int(w * 0.16)), joint="curve")
        return
    d.ellipse((cx - w * 0.62, cy - h * 0.62, cx + w * 0.62, cy + h * 0.58), fill=LASH)
    d.ellipse((cx - w * 0.52, cy - h * 0.46, cx + w * 0.52, cy + h * 0.50), fill=WHITE)
    ir, irh = w * 0.46, h * 0.48
    d.ellipse((cx - ir, cy - irh * 0.88, cx + ir, cy + irh * 0.96), fill=IRIS)
    d.ellipse((cx - ir * 0.99, cy + irh * 0.05, cx + ir * 0.99, cy + irh * 0.98), fill=IRIS_DEEP)
    d.ellipse((cx - ir * 0.82, cy + irh * 0.30, cx + ir * 0.82, cy + irh * 0.94), fill=(160, 236, 255))
    d.ellipse((cx - ir * 1.04, cy - irh * 1.05, cx + ir * 1.04, cy - irh * 0.06), fill=IRIS_DARK)
    d.ellipse((cx - ir * 0.94, cy - irh * 0.88, cx + ir * 0.94, cy + irh * 0.32), fill=IRIS)
    pr, prh = w * 0.20, h * 0.26
    d.ellipse((cx - pr, cy - prh * 0.9, cx + pr, cy + prh * 1.1), fill=(28, 20, 34))
    d.ellipse((cx - w * 0.36, cy + h * 0.04, cx - w * 0.05, cy + h * 0.32), fill=WHITE)
    d.ellipse((cx + w * 0.12, cy - h * 0.30, cx + w * 0.28, cy - h * 0.14), fill=WHITE)
    pts = []
    for i in range(19):
        t = i / 18.0
        x = cx - w * 0.64 + w * 1.30 * t
        y = cy - h * 0.54 + math.sin(t * math.pi * 0.92) * h * 0.10 - (t ** 2) * h * 0.18
        pts.append((x, y))
    d.line(pts, fill=LASH, width=max(3, int(w * 0.20)), joint="curve")
    tip = pts[-5:]
    d.line([(x + side * w * 0.16, y - h * 0.06) for (x, y) in tip],
           fill=LASH, width=max(2, int(w * 0.13)), joint="curve")
    pts = []
    for i in range(13):
        t = i / 12.0
        x = cx - w * 0.44 + w * 0.90 * t
        y = cy + h * 0.44 + math.sin(t * math.pi) * h * 0.06
        pts.append((x, y))
    d.line(pts, fill=(214, 168, 158), width=max(1, int(w * 0.07)), joint="curve")


# ---------------------------------------------------------------------------
# 身体图集
# ---------------------------------------------------------------------------
def build_body_atlas():
    S = 2048
    img = Image.new("RGB", (S, S), (255, 255, 255))
    d = ImageDraw.Draw(img)

    def rect(region, color):
        x0, y0, w, h = region
        d.rectangle((x0 * S, (1 - y0 - h) * S, (x0 + w) * S, (1 - y0) * S), fill=color)

    # ---- 头发区（R_HAIR）：粉色渐变 + 发丝 ----
    hx, hy, hw, hh = 0.50, 0.50, 0.50, 0.50
    x0, y0 = int(hx * S), int((1 - hy - hh) * S)
    box = (x0, y0, x0 + int(hw * S), y0 + int(hh * S))
    hair = Image.new("RGB", (box[2] - box[0], box[3] - box[1]))
    hw_px, hh_px = hair.size
    arr = np.zeros((hh_px, hw_px, 3), dtype=np.float32)
    grad = np.linspace(0, 1, hh_px)[:, None]           # 0=顶(发根) 1=底(发梢)
    base = np.array(HAIR_DARK, dtype=np.float32)
    tip = np.array(HAIR_LIGHT, dtype=np.float32)
    t = np.clip(grad * 1.35 - 0.15, 0, 1)
    arr[:, :, :] = base[None, None, :] * (1 - t[:, :, None]) + tip[None, None, :] * t[:, :, None]
    # 发丝：竖向明亮细条
    rng = np.random.default_rng(7)
    for i in range(70):
        cx = rng.random() * hw_px
        width = 2 + rng.random() * 7
        bright = 0.18 + rng.random() * 0.5
        wob = rng.random() * 6
        xs = np.arange(hw_px)
        off = np.sin(xs / (18 + wob * 6) + i) * (3 + wob)
        dist = np.abs(xs[None, :] + off[None, :] - cx)
        mask = np.clip(1 - dist / width, 0, 1)[:, :, None]
        arr += mask * bright * np.array([26, 24, 20], dtype=np.float32)[None, None, :]
    # 高光带
    spec = np.exp(-((grad - 0.36) ** 2) / (2 * 0.10 ** 2))
    arr += spec * 34.0
    arr = np.clip(arr, 0, 255)
    hair = Image.fromarray(arr.astype(np.uint8), "RGB")
    img.paste(hair, (x0, y0))

    # ---- 上衣区（R_TOP）：白 + 下摆深蓝条 + 柔和阴影 ----
    tx0 = int(0.0 * S)
    ty0 = int((1 - 0.5 - 0.5) * S)
    tw, th = int(0.5 * S), int(0.5 * S)
    top = Image.new("RGB", (tw, th), CLOTH)
    ta = np.zeros((th, tw, 3), dtype=np.float32)
    gy = np.linspace(0, 1, th)[:, None]
    ta[:, :, 0] = 255 - gy * 26
    ta[:, :, 1] = 255 - gy * 22
    ta[:, :, 2] = 255 - gy * 8
    # 环境光遮蔽：领口、下摆、腋下压暗，衣服才有“穿在身上”的体积感
    ta[:int(th * 0.06)] *= np.linspace(0.80, 1.0, int(th * 0.06))[:, None, None]
    ta[th - int(th * 0.12):] *= np.linspace(1.0, 0.84, int(th * 0.12))[:, None, None]
    ex = np.linspace(0, 1, tw)
    side = np.clip(np.minimum(ex, 1 - ex) / 0.16, 0, 1)
    ta *= (0.88 + 0.12 * side)[None, :, None]
    top = Image.fromarray(np.clip(ta, 0, 255).astype(np.uint8), "RGB")
    td = ImageDraw.Draw(top)
    # 下摆深蓝条（v 小 = 图像底部）
    td.rectangle((0, th - int(th * 0.075), tw, th), fill=NAVY)
    td.rectangle((0, th - int(th * 0.095), tw, th - int(th * 0.075)), fill=TRIM)
    # 竖向阴影（衣褶）
    for i in range(14):
        x = int(tw * (i + 0.5) / 14)
        td.line([(x, 0), (x, th)], fill=(246, 246, 252), width=3)
    top = top.filter(ImageFilter.GaussianBlur(2))
    img.paste(top, (tx0, ty0))

    # ---- 裙子区（R_SKIRT）：深蓝 + 20 道褶的明暗 ----
    sx0, sy0 = int(0.50 * S), int((1 - 0.25) * S)
    sw, sh = int(0.25 * S), int(0.25 * S)
    sa = np.zeros((sh, sw, 3), dtype=np.float32)
    xs = np.linspace(0, 1, sw)[None, :]
    ys = np.linspace(0, 1, sh)[:, None]
    pleat = np.cos(xs * math.pi * 2 * 20)
    shade = 0.72 + 0.36 * (pleat * 0.5 + 0.5)
    depth = 0.82 + 0.18 * ys
    base = np.array(NAVY, dtype=np.float32)
    sa[:, :, :] = base[None, None, :] * shade[:, :, None] * depth[:, :, None]
    sa[:int(sh * 0.10)] *= np.linspace(0.82, 1.0, int(sh * 0.10))[:, None, None]
    sd = Image.fromarray(np.clip(sa, 0, 255).astype(np.uint8), "RGB")
    # 裙摆受光边（下缘 = 图像底部）
    ImageDraw.Draw(sd).rectangle((0, sh - int(sh * 0.035), sw, sh), fill=(126, 140, 196))
    img.paste(sd, (sx0, sy0))

    # ---- 皮肤区（R_SKIN）：暖色 + 沿长度柔和变化 ----
    kx0, ky0 = int(0.75 * S), int((1 - 0.25 - 0.25) * S)
    kw, kh = int(0.25 * S), int(0.25 * S)
    ka = np.zeros((kh, kw, 3), dtype=np.float32)
    gy = np.linspace(0, 1, kh)[:, None]
    base = np.array(SKIN, dtype=np.float32)
    end = np.array(SKIN_SHADE, dtype=np.float32)
    blend = 0.18 * (np.abs(gy - 0.5) * 2) ** 1.5
    ka[:, :, :] = base[None, None, :] * (1 - blend[:, :, None]) + end[None, None, :] * blend[:, :, None]
    # 两端接缝处的遮蔽
    ka[:int(kh * 0.12)] *= np.linspace(0.84, 1.0, int(kh * 0.12))[:, None, None]
    ka[kh - int(kh * 0.12):] *= np.linspace(1.0, 0.86, int(kh * 0.12))[:, None, None]
    img.paste(Image.fromarray(np.clip(ka, 0, 255).astype(np.uint8), "RGB"), (kx0, ky0))

    # ---- 深蓝区（R_COLLAR）----
    cx0, cy0 = int(0.75 * S), int((1 - 0.25) * S)
    ca = np.zeros((int(0.25 * S), int(0.25 * S), 3), dtype=np.float32)
    ca[:, :, :] = np.array(SOCK, dtype=np.float32)[None, None, :]
    img.paste(Image.fromarray(ca.astype(np.uint8), "RGB"), (cx0, cy0))

    # ---- 平色补丁 ----
    patches = {
        0: SKIN, 1: CLOTH, 2: NAVY, 3: NAVY_DARK, 4: TRIM, 5: BOW,
        6: RIBBON, 7: SOCK, 8: SHOE, 9: SKIN_SHADE, 10: HAIR_DARK, 11: HAIR_LIGHT,
    }
    for i, col in patches.items():
        cx = 0.0625 + (i % 4) * 0.125
        cy = 0.9375 - (i // 4) * 0.125
        half = 0.055
        d.rectangle(((cx - half) * S, (1 - cy - half) * S,
                     (cx + half) * S, (1 - cy + half) * S), fill=col)
    return img


def main():
    face_open = build_face_frame(True)
    face_closed = build_face_frame(False)
    face = Image.new("RGB", (FRAME, FRAME * 2))
    face.paste(face_open, (0, 0))            # 上半 = 睁眼（v 0.5~1.0）
    face.paste(face_closed, (0, FRAME))      # 下半 = 闭眼（v 0.0~0.5）
    face.save(os.path.join(OUT, "face.png"))
    print("face.png", face.size)

    body = build_body_atlas()
    body.save(os.path.join(OUT, "body.png"))
    print("body.png", body.size)

    # 预览图（方便快速检查）
    prev = Image.new("RGB", (1024, 1024), (30, 34, 46))
    prev.paste(face_open.resize((512, 512)), (0, 0))
    prev.paste(face_closed.resize((512, 512)), (512, 0))
    prev.paste(body.resize((1024, 1024)), (0, 0))
    prev = Image.new("RGB", (1536, 1024), (30, 34, 46))
    prev.paste(face_open.resize((512, 512)), (0, 0))
    prev.paste(face_closed.resize((512, 512)), (512, 0))
    prev.paste(body.resize((1024, 1024)), (512, 0))
    prev.save(os.path.join(OUT, "..", "..", "research", "texture_preview.png"))
    print("preview saved")


if __name__ == "__main__":
    main()
