// ---------------------------------------------------------------------------
// world.js — 三个关卡的程序化生成：浮空岛、平台、水晶、敌人、装饰、天空
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from './character.js';
import { PropScatter, loadProps, propGeometry, propFitScale } from './props.js';

// 本作用到的免费 CC0 素材（Kenney Nature Kit，公共领域）
export const PROP_MODELS = [
  'tree_default', 'tree_pineRoundA', 'tree_oak', 'tree_fat', 'tree_cone', 'tree_detailed', 'tree_blocks', 'tree_palm',
  'rock_largeA', 'rock_largeC', 'rock_smallA', 'rock_smallFlatB', 'rock_tallA',
  'stone_largeA', 'stone_tallA', 'stone_tallB', 'cliff_block_rock', 'cliff_block_stone',
  'plant_bushDetailed', 'plant_bushLarge', 'plant_flatTall',
  'grass', 'grass_large', 'grass_leafs',
  'flower_purpleA', 'flower_redA', 'flower_yellowA',
  'mushroom_red', 'mushroom_tan', 'stump_round', 'log',
  // Quaternius（同为 CC0）：浮空岩石平台、云、水晶、金币星、旗子
  'RockPlatforms_1', 'RockPlatforms_2', 'RockPlatforms_3', 'RockPlatforms_Large', 'RockPlatforms_Medium',
  'RockPlatform_Tall', 'Cloud_1', 'Cloud_2', 'Cloud_3',
  'Crystal1', 'Crystal2', 'Crystal3', 'Crystal5', 'StarGold', 'Goal_Flag', 'Tree',
];

// 每关用不同的岩石平台 / 水晶外观
const ROCK_MODELS = [
  ['RockPlatforms_1', 'RockPlatforms_2', 'RockPlatforms_Large'],
  ['RockPlatforms_3', 'RockPlatform_Tall', 'RockPlatforms_Medium'],
  ['RockPlatforms_Large', 'RockPlatforms_1', 'RockPlatform_Tall'],
];
const CRYSTAL_MODELS = ['Crystal3', 'Crystal1', 'Crystal5'];
const CLOUD_MODELS = ['Cloud_1', 'Cloud_2', 'Cloud_3'];

export const preloadProps = () => loadProps(PROP_MODELS);

// 确定性随机（同一关卡每次生成一致）
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 生成径向渐变光晕贴图（Sprite 没贴图就会渲染成一个方块）
let GLOW_TEX = null;
function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.24)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  GLOW_TEX = new THREE.CanvasTexture(c);
  GLOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return GLOW_TEX;
}

const _cache = { geo: {}, mat: {} };
function cached(kind, key, make) {
  const bucket = _cache[kind];
  if (!bucket[key]) bucket[key] = make();
  return bucket[key];
}

export const THEMES = [
  {
    name: '云海花园',
    sub: '微风与花海中的试炼',
    sky: 0x9db8ff, skyTop: 0x6a6fe0, fog: [0xa9c0ff, 60, 190],
    sun: { color: 0xfff4e2, intensity: 2.5, pos: [16, 24, 14] },
    hemi: { sky: 0xd6ecff, ground: 0x94d69d, intensity: 1.5 },
    rock: 0x63ae9c, top: 0x79d9b4, grass: true,
    crystalColor: 0x6fe3ff, accent: 0xffb3d9,
  },
  {
    name: '黄昏遗迹',
    sub: '断柱之上，夕阳将落',
    sky: 0xffa86a, skyTop: 0x7a4fa0, fog: [0xefa070, 55, 180],
    sun: { color: 0xffd0a0, intensity: 2.6, pos: [-18, 16, 10] },
    hemi: { sky: 0xffd9b0, ground: 0xa1705c, intensity: 1.3 },
    rock: 0xb87a5c, top: 0xdfa06d, grass: false,
    crystalColor: 0xffd166, accent: 0xff8f5e,
  },
  {
    name: '星夜之巅',
    sub: '在星空尽头追上彗星',
    sky: 0x1b2145, skyTop: 0x05070f, fog: [0x141a38, 50, 170],
    sun: { color: 0xa9c4ff, intensity: 1.7, pos: [12, 26, -14] },
    hemi: { sky: 0x4a5a9c, ground: 0x1a1f3a, intensity: 1.1 },
    rock: 0x3b4570, top: 0x5a68a8, grass: false,
    crystalColor: 0xa7f5ff, accent: 0x9b7bff,
  },
];

