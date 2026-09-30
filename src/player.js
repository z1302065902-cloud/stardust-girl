// ---------------------------------------------------------------------------
// player.js — 角色控制器：胶囊碰撞、走/跑/跳/二段跳/回旋攻击、平台承载
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const GRAVITY = -24.0;
const WALK_SPEED = 3.5;
const RUN_SPEED = 6.3;
const ACCEL = 34.0;
const AIR_ACCEL = 18.0;
const FRICTION = 20.0;
const JUMP_V = 9.0;
const DOUBLE_JUMP_V = 7.8;
const MAX_FALL = -32.0;
const COYOTE = 0.12;
const JUMP_BUFFER = 0.16;
const RADIUS = 0.36;
const BODY_HEIGHT = 1.62;
const SAMPLES = [0.34, 0.86, 1.34];   // 三个采样球中心（相对脚底）
const SPIN_TIME = 0.42;

const _v = new THREE.Vector3();

function closestOnCollider(p, col) {
  if (col.type === 'box') {
    const qx = Math.max(col.x - col.hw, Math.min(p.x, col.x + col.hw));
    const qy = Math.max(col.y - col.hh, Math.min(p.y, col.y + col.hh));
    const qz = Math.max(col.z - col.hd, Math.min(p.z, col.z + col.hd));
    return [qx, qy, qz, col];
  }
  const dx = p.x - col.x, dz = p.z - col.z;
  const dr = Math.hypot(dx, dz);
  const inside = dr < col.r;
  let qx, qy, qz;
  const ux = dr > 1e-6 ? dx / dr : 1, uz = dr > 1e-6 ? dz / dr : 0;
  if (p.y > col.top) {
    if (inside) { qx = p.x; qz = p.z; qy = col.top; }
    else { qx = col.x + ux * col.r; qz = col.z + uz * col.r; qy = col.top; }
  } else if (p.y < col.bottom) {
    if (inside) { qx = p.x; qz = p.z; qy = col.bottom; }
    else { qx = col.x + ux * col.r; qz = col.z + uz * col.r; qy = col.bottom; }
  } else if (inside) {
    qx = col.x + ux * col.r; qz = col.z + uz * col.r; qy = p.y;
  } else {
    qx = col.x + ux * col.r; qz = col.z + uz * col.r; qy = p.y;
  }
  return [qx, qy, qz, col];
}

export class Player {
  constructor(girl) {
    this.girl = girl;
    this.pos = new THREE.Vector3(0, 2, 0);
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.groundCollider = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumps = 0;
    this.facing = 0;
    this.speed01 = 0;
    this.spinT = 0;
    this.spinHit = false;
    this.hurtT = 0;
    this.invulnT = 0;
    this.dead = false;
    this.state = 'idle';
    this.fallStart = 0;
    this.squashT = 0;
  }

  reset(pos) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.jumps = 0;
    this.dead = false;
    this.hurtT = 0;
    this.invulnT = 2.4;
    this.spinT = 0;
    this.facing = 0;
    if (this.girl.root) {
      this.girl.root.position.copy(this.pos);
      this.girl.root.rotation.set(0, 0, 0);
      this.girl.root.visible = true;
    }
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  hurt(dirX, dirZ) {
    if (this.invulnT > 0 || this.dead) return false;
    this.hurtT = 1;
    this.invulnT = 1.5;
    const l = Math.hypot(dirX, dirZ) || 1;
    this.vel.x = (dirX / l) * 5.5;
    this.vel.z = (dirZ / l) * 5.5;
    this.vel.y = 5.0;
    this.grounded = false;
    return true;
  }

  doSpin() {
    if (this.spinT > 0 || this.dead) return false;
    this.spinT = SPIN_TIME;
    this.spinHit = false;
    return true;
  }

