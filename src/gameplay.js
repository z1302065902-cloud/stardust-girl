// ---------------------------------------------------------------------------
// gameplay.js — 相机、敌人 AI、拾取、特效
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// ----------------------------- 第三人称相机 ---------------------------------
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.30;
    this.dist = 4.8;
    this.target = new THREE.Vector3();
    this.smooth = new THREE.Vector3();
    this.first = true;
    this.shake = 0;
    this.offsetX = 0;
    this.fov = 50;
  }

  addLook(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.55, 1.05);
  }

  zoom(dz) {
    this.dist = THREE.MathUtils.clamp(this.dist + dz * 0.004, 2.6, 11);
  }

  kick(amount) { this.shake = Math.min(1, this.shake + amount); }

  update(dt, player) {
    const px = player.pos.x, py = player.pos.y + 1.15, pz = player.pos.z;
    this.target.set(px, py, pz);
    if (this.first) { this.smooth.copy(this.target); this.first = false; }
    const followLerp = Math.min(1, dt * (player.grounded ? 9 : 5));
    this.smooth.lerp(this.target, followLerp);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp * this.dist;
    const oz = Math.cos(this.yaw) * cp * this.dist;
    const oy = sp * this.dist + 1.1;

    let cx = this.smooth.x + ox, cy = this.smooth.y + oy, cz = this.smooth.z + oz;
    if (cy < 0.9) cy = 0.9;

    // 相机避障：从角色往相机方向采样，撞到地形就把镜头拉近
    if (player.level) {
      const dx = cx - this.smooth.x, dy = cy - this.smooth.y, dz = cz - this.smooth.z;
      let worst = 1;
      for (let i = 1; i <= 8; i++) {
        const f = i / 8;
        const px = this.smooth.x + dx * f, py = this.smooth.y + dy * f, pz = this.smooth.z + dz * f;
        let blocked = false;
        for (const col of player.level.colliders) {
          if (col.type === 'cyl') {
            if (py < col.bottom || py > col.top + 0.25) continue;
            if (Math.hypot(px - col.x, pz - col.z) < col.r + 0.3) { blocked = true; break; }
          } else {
            if (Math.abs(px - col.x) < col.hw + 0.3 && Math.abs(py - col.y) < col.hh + 0.3 &&
                Math.abs(pz - col.z) < col.hd + 0.3) { blocked = true; break; }
          }
        }
        if (blocked) { worst = Math.max(0.22, f - 0.14); break; }
      }
      if (worst < 1) {
        cx = this.smooth.x + dx * worst;
        cy = this.smooth.y + dy * worst;
        cz = this.smooth.z + dz * worst;
        if (cy < this.smooth.y + 0.35) cy = this.smooth.y + 0.35;
      }
    }

    if (this.shake > 0) {
      const s = this.shake * 0.28;
      cx += (Math.random() - 0.5) * s;
      cy += (Math.random() - 0.5) * s;
      cz += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3.2);
    }

    this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 8));
    this.camera.lookAt(this.smooth.x, this.smooth.y + 0.18, this.smooth.z);
    if (this.offsetX) this.camera.translateX(this.offsetX);

    const wantFov = 50 + (player.speed01 || 0) * 7;
    if (Math.abs(wantFov - this.fov) > 0.05) {
      this.fov += (wantFov - this.fov) * Math.min(1, dt * 4);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

// -------------------------------- 特效 -------------------------------------
const _tmp = new THREE.Vector3();

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geo = new THREE.SphereGeometry(0.1, 8, 6);
  }

  burst(pos, color, count = 14, power = 5) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      m.position.copy(pos);
      m.scale.setScalar(0.6 + Math.random() * 0.9);
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * power * 0.8 + 1.5;
      const r = Math.random() * power;
      this.items.push({
        mesh: m, life: 0.7 + Math.random() * 0.5, t: 0,
        vel: new THREE.Vector3(Math.cos(a) * r, up, Math.sin(a) * r),
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.t += dt;
      p.vel.y -= 18 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = 1 - p.t / p.life;
      p.mesh.material.opacity = Math.max(0, k);
      p.mesh.scale.multiplyScalar(1 - dt * 1.2);
      if (p.t >= p.life) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.items) this.scene.remove(p.mesh);
    this.items.length = 0;
  }
}

// -------------------------------- 敌人 -------------------------------------
export class EnemyController {
  constructor(level, particles) {
    this.level = level;
    this.particles = particles;
    this.t = 0;
  }

