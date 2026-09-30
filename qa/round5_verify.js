// QA round 5: re-verify portrait touch layout after the stick/button resize
const fs = await import("node:fs/promises");
const task = await taskSpace(4);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";

const profiles = [
  { id: "iphone", w: 390, h: 844, dpr: 3, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", platform: "iPhone" },
  { id: "android", w: 393, h: 851, dpr: 2.75, ua: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l" },
];
const geo = () => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), shown: !e.classList.contains('hidden') && b.width > 0 }; };
  const ov = (a, b) => { if (!a || !b || !a.shown || !b.shown) return null;
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ox > 0 && oy > 0 ? { ox, oy, area: ox * oy } : null; };
  const el = { prompt: r('#prompt'), stick: r('#stick'), jump: r('#btnJump'), spin: r('#btnSpin'), cam: r('#btnCam'), pause: r('#btnPause'), statPanel: r('.stat-panel'), hearts: r('#hearts'), tbtns: r('.tbtns') };
  const pairs = [['stick', 'jump'], ['stick', 'spin'], ['stick', 'cam'], ['stick', 'prompt'], ['jump', 'prompt'], ['spin', 'prompt'], ['cam', 'prompt'], ['pause', 'statPanel'], ['pause', 'hearts'], ['tbtns', 'prompt'], ['stick', 'tbtns']];
  const res = {}; for (const [a, b] of pairs) { const o = ov(el[a], el[b]); if (o) res[`${a}~${b}`] = o; }
  return { el, overlaps: res, tapTargets: { jump: el.jump && el.jump.w, spin: el.spin && el.spin.w, cam: el.cam && el.cam.w, stick: el.stick && el.stick.w, pause: el.pause && el.pause.w } };
});
const touch = (t, pts) => page.cdp("Input.dispatchTouchEvent", { type: t, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 12, radiusY: 12, force: 1 })) });
const tap = async (x, y) => { await touch("touchStart", [[x, y]]); await page.waitForTimeout(90); await touch("touchEnd", []); };
const shot = async (n) => { try { await page.waitForTimeout(320); await page.screenshot({ path: `${OUT}/${n}.png` }); return "ok"; } catch (e) { return "FAIL"; } };

const results = {};
for (const p of profiles) {
  const rec = { profile: p.id };
  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
    await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.cdp("Emulation.setUserAgentOverride", { userAgent: p.ua, platform: p.platform });
    await page.goto(URL);
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
    await page.click("[data-act=start]");
    await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { const x = document.querySelector('#prompt'); if (x) { x.classList.remove('hidden'); x.textContent = '再收集 17 颗星屑就能开启光环'; } });
    await page.waitForTimeout(300);
    rec.portrait = await geo();
    rec.shots = { play: await shot(`${p.id}_r5_play`) };

    // 摇杆推动仍要生效（缩小后重新确认可用）
    const s = rec.portrait.el.stick;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const p0 = await page.evaluate(() => [...window.__game.player.pos.toArray()]);
    await touch("touchStart", [[cx, cy]]);
    for (let i = 1; i <= 6; i++) { await touch("touchMove", [[cx, cy - i * 8]]); await page.waitForTimeout(80); }
    await page.waitForTimeout(1500);
    await touch("touchEnd", []);
    const p1 = await page.evaluate(() => [...window.__game.player.pos.toArray()]);
    rec.stickStillWorks = +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2);
    // 跳按钮仍生效
    const j = rec.portrait.el.jump;
    const y0 = await page.evaluate(() => window.__game.player.pos.y);
    await tap(j.x + j.w / 2, j.y + j.h / 2);
    await page.waitForTimeout(260);
    rec.jumpStillWorks = { y0: +y0.toFixed(2), y1: +(await page.evaluate(() => window.__game.player.pos.y)).toFixed(2) };
    await page.waitForTimeout(1200);

    // 横屏回归
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.h, height: p.w, deviceScaleFactor: p.dpr, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await page.waitForTimeout(900);
    rec.landscape = await geo();
    rec.shots.landscape = await shot(`${p.id}_r5_landscape`);
  } catch (e) { rec.error = String(e && (e.message || e)).slice(0, 200); }
  results[p.id] = rec;
  await fs.writeFile(`${OUT}/round5.json`, JSON.stringify(results, null, 1));
  console.log("r5 done:", p.id, rec.error || "ok");
}
console.log("ROUND5 DONE");
