// QA round 7 v2: full-level playthrough with REAL input, progress trace, honest reporting
const fs = await import("node:fs/promises");
const task = await taskSpace(7);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";

const profiles = [
  { id: "mac", label: "苹果电脑 macOS", w: 1512, h: 945, dpr: 2, mobile: false,
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel" },
  { id: "iphone", label: "苹果手机 iPhone", w: 390, h: 844, dpr: 3, mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", platform: "iPhone" },
];
const MAX_SEC = 420;

const state = () => page.evaluate(() => {
  const g = window.__game;
  if (!g || !g.level) return { state: g ? g.state : "none" };
  const p = g.player.pos, lvl = g.level;
  return { state: g.state, pos: [p.x, p.y, p.z], grounded: !!g.player.grounded, jumps: g.player.jumps,
    rem: lvl.crystals.filter((c) => !c.taken).map((c) => [c.pos.x, c.pos.y, c.pos.z]),
    goal: { pos: [lvl.goal.pos.x, lvl.goal.pos.y, lvl.goal.pos.z], active: !!lvl.goal.active, radius: lvl.goal.radius },
    collected: g.run.collected, total: g.run.total, runTime: +g.run.time.toFixed(2), hearts: g.hearts, yaw: g.rig.yaw,
    levelIndex: g.levelIndex,
    result: { shown: !document.querySelector("#result").classList.contains("hidden"),
      title: (document.querySelector("#result-title") || {}).textContent || "",
      stats: (document.querySelector("#result-stats") || {}).textContent || "",
      rank: (document.querySelector("#result-rank") || {}).textContent || "" },
    errors: window.__errors.slice(0, 5) };
});

const keys = new Set();
const setKeys = async (want) => {
  const add = [...want].filter((k) => !keys.has(k)), del = [...keys].filter((k) => !want.has(k));
  for (const k of del) { await page.keyboard.up(k); keys.delete(k); }
  for (const k of add) { await page.keyboard.down(k); keys.add(k); }
};
const releaseAll = async () => { for (const k of [...keys]) { await page.keyboard.up(k); keys.delete(k); } };
const touch = (type, pts, ids) => page.cdp("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: ids ? ids[i] : i + 1, radiusX: 12, radiusY: 12, force: 1 })) });
let stickCenter = null, stickHeld = false;
const stickPress = async (ix, iz) => {
  if (!stickCenter) stickCenter = await page.evaluate(() => { const r = document.querySelector("#stick").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; });
  const [cx, cy, w] = stickCenter;
  const R = w * 0.45;
  const px = cx + ix * R, py = cy - iz * R;
  if (!stickHeld) { await touch("touchStart", [[px, py]], [1]); stickHeld = true; } else await touch("touchMove", [[px, py]], [1]);
};
const stickRelease = async () => { if (stickHeld) { await touch("touchEnd", [], []); stickHeld = false; } };
const tapBtn = async (sel, id = 9) => {
  const c = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  if (!c) return false;
  await touch("touchStart", [[c[0], c[1]]], [id]); await page.waitForTimeout(55); await touch("touchEnd", [], []);
  return true;
};
const clickOrTap = async (p, sel) => {
  if (p.mobile) { const b = await tapBtn(sel); if (!b) throw new Error("no " + sel); }
  else await page.click(sel);
};

async function playLevel(p, rec) {
  const t0 = Date.now();
  const blacklist = new Map();          // key -> until runTime
  const trace = [];
  let lastTrace = -99, bestDist = Infinity, lastProgress = 0, nextJumpAt = 0, lastRunTime = 0, falls = 0, jumps = 0, tricky = 0;

  while ((Date.now() - t0) / 1000 < MAX_SEC) {
    const s = await state();
    if (!s.state) break;
    if (s.state === "result") { rec.result = s.result; rec.finalRun = { collected: s.collected, total: s.total, score: s.hearts, hearts: s.hearts }; break; }
    if (s.state !== "play") { await page.waitForTimeout(300); continue; }
    if (s.runTime - lastRunTime < -0.5) trace.push({ t: s.runTime, note: "level restarted" });
    if (s.pos[1] < -3) falls++;

    let target = null, key = "goal";
    if (s.collected >= s.total && s.goal.active) { target = s.goal.pos; key = "goal"; }
    else {
      const avail = s.rem.filter((c) => (blacklist.get(c[0].toFixed(1) + "," + c[2].toFixed(1)) || 0) < s.runTime)
        .sort((a, b) => Math.hypot(a[0] - s.pos[0], a[2] - s.pos[2]) - Math.hypot(b[0] - s.pos[0], b[2] - s.pos[2]));
      if (avail.length) { target = avail[0]; key = target[0].toFixed(1) + "," + target[2].toFixed(1); }
      else if (s.goal.active) { target = s.goal.pos; key = "goal"; }
      else {
        // 全部被临时拉黑：清空黑名单重来（避免死锁，因为少一颗星屑就无法过关）
        blacklist.clear(); tricky++;
        if (tricky > 8) { trace.push({ t: s.runTime, note: "give up: crystals unreachable" }); break; }
        continue;
      }
    }

    const dx = target[0] - s.pos[0], dz = target[2] - s.pos[2], dy = target[1] - s.pos[1];
    const dist = Math.hypot(dx, dz);
    const nx = dx / (dist || 1), nz = dz / (dist || 1);
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const ix = nx * cos - nz * sin, iz = -nx * sin - nz * cos;
    const wantRun = dist > 1.6;
    let wantJump = false;

    if (dist < bestDist - 0.3) { bestDist = dist; lastProgress = s.runTime; }
    const idle = s.runTime - lastProgress;
    if (idle > 1.4 && s.runTime > nextJumpAt) { wantJump = true; nextJumpAt = s.runTime + 1.1; }
    if (dy > 0.7 && s.grounded) wantJump = true;
    if (idle > 9) { blacklist.set(key, s.runTime + 25); bestDist = Infinity; lastProgress = s.runTime;
      trace.push({ t: s.runTime, note: "blacklist " + key + " for 25s", dist: +dist.toFixed(1) }); continue; }

    if (p.mobile) {
      if (wantJump) { await tapBtn("#btnJump"); jumps++; }
      await stickPress(Math.max(-1, Math.min(1, ix * 1.5)), Math.max(-1, Math.min(1, iz * 1.5)));
      await page.waitForTimeout(85);
    } else {
      const want = new Set();
      if (Math.abs(ix) > 0.2) want.add(ix > 0 ? "d" : "a");
      if (Math.abs(iz) > 0.2) want.add(iz > 0 ? "w" : "s");
      if (wantRun) want.add("Shift");
      if (wantJump) {
        await setKeys(new Set([...want, " "])); jumps++;
        await page.waitForTimeout(60);
        await setKeys(want);
        await page.waitForTimeout(70);
      } else { await setKeys(want); await page.waitForTimeout(70); }
    }

    if (s.runTime - lastTrace > 4) {
      trace.push({ t: s.runTime, c: s.collected + "/" + s.total, pos: s.pos.map((v) => +v.toFixed(1)), target: key, dist: +dist.toFixed(1), idle: +idle.toFixed(1), hearts: s.hearts });
      lastTrace = s.runTime;
      rec.trace = trace;
      await fs.writeFile(`${OUT}/round7.json`, JSON.stringify(rec._all, null, 1)).catch(() => {});
    }
    lastRunTime = s.runTime;
  }
  await releaseAll(); await stickRelease();
  rec.trace = trace; rec.falls = falls; rec.jumps = jumps; rec.tricky = tricky;
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
    await page.waitForTimeout(1500);
    rec.start = await state();
    await playLevel(p, rec);
    try { await page.screenshot({ path: `${OUT}/${p.id}_r7_final.png` }); rec.shot = "ok"; } catch (e) { rec.shot = "FAIL"; }

    const s = await state();
    const won = s.result && s.result.shown && /通过|完成|成功/.test(s.result.title || "");
    rec.resultScreen = s.result;
    if (won) {
      await clickOrTap(p, "[data-act=next]");
      await page.waitForTimeout(3000);
      const a = await state();
      rec.afterNext = { state: a.state, levelIndex: a.levelIndex, collected: a.collected, total: a.total, runTime: a.runTime };
      try { await page.screenshot({ path: `${OUT}/${p.id}_r7_level2.png` }); } catch (e) {}
    } else {
      rec.verdict = s.result && s.result.shown ? "结算但不是通关：" + (s.result.title || "") : "未通关（超时）";
    }
  } catch (e) { rec.error = String(e && (e.message || e)).slice(0, 200); }
  await fs.writeFile(`${OUT}/round7.json`, JSON.stringify(results, null, 1));
  console.log("PLAY", p.id, rec.error || JSON.stringify({ collected: rec.finalRun ? rec.finalRun.collected + "/" + rec.finalRun.total : (rec.trace.length ? rec.trace[rec.trace.length - 1].c : "?"), result: rec.resultScreen && rec.resultScreen.title, afterNext: rec.afterNext || null, falls: rec.falls, jumps: rec.jumps, verdict: rec.verdict || null }));
}
console.log("ROUND7 DONE");