// ---------------------------------------------------------------------------
function discPlatform(theme, { x, y, z, r, h = 0.9 }, group) {
  const rock = cached('mat', 'rock' + theme.rock, () => toon(theme.rock, {}));
  const top = cached('mat', 'top' + theme.top, () => toon(theme.top, {}));
  const geo = cached('geo', 'cyl', () => new THREE.CylinderGeometry(1, 1, 1, 26, 1));
  const bottom = new THREE.Mesh(geo, rock);
  bottom.scale.set(r, h * 2.2, r);
  bottom.position.set(x, y - h * 1.6, z);
  bottom.castShadow = true;
  bottom.receiveShadow = true;
  group.add(bottom);

  const cap = new THREE.Mesh(cached('geo', 'cylTop', () => new THREE.CylinderGeometry(1, 1, 1, 26, 1)), top);
  cap.scale.set(r * 1.005, h, r * 1.005);
  cap.position.set(x, y - h * 0.5, z);
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);
  return { mesh: cap, collider: { type: 'cyl', x, z, r, top: y, bottom: y - h * 6 } };
}

function boxPlatform(theme, { x, y, z, w, d, h = 0.9 }, group) {
  const rock = cached('mat', 'rock' + theme.rock, () => toon(theme.rock, {}));
  const top = cached('mat', 'top' + theme.top, () => toon(theme.top, {}));
  const geo = cached('geo', 'box', () => new THREE.BoxGeometry(1, 1, 1));
  const body = new THREE.Mesh(geo, rock);
  body.scale.set(w, h * 2.4, d);
  body.position.set(x, y - h * 1.7, z);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  const cap = new THREE.Mesh(geo, top);
  cap.scale.set(w * 1.02, h, d * 1.02);
  cap.position.set(x, y - h * 0.5, z);
  cap.castShadow = true; cap.receiveShadow = true;
  group.add(cap);
  return { mesh: cap, collider: { type: 'box', x, y: y - h / 2, z, hw: w / 2, hh: h / 2, hd: d / 2, top: y } };
}

/**
 * 岩石拼接的浮空岛：顶面仍是一块平整圆台（碰撞体也是圆柱，视觉与碰撞一致、
 * 走位稳定），岛体与底部倒锥用免费 CC0 岩石平台模型一圈圈拼出来。
 */
function rockyIsland(theme, { x, y, z, r, h = 1.0 }, group, decor, rng, rockModels, tint, pick) {
  const top = cached('mat', 'top' + theme.top, () => toon(theme.top, {}));
  const cap = new THREE.Mesh(cached('geo', 'cylTop', () => new THREE.CylinderGeometry(1, 1, 1, 26, 1)), top);
  cap.scale.set(r * 1.005, h, r * 1.005);
  cap.position.set(x, y - h * 0.5, z);
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);

  // 岛身：外圈两圈岩石，宽度不一、略微错位，拼出自然的岩石感
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.16;
    const rr = r * (0.80 + rng() * 0.22);
    const w = r * (0.40 + rng() * 0.34);
    const yy = y - h * (0.30 + rng() * 1.5);
    decor.addTop(pick(rockModels), x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, w, a + rng() * 0.6, tint);
  }
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const rr = r * (0.30 + rng() * 0.45);
    const w = r * (0.36 + rng() * 0.32);
    const yy = y - h * (1.5 + rng() * 1.8);
    decor.addTop(pick(rockModels), x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, w, rng() * 6.28, tint);
  }
  // 底部倒锥：越往下越窄越少，浮空岛该有的剪影
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const rr = r * (0.10 + rng() * 0.30);
    const w = r * (0.26 + rng() * 0.30);
    const yy = y - h * (3.0 + rng() * 2.6);
    decor.addTop(pick(rockModels), x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, w, rng() * 6.28, tint);
  }

  return { mesh: cap, collider: { type: 'cyl', x, z, r, top: y, bottom: y - h * 10 } };
}