  update(dt, player, onStomp, onHit) {
    this.t += dt;
    for (const e of this.level.enemies) {
      if (!e.alive) continue;
      const m = e.mesh;
      const toP = _tmp.copy(player.pos).sub(m.position);
      const distXZ = Math.hypot(toP.x, toP.z);

      if (e.kind === 'slime') {
        // 蓄力 → 起跳 → 朝玩家推进
        e.jumpT += dt * e.speed;
        const hop = Math.abs(Math.sin(e.jumpT * 2.4));
        m.position.y = e.home.y - 0.1 + hop * e.hopH;
        const sc = 1 + (1 - hop) * 0.22;
        m.scale.set(1.05 * sc, 0.78 / sc, 1.05 * sc);
        if (distXZ < 11) {
          const dir = new THREE.Vector3(toP.x, 0, toP.z).normalize();
          m.position.x += dir.x * dt * e.speed * 1.15;
          m.position.z += dir.z * dt * e.speed * 1.15;
          m.rotation.y = Math.atan2(dir.x, dir.z);
        }
      } else {
        // 幽灵：绕家漂浮 + 靠近时追人
        e.phase += dt * 1.3;
        const chase = distXZ < 13;
        const tx = chase ? player.pos.x : e.home.x + Math.cos(e.phase * 0.7) * 2.4;
        const tz = chase ? player.pos.z : e.home.z + Math.sin(e.phase * 0.7) * 2.4;
        const ty = chase ? player.pos.y + 1.0 : e.baseY + Math.sin(e.phase) * 0.5;
        m.position.x += (tx - m.position.x) * Math.min(1, dt * e.speed * 0.7);
        m.position.z += (tz - m.position.z) * Math.min(1, dt * e.speed * 0.7);
        m.position.y += (ty - m.position.y) * Math.min(1, dt * e.speed * 0.6);
        m.rotation.z = Math.sin(e.phase * 2) * 0.12;
      }

      // 碰撞判定
      const dy = player.pos.y + 0.85 - m.position.y;
      const hit = distXZ < e.r + 0.55 && Math.abs(dy) < 1.15;
      if (!hit) continue;

      const stomping = player.vel.y < -1.5 && player.pos.y > m.position.y - 0.1;
      const spinning = player.spinT > 0;
      if (stomping || spinning) {
        e.alive = false;
        m.visible = false;
        this.particles.burst(m.position.clone(), e.kind === 'slime' ? 0x9df3c9 : 0xd9c4ff, 11, 4.5);
        if (stomping) {
          player.vel.y = 8.4;
          player.jumps = 1;
        }
        onStomp(e, spinning);
      } else if (player.hurt(m.position.x - player.pos.x, m.position.z - player.pos.z)) {
        this.particles.burst(player.pos.clone().setY(player.pos.y + 0.9), 0xff6f8f, 12, 4);
        onHit(e);
      }
    }
  }
}

// ------------------------------ 关卡状态推进 ---------------------------------
export class LevelRun {
  constructor(level, scene, particles) {
    this.level = level;
    this.scene = scene;
    this.particles = particles;
    this.total = level.crystals.length;
    this.collected = 0;
    this.time = 0;
    this.score = 0;
  }

  update(dt, player, onCollect, onGoal) {
    this.time += dt;
    const lv = this.level;

    // 水晶
    for (const c of lv.crystals) {
      if (c.taken) continue;
      c.mesh.rotation.y += dt * 2.2;
      c.mesh.position.y = c.pos.y - 0.35 + Math.sin(this.time * 2.4 + c.spin) * 0.13;
      const d = c.mesh.position.distanceTo(_tmp.set(player.pos.x, player.pos.y + 0.9, player.pos.z));
      if (d < 1.5) {
        c.taken = true;
        c.mesh.visible = false;
        this.collected++;
        this.score += 100;
        this.particles.burst(c.mesh.position.clone(), 0x8ff0ff, 9, 4);
        onCollect(this.collected, this.total);
      }
    }

    // 终点
    const goal = lv.goal;
    goal.mesh.rotation.z += dt * (goal.active ? 1.6 : 0.35);
    if (!goal.active && this.collected >= this.total) {
      goal.active = true;
      goal.glow.material.opacity = 0.45;
      this.particles.burst(goal.pos.clone(), 0xffe066, 26, 8);
      onGoal('open');
    }
    if (goal.active) {
      const pulse = 1 + Math.sin(this.time * 5) * 0.06;
      goal.mesh.scale.setScalar(pulse);
      goal.glow.material.opacity = 0.35 + Math.sin(this.time * 5) * 0.12;
      const d = goal.pos.distanceTo(_tmp.set(player.pos.x, player.pos.y + 0.9, player.pos.z));
      if (d < goal.radius) onGoal('enter');
    }

    // 运动平台带动玩家
    for (const mv of lv.movers) {
      const y = mv.yAt(this.time);
      const dy = y - mv.collider.top;
      mv.collider.top = y;
      for (const m of mv.meshes) m.position.y += dy;
      if (player.groundCollider === mv.collider && player.grounded) {
        player.pos.y += dy;
      }
    }
  }
}