  /** 与场景碰撞体求解（球 vs 圆柱/长方体） */
  resolve(colliders) {
    let hitGround = false;
    for (const col of colliders) {
      for (const sy of SAMPLES) {
        _v.set(this.pos.x, this.pos.y + sy, this.pos.z);
        const [qx, qy, qz] = closestOnCollider(_v, col);
        let nx = _v.x - qx, ny = _v.y - qy, nz = _v.z - qz;
        let d = Math.hypot(nx, ny, nz);
        if (d > RADIUS) continue;
        if (d < 1e-5) {
          // 完全嵌进去：沿最薄的轴顶出去
          nx = 0; nz = 0; ny = 1; d = 1e-5;
        } else {
          nx /= d; ny /= d; nz /= d;
        }
        const push = RADIUS - d;
        this.pos.x += nx * push;
        this.pos.y += ny * push;
        this.pos.z += nz * push;
        const vn = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= vn * nx;
          this.vel.y -= vn * ny;
          this.vel.z -= vn * nz;
        }
        if (ny > 0.55) {
          hitGround = true;
          this.groundCollider = col;
          if (this.vel.y < -6) this.squashT = Math.min(1, -this.vel.y / 22);
        }
      }
    }
    if (hitGround) {
      this.grounded = true;
      this.coyote = COYOTE;
    } else {
      this.grounded = false;
    }
    return hitGround;
  }

  update(dt, input, level, camYaw) {
    this.level = level;
    dt = Math.min(dt, 1 / 30);
    const wasGrounded = this.grounded;

    // ---- 输入 → 世界方向（相机相对）----
    let ix = input.x, iz = input.z;
    const mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; }
    // 相机相对移动：相机在角色后方 (sin*cos, cos) 方向，因此前方 = -(sin, cos)
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const wx = ix * cos - iz * sin;
    const wz = -ix * sin - iz * cos;

    const targetSpeed = (input.run ? RUN_SPEED : WALK_SPEED) * Math.min(1, Math.hypot(ix, iz));
    const accel = this.grounded ? ACCEL : AIR_ACCEL;

    const desiredX = wx * targetSpeed;
    const desiredZ = wz * targetSpeed;
    if (Math.hypot(ix, iz) > 0.08) {
      this.vel.x += (desiredX - this.vel.x) * Math.min(1, accel * dt / Math.max(targetSpeed, 1));
      this.vel.z += (desiredZ - this.vel.z) * Math.min(1, accel * dt / Math.max(targetSpeed, 1));
    } else if (this.grounded) {
      const f = Math.max(0, 1 - FRICTION * dt / Math.max(this.speed, 0.001));
      this.vel.x *= f;
      this.vel.z *= f;
      if (this.speed < 0.15) { this.vel.x = 0; this.vel.z = 0; }
    }

    // ---- 跳跃（只在按下的那一瞬间触发，长按不会连跳）----
    const jumpPressed = input.jump && !this._prevJump;
    this._prevJump = input.jump;
    this.jumpBuffer = jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    if (this.grounded) this.jumps = 0;
    if (this.jumpBuffer > 0 && !this.dead) {
      if (this.grounded || this.coyote > 0 || this.jumps === 0) {
        this.vel.y = JUMP_V;
        this.jumps = 1;
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.grounded = false;
        if (input.onJump) input.onJump(false);
      } else if (this.jumps < 2) {
        this.vel.y = DOUBLE_JUMP_V;
        this.jumps = 2;
        this.jumpBuffer = 0;
        if (input.onJump) input.onJump(true);
        this.doubleJumpT = 0.3;
      }
    }
    input.jump = false;

    // ---- 重力 ----
    this.vel.y = Math.max(MAX_FALL, this.vel.y + GRAVITY * dt);

    // ---- 位移 ----
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // ---- 碰撞求解 ----
    this.resolve(level.colliders);

    if (!wasGrounded && this.grounded) this.squashT = Math.max(this.squashT, Math.min(0.7, -this.vel.y / 26));

    // ---- 掉出世界 ----
    if (this.pos.y < -9) {
      this.pos.set(0, 3, 0);
      this.vel.set(0, 0, 0);
      this.hurtT = 1;
      this.invulnT = 1.4;
      if (input.onFell) input.onFell();
    }

    // ---- 计时器 ----
    this.spinT = Math.max(0, this.spinT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.squashT = Math.max(0, this.squashT - dt);
    if (this.doubleJumpT > 0) this.doubleJumpT -= dt;

    // ---- 朝向 ----
    if (this.speed > 0.35) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let diff = want - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 14);
    }

    // ---- 动画状态 ----
    const sp = this.speed;
    this.speed01 = THREE.MathUtils.clamp(sp / RUN_SPEED, 0, 1);
    let st;
    if (this.dead) st = 'ko';
    else if (this.hurtT > 0) st = 'hurt';
    else if (this.spinT > 0) st = 'spin';
    else if (!this.grounded) st = this.vel.y > 0.4 ? (this.doubleJumpT > 0 ? 'doubleJump' : 'jump') : 'fall';
    else if (sp < 0.35) st = this.squashT > 0.25 ? 'land' : 'idle';
    else if (sp < 4.3) st = 'walk';
    else st = 'run';
    this.state = st;

    // ---- 同步到模型 ----
    const root = this.girl.root;
    if (root) {
      root.position.copy(this.pos);
      root.rotation.y = this.facing;
      if (this.squashT > 0 && this.grounded) {
        const k = this.squashT;
        root.scale.set(1 + k * 0.10, 1 - k * 0.14, 1 + k * 0.10);
      } else {
        root.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 12));
      }
      // 受伤闪红 / 无敌闪烁
      const visible = this.invulnT <= 0 || Math.floor(this.invulnT * 18) % 2 === 0;
      root.visible = visible || this.dead;
    }
    this.girl.update(dt, { state: st, speed01: this.speed01 });

    return st;
  }
}
