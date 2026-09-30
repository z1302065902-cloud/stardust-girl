// ---------------------------------------------------------------------------
// girl.js — 角色装配：加载 Blender 导出的 Draco 压缩 glTF（assets/girl.glb），
//           转成卡通材质 + 反向外壳描边，驱动骨骼动画与眨眼。
//           加载失败时回退到纯代码程序化角色，接口完全一致。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const OUTLINE_WIDTH = 0.0072;

// 边缘光（Fresnel Rim）：给所有卡通材质注入一段菲涅尔项，让角色轮廓从背景里跳出来
let RIM = { color: new THREE.Color(0x9fe4ff), strength: 0.55 };
export function setRim(color, strength = 0.55) {
  RIM.color = new THREE.Color(color);
  RIM.strength = strength;
  for (const m of RIM_MATS) {
    const u = m.userData.rimUniforms;
    if (u) {
      u.uRimColor.value.copy(RIM.color);
      u.uRimStrength.value = strength;
    }
  }
}
const RIM_MATS = [];

let gradientTex = null;
function gradientMap() {
  if (gradientTex) return gradientTex;
  const data = new Uint8Array([104, 158, 212, 255]);
  gradientTex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradientTex.minFilter = THREE.NearestFilter;
  gradientTex.magFilter = THREE.NearestFilter;
  gradientTex.generateMipmaps = false;
  gradientTex.needsUpdate = true;
  return gradientTex;
}

function toonify(mesh) {
  const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const out = src.map((m) => {
    // 有贴图时用纯白乘贴图；没有贴图（如 Quaternius 的纯色模型）就保留原材质颜色，
    // 否则整个角色会变成一片白。
    const base = m.map
      ? new THREE.Color(0xffffff)
      : (m.color ? m.color.clone() : new THREE.Color(0xffffff));
    // 透明/双面必须原样保留：VRoid 的头发、睫毛、眼高光是 alpha 贴图片，
    // 一律按不透明渲染会糊成实心板。
    const alphaTest = m.alphaTest || (m.transparent && m.opacity >= 0.99 ? 0.35 : 0);
    const tm = new THREE.MeshToonMaterial({
      color: base,
      gradientMap: gradientMap(),
      map: m.map || null,
      side: (m.side !== undefined && m.side !== null) ? m.side
        : (/\bNavy\b/i.test(m.name || '') ? THREE.DoubleSide : THREE.FrontSide),
      transparent: !!m.transparent && alphaTest === 0,
      alphaTest,
      depthWrite: alphaTest > 0 ? true : (m.depthWrite !== false),
      vertexColors: !!m.vertexColors,
    });
    tm.name = m.name || '';
    tm.emissive = new THREE.Color(0x000000);
    tm.emissiveMap = tm.map;
    tm.emissiveIntensity = 0;
    return tm;
  });
  mesh.material = Array.isArray(mesh.material) ? out : out[0];
}

/** 反向外壳描边（蒙皮网格：把法线位移注入标准顶点着色器，随骨骼一起变形） */
function addOutline(mesh) {
  const o = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, null) : new THREE.Mesh(mesh.geometry, null);
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
    const om = new THREE.MeshBasicMaterial({ color: 0x3b2740, side: THREE.BackSide });
    om.onBeforeCompile = (shader) => {
      shader.uniforms.uWidth = { value: OUTLINE_WIDTH };
      shader.vertexShader = 'uniform float uWidth;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\ttransformed += objectNormal * uWidth;',
      );
    };
    om.name = (m.name || '') + '_outline';
    return om;
  });
  o.material = Array.isArray(mesh.material) ? mats : mats[0];
  if (mesh.isSkinnedMesh) {
    o.bindMode = mesh.bindMode;
    o.bind(mesh.skeleton, mesh.bindMatrix);
  }
  o.frustumCulled = false;
  o.castShadow = false;
  o.receiveShadow = false;
  o.renderOrder = -1;
  o.name = `${mesh.name}_outline`;
  return o;
}

