// ---------------------------------------------------------------------------
// character.js — 程序化生成的动漫少女（无外部模型/贴图资源，全部由代码构建）
// 分层骨骼 Object3D 骨架 + 手绘式动画状态机（idle / walk / run / jump / spin ...）
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// ------------------------------- 配色 --------------------------------------
export const PALETTE = {
  skin: 0xffe0d2,
  skinShade: 0xf2c3b4,
  hair: 0xff9ec7,
  hairDark: 0xf06fa8,
  hairLight: 0xffc2dd,
  eye: 0x66d3ff,
  eyeDeep: 0x2f8fd6,
  lash: 0x3a2436,
  mouth: 0xd0607a,
  blush: 0xff8ba6,
  cloth: 0xffffff,
  clothTrim: 0xff8fb8,
  navy: 0x3d4a7a,
  navyDark: 0x2c3559,
  bow: 0xff6fa5,
  shoe: 0x4a3a5c,
  sock: 0x2f3a63,
  ribbon: 0xffd166,
};

// --------------------------- 卡通材质与描边 --------------------------------
let GRADIENT_MAP = null;
function gradientMap() {
  if (GRADIENT_MAP) return GRADIENT_MAP;
  const data = new Uint8Array([90, 150, 210, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  GRADIENT_MAP = tex;
  return tex;
}

export function toon(color, opts = {}) {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  return m;
}

export function flat(color, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
  });
}

const _outlineCache = new Map();
function outlineMaterial(width) {
  const key = width.toFixed(4);
  if (_outlineCache.has(key)) return _outlineCache.get(key);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: width }, uColor: { value: new THREE.Color(0x3d2637) } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz += n * uWidth;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
    side: THREE.BackSide,
  });
  _outlineCache.set(key, mat);
  return mat;
}

/**
 * 把若干网格聚合成一个部件组（自带反向外壳描边，卡通渲染用）。
 */
function part(name, outlineWidth = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.userData.outlineWidth = outlineWidth;
  return g;
}

function addMesh(group, geometry, material, { outline = 0, position, rotation, scale, name } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  if (name) mesh.name = name;
  if (position) mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  group.add(mesh);
  if (outline > 0) {
    const o = new THREE.Mesh(geometry, outlineMaterial(outline));
    o.position.copy(mesh.position);
    o.rotation.copy(mesh.rotation);
    o.scale.copy(mesh.scale);
    o.castShadow = false;
    o.receiveShadow = false;
    o.renderOrder = -1;
    group.add(o);
  }
  return mesh;
}

// --------------------------- 几何构造小工具 ---------------------------------
/** 用剖面点阵旋成回转体（躯干、头、裙摆都用它，比拼球体自然得多） */
function lathe(profile, segments = 28, thetaStart = 0, thetaLength = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  return new THREE.LatheGeometry(pts, segments, thetaStart, thetaLength);
}

/** 给回转体打褶皱：按角度调制半径（裙摆百褶） */
function pleat(geo, count, depth, yMin = -Infinity, yMax = Infinity) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-5) continue;
    const a = Math.atan2(z, x);
    // 褶皱强度随高度渐变：腰部平坦、裙边最深
    const t = THREE.MathUtils.clamp((yMax - y) / Math.max(yMax - yMin, 1e-5), 0, 1);
    const k = 1 + depth * t * Math.cos(a * count);
    p.setX(i, Math.cos(a) * r * k);
    p.setZ(i, Math.sin(a) * r * k);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function taper(r1, r2, len, segmentCount = 10) {
  // 原点在顶端，向 -y 延伸，方便做关节链
  const g = new THREE.CylinderGeometry(r1, r2, len, segmentCount, 1, true);
  g.translate(0, -len / 2, 0);
  return g;
}

