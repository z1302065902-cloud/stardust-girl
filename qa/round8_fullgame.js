// QA round 8: clear the whole game with real input; verify auto-advance to the next level
const fs = await import("node:fs/promises");
const task = await taskSpace(7);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";
const PER_LEVEL_SEC = 900, TOTAL_SEC = 2400;

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
  return { state: g.state, level: g.levelIndex, levelName: g.level.theme.name, pos: [p.x, p.y, p.z], grounded: !!g.player.grounded,
    rem: lvl.crystals.filter((c) => !c.taken).map((c) => [c.pos.x, c.pos.y, c.pos.z]),
    goal: { pos: [lvl.goal.pos.x, lvl.goal.pos.y, lvl.goal.pos.z], active: !!lvl.goal.active },
    collected: g.run.collected, total: g.run.total, runTime: +g.run.time.toFixed(2), hearts: g.hearts, yaw: g.rig.yaw, cols,
    resultVisible: !document.querySelector("#result").classList.contains("hidden"),
    resultTitle: (document.querySelector("#result-title") || {}).textContent || "",
    resultStats: ((document.querySelector("#result-stats") || {}).textContent || "").replace(/\s+/g, " ").trim(),
    resultRank: (document.querySelector("#result-rank") || {}).textContent || "",
    autoNext: ((document.querySelector("#autoNext") || {}).textContent || "").trim(),
    errors: window.__errors.slice(0, 5) };
});
const inside = (c, x, z) => c.t === "c" ? Math.hypot(x - c.x, z - c.z) <= c.r + 0.3 : Math.abs(x - c.x) <= c.hw + 0.3 && Math.abs(z - c.z) <= c.hd + 0.3;
const supported = (cols, x, z, y, tol = 1.7) => cols.some((c) => inside(c, x, z) && Math.abs(c.top - y) <= tol);
const myPlatform = (s) => s.cols.find((c) => inside(c, s.pos[0], s.pos[2]) && Math.abs(c.top - s.pos[1]) <= 1.7) || null;