/** 菲涅尔边缘发光外壳：稍微外扩 + 加色混合，让角色轮廓从任何背景里跳出来 */
function addRimShell(mesh) {
  const o = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, null) : new THREE.Mesh(mesh.geometry, null);
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((src) => {
    const m = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.FrontSide, fog: false,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: RIM.color.clone() };
      shader.uniforms.uRimStrength = { value: RIM.strength };
      shader.uniforms.uRimPower = { value: 3.0 };
      shader.uniforms.uExpand = { value: 0.006 };
      shader.vertexShader = 'uniform float uExpand;\nvarying vec3 vRimN;\nvarying vec3 vRimV;\n' +
        shader.vertexShader
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += objectNormal * uExpand;')
          .replace('#include <project_vertex>',
            '#include <project_vertex>\n\tvRimN = normalize(normalMatrix * objectNormal);\n\tvRimV = -mvPosition.xyz;');
      shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\n' +
        'varying vec3 vRimN;\nvarying vec3 vRimV;\n' +
        'void main() {\n' +
        '  float f = pow(1.0 - clamp(dot(normalize(vRimN), normalize(vRimV)), 0.0, 1.0), uRimPower);\n' +
        '  gl_FragColor = vec4(uRimColor, f * uRimStrength);\n' +
        '}';
      m.userData.rimUniforms = shader.uniforms;
    };
    m.name = (src.name || '') + '_rim';
    return m;
  });
  o.material = Array.isArray(mesh.material) ? mats : mats[0];
  if (mesh.isSkinnedMesh) {
    o.bindMode = mesh.bindMode;
    o.bind(mesh.skeleton, mesh.bindMatrix);
  }
  o.frustumCulled = false;
  o.castShadow = false;
  o.renderOrder = 2;
  o.name = `${mesh.name}_rim`;
  mats.forEach((m) => RIM_MATS.push(m));
  return o;
}

const CLIP_ALIAS = {
  idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', fall: 'Fall',
  spin: 'Spin', hurt: 'Hurt', win: 'Win', pose: 'Pose',
  doubleJump: 'Spin', land: 'Jump',
};

/**
 * 蒙皮网格的 Box3 是「绑定空间的几何包围盒 × 节点矩阵」，没有经过骨骼，
 * 往往和实际渲染出来的大小差几个数量级（会把角色缩成一个点）。
 * 这里改用骨骼实际位置量：头骨到脚骨的世界距离，再补一点头顶/脚底。
 */
function skeletonHeight(root) {
  let head = null, foot = null;
  root.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase();
    // 兼容多种骨架命名：UE 风格(root/pelvis/Head/Foot_l)、GameRig(Foot.L)、VRoid(J_Bip_C_Head/J_Bip_L_Foot)
    if (!head && (/head/.test(n) && !/headwear|headgear/.test(n))) head = o;
    if (!foot && (/foot/.test(n) || /toebase|ball$/.test(n))) foot = o;
  });
  if (!head || !foot) return null;
  root.updateMatrixWorld(true);
  const a = head.getWorldPosition(new THREE.Vector3());
  const b = foot.getWorldPosition(new THREE.Vector3());
  const d = a.y - b.y;
  return d > 0.05 ? d * 1.18 : null;
}

/**
 * 量出模型自身的前向（水平面投影）。
 * 优先用「脚踝→脚趾」向量（最可靠），没有脚趾骨就退回脚骨自身的 Y 轴。
 * 不同素材朝向完全不一样：Blender +Y 前向的模型导出后在 three.js 里是 -Z，
 * 直接放进游戏就会倒着走 —— 必须按量出来的朝向修正。
 */
function measureForward(root) {
  let foot = null, toe = null;
  root.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase();
    if (!foot && /foot/.test(n) && !/toe/.test(n)) foot = o;
    if (!toe && /toebase|_toe|toe$/.test(n)) toe = o;
  });
  if (!foot) return null;
  root.updateMatrixWorld(true);
  const rq = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  if (toe) {
    const a = foot.getWorldPosition(new THREE.Vector3());
    const b = toe.getWorldPosition(new THREE.Vector3());
    const d = b.sub(a);
    d.y = 0;
    d.applyQuaternion(rq);
    if (d.lengthSq() > 1e-6) return d.normalize();
  }
  const q = foot.getWorldQuaternion(new THREE.Quaternion());
  const d = new THREE.Vector3(0, 1, 0).applyQuaternion(q).applyQuaternion(rq);
  d.y = 0;
  return d.lengthSq() > 1e-6 ? d.normalize() : null;
}

