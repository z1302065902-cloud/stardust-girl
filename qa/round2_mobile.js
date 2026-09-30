// QA round 2: iPhone + Android phone — touch emulation, portrait/landscape
const fs = await import("node:fs/promises");
const task = await taskSpace("stardust girl QA - 4 devices");
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";

const devs = [
  { id: "iphone", name: "苹果手机 iPhone (iOS Safari UA)", w: 390, h: 844, dpr: 3, mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", platform: "iPhone" },
  { id: "android", name: "安卓手机 (Android Chrome UA)", w: 393, h: 851, dpr: 2.75, mobile: true,
    ua: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l" },
];

const readState = () => page.evaluate(() => {
  const g = window.__game, c = document.querySelector('#game');
  const vis = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), shown: !e.classList.contains('hidden') && r.width > 0 }; };
  const btns = [...document.querySelectorAll('#touch .tbtn')].map((e) => { const r = e.getBoundingClientRect();
    return { id: e.id, c: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)], size: [Math.round(r.width), Math.round(r.height)] }; });
  return {
    errors: (window.__errors || []).slice(0, 10), state: g && g.state, fps: g && g.fps,
    tris: g && g.renderer ? g.renderer.info.render.triangles : null,
    pixelRatio: g && g.renderer ? g.renderer.getPixelRatio() : null,
    pos: g && g.player ? [+g.player.pos.x.toFixed(2), +g.player.pos.y.toFixed(2), +g.player.pos.z.toFixed(2)] : null,
    input: g ? { ...g.input } : null,
    yaw: g && g.rig ? +g.rig.yaw.toFixed(3) : null,
    collected: g && g.run ? g.run.collected : null, total: g && g.run ? g.run.total : null,
    hearts: g && g.hearts, touchEnabled: g && g.touchEnabled,
    hud: vis('#hud'), touch: vis('#touch'), stick: vis('#stick'),
    btns, canvasCss: [c.clientWidth, c.clientHeight], canvasBuf: [c.width, c.height], dpr: window.devicePixelRatio,
    hoverNone: matchMedia('(hover: none)').matches, hasTouchStart: 'ontouchstart' in window,
    scroll: { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight },
  };
});