function makeTree(theme, x, y, z, s, group, rng) {
  const trunk = new THREE.Mesh(cached('geo', 'trunk', () => new THREE.CylinderGeometry(0.09, 0.13, 1, 8)),
    cached('mat', 'trunk', () => toon(0x8b5e42, {})));
  trunk.scale.set(s, s * 1.5, s);
  trunk.position.set(x, y + 0.75 * s, z);
  trunk.castShadow = true;
  group.add(trunk);
  const leafMat = toon(rng() > 0.5 ? 0x63c9a8 : 0x4fb694, {});
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(cached('geo', 'cone', () => new THREE.ConeGeometry(1, 1, 9)), leafMat);
    const k = 1 - i * 0.22;
    c.scale.set(1.15 * s * k, 1.3 * s * k, 1.15 * s * k);
    c.position.set(x, y + (1.4 + i * 0.75) * s, z);
    c.castShadow = true;
    group.add(c);
  }
}

function makeColumn(theme, x, y, z, s, group, rng) {
  const mat = cached('mat', 'rock' + theme.rock, () => toon(theme.rock, {}));
  const h = (2.4 + rng() * 2.6) * s;
  const col = new THREE.Mesh(cached('geo', 'cyl', () => new THREE.CylinderGeometry(1, 1, 1, 18, 1)), mat);
  col.scale.set(0.34 * s, h, 0.34 * s);
  col.position.set(x, y + h / 2, z);
  col.rotation.z = (rng() - 0.5) * 0.06;
  col.castShadow = true;
  group.add(col);
  const capB = new THREE.Mesh(cached('geo', 'box', () => new THREE.BoxGeometry(1, 1, 1)), mat);
  capB.scale.set(0.9 * s, 0.18 * s, 0.9 * s);
  capB.position.set(x, y + h + 0.08 * s, z);
  capB.castShadow = true;
  group.add(capB);
}

function makeCloud(x, y, z, s, group) {
  const mat = cached('mat', 'cloud', () => new THREE.MeshBasicMaterial({
    color: 0xf3eeff, transparent: true, opacity: 0.75, depthWrite: false, fog: false,
  }));
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(cached('geo', 'sph', () => new THREE.SphereGeometry(1, 12, 9)), mat);
    const k = 0.7 + Math.random() * 0.6;
    b.scale.set(1.5 * s * k, 0.8 * s * k, 1.2 * s * k);
    b.position.set((i - 1.5) * 1.1 * s, Math.random() * 0.35 * s, Math.random() * 0.6 * s);
    g.add(b);
  }
  g.position.set(x, y, z);
  group.add(g);
  return g;
}

function makeIceShard(theme, x, y, z, s, group) {
  const mat = cached('mat', 'ice', () => toon(0xa7f5ff, { emissive: 0x1a4a66, emissiveIntensity: 0.6 }));
  const c = new THREE.Mesh(cached('geo', 'cone', () => new THREE.ConeGeometry(1, 1, 6)), mat);
  c.scale.set(0.34 * s, 1.5 * s, 0.34 * s);
  c.position.set(x, y + 0.75 * s, z);
  c.rotation.z = (Math.random() - 0.5) * 0.4;
  c.castShadow = true;
  group.add(c);
}

function makeSky(theme) {
  const geo = new THREE.SphereGeometry(1, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      bottom: { value: new THREE.Color(theme.sky) },
    },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vPos; uniform vec3 top; uniform vec3 bottom;
      void main(){
        float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(bottom, top, pow(h, 0.9));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.scale.setScalar(320);
  sky.name = 'sky';
  const stars = new THREE.Group();
  const rng = makeRng(7);
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.95, fog: false, depthWrite: false });
  const pos = [];
  for (let i = 0; i < 700; i++) {
    const v = new THREE.Vector3(rng() * 2 - 1, rng() * 1.1 - 0.1, rng() * 2 - 1).normalize().multiplyScalar(150);
    pos.push(v.x, v.y, v.z);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  stars.add(new THREE.Points(pg, starMat));
  stars.visible = false;
  return { sky, stars };
}