export async function loadGirl({
  onProgress,
  url = './assets/girl.glb',
  targetHeight = 1.62,     // 统一到游戏的 1.62m 身高，碰撞胶囊才不用改
  outline = true,          // 低多边形外部模型（硬边法线）不画描边，接缝会裂
  nativeHeight = null,     // 已知模型原始身高（Blender 里量过就直接给，省一次猜测）
  tag = 'anime',
} = {}) {
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('./vendor/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(url, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    });

    const root = gltf.scene;
    root.name = 'girlGLB';

    const skinned = [];
    let faceMat = null;
    root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        toonify(o);
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
        if ((o.material.name || '').match(/face/i)) faceMat = o.material;
        if (o.isSkinnedMesh) skinned.push(o);
      }
    });
    if (outline) {
      skinned.forEach((m) => {
        m.parent.add(addOutline(m));
        m.parent.add(addRimShell(m));
      });
    } else {
      skinned.forEach((m) => m.parent.add(addRimShell(m)));
    }

    // 外部模型尺寸不一，统一缩放到游戏身高。
    // 蒙皮网格的 Box3 不可信，优先用骨骼量出来的实际高度。
    const skelH = skeletonHeight(root);
    const boxH = (() => {
      const b = new THREE.Box3().setFromObject(root);
      return b.max.y - b.min.y;
    })();
    const nativeH = nativeHeight || skelH || boxH || targetHeight;
    const fit = targetHeight / nativeH;
    if (Math.abs(fit - 1) > 0.02) root.scale.multiplyScalar(fit);
    console.info(`[girl] 量得身高 骨骼=${skelH ? skelH.toFixed(3) : 'n/a'} 包围盒=${boxH.toFixed(3)} → 采用 ${nativeH.toFixed(3)}，缩放 ${fit.toFixed(3)}`);

    // ---- 朝向修正：把模型自身的前向对到游戏约定的 +Z ----
    // 游戏的移动/转向逻辑都假定「角色面朝 +Z」，而不同素材的朝向完全不同
    // （Blender +Y 前向的模型导出后在 three.js 里是 -Z），不修正就会倒着走。
    const fwd = measureForward(root);
    let yawFix = 0;
    if (fwd) {
      yawFix = Math.atan2(fwd.x, fwd.z);
      root.rotation.y -= yawFix;
      console.info(`[girl] 原生前向 (${fwd.x.toFixed(2)}, ${fwd.z.toFixed(2)}) → 朝向修正 ${(-yawFix * 180 / Math.PI).toFixed(1)}°`);
    }
    // 外层 holder：游戏只旋转/移动它，内层保留素材自身的朝向修正
    const holder = new THREE.Group();
    holder.name = 'girlRoot';
    holder.add(root);

    const mixer = new THREE.AnimationMixer(holder);
    const actions = {};
    for (const clip of gltf.animations) {
      const key = Object.keys(CLIP_ALIAS).find((k) => CLIP_ALIAS[k] === clip.name) || clip.name.toLowerCase();
      const a = mixer.clipAction(clip);
      const once = ['Jump', 'Spin', 'Hurt'].includes(clip.name);
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
      a.clampWhenFinished = true;
      actions[key] = a;
      actions[clip.name.toLowerCase()] = a;
    }

    let current = null;
    function setState(name) {
      const target = actions[name] || actions[CLIP_ALIAS[name]] || actions.idle;
      if (!target || target === current) return;
      target.reset();
      target.enabled = true;
      target.setEffectiveWeight(1);
      target.fadeIn(0.16);
      target.play();
      if (current) current.fadeOut(0.16);
      current = target;
    }

    const box = new THREE.Box3().setFromObject(holder);
    const height = box.max.y - box.min.y || 1.6;

    // ---- 眨眼：脸部贴图上下两帧切换 ----
    let blinkIn = 1.5 + Math.random() * 3;
    let blinkT = 0;
    function updateBlink(dt) {
      if (!faceMat || !faceMat.map) return;
      blinkIn -= dt;
      if (blinkIn <= 0 && blinkT <= 0) {
        blinkT = 0.13;
        blinkIn = 2.4 + Math.random() * 3.6;
      }
      if (blinkT > 0) {
        blinkT -= dt;
        faceMat.map.offset.y = -0.5;
      } else {
        faceMat.map.offset.y = 0;
      }
    }

    return {
      root: holder,
      inner: root,
      source: 'glb',
      tag,
      url,
      yawFix,
      actions,
      height,
      clips: gltf.animations.map((c) => c.name),
      setState,
      update(dt, s = {}) {
        if (s.state) setState(s.state);
        if (current && (s.state === 'walk' || s.state === 'run')) {
          current.setEffectiveTimeScale(0.8 + (s.speed01 ?? 0) * 0.75);
        }
        mixer.update(dt);
        updateBlink(dt);
      },
    };
  } catch (err) {
    console.warn('[girl] glTF 加载失败，回退程序化角色:', err && err.message);
    (window.__errors = window.__errors || []).push('glb: ' + (err && (err.stack || err.message) || err));
    const { createAnimeGirl } = await import('./character.js');
    const g = createAnimeGirl();
    return {
      root: g.root, source: 'procedural', height: g.height,
      setState: g.setState,
      update: (dt, s = {}) => g.update(dt, s),
    };
  }
}