const touch = (type, points) => page.cdp("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 12, radiusY: 12, force: 1 })) });
const tap = async (x, y) => { await touch("touchStart", [[x, y]]); await page.waitForTimeout(90); await touch("touchEnd", []); };
const sampleY = async (ms, step = 130) => { const o = []; for (let t = 0; t < ms; t += step) { o.push((await readState()).pos[1]); await page.waitForTimeout(step); } return o; };

const results = {};
for (const d of devs) {
  const rec = { device: d.name, viewport: [d.w, d.h], dpr: d.dpr, notes: [] };
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.cdp("Emulation.setUserAgentOverride", { userAgent: d.ua, platform: d.platform });
  await page.goto(URL);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
  rec.boot = await readState();
  await page.screenshot({ path: `${OUT}/${d.id}_01_title.png` });

  // 人：拇指点「开始游戏」
  const startBtn = await page.evaluate(() => { const e = document.querySelector('[data-act=start]'); const r = e.getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width), Math.round(r.height)]; });
  rec.startBtn = startBtn;
  await tap(startBtn[0], startBtn[1]);
  await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  rec.playStart = await readState();
  await page.screenshot({ path: `${OUT}/${d.id}_02_play.png` });

  // 人：左拇指推摇杆向前 2.5s（touchStart on stick → touchMove up）
  const s = rec.playStart.stick;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const p0 = (await readState()).pos;
  await touch("touchStart", [[cx, cy]]);
  await page.waitForTimeout(120);
  for (let i = 1; i <= 6; i++) { await touch("touchMove", [[cx, cy - i * 9]]); await page.waitForTimeout(90); }
  const stickState = await readState();
  await page.waitForTimeout(1800);
  await touch("touchEnd", []);
  await page.waitForTimeout(300);
  const p1 = (await readState()).pos;
  rec.stickMove = { stickCenter: [cx, cy], inputWhilePushing: stickState.input, from: p0, to: p1, dist: +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2) };
  rec.afterStickRelease = await readState().then((r) => r.input);
  await page.screenshot({ path: `${OUT}/${d.id}_03_stick.png` });

  // 人：右拇指拖动转视角（右半屏）1s
  const yaw0 = (await readState()).yaw;
  await touch("touchStart", [[d.w * 0.8, d.h * 0.5]]);
  for (let i = 1; i <= 5; i++) { await touch("touchMove", [[d.w * 0.8 - i * 22, d.h * 0.5]]); await page.waitForTimeout(80); }
  await touch("touchEnd", []);
  rec.lookDrag = { yawBefore: yaw0, yawAfter: (await readState()).yaw };

  // 人：点「跳」两次（二段跳）
  const jumpBtn = rec.playStart.btns.find((b) => b.id === "btnJump");
  await page.waitForTimeout(1500);
  await tap(jumpBtn.c[0], jumpBtn.c[1]);
  rec.jumpSeries = await sampleY(1200);
  await tap(jumpBtn.c[0], jumpBtn.c[1]);
  rec.jumpSeries2 = await sampleY(900);

  // 人：点「旋」攻击
  const spinBtn = rec.playStart.btns.find((b) => b.id === "btnSpin");
  const scoreBefore = (await readState()).collected;
  await tap(spinBtn.c[0], spinBtn.c[1]);
  await page.waitForTimeout(800);
  rec.spin = { collectedBefore: scoreBefore, collectedAfter: (await readState()).collected, fps: (await readState()).fps };
  await page.screenshot({ path: `${OUT}/${d.id}_04_spin.png` });

  // 人：点「视」转镜头
  const camBtn = rec.playStart.btns.find((b) => b.id === "btnCam");
  const yawB = (await readState()).yaw;
  for (let i = 0; i < 3; i++) { await tap(camBtn.c[0], camBtn.c[1]); await page.waitForTimeout(250); }
  rec.camBtn = { yawBefore: yawB, yawAfter: (await readState()).yaw };

  // 人：横屏旋转
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: d.h, height: d.w, deviceScaleFactor: d.dpr, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
  await page.waitForTimeout(1200);
  rec.afterRotate = await readState();
  await page.screenshot({ path: `${OUT}/${d.id}_05_landscape.png` });

  // 横屏下再推摇杆
  const s2 = rec.afterRotate.stick;
  const r0 = (await readState()).pos;
  await touch("touchStart", [[s2.x + s2.w / 2, s2.y + s2.h / 2]]);
  for (let i = 1; i <= 6; i++) { await touch("touchMove", [[s2.x + s2.w / 2, s2.y + s2.h / 2 - i * 9]]); await page.waitForTimeout(90); }
  await page.waitForTimeout(1500);
  await touch("touchEnd", []);
  const r1 = (await readState()).pos;
  rec.landscapeMove = { from: r0, to: r1, dist: +Math.hypot(r1[0] - r0[0], r1[2] - r0[2]).toFixed(2) };

  // 竖屏回退 + 长跑 8s 看帧率
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
  await page.waitForTimeout(800);
  await touch("touchStart", [[cx, cy]]);
  for (let i = 1; i <= 6; i++) { await touch("touchMove", [[cx, cy - i * 12]]); await page.waitForTimeout(60); }
  await page.waitForTimeout(8000);
  await touch("touchEnd", []);
  rec.longRun = await readState();
  await page.screenshot({ path: `${OUT}/${d.id}_06_longrun.png` });
  results[d.id] = rec;
}
await fs.writeFile(`${OUT}/round2.json`, JSON.stringify(results, null, 1));
console.log("ROUND2 DONE", JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
  fps: v.longRun.fps, tris: v.longRun.tris, pixelRatio: v.longRun.pixelRatio, errors: v.longRun.errors,
  touchEnabled: v.longRun.touchEnabled, stickMoved: v.stickMove.dist, jumpPeak: Math.max(...v.jumpSeries), lookDrag: v.lookDrag, rotateCss: v.afterRotate.canvasCss,
}]))));
