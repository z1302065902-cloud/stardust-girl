// ---------------------------------------------------------------------------
// props.js — 免费 CC0 3D 资源的加载与批量实例化
//
// 素材来源：Kenney.nl「Nature Kit」（CC0 / 公共领域，无需署名）
//   经 https://github.com/shorepine/kenney 的 glTF-binary 镜像取单个模型，
//   只抽取本项目实际用到的 31 个（共 332 KB），没有整包塞进游戏目录。
//
// Kenney 的模型特点：纯色材质、每个模型 2~6 个 primitive、没有贴图。
// 所以这里把每个 primitive 的扁平基色烘成顶点色后合并成一个几何体，
// 这样每种道具只要 1 个 InstancedMesh（1 个 draw call）就能画上百个。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();
const registry = new Map();          // name -> { geometry, height, size, baseY }

let GRADIENT = null;
let MAT = null;
function gradientMap() {
  if (GRADIENT) return GRADIENT;
  const data = new Uint8Array([96, 152, 208, 255]);   // 4 阶卡通色阶，与角色一致
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  GRADIENT = tex;
  return tex;
}

function propMaterial() {
  if (!MAT) {
    MAT = new THREE.MeshToonMaterial({
      color: 0xffffff,
      vertexColors: true,
      gradientMap: gradientMap(),
    });
  }
  return MAT;
}

/** 加载指定的道具模型（幂等，重复调用只加载缺失的） */
export async function loadProps(names, base = 'assets/props/') {
  const failed = [];
  await Promise.all(names.map(async (name) => {
    if (registry.has(name)) return;
    try {
      const gltf = await loader.loadAsync(`${base}${name}.glb`);
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        let g = o.geometry.clone();
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const c = (mat && mat.color) ? mat.color : new THREE.Color(1, 1, 1);
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        for (const k of ['uv', 'uv1', 'uv2', 'tangent']) if (g.attributes[k]) g.deleteAttribute(k);
        if (g.index) g = g.toNonIndexed();
        g.applyMatrix4(o.matrixWorld);
        parts.push(g);
      });
      if (!parts.length) throw new Error('没有可用的 mesh');
      const geometry = mergeGeometries(parts, false);
      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox.getSize(size);
      registry.set(name, {
        geometry,
        size,
        height: size.y,
        baseY: geometry.boundingBox.min.y,   // 让道具正好站在地面上
      });
    } catch (e) {
      failed.push(`${name} (${String(e.message || e).slice(0, 42)})`);
    }
  }));
  if (failed.length) console.warn('[props] 加载失败：', failed);
  return registry.size;
}

export function hasProp(name) { return registry.has(name); }
export function propNames() { return [...registry.keys()]; }

/** 取道具几何体（已合并、带顶点色）。用于需要单独 Mesh 的场合（会自转的收集物等） */
export function propGeometry(name) {
  const r = registry.get(name);
  return r ? r.geometry : null;
}

export function propSize(name) {
  const r = registry.get(name);
  return r ? r.size : null;
}

/** 把模型缩放到目标高度所需的缩放系数 */
export function propFitScale(name, targetHeight) {
  const r = registry.get(name);
  if (!r || !r.size.y) return 1;
  return targetHeight / r.size.y;
}

/** 某道具缩放后离地高度，用于把道具底面贴到平台面上 */
export function propBaseY(name, scale) {
  const r = registry.get(name);
  return r ? r.baseY * scale : 0;
}

// ---------------------------------------------------------------------------
// 散布器：收集 (模型, 位置, 缩放, 色调) 后一次性建 InstancedMesh
// ---------------------------------------------------------------------------
export class PropScatter {
  constructor() { this.buckets = new Map(); this.total = 0; }

  add(name, x, y, z, scale = 1, rotY = null, tint = null) {
    if (!registry.has(name)) return false;
    const item = [
      x, y, z, scale,
      rotY === null ? Math.random() * Math.PI * 2 : rotY,
      tint,
      0,                                   // anchor 0 = 底面贴在 y
    ];
    if (!this.buckets.has(name)) this.buckets.set(name, []);
    this.buckets.get(name).push(item);
    this.total++;
    return true;
  }

  /** 按目标宽度自适应缩放（底面贴地），用于云这类尺寸不一的模型 */
  addFit(name, x, y, z, width, rotY = null, tint = null) {
    const rec = registry.get(name);
    if (!rec) return false;
    const s = width / Math.max(rec.size.x, rec.size.z);
    return this.add(name, x, y, z, s, rotY, tint);
  }

  /** 按目标宽度自适应缩放，并把模型顶面对齐到 y（用于平台这类「顶面朝上」的模型） */
  addTop(name, x, y, z, width, rotY = null, tint = null) {
    const rec = registry.get(name);
    if (!rec) return false;
    const s = width / Math.max(rec.size.x, rec.size.z);
    const item = [
      x, y, z, s,
      rotY === null ? Math.random() * Math.PI * 2 : rotY,
      tint,
      1,                                   // anchor 1 = 顶面对齐到 y
    ];
    if (!this.buckets.has(name)) this.buckets.set(name, []);
    this.buckets.get(name).push(item);
    this.total++;
    return true;
  }

  /** 建实例网格并挂到 group；drawCalls 返回实际产生的 draw call 数 */
  build(group, { castShadow = true, receiveShadow = true, material = null } = {}) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    let drawCalls = 0;

    for (const [name, list] of this.buckets) {
      const rec = registry.get(name);
      if (!rec) continue;
      const mesh = new THREE.InstancedMesh(rec.geometry, material || propMaterial(), list.length);
      mesh.name = 'props:' + name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      let tinted = false;
      for (let i = 0; i < list.length; i++) {
        const [x, y, z, s, ry, tint, anchor] = list[i];
        const yOff = anchor ? rec.size.y * s : 0;     // anchor=1：模型顶面对齐到 y
        pos.set(x, y - yOff - rec.baseY * s, z);
        q.setFromAxisAngle(up, ry);
        scl.set(s, s, s);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(i, m4);
        if (tint) { col.set(tint); mesh.setColorAt(i, col); tinted = true; }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      drawCalls++;
    }
    return drawCalls;
  }

  dispose() { this.buckets.clear(); this.total = 0; }
}