// ---------------------------------------------------------------------------
// 关卡生成
// ---------------------------------------------------------------------------
export function buildLevel(index) {
  const theme = THEMES[index % THEMES.length];
  const rng = makeRng(20260929 + index * 977);
  const group = new THREE.Group();
  group.name = 'level' + index;

  const colliders = [];
  const crystals = [];
  const enemies = [];
  const movers = [];
  const props = [];

  // 装饰散布器：免费 CC0 模型统一走实例化，上百个道具只有十几个 draw call
  const decor = new PropScatter();
  const cloudScatter = new PropScatter();
  const rnd = (a, b) => a + rng() * (b - a);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const ring = (n, rIn, rOut) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const rr = rnd(rIn, rOut);
      out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return out;
  };
  const rockModels = ROCK_MODELS[index % ROCK_MODELS.length];
  const rockTint = [null, 0xffd9b8, 0xa8b8f0][index % 3];

  const { sky, stars } = makeSky(theme);
  group.add(sky);
  if (index === 2) { stars.visible = true; group.add(stars); }

  // 主岛
  const mainR = 9 - index * 0.6;
  const main = rockyIsland(theme, { x: 0, y: 0, z: 0, r: mainR, h: 1.0 }, group, decor, rng, rockModels, rockTint, pick);
  colliders.push(main.collider);

  // 螺旋上升的平台链
  const N = 14 + index * 2;
  const crystalPositions = [];
  const platformTops = [{ x: 0, y: 0, z: 0, r: mainR }];
  let prevCollider = main.collider;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const ang = 0.62 * i + index * 0.7;
    const rad = (mainR + 2.4) + i * 1.05 + rng() * 0.6;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const y = 0.9 + i * 0.62 + rng() * 0.35;
    const r = Math.max(1.35, 2.3 - i * 0.05);
    const isMover = index >= 1 && i % 5 === 3;
    const spec = { x, y, z, r, h: 0.8 };
    if (isMover) {
      // 升降平台每帧要单独移动，用程序化圆柱（实例化没法单独改某个实例的位置）
      const p = discPlatform(theme, spec, group);
      colliders.push(p.collider);
      props.push(p);
    } else {
      // 静态平台：免费 CC0 岩石平台模型，顶面对齐碰撞体顶面，宽度略大于碰撞体
      colliders.push({ type: 'cyl', x, z, r, top: y, bottom: y - 5.0 });
      decor.addTop(pick(rockModels), x, y, z, r * 2.2, rng() * 6.28, rockTint);
    }
    const col = colliders[colliders.length - 1];

    if (isMover) {
      // 上下升降平台
      const amp = 1.1 + rng() * 0.5;
      const speed = 0.5 + rng() * 0.35;
      const phase = rng() * Math.PI * 2;
      const baseY = col.top;
      const meshes = group.children.filter((m) => Math.abs(m.position.x - x) < 0.01 && Math.abs(m.position.z - z) < 0.01);
      movers.push({
        collider: col, meshes, baseY, amp, speed, phase,
        yAt(t) { return baseY + Math.sin(t * speed + phase) * amp; },
      });
    }

    crystalPositions.push(new THREE.Vector3(x, col.top + 1.05, z));
    platformTops.push({ x, y: col.top, z, r });
    prevCollider = col;
  }

  // 终点平台（最高最远）
  const endAng = 0.62 * N + index * 0.7;
  const endRad = (mainR + 2.4) + N * 1.05 + 2.0;
  const endX = Math.cos(endAng) * endRad;
  const endZ = Math.sin(endAng) * endRad;
  const endY = 0.9 + N * 0.62 + 1.4;
  const endPlat = rockyIsland(theme, { x: endX, y: endY, z: endZ, r: 4.2, h: 1.1 }, group, decor, rng, rockModels, rockTint, pick);
  colliders.push(endPlat.collider);

  // 装饰：全部使用免费 CC0 3D 素材（Kenney Nature Kit）。
  // 每种道具合并成一个 InstancedMesh —— 上百个道具也只有十几个 draw call。
  const outerIn = mainR * 0.58, outerOut = mainR * 0.99;

  if (index === 0) {
    // 云海花园：花海 + 树丛 + 石头 + 蘑菇
    const TREES = ['tree_default', 'tree_oak', 'tree_pineRoundA', 'tree_fat', 'tree_cone', 'tree_detailed'];
    for (const [x, z] of ring(13, outerIn + 1.7, outerOut)) decor.add(pick(TREES), x, 0, z, rnd(0.95, 1.5));
    for (const [x, z] of ring(48, 2.2, outerOut)) decor.add(rng() > 0.45 ? 'plant_bushDetailed' : 'plant_bushLarge', x, 0, z, rnd(0.7, 1.5));
    for (const [x, z] of ring(150, 2.3, mainR * 1.02)) decor.add(pick(['grass', 'grass_large', 'plant_flatTall']), x, 0, z, rnd(0.8, 2.0));
    for (const [x, z] of ring(80, 2.4, mainR * 1.0)) decor.add(pick(['flower_purpleA', 'flower_redA', 'flower_yellowA']), x, 0, z, rnd(0.9, 2.1));
    for (const [x, z] of ring(22, outerIn, outerOut)) decor.add(pick(['rock_smallA', 'rock_smallFlatB']), x, 0, z, rnd(0.7, 1.4));
    for (const [x, z] of ring(15, outerIn, outerOut)) decor.add(pick(['rock_largeA', 'rock_largeC']), x, 0, z, rnd(0.8, 1.5));
    for (const [x, z] of ring(14, 3.0, outerOut)) decor.add(pick(['mushroom_red', 'mushroom_tan']), x, 0, z, rnd(0.9, 1.7));
  } else if (index === 1) {
    // 黄昏遗迹：断柱、残石、枯草，整体压一层暖色
    for (const [x, z] of ring(17, outerIn + 1.2, outerOut)) decor.add(rng() > 0.5 ? 'stone_tallA' : 'stone_tallB', x, 0, z, rnd(0.9, 2.0), rng() * 6.28, 0xffd6b0);
    for (const [x, z] of ring(20, outerIn, outerOut)) decor.add(rng() > 0.5 ? 'stone_largeA' : 'rock_tallA', x, 0, z, rnd(0.8, 1.7), null, 0xf0c49c);
    for (const [x, z] of ring(9, 3.2, outerOut)) decor.add(rng() > 0.5 ? 'stump_round' : 'log', x, 0, z, rnd(0.9, 1.6), null, 0xe8c0a0);
    for (const [x, z] of ring(92, 2.6, mainR * 1.02)) decor.add(pick(['grass', 'grass_leafs']), x, 0, z, rnd(0.9, 2.2), null, 0xd9a878);
    for (const [x, z] of ring(16, 3.0, outerOut)) decor.add('mushroom_tan', x, 0, z, rnd(0.9, 1.6), null, 0xe8b898);
  } else {
    // 星夜之巅：冷色岩柱与荧光蘑菇
    for (const [x, z] of ring(22, outerIn + 1.0, outerOut)) decor.add(rng() > 0.5 ? 'rock_tallA' : 'cliff_block_rock', x, 0, z, rnd(1.0, 2.2), rng() * 6.28, 0x9fb0e8);
    for (const [x, z] of ring(15, outerIn, outerOut)) decor.add(rng() > 0.5 ? 'stone_tallA' : 'stone_tallB', x, 0, z, rnd(1.0, 2.4), null, 0xa8b8f0);
    for (const [x, z] of ring(72, 2.6, mainR * 1.02)) decor.add(pick(['grass_leafs', 'grass']), x, 0, z, rnd(0.9, 2.0), null, 0x8fa0e0);
    for (const [x, z] of ring(18, 3.0, outerOut)) decor.add('mushroom_red', x, 0, z, rnd(1.0, 1.8), null, 0xb9d0ff);
    for (const [x, z] of ring(18, outerIn, outerOut)) decor.add('rock_smallA', x, 0, z, rnd(0.8, 1.6), null, 0x9aa8d8);
  }

  // 浮空平台上撒一点道具，别让它们光秃秃的
  for (let i = 1; i < platformTops.length; i++) {
    const p = platformTops[i];
    if (rng() > 0.5) continue;
    const a = rng() * Math.PI * 2, rr = rng() * Math.max(0.2, p.r - 0.7);
    const px = p.x + Math.cos(a) * rr, pz = p.z + Math.sin(a) * rr;
    if (index === 0) decor.add(pick(['plant_bushDetailed', 'flower_purpleA', 'grass_large', 'rock_smallA']), px, p.y, pz, rnd(0.9, 1.5));
    else if (index === 1) decor.add(pick(['rock_smallA', 'stone_largeA', 'grass_leafs']), px, p.y, pz, rnd(0.9, 1.5), null, 0xe8c0a0);
    else decor.add(pick(['rock_smallA', 'mushroom_red', 'grass_leafs']), px, p.y, pz, rnd(0.9, 1.5), null, 0xa8b8f0);
  }

  let decorCalls = decor.build(group, { castShadow: true, receiveShadow: true });

  // 云：CC0 云模型 + 不受光材质（受光材质在天空里会糊成一片看不出来）
  const cloudTint = [0xffffff, 0xffe0c8, 0x7f8ec8][index % 3];
  {
    // 低空云海：浮空岛脚下那层，是「云海花园」的题眼
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const rr = 12 + rng() * 54;
      cloudScatter.addFit(pick(CLOUD_MODELS), Math.cos(a) * rr, -8 - rng() * 10, Math.sin(a) * rr,
        rnd(16, 36), rng() * 6.28, cloudTint);
    }
    // 空中零散云
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2;
      const rr = 30 + rng() * 55;
      cloudScatter.addFit(pick(CLOUD_MODELS), Math.cos(a) * rr, 5 + rng() * 20, Math.sin(a) * rr,
        rnd(10, 20), rng() * 6.28, cloudTint);
    }
  }
  // 注意：必须等实例 add 完再 build（build 时桶里有什么就生成什么）
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  decorCalls += cloudScatter.build(group, { castShadow: false, receiveShadow: false, material: cloudMat });

  // 主岛上的三颗（开局就能收集，给即时反馈）
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.55;
    crystalPositions.push(new THREE.Vector3(Math.cos(a) * 5.2, 1.15, Math.sin(a) * 5.2 - 1.0));
  }

  // ---- 星屑：免费 CC0 水晶模型（每个关卡换一种外形）----
  const crystalModel = CRYSTAL_MODELS[index % CRYSTAL_MODELS.length];
  const crystalGeo = propGeometry(crystalModel) || new THREE.ConeGeometry(0.34, 0.95, 6);
  const crystalScale = propGeometry(crystalModel) ? propFitScale(crystalModel, 0.72) : 1;
  const crystalMat = new THREE.MeshToonMaterial({
    color: theme.crystalColor,
    vertexColors: !!propGeometry(crystalModel),
    gradientMap: undefined,
    emissive: theme.crystalColor, emissiveIntensity: 0.55,
  });
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: theme.crystalColor, transparent: true, opacity: 0.75, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  for (const p of crystalPositions) {
    const m = new THREE.Mesh(crystalGeo, crystalMat);
    m.scale.setScalar(crystalScale);
    m.position.copy(p);
    m.position.y -= 0.22;
    m.castShadow = true;
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(2.6);
    m.add(glow);
    group.add(m);
    crystals.push({ mesh: m, pos: p.clone(), taken: false, spin: rng() * 6.28 });
  }

  // ---- 敌人 ----
  const enemyCount = 4 + index * 3;
  for (let i = 0; i < enemyCount; i++) {
    const useHigh = i % 3 === 0 && index >= 1;
    const base = colliders[1 + Math.floor(rng() * (colliders.length - 1))];
    const cx = base.type === 'cyl' ? base.x : base.x;
    const cz = base.type === 'cyl' ? base.z : base.z;
    const cy = base.top;
    // 敌人不要生在出生点附近（开局就被撞是很糟的体验）
    let a = rng() * Math.PI * 2;
    let spread = 2.6 + rng() * 3.5;
    let ex = cx + Math.cos(a) * spread, ez = cz + Math.sin(a) * spread;
    for (let tries = 0; tries < 6 && Math.hypot(ex, ez - 3.5) < 9.5; tries++) {
      a = rng() * Math.PI * 2;
      spread = 4.5 + rng() * 4.5;
      ex = cx + Math.cos(a) * spread;
      ez = cz + Math.sin(a) * spread;
    }
    const pos = new THREE.Vector3(ex, cy + (useHigh ? 1.6 : 0.45), ez);
    if (useHigh) {
      // 空中飘浮的小幽灵
      const mat = toon(theme.accent, { emissive: theme.accent, emissiveIntensity: 0.25 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat);
      body.castShadow = true;
      const eyeGeo = new THREE.SphereGeometry(0.07, 8, 8);
      const eyeMat = toon(0x241a2b, {});
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(eyeGeo, eyeMat);
        e.position.set(s * 0.15, 0.06, 0.36);
        body.add(e);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.7, 12), mat);
      tail.position.y = -0.5; tail.rotation.x = Math.PI;
      body.add(tail);
      body.position.copy(pos);
      group.add(body);
      enemies.push({ kind: 'ghost', mesh: body, home: pos.clone(), hp: 1, r: 0.55, alive: true, phase: rng() * 6.28, speed: 1.1 + rng() * 0.5, baseY: pos.y });
    } else {
      const mat = toon(index === 2 ? 0x8f7bff : 0x6cc7a0, { emissive: 0x11202a, emissiveIntensity: 0.25 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 12), mat);
      body.scale.set(1, 0.78, 1);
      body.castShadow = true;
      const eyeGeo = new THREE.SphereGeometry(0.075, 8, 8);
      const eyeMat = toon(0x241a2b, {});
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(eyeGeo, eyeMat);
        e.position.set(s * 0.17, 0.12, 0.38);
        body.add(e);
      }
      const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 12, Math.PI), eyeMat);
      mouth.position.set(0, -0.05, 0.42); mouth.rotation.z = Math.PI;
      body.add(mouth);
      body.position.copy(pos);
      group.add(body);
      enemies.push({
        kind: 'slime', mesh: body, home: pos.clone(), hp: 1, r: 0.5, alive: true,
        phase: rng() * 6.28, speed: 1.5 + rng() * 0.8 + index * 0.25, jumpT: rng(),
        hopH: 0.55, patrolling: true,
      });
    }
  }

  // ---- 终点光环 ----
  const goalPos = new THREE.Vector3(endX, endY + 1.6, endZ);
  const goalMat = new THREE.MeshToonMaterial({ color: 0xffe066, emissive: 0xffb300, emissiveIntensity: 0.8 });
  const goal = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.16, 10, 30), goalMat);
  goal.position.copy(goalPos);
  goal.rotation.y = 0.4;
  group.add(goal);
  const goalStarGeo = propGeometry('StarGold');
  if (goalStarGeo) {
    const star = new THREE.Mesh(goalStarGeo, new THREE.MeshToonMaterial({
      color: 0xfff3cc, vertexColors: true, gradientMap: undefined,
      emissive: 0xffcc66, emissiveIntensity: 0.55,
    }));
    star.scale.setScalar(propFitScale('StarGold', 1.5));
    star.position.copy(goalPos);
    group.add(star);
    goal.userData = { star };
  }
  const goalGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe9a0, transparent: true, opacity: 0.0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  goalGlow.scale.setScalar(6);
  goalGlow.position.copy(goalPos);
  group.add(goalGlow);

  return {
    index, theme, group, colliders, crystals, enemies, movers, decorCalls,
    goal: { mesh: goal, glow: goalGlow, pos: goalPos, radius: 1.9, active: false },
    spawn: new THREE.Vector3(0, 1.6, 3.5),
    sky, stars,
  };
}

export function disposeLevel(level, scene) {
  scene.remove(level.group);
  level.group.traverse((o) => {
    if (o.isMesh) { /* 几何与材质是共享缓存的，不销毁 */ }
  });
}