const keysHeld = new Set();
const setKeys = async (want) => {
  for (const k of [...keysHeld]) if (!want.has(k)) { await page.keyboard.up(k); keysHeld.delete(k); }
  for (const k of want) if (!keysHeld.has(k)) { await page.keyboard.down(k); keysHeld.add(k); }
};
const releaseKeys = async () => { for (const k of [...keysHeld]) { await page.keyboard.up(k); keysHeld.delete(k); } };
const touch = (type, pts) => page.cdp("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] || i + 1, radiusX: 12, radiusY: 12, force: 1 })) });
let stickCenter = null;
const stickBurst = async (ix, iz, ms) => {
  if (!stickCenter) stickCenter = await page.evaluate(() => { const r = document.querySelector("#stick").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; });
  const [cx, cy, w] = stickCenter, R = w * 0.45;
  await touch("touchStart", [[cx + ix * R, cy - iz * R, 1]]);
  await page.waitForTimeout(ms);
  await touch("touchEnd", []);
};
const tapBtn = async (sel) => {
  const c = await page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  if (!c) return false;
  await touch("touchStart", [[c[0], c[1], 5]]); await page.waitForTimeout(60); await touch("touchEnd", []);
  return true;
};

async function play(profile, results, rec) {
  const t0 = Date.now();
  const blacklist = new Map();
  let lastLevel = 0, levelStart = Date.now(), bestDist = Infinity, lastProgress = 0, nextJumpAt = 0, lastTick = 0;
  let jumps = 0, falls = 0, wasFalling = false, trace = [];
  rec.levels = rec.levels || [];
  let curLevel = { index: 0, name: null, cleared: false, autoAdvanced: false, resultShot: null, startShot: null };

  while ((Date.now() - t0) / 1000 < TOTAL_SEC) {
    const s = await worldState();
    if (s.state === "none") break;

    // ---- 结算面板：不点任何按钮，验证倒计时自动进入下一关 ----
    if (s.state === "result" || s.resultVisible) {
      if (!curLevel.resultLogged) {
        curLevel.resultLogged = true;
        curLevel.result = { title: s.resultTitle, stats: s.resultStats, rank: s.resultRank, autoNextText: s.autoNext };
        try { await page.screenshot({ path: `${OUT}/${profile.id}_r8_L${s.level}_result.png` }); curLevel.resultShot = "ok"; } catch (e) { curLevel.resultShot = "FAIL"; }
      }
      const win = /通关|通过|完成|成功/.test(s.resultTitle);
      if (!win) { rec.note = "关卡失败：" + s.resultTitle; break; }
      // 等自动继续（最多 12 秒）
      const t = Date.now();
      while (Date.now() - t < 12000) {
        const a = await worldState();
        if (a.state === "title") { curLevel.cleared = true; curLevel.autoAdvanced = true; curLevel.advancedTo = "title"; break; }
        if (a.state === "play" && a.level !== s.level) {
          curLevel.cleared = true; curLevel.autoAdvanced = true; curLevel.advancedTo = "level " + a.level;
          curLevel.advancedAfterSec = +((Date.now() - t) / 1000).toFixed(1);
          blacklist.clear(); bestDist = Infinity; lastProgress = 0; levelStart = Date.now();
          try { await page.screenshot({ path: `${OUT}/${profile.id}_r8_L${a.level}_start.png` }); } catch (e) {}
          results[profile.id] = rec;
          await fs.writeFile(`${OUT}/round8.json`, JSON.stringify(results, null, 1)).catch(() => {});
          break;
        }
        await page.waitForTimeout(500);
      }
      rec.levels.push(curLevel);
      if (curLevel.advancedTo === "title") break;
      curLevel = { index: (await worldState()).level, name: null, cleared: false, autoAdvanced: false };
      continue;
    }

    if (s.state !== "play") { await page.waitForTimeout(400); continue; }
    curLevel.name = s.levelName; curLevel.totalCrystals = s.total;
    if ((Date.now() - levelStart) / 1000 > PER_LEVEL_SEC) { rec.note = "关卡超时未通关"; rec.levels.push(curLevel); break; }
    if (s.level !== lastLevel) { lastLevel = s.level; blacklist.clear(); bestDist = Infinity; lastProgress = 0; }

    const falling = s.pos[1] < -2.5;
    if (falling && !wasFalling) falls++;
    wasFalling = falling;

    // ---- 目标：优先本平台上的星屑 ----
    let target = null, key = "goal";
    const mine = myPlatform(s);
    const avail = s.rem.filter((c) => (blacklist.get(c[0].toFixed(1) + "," + c[2].toFixed(1)) || 0) < s.runTime);
    if (s.collected >= s.total && s.goal.active) target = s.goal.pos;
    else if (avail.length) {
      const local = mine ? avail.filter((c) => inside(mine, c[0], c[2]) && Math.abs(c[1] - mine.top) < 3.0) : [];
      const pool = local.length ? local : avail;
      pool.sort((a, b) => Math.hypot(a[0] - s.pos[0], a[2] - s.pos[2]) - Math.hypot(b[0] - s.pos[0], b[2] - s.pos[2]));
      target = pool[0]; key = target[0].toFixed(1) + "," + target[2].toFixed(1);
    } else if (s.goal.active) target = s.goal.pos;
    else { blacklist.clear(); continue; }

    const dx = target[0] - s.pos[0], dz = target[2] - s.pos[2], dy = target[1] - s.pos[1];
    const dist = Math.hypot(dx, dz);
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    let nx = dx / (dist || 1), nz = dz / (dist || 1);

    // 方向选择：正前方优先，无支撑时找有支撑的偏角
    let supportedDirect = supported(s.cols, s.pos[0] + nx * 1.5, s.pos[2] + nz * 1.5, s.pos[1]);
    let chosen = null, chosenDeg = null;
    for (const deg of [0, 20, -20, 40, -40, 60, -60, 80, -80]) {
      const a = (deg * Math.PI) / 180;
      const cx2 = nx * Math.cos(a) - nz * Math.sin(a), cz2 = nx * Math.sin(a) + nz * Math.cos(a);
      if (supported(s.cols, s.pos[0] + cx2 * 1.5, s.pos[2] + cz2 * 1.5, s.pos[1]) && !chosen) { chosen = [cx2, cz2]; chosenDeg = deg; }
    }

    if (dist < bestDist - 0.3) { bestDist = dist; lastProgress = s.runTime; }
    const idle = s.runTime - lastProgress;
    let jump = false;
    const wantRun = dist > 1.8;
    if (s.grounded && !supportedDirect) { jump = true; }
    if (s.grounded && dy > 0.7 && dist < 2.6) jump = true;
    if (idle > 1.2 && s.runTime > nextJumpAt) { jump = true; nextJumpAt = s.runTime + 1.0; }
    if (idle > 10) { blacklist.set(key, s.runTime + 30); bestDist = Infinity; lastProgress = s.runTime;
      trace.push({ t: s.runTime, note: "blacklist " + key }); continue; }

    // 空中或前方空旷时，不要朝虚空直线冲：转向有支撑的偏角（掉落时才用，避免来回摆）
    if (!s.grounded && !supportedDirect && chosen && Math.abs(chosenDeg) > 0 && s.pos[1] < -1.0) { nx = chosen[0]; nz = chosen[1]; }
    else if (s.grounded && !supportedDirect && chosen && Math.abs(chosenDeg) > 40) { nx = chosen[0]; nz = chosen[1]; }

    const ix = nx * cos - nz * sin, iz = -nx * sin - nz * cos;

    if (profile.mobile) {
      if (jump) { await tapBtn("#btnJump"); jumps++; }
      await stickBurst(Math.max(-1, Math.min(1, ix * 1.5)), Math.max(-1, Math.min(1, iz * 1.5)), jump ? 300 : 560);
    } else {
      const want = new Set();
      if (Math.abs(ix) > 0.2) want.add(ix > 0 ? "d" : "a");
      if (Math.abs(iz) > 0.2) want.add(iz > 0 ? "w" : "s");
      if (wantRun) want.add("Shift");
      if (jump) { await setKeys(new Set([...want, " "])); jumps++; await page.waitForTimeout(70); await setKeys(want); await page.waitForTimeout(80); }
      else { await setKeys(want); await page.waitForTimeout(90); }
    }

    if (s.runTime - lastTick > 6) {
      lastTick = s.runTime;
      trace.push({ t: s.runTime, L: s.level, c: s.collected + "/" + s.total, pos: s.pos.map((v) => +v.toFixed(1)), target: key, dist: +dist.toFixed(1), idle: +idle.toFixed(1), hearts: s.hearts, falls, local: avail.length });
      curLevel.trace = trace.slice(-14);
      rec.jumps = jumps; rec.falls = falls; rec.trace = trace.slice(-40);
      results[profile.id] = rec;
      await fs.writeFile(`${OUT}/round8.json`, JSON.stringify(results, null, 1)).catch(() => {});
    }
  }
  await releaseKeys();
  rec.jumps = jumps; rec.falls = falls;
  return rec;
}

const results = {};
for (const p of profiles) {
  const rec = { profile: p.label, viewport: [p.w, p.h], dpr: p.dpr, mobile: p.mobile, levels: [] };
  results[p.id] = rec;
  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: p.mobile, screenOrientation: { type: p.mobile ? "portraitPrimary" : "landscapePrimary", angle: 0 } });
    await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: p.mobile, maxTouchPoints: p.mobile ? 5 : 1 });
    await page.cdp("Emulation.setUserAgentOverride", { userAgent: p.ua, platform: p.platform });
    await page.goto(URL);
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
    if (p.mobile) await tapBtn("[data-act=start]"); else await page.click("[data-act=start]");
    await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
    await page.waitForTimeout(1200);
    await play(p, results, rec);
  } catch (e) { rec.error = String(e && (e.message || e)).slice(0, 220); }
  await fs.writeFile(`${OUT}/round8.json`, JSON.stringify(results, null, 1));
  console.log("GAME", p.id, rec.error || JSON.stringify(rec.levels.map((l) => ({ L: l.index, name: l.name, total: l.totalCrystals, cleared: l.cleared, auto: l.advancedTo || null, afterSec: l.advancedAfterSec || null, result: l.result && l.result.title, autoText: l.result && l.result.autoNextText }))), "falls", rec.falls, "jumps", rec.jumps, rec.note || "");
}
console.log("ROUND8 DONE");