function rounded(minR, maxR, cmp) {
  // 占位：保持 API 稳定
  return new THREE.SphereGeometry(maxR, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
}

// ---------------------------------------------------------------------------
// 骨架尺寸（单位：米，1 单位 = 1 米；角色身高约 1.58m，6.5 头身）
// ---------------------------------------------------------------------------
const S = {
  hipY: 0.86,
  spineY: 0.10,      // 相对 hips
  chestY: 0.15,      // 相对 spine
  neckY: 0.155,      // 相对 chest
  headY: 0.065,      // 相对 neck（头的底部=下巴）
  shoulderX: 0.088,
  shoulderY: 0.135,  // 相对 chest
  upperArm: 0.225,
  foreArm: 0.215,
  hand: 0.078,
  hipX: 0.062,
  hipJointY: -0.035, // 相对 hips
  thigh: 0.40,
  shin: 0.395,
  footY: 0.032,
};

// 头部剖面：从下巴(0)到头顶(0.215)
const HEAD_PROFILE = [
  [0.000, 0.000], [0.042, 0.006], [0.062, 0.020], [0.076, 0.042],
  [0.086, 0.070], [0.092, 0.098], [0.094, 0.124], [0.091, 0.150],
  [0.082, 0.174], [0.065, 0.196], [0.040, 0.209], [0.000, 0.215],
];

// 躯干剖面：腰(0) -> 胸 -> 肩 -> 颈
const TORSO_PROFILE = [
  [0.082, 0.000], [0.086, 0.030], [0.094, 0.070], [0.102, 0.105],
  [0.106, 0.135], [0.100, 0.165], [0.082, 0.195], [0.055, 0.222],
  [0.036, 0.240], [0.030, 0.250],
];

export function createAnimeGirl(opts = {}) {
  const scaleAll = opts.scale ?? 1;
  const root = new THREE.Group();
  root.name = 'animeGirl';
  root.scale.setScalar(scaleAll);

  const mat = {
    skin: toon(PALETTE.skin),
    skinShade: toon(PALETTE.skinShade),
    hair: toon(PALETTE.hair),
    hairDark: toon(PALETTE.hairDark),
    hairLight: toon(PALETTE.hairLight),
    cloth: toon(PALETTE.cloth),
    trim: toon(PALETTE.clothTrim),
    navy: toon(PALETTE.navy, { side: THREE.DoubleSide }),
    navyDark: toon(PALETTE.navyDark),
    bow: toon(PALETTE.bow),
    shoe: toon(PALETTE.shoe),
    sock: toon(PALETTE.sock, { side: THREE.DoubleSide }),
    ribbon: toon(PALETTE.ribbon, { emissive: 0x5a3a00, emissiveIntensity: 0.35 }),
    // 眼睛/五官用不受光的平涂材质，才是动画脸的味道
    lash: flat(PALETTE.lash),
    white: flat(0xffffff),
    iris: flat(PALETTE.eye),
    irisDeep: flat(PALETTE.eyeDeep),
    pupil: flat(0x241a2b),
    shine: flat(0xffffff),
    blush: flat(PALETTE.blush, { transparent: true, opacity: 0.5 }),
    mouth: flat(PALETTE.mouth),
    brow: flat(0xd5836f),
  };

  // ======================= 骨骼层级 =========================================
  const hips = new THREE.Group(); hips.name = 'hips';
  hips.position.y = S.hipY;
  root.add(hips);

  const spine = new THREE.Group(); spine.name = 'spine';
  spine.position.y = S.spineY;
  hips.add(spine);

  const chest = new THREE.Group(); chest.name = 'chest';
  chest.position.y = S.chestY;
  spine.add(chest);

  const neck = new THREE.Group(); neck.name = 'neck';
  neck.position.y = S.neckY;
  chest.add(neck);

  const head = new THREE.Group(); head.name = 'head';
  head.position.y = S.headY;
  neck.add(head);

  const arm = (side) => {
    const sign = side === 'L' ? 1 : -1;
    const shoulder = new THREE.Group();
    shoulder.name = 'shoulder' + side;
    shoulder.position.set(sign * S.shoulderX, S.shoulderY, 0);
    chest.add(shoulder);

    const upper = new THREE.Group(); upper.name = 'upperArm' + side;
    shoulder.add(upper);

    const fore = new THREE.Group(); fore.name = 'foreArm' + side;
    fore.position.y = -S.upperArm;
    upper.add(fore);

    const hand = new THREE.Group(); hand.name = 'hand' + side;
    hand.position.y = -S.foreArm;
    fore.add(hand);
    return { shoulder, upper, fore, hand, sign };
  };

  const leg = (side) => {
    const sign = side === 'L' ? 1 : -1;
    const hipJoint = new THREE.Group();
    hipJoint.name = 'thigh' + side;
    hipJoint.position.set(sign * S.hipX, S.hipJointY, 0);
    hips.add(hipJoint);

    const knee = new THREE.Group(); knee.name = 'shin' + side;
    knee.position.y = -S.thigh;
    hipJoint.add(knee);

    const ankle = new THREE.Group(); ankle.name = 'foot' + side;
    ankle.position.y = -S.shin;
    knee.add(ankle);
    return { hipJoint, knee, ankle, sign };
  };

  const arms = { L: arm('L'), R: arm('R') };
  const legs = { L: leg('L'), R: leg('R') };

  // ======================= 躯干与服装 =======================================
  const body = part('body', 0.011);

  // 上身：白色水手服
  const torsoGeo = lathe(TORSO_PROFILE, 26);
  const torso = addMesh(body, torsoGeo, mat.cloth, { outline: 0.011 });
  torso.scale.set(1.0, 1.0, 0.76);
  torso.position.y = 0.0;
  body.add(torso);
  // 躯干网格挂在 spine 上，位置从腰算起
  spine.add(body);

  // 胸口蝴蝶结
  const bow = part('bow', 0.008);
  addMesh(bow, new THREE.SphereGeometry(0.018, 12, 10), mat.ribbon, { scale: [1, 0.8, 0.6], position: [0, 0.135, 0.084] });
  addMesh(bow, new THREE.ConeGeometry(0.030, 0.052, 10), mat.ribbon, { rotation: [0, 0, Math.PI / 2], position: [-0.036, 0.135, 0.082] });
  addMesh(bow, new THREE.ConeGeometry(0.030, 0.052, 10), mat.ribbon, { rotation: [0, 0, -Math.PI / 2], position: [0.036, 0.135, 0.082] });
  // 缎带垂坠
  addMesh(bow, new THREE.BoxGeometry(0.024, 0.20, 0.014), mat.trim, { position: [-0.020, 0.030, 0.078], rotation: [0.10, 0, 0.10] });
  addMesh(bow, new THREE.BoxGeometry(0.024, 0.185, 0.014), mat.trim, { position: [0.022, 0.030, 0.076], rotation: [0.10, 0, -0.10] });
  spine.add(bow);

  // 水手领（后领布 + 前襟 V 字）
  const collar = part('collar', 0.009);
  const collarBack = new THREE.Mesh(lathe([[0.001, 0], [0.115, 0.0], [0.115, 0.012], [0.095, 0.055], [0.06, 0.075], [0.001, 0.078]], 22), mat.navy,);
  collarBack.scale.set(1, 1, 0.8);
  collarBack.position.y = 0.245;
  collarBack.castShadow = true;
  collar.add(collarBack);
  const collarFrontL = addMesh(collar, new THREE.BoxGeometry(0.055, 0.10, 0.02), mat.navy, { position: [-0.040, 0.195, 0.062], rotation: [0.18, 0.55, 0.16] });
  const collarFrontR = addMesh(collar, new THREE.BoxGeometry(0.055, 0.10, 0.02), mat.navy, { position: [0.040, 0.195, 0.062], rotation: [0.18, -0.55, -0.16] });
  collarFrontL.material = collarFrontR.material = mat.navy;
  chest.add(collar);

  // 裙摆：百褶短裙
  const skirt = part('skirt', 0.010);
  const skirtGeo = lathe([
    [0.098, 0.000], [0.112, -0.045], [0.140, -0.095], [0.176, -0.145], [0.196, -0.168],
  ], 30);
  pleat(skirtGeo, 16, 0.055, -0.168, 0.0);
  const skirtMesh = addMesh(skirt, skirtGeo, mat.navy, { outline: 0.010 });
  skirtMesh.material = new THREE.MeshToonMaterial({
    color: PALETTE.navy, gradientMap: gradientMap(), side: THREE.DoubleSide,
  });
  skirt.position.y = -0.052;
  hips.add(skirt);

  // 腰带
  const belt = part('belt', 0);
  addMesh(belt, lathe([[0.098, 0.0], [0.101, 0.012], [0.098, 0.026]], 24), mat.navyDark, { position: [0, -0.040, 0] });
  hips.add(belt);

  // ======================= 手臂 =============================================
  for (const side of ['L', 'R']) {
    const a = arms[side];
    const g = part('arm' + side, 0.008);
    // 泡泡袖
    addMesh(g, new THREE.SphereGeometry(0.052, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), mat.cloth, { position: [0, 0.008, 0], scale: [1, 1.05, 1] });
    addMesh(g, taper(0.030, 0.028, 0.075), mat.cloth);
    // 上臂 / 前臂（裸露部分）
    addMesh(g, taper(0.030, 0.026, S.upperArm - 0.045), mat.skin, { position: [0, -0.045, 0] });
    a.upper.add(g);
    // 袖口
    addMesh(a.upper, new THREE.TorusGeometry(0.029, 0.006, 6, 14), mat.trim, { rotation: [Math.PI / 2, 0, 0], position: [0, -0.045, 0] });

    const f = part('fore' + side, 0.007);
    addMesh(f, taper(0.026, 0.022, S.foreArm), mat.skin);
    a.fore.add(f);

    const h = part('hand' + side, 0);
    addMesh(h, new THREE.SphereGeometry(0.030, 12, 10), mat.skin, { scale: [1, 1.35, 0.72], position: [0, -0.035, 0] });
    a.hand.add(h);
  }

  // ======================= 腿 / 袜 / 鞋 =====================================
  for (const side of ['L', 'R']) {
    const l = legs[side];
    const thigh = part('thighMesh' + side, 0.008);
    addMesh(thigh, taper(0.052, 0.040, S.thigh - 0.16), mat.skin, { position: [0, -0.13, 0] });
    // 过膝袜从大腿中段开始
    addMesh(thigh, taper(0.043, 0.040, 0.075), mat.sock, { position: [0, -0.195, 0] });
    addMesh(thigh, new THREE.TorusGeometry(0.042, 0.005, 6, 16), mat.trim, { rotation: [Math.PI / 2, 0, 0], position: [0, -0.196, 0] });
    l.hipJoint.add(thigh);

    const shin = part('shinMesh' + side, 0.008);
    addMesh(shin, taper(0.040, 0.030, S.shin - 0.03), mat.sock);
    l.knee.add(shin);

    const foot = part('footMesh' + side, 0.008);
    const shoe = addMesh(foot, new THREE.BoxGeometry(0.090, 0.058, 0.155), mat.shoe, { position: [0, -0.014, 0.026] });
    shoe.geometry.translate(0, 0, 0);
    addMesh(foot, new THREE.BoxGeometry(0.086, 0.020, 0.055), mat.shoe, { position: [0, 0.012, 0.062] });
    l.ankle.add(foot);
  }

  // ======================= 头部 / 脸 ========================================
  const headGrp = part('headMesh', 0.010);
  const skull = addMesh(headGrp, lathe(HEAD_PROFILE, 26), mat.skin, { outline: 0.010 });
  skull.scale.set(1.0, 1.0, 0.94);
  // 后脑补一块，让头型更饱满
  addMesh(headGrp, new THREE.SphereGeometry(0.093, 20, 16), mat.skin, { position: [0, 0.112, -0.012], scale: [1.0, 1.12, 1.0] });
  head.add(headGrp);

  const face = new THREE.Group();
  face.name = 'face';
  head.add(face);

  /** 单只眼睛：动漫大眼 = 深色眼框 + 大虹膜 + 瞳孔 + 双高光 */
  function buildEye(sign) {
    const g = new THREE.Group();
    const ex = sign * 0.0435;
    g.position.set(ex, 0.116, 0.056);
    g.rotation.y = Math.atan2(ex, 0.056);

    const back = new THREE.Mesh(new THREE.CircleGeometry(0.037, 24), mat.lash);
    back.scale.set(0.92, 1.16, 1);
    g.add(back);

    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.0305, 24), mat.iris);
    iris.position.z = 0.0016;
    iris.scale.set(0.94, 1.10, 1);
    g.add(iris);

    const irisDeep = new THREE.Mesh(new THREE.CircleGeometry(0.0305, 24), mat.irisDeep);
    irisDeep.position.set(0, -0.008, 0.0022);
    irisDeep.scale.set(0.94, 0.72, 1);
    g.add(irisDeep);

    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.0135, 18), mat.pupil);
    pupil.position.set(0, -0.002, 0.0032);
    pupil.scale.set(1, 1.18, 1);
    g.add(pupil);

    const hi1 = new THREE.Mesh(new THREE.CircleGeometry(0.0092, 14), mat.shine);
    hi1.position.set(-sign * 0.008, 0.012, 0.0042);
    g.add(hi1);

    const hi2 = new THREE.Mesh(new THREE.CircleGeometry(0.0052, 12), mat.shine);
    hi2.position.set(sign * 0.009, -0.014, 0.0042);
    g.add(hi2);

    // 上眼睑 / 睫毛
    const lash = new THREE.Mesh(new THREE.TorusGeometry(0.0385, 0.0055, 6, 18, Math.PI * 0.95), mat.lash);
    lash.position.set(0, 0.001, 0.0018);
    lash.rotation.z = Math.PI * 0.02;
    g.add(lash);
    // 外眼角上挑
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.026, 6), mat.lash);
    wing.position.set(sign * 0.040, 0.012, 0.0);
    wing.rotation.z = sign * 1.9;
    wing.rotation.y = -sign * 0.4;
    g.add(wing);

    // 下眼线（浅）
    const lower = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0022, 5, 14, Math.PI * 0.55), mat.skinShade);
    lower.position.set(0, 0.0035, 0.002);
    lower.rotation.z = Math.PI * 1.22;
    g.add(lower);
    return g;
  }

  const eyeL = buildEye(1);
  const eyeR = buildEye(-1);
  face.add(eyeL, eyeR);

  // 眉毛
  for (const sign of [1, -1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.0075, 0.008), mat.brow);
    brow.position.set(sign * 0.045, 0.168, 0.078);
    brow.rotation.y = Math.atan2(sign * 0.045, 0.078);
    brow.rotation.z = -sign * 0.16;
    face.add(brow);
  }

  // 腮红
  for (const sign of [1, -1]) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.0195, 16), mat.blush);
    b.position.set(sign * 0.0615, 0.079, 0.062);
    b.rotation.y = Math.atan2(sign * 0.0615, 0.062);
    b.scale.set(1, 0.68, 1);
    face.add(b);
  }

  // 嘴（微笑弧线）
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.0115, 0.0032, 6, 14, Math.PI), mat.mouth);
  mouth.position.set(0, 0.058, 0.0855);
  mouth.rotation.z = Math.PI;
  face.add(mouth);
  // 鼻尖小投影
  const nose = new THREE.Mesh(new THREE.CircleGeometry(0.0062, 10), mat.skinShade);
  nose.position.set(0, 0.089, 0.0905);
  nose.scale.set(1, 0.7, 1);
  face.add(nose);

  // ======================= 头发 =============================================
  const hair = new THREE.Group();
  hair.name = 'hair';
  head.add(hair);

  // 头顶发帽
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.099, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), mat.hair);
  cap.position.set(0, 0.108, -0.006);
  cap.scale.set(1.04, 1.06, 1.04);
  cap.castShadow = true;
  hair.add(cap);
  const cap2 = new THREE.Mesh(new THREE.SphereGeometry(0.099, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.9), mat.hairDark);
  cap2.position.set(0, 0.100, -0.028);
  cap2.scale.set(0.98, 1.0, 0.92);
  cap2.castShadow = true;
  hair.add(cap2);

  // 刘海：沿前额弧线分布的锥形发束
  const bangCount = 9;
  for (let i = 0; i < bangCount; i++) {
    const t = (i / (bangCount - 1)) * 2 - 1;          // -1 .. 1
    const ang = t * 1.15;
    const r = 0.092;
    const len = 0.105 - Math.abs(t) * 0.028 + (i % 3) * 0.008;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.0235, len, 7), i % 2 ? mat.hair : mat.hairLight);
    cone.position.set(Math.sin(ang) * r, 0.185 - len * 0.42, Math.cos(ang) * r * 0.94);
    cone.rotation.set(0.30, -ang * 0.9, -Math.sin(ang) * 0.28);
    cone.castShadow = true;
    hair.add(cone);
  }
  // 两侧鬓发
  for (const sign of [1, -1]) {
    const sideLock = new THREE.Mesh(taper(0.021, 0.007, 0.24), mat.hair);
    sideLock.position.set(sign * 0.096, 0.150, 0.030);
    sideLock.rotation.z = -sign * 0.10;
    sideLock.castShadow = true;
    hair.add(sideLock);
    const sideLock2 = new THREE.Mesh(taper(0.014, 0.004, 0.15), mat.hairLight);
    sideLock2.position.set(sign * 0.078, 0.160, 0.062);
    sideLock2.rotation.z = -sign * 0.05;
    sideLock2.castShadow = true;
    hair.add(sideLock2);
  }
  // 呆毛
  const ahoge = new THREE.Mesh(taper(0.010, 0.001, 0.10), mat.hairLight);
  ahoge.position.set(0.012, 0.208, -0.004);
  ahoge.rotation.set(0.18, 0, -0.42);
  hair.add(ahoge);

  // ---- 双马尾：分段链条，每段独立弹性摆动 ----
  const TAIL_SEGMENTS = 7;
  const tails = [];
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    const base = new THREE.Group();
    base.position.set(sign * 0.098, 0.150, -0.035);
    base.rotation.z = -sign * 0.42;
    base.rotation.x = -0.22;
    hair.add(base);

    // 发圈
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.009, 8, 14), mat.bow);
    tie.rotation.x = Math.PI / 2;
    tie.castShadow = true;
    base.add(tie);

    let parent = base;
    const segs = [];
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const seg = new THREE.Group();
      const segLen = 0.115;
      const r1 = 0.030 - i * 0.0032;
      const r2 = Math.max(0.006, r1 - 0.0042);
      const mesh = new THREE.Mesh(taper(r1, r2, segLen, 9), i % 2 ? mat.hair : mat.hairLight);
      mesh.castShadow = true;
      seg.add(mesh);
      parent.add(seg);
      parent = seg;
      segs.push(seg);
      if (i === 0) seg.position.y = -0.012;
    }
    tails.push({ base, segs, sign });
  }

  // ======================= 动画状态机 =======================================
  const rest = {
    hipsY: S.hipY,
    hipsRot: new THREE.Vector3(0, 0, 0),
    spine: new THREE.Vector3(0, 0, 0),
    chest: new THREE.Vector3(0, 0, 0),
    neck: new THREE.Vector3(0, 0, 0),
    head: new THREE.Vector3(0, 0, 0),
    upperArmL: new THREE.Vector3(0, 0, 0.08),
    upperArmR: new THREE.Vector3(0, 0, -0.08),
    foreArmL: new THREE.Vector3(0, 0, -0.12),
    foreArmR: new THREE.Vector3(0, 0, -0.12),
    thighL: new THREE.Vector3(0, 0, 0.02),
    thighR: new THREE.Vector3(0, 0, -0.02),
    shinL: new THREE.Vector3(0, 0, 0),
    shinR: new THREE.Vector3(0, 0, 0),
    footL: new THREE.Vector3(0, 0, 0),
    footR: new THREE.Vector3(0, 0, 0),
  };

  const pose = {};       // 平滑后的当前姿态
  const target = {};     // 目标姿态
  const keys = ['hipsY', 'hipsRot', 'spine', 'chest', 'neck', 'head',
    'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR',
    'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'];
  for (const k of keys) {
    pose[k] = k === 'hipsY' ? rest.hipsY : rest[k].clone();
    target[k] = k === 'hipsY' ? rest.hipsY : rest[k].clone();
  }

  const state = {
    name: 'idle',
    phase: 0,          // 步态相位
    speed01: 0,        // 0..1 归一化速度
    time: 0,
    blinkIn: 2 + Math.random() * 3,
    blinkT: 0,
    hurtT: 0,
    spinT: 0,
    cheerT: 0,
    landSquash: 0,
    turnLean: 0,
    lastPos: new THREE.Vector3(),
    velLocal: new THREE.Vector3(),
    tailVel: 0,
    tailRot: 0,
    ahoge: 0,
  };

  function V(x, y, z) { return new THREE.Vector3(x, y, z); }

  /** 根据状态与相位产生目标姿态 */
  function buildTarget(s, dt) {
    const t = state.time;
    const spd = state.speed01;
    const p = state.phase;
    const idleAmp = 1;

    // 复位
    target.hipsY = rest.hipsY;
    target.hipsRot.set(0, 0, 0);
    target.spine.set(0, 0, 0);
    target.chest.set(0, 0, 0);
    target.neck.set(0, 0, 0);
    target.head.set(0, 0, 0);
    target.upperArmL.copy(rest.upperArmL);
    target.upperArmR.copy(rest.upperArmR);
    target.foreArmL.copy(rest.foreArmL);
    target.foreArmR.copy(rest.foreArmR);
    target.thighL.copy(rest.thighL);
    target.thighR.copy(rest.thighR);
    target.shinL.copy(rest.shinL);
    target.shinR.copy(rest.shinR);
    target.footL.set(0, 0, 0);
    target.footR.set(0, 0, 0);

    const name = state.name;
    const speedLean = THREE.MathUtils.clamp(spd * 1.0, 0, 1);

    if (name === 'idle' || name === 'talk') {
      // 呼吸 + 重心微微左右移动 + 手指般的细微摆动
      const br = Math.sin(t * 1.9) * idleAmp;
      target.hipsY += br * 0.0045;
      target.chest.x = -0.03 + br * 0.018;
      target.spine.z = Math.sin(t * 0.9) * 0.018;
      target.chest.z = -Math.sin(t * 0.9) * 0.012;
      target.hipsRot.z = Math.sin(t * 0.9) * 0.022;
      target.neck.z = -Math.sin(t * 0.9) * 0.014;
      target.head.y = Math.sin(t * 0.45) * 0.16 + Math.sin(t * 1.3) * 0.03;
      target.head.x = Math.sin(t * 0.7) * 0.05 - (name === 'talk' ? 0.05 : 0);
      target.upperArmL.z = 0.14 + Math.sin(t * 1.9 + 0.4) * 0.03;
      target.upperArmR.z = -0.14 - Math.sin(t * 1.9 + 0.9) * 0.03;
      target.upperArmL.x = Math.sin(t * 1.9 + 0.2) * 0.035;
      target.upperArmR.x = Math.sin(t * 1.9 + 0.7) * 0.035;
      target.foreArmL.z = -0.22 + Math.sin(t * 1.6) * 0.03;
      target.foreArmR.z = 0.22 - Math.sin(t * 1.6 + 0.5) * 0.03;
      target.thighL.x = Math.sin(t * 0.9) * 0.012;
      target.thighR.x = -Math.sin(t * 0.9) * 0.012;
    } else if (name === 'walk' || name === 'run') {
      const amp = 0.30 + spd * 0.62;
      const swing = Math.sin(p);
      const swing2 = Math.sin(p + Math.PI);
      const bob = Math.abs(Math.cos(p));
      // 腿
      target.thighL.x = swing * amp;
      target.thighR.x = swing2 * amp;
      target.shinL.x = -Math.max(0, -Math.sin(p - 0.8)) * (0.55 + spd * 0.75);
      target.shinR.x = -Math.max(0, -Math.sin(p + Math.PI - 0.8)) * (0.55 + spd * 0.75);
      target.footL.x = Math.sin(p + 1.1) * 0.30 * (1 - spd * 0.4);
      target.footR.x = Math.sin(p + Math.PI + 1.1) * 0.30 * (1 - spd * 0.4);
      // 身体上下起伏与前倾
      target.hipsY += (bob * 2 - 1) * (0.016 + spd * 0.020);
      target.spine.x = 0.06 + speedLean * 0.24;
      target.chest.x = -0.02 + speedLean * 0.05;
      target.hipsRot.y = -swing * (0.10 + spd * 0.16);
      target.chest.y = swing * (0.13 + spd * 0.20);
      target.hipsRot.z = Math.sin(p) * 0.05 * (1 - spd * 0.5);
      target.neck.y = -swing * 0.06;
      target.head.x = -speedLean * 0.16 + Math.sin(p * 2) * 0.02;
      // 手臂反向摆
      const armAmp = 0.42 + spd * 0.62;
      target.upperArmL.x = -swing * armAmp;
      target.upperArmR.x = -swing2 * armAmp;
      target.upperArmL.z = 0.16 + spd * 0.06;
      target.upperArmR.z = -0.16 - spd * 0.06;
      target.foreArmL.x = -(0.30 + spd * 0.72) - Math.max(0, -swing) * 0.45;
      target.foreArmR.x = -(0.30 + spd * 0.72) - Math.max(0, -swing2) * 0.45;
      target.foreArmL.z = -0.12 - spd * 0.10;
      target.foreArmR.z = 0.12 + spd * 0.10;
    } else if (name === 'jump' || name === 'fall' || name === 'doubleJump') {
      const rising = name !== 'fall';
      target.thighL.x = rising ? -0.62 : -0.22;
      target.thighR.x = rising ? -0.30 : 0.34;
      target.shinL.x = rising ? 0.95 : 0.42;
      target.shinR.x = rising ? 0.35 : 0.62;
      target.footL.x = rising ? -0.35 : 0.22;
      target.footR.x = rising ? -0.20 : 0.30;
      target.spine.x = rising ? -0.10 : 0.10;
      target.chest.x = -0.06;
      target.upperArmL.x = rising ? -1.05 : 0.55;
      target.upperArmR.x = rising ? -1.05 : 0.55;
      target.upperArmL.z = 0.55;
      target.upperArmR.z = -0.55;
      target.foreArmL.x = -0.55;
      target.foreArmR.x = -0.55;
      target.head.x = rising ? -0.18 : 0.12;
      if (name === 'doubleJump') {
        target.hipsRot.y = state.spinT * Math.PI * 2;
        target.upperArmL.z = 1.25;
        target.upperArmR.z = -1.25;
        target.thighL.x = -0.85; target.thighR.x = -0.85;
        target.shinL.x = 1.15; target.shinR.x = 1.15;
      }
    } else if (name === 'land') {
      const k = Math.max(0, state.landSquash);
      target.hipsY -= k * 0.14;
      target.thighL.x = -k * 0.85; target.thighR.x = -k * 0.85;
      target.shinL.x = k * 1.45; target.shinR.x = k * 1.45;
      target.footL.x = -k * 0.55; target.footR.x = -k * 0.55;
      target.spine.x = k * 0.30;
      target.upperArmL.x = 0.35 * k; target.upperArmR.x = 0.35 * k;
      target.upperArmL.z = 0.42 * k + 0.14; target.upperArmR.z = -0.42 * k - 0.14;
      target.foreArmL.x = -0.7 * k; target.foreArmR.x = -0.7 * k;
      target.head.x = k * 0.2;
    } else if (name === 'spin') {
      const k = 1 - state.spinT;
      target.hipsRot.y = state.spinT * Math.PI * 4;
      target.spine.x = 0.35 * k;
      target.upperArmL.x = -0.2; target.upperArmR.x = -0.2;
      target.upperArmL.z = 1.35 * k + 0.14; target.upperArmR.z = -1.35 * k - 0.14;
      target.foreArmL.x = -0.25; target.foreArmR.x = -0.25;
      target.thighL.x = -0.25; target.thighR.x = 0.30;
      target.shinL.x = 0.55; target.shinR.x = 0.75;
      target.head.x = -0.2; target.head.y = 0.3 * k;
    } else if (name === 'hurt') {
      const k = THREE.MathUtils.clamp(state.hurtT, 0, 1);
      target.spine.x = -0.45 * k;
      target.chest.x = -0.18 * k;
      target.head.x = -0.35 * k;
      target.upperArmL.x = -0.9 * k; target.upperArmR.x = -0.9 * k;
      target.upperArmL.z = 0.6 * k + 0.14; target.upperArmR.z = -0.6 * k - 0.14;
      target.foreArmL.x = -0.9 * k; target.foreArmR.x = -0.9 * k;
      target.thighL.x = 0.25 * k; target.thighR.x = -0.30 * k;
      target.shinL.x = 0.55 * k; target.shinR.x = 0.45 * k;
      if (k > 0.05) target.hipsRot.y = Math.sin(state.time * 30) * 0.06 * k;
    } else if (name === 'ko') {
      const k = Math.min(1, state.koT ?? 1);
      target.hipsY -= 0.34 * k;
      target.spine.x = 1.25 * k;
      target.chest.x = 0.18 * k;
      target.neck.x = 0.35 * k;
      target.head.x = 0.30 * k;
      target.upperArmL.x = -0.4 * k; target.upperArmR.x = -0.55 * k;
      target.upperArmL.z = 0.9 * k + 0.14; target.upperArmR.z = -0.75 * k - 0.14;
      target.foreArmL.x = -0.3 * k; target.foreArmR.x = -0.5 * k;
      target.thighL.x = -1.1 * k; target.thighR.x = -0.9 * k;
      target.shinL.x = 1.5 * k; target.shinR.x = 1.2 * k;
    } else if (name === 'win' || name === 'cheer') {
      const b = Math.abs(Math.sin(t * 5.2));
      target.hipsY += b * 0.055;
      target.spine.x = -0.10;
      target.chest.x = -0.05;
      target.head.x = -0.22 + Math.sin(t * 5.2) * 0.05;
      target.upperArmL.x = -2.35 - Math.sin(t * 5.2) * 0.2;
      target.upperArmR.x = -2.35 - Math.sin(t * 5.2 + 0.5) * 0.2;
      target.upperArmL.z = 0.75; target.upperArmR.z = -0.75;
      target.foreArmL.x = -0.45 + Math.sin(t * 5.2) * 0.25;
      target.foreArmR.x = -0.45 + Math.sin(t * 5.2 + 0.6) * 0.25;
      target.foreArmL.z = -0.35; target.foreArmR.z = 0.35;
      target.thighL.x = -0.12 * b; target.thighR.x = -0.12 * b;
      target.shinL.x = 0.25 * b; target.shinR.x = 0.25 * b;
    } else if (name === 'pose') {
      // 展示姿态：单手叉腰 + 另一手举起打招呼
      target.hipsRot.z = 0.06;
      target.spine.z = -0.04;
      target.chest.z = 0.03;
      target.head.z = -0.10;
      target.head.y = Math.sin(t * 0.8) * 0.14;
      target.upperArmR.x = -2.5 + Math.sin(t * 2.4) * 0.12;
      target.upperArmR.z = -0.55;
      target.foreArmR.x = -0.3;
      target.foreArmR.z = 0.5 + Math.sin(t * 2.4) * 0.3;
      target.upperArmL.x = 0.15;
      target.upperArmL.z = 0.95;
      target.foreArmL.x = -1.25;
      target.foreArmL.z = -0.55;
      target.thighL.x = -0.10; target.thighR.x = 0.06;
      target.shinR.x = 0.22;
      target.hipsY += Math.sin(t * 1.9) * 0.006;
    } else if (name === 'sit') {
      target.hipsY -= 0.30;
      target.spine.x = 0.22;
      target.thighL.x = -1.45; target.thighR.x = -1.35;
      target.shinL.x = 1.55; target.shinR.x = 1.40;
      target.footL.x = 0.2; target.footR.x = 0.25;
      target.upperArmL.x = 0.5; target.upperArmR.x = 0.45;
      target.upperArmL.z = 0.35; target.upperArmR.z = -0.35;
      target.foreArmL.x = -0.9; target.foreArmR.x = -0.85;
      target.head.x = -0.05 + Math.sin(t * 1.3) * 0.05;
    }
  }

  const smoothRate = 14;

  function applyPose() {
    hips.position.y = pose.hipsY;
    hips.rotation.set(pose.hipsRot.x, pose.hipsRot.y, pose.hipsRot.z);
    spine.rotation.copy(pose.spine);
    chest.rotation.copy(pose.chest);
    neck.rotation.copy(pose.neck);
    head.rotation.copy(pose.head);
    arms.L.upper.rotation.copy(pose.upperArmL);
    arms.R.upper.rotation.copy(pose.upperArmR);
    arms.L.fore.rotation.copy(pose.foreArmL);
    arms.R.fore.rotation.copy(pose.foreArmR);
    legs.L.hipJoint.rotation.copy(pose.thighL);
    legs.R.hipJoint.rotation.copy(pose.thighR);
    legs.L.knee.rotation.copy(pose.shinL);
    legs.R.knee.rotation.copy(pose.shinR);
    legs.L.ankle.rotation.copy(pose.footL);
    legs.R.ankle.rotation.copy(pose.footR);
  }

  function updateEyeBlink(dt) {
    state.blinkIn -= dt;
    if (state.blinkIn <= 0 && state.blinkT <= 0) {
      state.blinkT = 0.14;
      state.blinkIn = 2.2 + Math.random() * 3.4;
    }
    let k = 1;
    if (state.blinkT > 0) {
      state.blinkT -= dt;
      const u = 1 - Math.abs(state.blinkT / 0.14 - 0.5) * 2; // 0->1->0
      k = 1 - u * 0.94;
    }
    if (state.name === 'ko' || state.name === 'hurt') k *= 0.35;
    eyeL.scale.y = k;
    eyeR.scale.y = k;
    eyeL.children.forEach((c, i) => { if (i >= 3 && i <= 5) c.visible = k > 0.55; });
    eyeR.children.forEach((c, i) => { if (i >= 3 && i <= 5) c.visible = k > 0.55; });
  }

  const _worldPos = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  function update(dt, s = {}) {
    dt = Math.min(dt, 0.05);
    state.time += dt;

    if (s.state && s.state !== state.name) {
      if (s.state === 'spin') state.spinT = 0;
      if (s.state === 'hurt') state.hurtT = 1;
      if (s.state === 'land') state.landSquash = 1;
      if (s.state === 'ko') state.koT = 0;
      state.name = s.state;
    }
    state.speed01 = s.speed01 ?? state.speed01;
    if (state.name === 'ko') state.koT = Math.min(1, (state.koT ?? 0) + dt * 2.6);
    if (state.name === 'spin') state.spinT = Math.min(1, state.spinT + dt * 2.4);
    if (state.name === 'hurt') state.hurtT = Math.max(0, state.hurtT - dt * 3.2);
    if (state.name === 'land') state.landSquash = Math.max(0, state.landSquash - dt * 5.0);

    // 步态相位随速度推进
    if (state.name === 'walk' || state.name === 'run') {
      const freq = THREE.MathUtils.lerp(6.0, 11.0, state.speed01);
      state.phase += dt * freq;
    } else {
      state.phase += dt * 2.0;
    }

    buildTarget(s, dt);

    // 指数平滑，状态切换不突兀
    const k = 1 - Math.exp(-smoothRate * dt);
    for (const key of keys) {
      if (key === 'hipsY') { pose.hipsY += (target.hipsY - pose.hipsY) * k; continue; }
      pose[key].x += (target[key].x - pose[key].x) * k;
      pose[key].y += (target[key].y - pose[key].y) * k;
      pose[key].z += (target[key].z - pose[key].z) * k;
    }
    applyPose();
    updateEyeBlink(dt);

    // ---- 头发物理：根据角色实际位移产生滞后摆动 ----
    root.getWorldPosition(_worldPos);
    if (dt > 0) {
      const vx = (_worldPos.x - state.lastPos.x) / dt;
      const vz = (_worldPos.z - state.lastPos.z) / dt;
      root.getWorldQuaternion(_q);
      const inv = _q.clone().invert();
      const local = new THREE.Vector3(vx, 0, vz).applyQuaternion(inv);
      state.velLocal.lerp(local, Math.min(1, dt * 8));
    }
    state.lastPos.copy(_worldPos);
    const bobT = state.name === 'run' || state.name === 'walk' ? Math.sin(state.phase * 2) * 0.06 : 0;
    state.tailVel += ((state.velLocal.z * -0.045) + bobT * 0.5 - state.tailVel) * Math.min(1, dt * 10);
    state.tailRot = state.tailVel;
    const lateral = THREE.MathUtils.clamp(state.velLocal.x * 0.05, -0.5, 0.5);
    const bob2 = state.name === 'idle' ? Math.sin(state.time * 1.9) * 0.012 : 0;

    tails.forEach(({ segs, sign, base }) => {
      base.rotation.z = -sign * 0.42 + sign * lateral * 0.5;
      base.rotation.x = -0.22 + state.tailRot * 0.5 + bob2;
      segs.forEach((seg, i) => {
        const amp = 0.10 + i * 0.048;
        const sway = Math.sin(state.time * 3.0 + i * 0.7) * 0.02 * (state.name === 'idle' ? 1.6 : 0.6);
        seg.rotation.x = state.tailRot * amp * 1.6 + sway + (state.name === 'run' ? -0.05 - i * 0.012 : 0);
        seg.rotation.z = -sign * lateral * amp * 1.1 + Math.sin(state.time * 2.2 + i * 0.5) * 0.015;
        seg.rotation.y = Math.sin(state.time * 1.5 + i) * 0.02;
      });
    });
    // 呆毛弹动
    state.ahoge += ((-state.velLocal.z * 0.03 + bob2 * 2 - 4 * state.ahoge)) * Math.min(1, dt * 12);
    ahoge.rotation.z = -0.42 + Math.sin(state.time * 3.4) * 0.08 + state.ahoge;
    ahoge.rotation.x = 0.18 + state.tailRot * 0.35;

    // 裙子惯性摆动
    skirt.rotation.x = -state.tailRot * 0.30 + (state.name === 'run' ? 0.05 : 0);
    skirt.rotation.z = lateral * 0.4;
    skirt.scale.set(1 + Math.abs(state.tailRot) * 0.06, 1, 1 + Math.abs(state.tailRot) * 0.06);
  }

  // 供外部读取的骨架引用（用来外挂特效、UI 锚点等）
  return {
    root,
    bones: { hips, spine, chest, neck, head, arms, legs, hair, tails },
    eyes: { eyeL, eyeR },
    mouth,
    materials: mat,
    height: 1.58 * scaleAll,
    setState: (name) => {
      if (name === state.name) return;
      if (name === 'spin') state.spinT = 0;
      if (name === 'hurt') state.hurtT = 1;
      if (name === 'land') state.landSquash = 1;
      if (name === 'ko') state.koT = 0;
      state.name = name;
    },
    getState: () => state.name,
    update,
    raw: state,
  };
}
