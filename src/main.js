// ---------------------------------------------------------------------------
// main.js — 星屑少女 · Stardust Girl
// 3D 收集跳跃闯关：标题 → 三关平台跳跃 → 结算，含角色鉴赏模式
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { loadGirl, setRim } from './girl.js';
import { buildLevel, THEMES, preloadProps } from './world.js';
import { Player } from './player.js';
import { CameraRig, Particles, EnemyController, LevelRun } from './gameplay.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const MAX_HEARTS = 3;

// 三套可选主角，全部免费素材，鉴赏模式里可随时切换
const GIRL_PRESETS = {
  shino: { url: './assets/shino_girl.glb', outline: false, tag: 'shino' },
  anime: { url: './assets/girl.glb', outline: true, tag: 'anime' },
  cc0: { url: './assets/quaternius_girl.glb', outline: false, nativeHeight: 1.852, tag: 'cc0' },
};
const GIRL_LABEL = {
  shino: 'VRoid 千駄ヶ谷シノ（CC0，动画来自 UAL 动画库）',
  anime: '自建动漫少女（Blender 建模 + Krita 贴图）',
  cc0: 'Quaternius CC0 女性（动画来自 UAL 动画库）',
};
const GIRL_ORDER = ['shino', 'anime', 'cc0'];

// 三点布光：主光(暖) / 补光(冷半球) / 轮廓光(主光互补色 —— 让角色边缘从背景里跳出来)
const LIGHT_RIG = [
  { key: [0xfff3e2, 2.6], fill: 1.15, rim: [0x9fe4ff, 1.05], edge: [0xa8e8ff, 0.85] },  // 白天：暖白主光 + 青边缘
  { key: [0xffd0a0, 2.5], fill: 1.05, rim: [0xb489ff, 1.20], edge: [0xc9a6ff, 0.95] },  // 黄昏：橙 + 紫
  { key: [0xc3d8ff, 2.30], fill: 1.60, rim: [0xff8fd0, 1.35], edge: [0xffa8dc, 1.10] }, // 夜：冷蓝 + 品红
];

class Game {
  constructor() {
    this.state = 'load';
    this.levelIndex = 0;
    this.unlocked = 1;
    this.hearts = MAX_HEARTS;
    this.score = 0;
    this.bestTime = {};
    this.audio = new Audio();
    this.keys = {};
    this.input = { x: 0, z: 0, run: false, jump: false };
    this.touchLook = { active: false, x: 0, y: 0 };
    this.safePos = new THREE.Vector3(0, 3, 3);
    this.safeTimer = 0;
    this.safeValid = false;        // 是否记录过一个「离边缘足够远」的安全点
    this.lastFallT = -99;          // 上次掉落时间，用于识别「重生后立刻又掉」的循环
    this.perfT = 0;
    this.frames = 0;
    this.fps = 0;
    this.paused = false;
    this.lockUnavailable = false;      // iframe 内嵌时 pointer lock 可能被拒
  }

  // ------------------------------------------------------------------ 启动
  async boot() {
    const canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.08, 400);
    this.camera.position.set(0, 2.6, 5.4);

    this.rig = new CameraRig(this.camera);
    this.particles = new Particles(this.scene);

