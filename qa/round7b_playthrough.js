// QA round 7 v3: full-level playthrough — edge-aware autopilot, burst touch, strict verdicts
const fs = await import("node:fs/promises");
const task = await taskSpace(7);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";
const MAX_SEC = 600;

const profiles = [
  { id: "mac", label: "苹果电脑 macOS", w: 1512, h: 945, dpr: 2, mobile: false,
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel" },
  { id: "iphone", label: "苹果手机 iPhone", w: 390, h: 844, dpr: 3, mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", platform: "iPhone" },
];

const worldState = () => page.evaluate(() => {
  const g = window.__game;
  if (!g || !g.level) return { state: g ? g.state : "none" };
  const p = g.player.pos, lvl = g.level;
  const cols = lvl.colliders.map((c) => c.type === "cyl"
    ? { t: "c", x: c.x, z: c.z, r: c.r, top: c.top }
    : { t: "b", x: c.x, z: c.z, hw: c.hw, hd: c.hd, top: c.top });
  return { state: g.state, pos: [p.x, p.y, p.z], grounded: !!g.player.grounded,
    rem: lvl.crystals.filter((c) => !c.taken).map((c) => [c.pos.x, c.pos.y, c.pos.z]),
    goal: { pos: [lvl.goal.pos.x, lvl.goal.pos.y, lvl.goal.pos.z], active: !!lvl.goal.active, radius: lvl.goal.radius },
    collected: g.run.collected, total: g.run.total, runTime: +g.run.time.toFixed(2), hearts: g.hearts, yaw: g.rig.yaw,
    levelIndex: g.levelIndex, cols,
    resultVisible: !document.querySelector("#result").classList.contains("hidden"),
    resultTitle: (document.querySelector("#result-title") || {}).textContent || "",
    resultStats: (document.querySelector("#result-stats") || {}).textContent || "",
    resultRank: (document.querySelector("#result-rank") || {}).textContent || "",
    errors: window.__errors.slice(0, 5) };
});

const supported = (cols, x, z, y) => cols.some((c) => {
  const inside = c.t === "c" ? Math.hypot(x - c.x, z - c.z) <= c.r + 0.3
    : Math.abs(x - c.x) <= c.hw + 0.3 && Math.abs(z - c.z) <= c.hd + 0.3;
  return inside && Math.abs(c.top - y) <= 1.7;
});

const keysHeld = new Set();
const setKeys = async (want) => {
  for (const k of [...keysHeld]) if (!want.has(k)) { await page.keyboard.up(k); keysHeld.delete(k); }
  for (const k of want) if (!keysHeld.has(k)) { await page.keyboard.down(k); keysHeld.add(k); }
};
const releaseKeys = async () => { for (const k of [...keysHeld]) { await page.keyboard.up(k); keysHeld.delete(k); } };

const touch = (type, pts) => page.cdp("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] || i + 1, radiusX: 12, radiusY: 12, force: 1 })) });
let stickCenter = null;
const stickRect = async () => { if (!stickCenter) stickCenter = await page.evaluate(() => { const r = document.querySelector("#stick").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; }); return stickCenter; };
const stickBurst = async (ix, iz, ms) => {
  const [cx, cy, w] = await stickRect();
  const R = w * 0.45;
  await touch("touchStart", [[cx + ix * R, cy - iz * R, 1]]);
  await page.waitForTimeout(ms);
  await touch("touchEnd", []);
};
const tapBtn = async (sel) => {
  const c = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  if (!c) return false;
  await touch("touchStart", [[c[0], c[1], 5]]); await page.waitForTimeout(60); await touch("touchEnd", []);
  return true;
};
const clickOrTap = async (p, sel) => { if (p.mobile) await tapBtn(sel); else await page.click(sel); };

async function playLevel(p, rec, results) {
  const t0 = Date.now();
  const blacklist = new Map();
  let lastTrace = -99, bestDist = Infinity, lastProgress = 0, nextJumpAt = 0, lastRunTime = 0;
  let falls = 0, wasFalling = false, jumps = 0, bypass = 0, edgeJumps = 0;

  while ((Date.now() - t0) / 1000 < MAX_SEC) {
    const s = await worldState();
    if (!s.state || s.state === "none") break;
    if (s.state === "result" || s.resultVisible) {
      rec.result = { title: s.resultTitle, stats: s.resultStats, rank: s.resultRank, atRunTime: s.runTime, collected: s.collected, total: s.total, hearts: s.hearts };
      break;
    }
    if (s.state !== "play") { await page.waitForTimeout(300); continue; }
    if (s.runTime - lastRunTime < -0.5) rec.trace.push({ t: s.runTime, note: "level restarted" });
    lastRunTime = s.runTime;

    const falling = s.pos[1] < -2.5;
    if (falling && !wasFalling) falls++;
    wasFalling = falling;

    let target = null, key = "goal";
    if (s.collected >= s.total && s.goal.active) target = s.goal.pos;
    else {
      const avail = s.rem.filter((c) => (blacklist.get(c[0].toFixed(1) + "," + c[2].toFixed(1)) || 0) < s.runTime)
        .sort((a, b) => Math.hypot(a[0] - s.pos[0], a[2] - s.pos[2]) - Math.hypot(b[0] - s.pos[0], b[2] - s.pos[2]));
      if (avail.length) { target = avail[0]; key = target[0].toFixed(1) + "," + target[2].toFixed(1); }
      else if (s.goal.active) target = s.goal.pos;
      else {
        blacklist.clear(); bypass++;
        if (bypass > 10) { rec.trace.push({ t: s.runTime, note: "give up: remaining crystals unreachable" }); break; }
        continue;
      }
    }

    const dx = target[0] - s.pos[0], dz = target[2] - s.pos[2], dy = target[1] - s.pos[1];
    const dist = Math.hypot(dx, dz);
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const toInput = (nx, nz) => [nx * cos - nz * sin, -nx * sin - nz * cos];
    let nx = dx / (dist || 1), nz = dz / (dist || 1);

    let supportedDirect = false, chosen = null;
    for (const deg of [0, 20, -20, 40, -40, 60, -60, 80, -80]) {
      const a = (deg * Math.PI) / 180;
      const cx2 = nx * Math.cos(a) - nz * Math.sin(a), cz2 = nx * Math.sin(a) + nz * Math.cos(a);
      const ok = supported(s.cols, s.pos[0] + cx2 * 1.3, s.pos[2] + cz2 * 1.3, s.pos[1]);
      if (deg === 0) supportedDirect = ok;
      if (ok && !chosen) chosen = [cx2, cz2];
      if (ok && deg === 0) break;
    }

    if (dist < bestDist - 0.3) { bestDist = dist; lastProgress = s.runTime; }
    const idle = s.runTime - lastProgress;

    let jump = false, run = dist > 1.6;
    if (!supportedDirect && s.grounded) { jump = true; edgeJumps++; run = true; }
    if (dy > 0.7 && s.grounded) jump = true;
    if (idle > 1.4 && s.runTime > nextJumpAt) { jump = true; nextJumpAt = s.runTime + 1.1; }
    if (idle > 9) { blacklist.set(key, s.runTime + 25); bestDist = Infinity; lastProgress = s.runTime;
      rec.trace.push({ t: s.runTime, note: "blacklist " + key, dist: +dist.toFixed(1) }); continue; }

    if (!supportedDirect && chosen) { nx = chosen[0]; nz = chosen[1]; }
    const [ix, iz] = toInput(nx, nz);

    if (p.mobile) {
      if (jump) { await tapBtn("#btnJump"); jumps++; }
      await stickBurst(Math.max(-1, Math.min(1, ix * 1.5)), Math.max(-1, Math.min(1, iz * 1.5)), jump ? 320 : 600);
    } else {
      const want = new Set();
      if (Math.abs(ix) > 0.2) want.add(ix > 0 ? "d" : "a");
      if (Math.abs(iz) > 0.2) want.add(iz > 0 ? "w" : "s");
      if (run) want.add("Shift");
      if (jump) { await setKeys(new Set([...want, " "])); jumps++; await page.waitForTimeout(70); await setKeys(want); await page.waitForTimeout(80); }
      else { await setKeys(want); await page.waitForTimeout(90); }
    }

    if (s.runTime - lastTrace > 5) {
      lastTrace = s.runTime;
      rec.trace.push({ t: s.runTime, c: s.collected + "/" + s.total, pos: s.pos.map((v) => +v.toFixed(1)), target: key,
        dist: +dist.toFixed(1), idle: +idle.toFixed(1), hearts: s.hearts, supported: supportedDirect, falls });
      await fs.writeFile(`${OUT}/round7.json`, JSON.stringify(results, null, 1)).catch(() => {});
    }
  }
  await releaseKeys();
  Object.assign(rec, { falls, jumps, edgeJumps, bypass });
  return rec;
}

const results = {};
for (const p of profiles) {
  const rec = { profile: p.label, viewport: [p.w, p.h], dpr: p.dpr, mobile: p.mobile, trace: [] };
  results[p.id] = rec;
  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: p.mobile, screenOrientation: { type: p.mobile ? "portraitPrimary" : "landscapePrimary", angle: 0 } });
    await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: p.mobile, maxTouchPoints: p.mobile ? 5 : 1 });
    await page.cdp("Emulation.setUserAgentOverride", { userAgent: p.ua, platform: p.platform });
    await page.goto(URL);
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
    await clickOrTap(p, "[data-act=start]");
    await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
    await page.waitForTimeout(1200);
    await playLevel(p, rec, results);
    try { await page.screenshot({ path: `${OUT}/${p.id}_r7_final.png` }); rec.shot = "ok"; } catch (e) { rec.shot = "FAIL"; }

    const r = rec.result;
    const win = r && /通过|通关|完成|成功/.test(r.title || "");
    rec.won = !!win;
    if (win) {
      await clickOrTap(p, "[data-act=next]");
      await page.waitForTimeout(3200);
      const a = await worldState();
      rec.afterNext = { state: a.state, levelIndex: a.levelIndex, collected: a.collected, total: a.total, runTime: a.runTime,
        levelName: await page.evaluate(() => (document.querySelector("#hud-level") || {}).textContent) };
      try { await page.screenshot({ path: `${OUT}/${p.id}_r7_level2.png` }); } catch (e) {}
    }
  } catch (e) { rec.error = String(e && (e.message || e)).slice(0, 220); }
  await fs.writeFile(`${OUT}/round7.json`, JSON.stringify(results, null, 1));
  console.log("PLAY", p.id, rec.error || JSON.stringify({ result: rec.result && rec.result.title, stats: rec.result && rec.result.stats.replace(/\s+/g, " ").slice(0, 130), rank: rec.result && rec.result.rank,
    won: rec.won, afterNext: rec.afterNext || null, falls: rec.falls, jumps: rec.jumps, edgeJumps: rec.edgeJumps, lastTrace: rec.trace[rec.trace.length - 1] || null }));
}
console.log("ROUND7 DONE");