    // 灯光（跟着玩家的方向光负责投影）
    this.hemi = new THREE.HemisphereLight(0xd6ecff, 0x94d69d, 1.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
    this.sun.position.set(14, 22, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 90; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.022;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 轮廓补光（让角色边缘亮起来）
    this.rim = new THREE.DirectionalLight(0xbfd8ff, 0.85);
    this.rim.position.set(-4.5, 3.2, -3.6);
    this.scene.add(this.rim);
    this.rim.target.position.set(0, 0.9, 0);
    this.scene.add(this.rim.target);

    // 加载角色
    const bar = $('loadbar');
    const tip = $('loadtip');
    let prog = 0;
    const tick = setInterval(() => {
      prog = Math.min(0.94, prog + 0.07);
      bar.style.width = `${(prog * 100).toFixed(0)}%`;
    }, 90);
    tip.textContent = '正在加载角色模型（Draco 压缩 glTF）…';
    const wantKind = (new URLSearchParams(location.search).get('girl') || 'shino').toLowerCase();
    this.girlKind = GIRL_PRESETS[wantKind] ? wantKind
      : (wantKind === 'quaternius' ? 'cc0' : 'shino');
    this.girl = await loadGirl({
      ...GIRL_PRESETS[this.girlKind],
      onProgress: (p) => { bar.style.width = `${Math.min(96, p * 100).toFixed(0)}%`; },
    });
    tip.textContent = '正在加载场景素材（Kenney CC0 模型）…';
    const loaded = await preloadProps();
    clearInterval(tick);
    bar.style.width = '100%';
    $('srcinfo').textContent = this.girl.source === 'glb'
      ? (`角色：${GIRL_LABEL[this.girlKind]}　|　场景：CC0 素材 ${loaded} 个模型`)
      : '角色：程序化生成（glTF 加载失败时的回退）';

    this.player = new Player(this.girl);
    this.scene.add(this.girl.root);
    this.girl.root.visible = false;

    this.bindInput();
    this.buildMenuWorld();
    this.showTitle();
    this.clock = new THREE.Clock();
    this.loop();
  }

  // ------------------------------------------------------------ 标题/鉴赏舞台
  buildMenuWorld() {
    this.menuScene = new THREE.Group();
    this.scene.add(this.menuScene);

    // 展示台
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.85, 0.34, 44),
      new THREE.MeshToonMaterial({ color: 0x6d5aa8 }),
    );
    ped.position.y = -0.17;
    ped.receiveShadow = true;
    this.menuScene.add(ped);
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(1.58, 0.055, 8, 44),
      new THREE.MeshToonMaterial({ color: 0xffa8cf, emissive: 0x5a1f3a, emissiveIntensity: 0.5 }),
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.005;
    this.menuScene.add(trim);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.9, 48),
      new THREE.MeshBasicMaterial({ color: 0x9f8bff, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.33;
    this.menuScene.add(halo);

    // 环绕漂浮的星屑
    this.menuStars = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.115, 0),
        new THREE.MeshToonMaterial({ color: 0x8ff0ff, emissive: 0x2b6f8a, emissiveIntensity: 0.9 }),
      );
      const a = (i / 9) * Math.PI * 2;
      m.userData = { a, r: 1.9 + Math.random() * 0.7, y: 0.5 + Math.random() * 1.7, sp: 0.3 + Math.random() * 0.5 };
      this.menuScene.add(m);
      this.menuStars.push(m);
    }

    this.menuSpot = new THREE.Vector3(0, 0.0, 0);
    this.sun.target.position.set(0, 0.9, 0);
    this.sun.shadow.camera.left = -3.2; this.sun.shadow.camera.right = 3.2;
    this.sun.shadow.camera.top = 3.4; this.sun.shadow.camera.bottom = -1.0;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.girl.root.visible = true;
    this.girl.root.position.set(0, 0, 0);
    this.girl.setState('pose');
  }

  teardownMenu() {
    if (!this.menuScene) return;
    this.scene.remove(this.menuScene);
    this.menuScene = null;
    this.menuLevel = null;
  }

  // ------------------------------------------------------------ 关卡
  startLevel(i, keepScore = false) {
    this.teardownMenu();
    if (this.level) this.scene.remove(this.level.group);
    this.levelIndex = i;
    this.level = buildLevel(i);
    this.scene.add(this.level.group);
    this.enemies = new EnemyController(this.level, this.particles);
    this.run = new LevelRun(this.level, this.scene, this.particles);

    const t = this.level.theme;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog[0], t.fog[1], t.fog[2]);
    const rig = LIGHT_RIG[i % LIGHT_RIG.length];
    this.hemi.color.setHex(t.hemi.sky);
    this.hemi.groundColor.setHex(t.hemi.ground);
    this.hemi.intensity = rig.fill;
    this.sun.color.setHex(rig.key[0]);
    this.sun.intensity = rig.key[1];
    this.sun.position.set(...t.sun.pos);
    this.rim.color.setHex(rig.rim[0]);
    this.rim.intensity = rig.rim[1];
    setRim(rig.edge[0], rig.edge[1]);
    this.level.sky.visible = true;

    if (!keepScore) this.score = 0;
    this.hearts = MAX_HEARTS;
    this.safePos.copy(this.level.spawn);
    this.safeValid = true;
    this.lastFallT = -99;
    this.player.reset(this.level.spawn);
    this.rig.yaw = 0;
    this.rig.pitch = 0.30;
    this.rig.dist = 4.8;
    this.rig.offsetX = 0;
    this.rim.intensity = 0.85;
    this.rim.target.position.copy(this.player.pos);
    this.sun.shadow.camera.left = -26; this.sun.shadow.camera.right = 26;
    this.sun.shadow.camera.top = 26; this.sun.shadow.camera.bottom = -26;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.girl.root.visible = true;
    this.paused = false;
    this.state = 'play';
    this.show(null);                       // 关掉所有覆盖层，只留 HUD
    $('hud').classList.remove('hidden');
    $('hud-level').textContent = t.name;
    this.updateHearts();
    this.toast(`${t.name} — ${t.sub}`, 2400);
    if (this.audio.ctx) { this.audio.stopMusic(); this.audio.startMusic(i); }
  }

  restartLevel() {
    this.startLevel(this.levelIndex, false);
  }

  nextLevel() {
    if (this.levelIndex + 1 < THEMES.length) {
      this.unlocked = Math.max(this.unlocked, this.levelIndex + 2);
      this.save();
      this.startLevel(this.levelIndex + 1, false);
    } else {
      this.showTitle();
    }
  }

  updateHearts() {
    const h = $('hearts');
    h.innerHTML = '';
    for (let i = 0; i < MAX_HEARTS; i++) {
      const span = document.createElement('span');
      span.className = 'heart' + (i < this.hearts ? '' : ' off');
      span.innerHTML = `<svg viewBox="0 0 24 22" width="100%" height="100%" aria-hidden="true">
        <defs><linearGradient id="hg${i}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffb0d2"/><stop offset="100%" stop-color="#ff3d81"/>
        </linearGradient></defs>
        <path d="M12 21C4.8 15.4 1 11.6 1 7.4 1 3.9 3.7 1 7.2 1 9.1 1 10.9 1.9 12 3.4 13.1 1.9 14.9 1 16.8 1 20.3 1 23 3.9 23 7.4 23 11.6 19.2 15.4 12 21Z"
              fill="url(#hg${i})" stroke="rgba(255,255,255,.55)" stroke-width=".7"/>
      </svg>`;
      h.appendChild(span);
    }
  }

  toast(text, ms = 1600) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------ 输入
  bindInput() {
    const canvas = $('game');
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === ' ') { e.preventDefault(); this.jumpLatch = true; }
      if (k === 'escape') this.togglePause();
      if (k === 'j') this.player.doSpin() && this.audio.spin();
      if (k === 'r' && this.state === 'play') this.restartLevel();
      if (k === 'm') this.toggleMute();
    });
    addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'play' || e.button !== 0) return;
      // 指针锁定可用时：第一次点击锁定视角，之后点击 = 回旋攻击
      if (document.pointerLockElement === canvas || this.lockUnavailable) {
        if (this.player.doSpin()) this.audio.spin();
        return;
      }
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { this.lockUnavailable = true; });
      // 被 iframe 权限策略拒绝（itch 内嵌）时，350ms 内没锁定就退化成「点击即攻击」
      clearTimeout(this._lockProbe);
      this._lockProbe = setTimeout(() => {
        if (document.pointerLockElement !== canvas) this.lockUnavailable = true;
      }, 350);
    });
    document.addEventListener('pointerlockerror', () => { this.lockUnavailable = true; });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) this.lockUnavailable = false;
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas && this.state === 'play') {
        this.rig.addLook(e.movementX * 0.0022, e.movementY * 0.0018);
      }
    });
    addEventListener('wheel', (e) => this.rig.zoom(e.deltaY), { passive: true });
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // ---- 触屏 ----
    const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
    if (isTouch) $('touch').classList.remove('hidden');
    const stick = $('stick');
    const nub = $('stickNub');
    let sid = null, scenter = { x: 0, y: 0 };
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      sid = t.identifier;
      const r = stick.getBoundingClientRect();
      scenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      e.preventDefault();
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (sid !== null && t.identifier === sid) {
          const dx = (t.clientX - scenter.x) / 54;
          const dy = (t.clientY - scenter.y) / 54;
          this.input.x = THREE.MathUtils.clamp(dx, -1, 1);
          this.input.z = THREE.MathUtils.clamp(-dy, -1, 1);
          this.input.run = Math.hypot(dx, dy) > 0.85;
          nub.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
        } else if (t.clientX > innerWidth * 0.45) {
          if (!this.touchLook.active) {
            this.touchLook.active = true;
            this.touchLook.x = t.clientX;
            this.touchLook.y = t.clientY;
            this.touchLook.id = t.identifier;
          } else if (this.touchLook.id === t.identifier) {
            this.rig.addLook((t.clientX - this.touchLook.x) * 0.005, (t.clientY - this.touchLook.y) * 0.004);
            this.touchLook.x = t.clientX;
            this.touchLook.y = t.clientY;
          }
        }
      }
      e.preventDefault();
    }, { passive: false });
    addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          sid = null;
          this.input.x = 0; this.input.z = 0; this.input.run = false;
          nub.style.transform = '';
        }
        if (t.identifier === this.touchLook.id) this.touchLook.active = false;
      }
    });
    const down = (el, fn) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
    };
    down($('btnJump'), () => { this.input.jump = true; this.jumpLatch = true; });
    down($('btnSpin'), () => { if (this.player.doSpin()) this.audio.spin(); });
    down($('btnCam'), () => { this.rig.yaw += 0.7; });
    down($('btnPause'), () => this.togglePause());
    // 玩家一动结算面板就取消自动继续（想自己看数据 / 自己点）
    $('result').addEventListener('pointerdown', () => this.cancelAutoNext(), { passive: true });

    // ---- 菜单按钮 ----
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this.audio.resume();
      this.audio.ui();
      if (btn.dataset.act !== 'next') this.cancelAutoNext();
      const act = btn.dataset.act;
      if (act === 'start') this.startLevel(0);
      else if (act === 'gallery') this.showGallery();
      else if (act === 'help') this.show('help');
      else if (act === 'resume') this.togglePause();
      else if (act === 'restart') this.restartLevel();
      else if (act === 'totitle') this.showTitle();
      else if (act === 'next') this.nextLevel();
      else if (act === 'mute') this.toggleMute();
    });
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    const label = this.audio.muted ? '音效：关' : '音效：开';
    for (const id of ['muteBtn', 'muteBtnTitle']) {
      const el = $(id);
      if (el) el.textContent = label;
    }
  }

  togglePause() {
    if (this.state === 'play') {
      this.state = 'pause';
      this.clearHeldInput();
      this.show('pause');
      this.audio.stopMusic();
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (this.state === 'pause') {
      this.state = 'play';
      this.show(null);
      this.audio.startMusic(this.levelIndex);
    }
  }

  /** 暂停/切关时清掉按住的输入，避免角色一直朝一个方向跑 */
  clearHeldInput() {
    this.input.x = 0; this.input.z = 0; this.input.run = false; this.input.jump = false;
    this.jumpLatch = false;
    this.touchLook.active = false;
    this.touchLook.id = null;
    const nub = $('stickNub');
    if (nub) nub.style.transform = '';
  }

  show(which) {
    for (const id of ['title', 'pause', 'result', 'gallery', 'help', 'loading']) {
      $(id).classList.toggle('hidden', id !== which);
    }
    if (which !== 'result') this.cancelAutoNext();
    $('hud').classList.toggle('hidden', !(this.state === 'play'));
    $('touch').classList.toggle('hidden', !(this.state === 'play') || !this.touchEnabled);
  }

  showTitle() {
    this.teardownMenu();
    if (this.level) { this.scene.remove(this.level.group); this.level = null; }
    this.state = 'title';
    this.scene.fog = null;
    this.scene.background = new THREE.Color(0x2a2350);
    this.hemi.color.setHex(0xbfd0ff);
    this.hemi.groundColor.setHex(0x4a3a66);
    this.hemi.intensity = 1.5;
    this.sun.color.setHex(0xfff0f6);
    this.sun.intensity = 2.5;
    this.sun.position.set(3.2, 5.2, 4.2);
    this.buildMenuWorld();
    this.rig.yaw = 0.35; this.rig.pitch = -0.14; this.rig.dist = 3.15;
    this.rig.offsetX = -1.12;
    this.rim.intensity = 0.95;
    setRim(0xd8c4ff, 0.90);
    this.sun.position.set(2.4, 7.2, 3.6);
    this.girl.setState('idle');
    this.audio.stopMusic();
    this.renderLevelPick();
    this.show('title');
  }

  renderLevelPick() {
    const box = $('levelpick');
    box.innerHTML = '';
    THEMES.forEach((t, i) => {
      const d = document.createElement('div');
      d.className = 'lv' + (i < this.unlocked ? '' : ' locked');
      d.textContent = `${i + 1}. ${t.name}`;
      const best = this.bestTime[i];
      if (best) d.textContent += `　最佳 ${best.toFixed(1)}s`;
      if (i < this.unlocked) d.onclick = () => { this.audio.resume(); this.startLevel(i); };
      box.appendChild(d);
    });
  }

  showGallery() {
    this.teardownMenu();
    if (this.level) { this.scene.remove(this.level.group); this.level = null; }
    this.state = 'gallery';
    this.scene.fog = null;
    this.scene.background = new THREE.Color(0x1d1936);
    this.hemi.color.setHex(0x8fa4ff);
    this.hemi.groundColor.setHex(0x3a2c55);
    this.sun.color.setHex(0xffe6f2);
    this.sun.intensity = 2.6;
    this.sun.position.set(3, 6, 5);
    this.buildMenuWorld();
    this.rig.yaw = 0.32; this.rig.pitch = -0.13; this.rig.dist = 3.7;
    this.rig.offsetX = 1.0;
    this.rim.intensity = 1.1;
    this.buildGalleryButtons();
    this.girl.setState('idle');
    this.show('gallery');
  }

  buildGalleryButtons() {
    const btnBox = $('galBtns');
    const clips = this.girl.clips || ['Idle', 'Walk', 'Run', 'Jump', 'Fall', 'Spin', 'Hurt', 'Win', 'Pose'];
    btnBox.innerHTML = '';
    for (const c of clips) {
      const b = document.createElement('button');
      b.className = 'lv';
      b.textContent = c;
      b.onclick = () => {
        this.girl.setState(c.toLowerCase());
        $('gal-info').textContent = `当前动作：${c}　·　主角：${GIRL_LABEL[this.girlKind]}`;
      };
      btnBox.appendChild(b);
    }
    const sw = document.createElement('button');
    sw.className = 'lv primary';
    const nextKind = GIRL_ORDER[(GIRL_ORDER.indexOf(this.girlKind) + 1) % GIRL_ORDER.length];
    sw.textContent = '切换主角：' + GIRL_LABEL[nextKind].split('（')[0];
    sw.onclick = () => this.switchGirl(nextKind);
    btnBox.appendChild(sw);
    $('gal-info').textContent =
      `模型来源：${GIRL_LABEL[this.girlKind]}　·　${this.girl.clips ? this.girl.clips.length : 9} 段骨骼动画　·　鼠标拖动旋转视角`;
  }

  /** 鉴赏模式里实时切换主角（两套角色接口一致，换掉引用即可） */
  async switchGirl(kind) {
    if (this.switching) return;
    this.switching = true;
    const info = $('gal-info');
    info.textContent = '正在加载角色…';
    try {
      const old = this.girl.root;
      const g = await loadGirl(GIRL_PRESETS[kind]);
      g.root.position.copy(old.position);
      g.root.rotation.y = old.rotation.y;
      g.root.visible = true;
      if (old.parent) old.parent.remove(old);
      this.scene.add(g.root);
      this.girl = g;
      this.girlKind = kind;
      if (this.player) this.player.girl = g;
      this.girl.setState('idle');
      this.buildGalleryButtons();
    } catch (e) {
      info.textContent = '角色切换失败：' + (e && e.message);
    }
    this.switching = false;
  }

  // ------------------------------------------------------------ 主循环
  loop() {
    requestAnimationFrame(() => this.loop());
    this.step(Math.min(this.clock.getDelta(), 0.05));
  }

  /** 单步推进（测试时可手动调用，不依赖 rAF 节奏） */
  step(dt) {
    dt = Math.min(dt, 0.05);
    this.frames++;
    this.perfT += dt;
    if (this.perfT > 0.5) {
      this.fps = Math.round(this.frames / this.perfT);
      this.frames = 0; this.perfT = 0;
      if (!$('perf').classList.contains('hidden')) {
        $('perf').textContent = `${this.fps} fps · ${this.renderer.info.render.triangles.toLocaleString()} tris`;
      }
    }

    if (this.state === 'play') this.updatePlay(dt);
    else this.updateIdleScene(dt);

    this.renderer.render(this.scene, this.camera);
  }

  updateIdleScene(dt) {
    // 标题/鉴赏：慢速环绕展示
    if (this.state === 'title' || this.state === 'gallery') {
      const anchor = { pos: this.menuSpot, speed01: 0, grounded: true };
      this.rig.update(dt, anchor);
      if (this.state === 'title') this.rig.yaw += dt * 0.2;
      if (this.girl.source === 'procedural') this.girl.update(dt, { state: 'pose', speed01: 0 });
      else this.girl.update(dt, {});
      if (this.menuStars) {
        this.starT = (this.starT || 0) + dt;
        for (const m of this.menuStars) {
          const d = m.userData;
          const a = d.a + this.starT * d.sp;
          m.position.set(Math.cos(a) * d.r, d.y + Math.sin(this.starT * 1.4 + d.a) * 0.14, Math.sin(a) * d.r);
          m.rotation.set(this.starT * 1.5, this.starT * 2.1, 0);
        }
      }
      this.particles.update(dt);
    } else {
      this.particles.update(dt);
    }
  }

  /**
   * 求当前站位的「安全点」：必须在平台内部、离边缘 ≥ 1.35m，并往中心收 45%，
   * 这样重生点绝不会落在边缘上。升降平台不记录（它下一秒就移动了）。
   * 返回 null 表示「现在这个位置不适合当安全点」。
   */
  safeSpotFor(player) {
    const c = player.groundCollider;
    const p = player.pos;
    if (!c) return null;
    if (this.level.movers && this.level.movers.some((m) => m.collider === c)) return null;
    const margin = 1.35;
    const pull = 0.45;
    if (c.type === 'cyl') {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > c.r - margin) return null;
      return new THREE.Vector3(p.x - dx * pull, p.y + 0.05, p.z - dz * pull);
    }
    if (c.type === 'box') {
      if (Math.abs(p.x - c.x) > c.hw - margin || Math.abs(p.z - c.z) > c.hd - margin) return null;
      return new THREE.Vector3(p.x + (c.x - p.x) * pull, p.y + 0.05, p.z + (c.z - p.z) * pull);
    }
    return null;
  }

  updatePlay(dt) {
    // ---- 输入 ----
    const k = this.keys;
    let ix = (k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0);
    let iz = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0);
    if (this.input.x || this.input.z) { ix = this.input.x; iz = this.input.z; }
    const inp = {
      x: ix, z: iz,
      run: !!(k['shift'] || this.input.run),
      jump: this.input.jump || !!k[' '] || !!this.jumpLatch,
      onJump: (dbl) => { dbl ? this.audio.doubleJump() : this.audio.jump(); },
      onFell: () => {
        // 掉出世界：回到安全点。若 1.5 秒内又掉（说明这个安全点本身站不住），
        // 直接退回关卡出生点，避免「边缘重生→立刻又掉」的死循环。
        const t = this.run ? this.run.time : 0;
        const looping = (t - this.lastFallT) < 1.5;
        this.lastFallT = t;
        if (looping || !this.safeValid) {
          this.safeValid = false;
          this.player.pos.copy(this.level.spawn);
          if (looping) this.toast('回到关卡起点', 1200);
        } else {
          this.player.pos.copy(this.safePos);
        }
        this.player.vel.set(0, 0, 0);
        this.player.grounded = false;
        this.player.invulnT = Math.max(this.player.invulnT, 1.0);
        this.player.girl.root.position.copy(this.player.pos);
        this.damage(null, true);
      },
    };
    if (k['q']) this.rig.yaw += dt * 1.9;
    if (k['e']) this.rig.yaw -= dt * 1.9;

    // ---- 玩家 ----
    this.jumpLatch = false;
    const prevY = this.player.pos.y;
    this.player.update(dt, inp, this.level, this.rig.yaw);
    const st = this.player.state;

    // ---- 记录安全点 ----
    // 只在「离平台边缘足够远、且不是升降平台」时记录。否则掉落后会重生在边缘，
    // 胶囊中心压在碰撞体边界上探不到地面 → 立刻又掉 → 无限重生死亡循环。
    this.safeTimer -= dt;
    if (this.player.grounded && this.safeTimer <= 0 && this.player.pos.y > -2) {
      const spot = this.safeSpotFor(this.player);
      if (spot) {
        this.safePos.copy(spot);
        this.safeValid = true;
        this.safeTimer = 0.6;
      } else {
        this.safeTimer = 0.15;      // 站在边上：等走到里面再记
      }
    }

    // ---- 相机 ----
    this.rig.update(dt, this.player);
    // 三点布光：主光固定在 45° 侧上方；轮廓光摆在「角色背后、相对相机」才看得见边缘光
    const pp = this.player.pos;
    this.sun.position.set(pp.x + 11, pp.y + 19, pp.z + 9);
    this.sun.target.position.copy(pp);
    const camDir = new THREE.Vector3().subVectors(pp, this.camera.position).setY(0);
    if (camDir.lengthSq() < 1e-4) camDir.set(0, 0, 1);
    camDir.normalize();
    this.rim.position.set(pp.x + camDir.x * 7.5, pp.y + 5.4, pp.z + camDir.z * 7.5);
    this.rim.target.position.set(pp.x, pp.y + 1.05, pp.z);

    // ---- 敌人 / 关卡 ----
    this.enemies.update(dt, this.player, (e, bySpin) => {
      this.score += 50;
      this.audio.stomp();
      this.rig.kick(0.35);
      if (bySpin) this.toast('旋转击飞！+50', 900);
    }, () => {
      this.damage();
    });

    this.run.update(dt, this.player, (got, total) => {
      this.audio.collect(got);
      if (got === total) this.toast('星屑集齐！光环已亮起 →', 2200);
    }, (evt) => {
      if (evt === 'open') this.audio.goalOpen();
      else if (evt === 'enter') this.finishLevel();
    });

    this.particles.update(dt);

    // ---- HUD ----
    $('hud-crystal').textContent = `${this.run.collected} / ${this.run.total}`;
    $('hud-score').textContent = this.score + this.run.score;
    $('hud-time').textContent = `${this.run.time.toFixed(1)}s`;
    const p = $('prompt');
    if (!this.level.goal.active) {
      p.classList.remove('hidden');
      p.textContent = `再收集 ${this.run.total - this.run.collected} 颗星屑就能开启光环`;
    } else if (this.level.goal.pos.distanceTo(this.player.pos) < 9) {
      p.classList.remove('hidden');
      p.textContent = '光环已开启，跳进去！';
    } else {
      p.classList.add('hidden');
    }

    if (this.player.grounded && this.player.squashT > 0 && prevY - this.player.pos.y > 0.0) { /* 落地音在 player 里触发更准 */ }
    if (this.player.state === 'land' && !this._landSfx) { this.audio.land(); }
    this._landSfx = this.player.state === 'land';
  }

  damage(fromEnemy, silent = false) {
    if (this.player.invulnT > 0) return;
    this.hearts--;
    this.updateHearts();
    this.rig.kick(0.8);
    if (!silent) this.audio.hurt();
    if (this.hearts <= 0) {
      this.player.dead = true;
      this.audio.lose();
      setTimeout(() => this.finishLevel(true), 900);
    } else {
      this.toast(`受伤！剩余 ${this.hearts} 颗心`, 1200);
    }
  }

  finishLevel(failed = false) {
    if (this.state !== 'play') return;
    this.state = 'result';
    this.audio.stopMusic();
    const t = this.run.time;
    this.score += this.run.score;
    if (!failed) {
      this.score += Math.max(0, Math.round(400 - t * 6));
      this.audio.win();
      this.bestTime[this.levelIndex] = Math.min(this.bestTime[this.levelIndex] ?? 9999, t);
      this.unlocked = Math.max(this.unlocked, this.levelIndex + 2);
      this.save();
    } else {
      this.player.setState?.('ko');
    }
    $('result-title').textContent = failed ? '被星屑之力击倒了…' : '通关！';
    $('result-stats').innerHTML = `
      <div><span>关卡</span><span>${this.level.theme.name}</span></div>
      <div><span>收集星屑</span><span>${this.run.collected} / ${this.run.total}</span></div>
      <div><span>用时</span><span>${t.toFixed(1)} 秒</span></div>
      <div><span>得分</span><span>${this.score}</span></div>`;
    const rank = failed ? '—' : (t < 28 ? 'S' : t < 45 ? 'A' : t < 70 ? 'B' : 'C');
    $('result-rank').textContent = failed ? '' : `评级 ${rank}`;
    $('nextBtn').textContent = this.levelIndex + 1 < THEMES.length ? '下一关' : '回到标题';
    if (document.pointerLockElement) document.exitPointerLock();
    this.show('result');
    if (failed) { $('autoNext').textContent = ''; this.cancelAutoNext(); }
    else this.armAutoNext();
  }

  /** 通关后自动进入下一关（倒计时；玩家一动手/点任意面板按钮就取消） */
  armAutoNext(seconds = 6) {
    this.cancelAutoNext();
    const last = this.levelIndex + 1 >= THEMES.length;
    const label = last ? '全部关卡完成！' : `下一关：${THEMES[this.levelIndex + 1].name}`;
    const el = $('autoNext');
    let left = seconds;
    const tick = () => {
      el.textContent = `${label} · ${left} 秒后自动继续`;
      if (left <= 0) { this.cancelAutoNext(); el.textContent = ''; this.nextLevel(); return; }
      left -= 1;
    };
    tick();
    this._autoNextTimer = setInterval(tick, 1000);
  }

  cancelAutoNext() {
    if (this._autoNextTimer) { clearInterval(this._autoNextTimer); this._autoNextTimer = null; }
    const el = $('autoNext');
    if (el) el.textContent = '';
  }

  save() {
    try {
      localStorage.setItem('stardust-girl', JSON.stringify({ unlocked: this.unlocked, bestTime: this.bestTime }));
    } catch (e) { /* 忽略 */ }
  }

  load() {
    try {
      const d = JSON.parse(localStorage.getItem('stardust-girl') || '{}');
      this.unlocked = d.unlocked || 1;
      this.bestTime = d.bestTime || {};
    } catch (e) { /* 忽略 */ }
  }
}

// ---------------------------------------------------------------- 启动
const game = new Game();
game.touchEnabled = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
game.load();
window.__game = game;
game.boot().then(() => {
  $('loading').classList.add('hidden');
  window.__ready = true;
}).catch((err) => {
  console.error(err);
  $('loadtip').textContent = `启动失败：${err.message}`;
  window.__errors.push('boot: ' + err.message);
});
