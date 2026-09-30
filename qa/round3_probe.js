// QA round 3: frame cost (throttle-independent), UI geometry/overlap, mobile menu gap, desktop key holds
const fs = await import("node:fs/promises");
const task = await taskSpace(4);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";

const profiles = [
  { id: "mac", w: 1512, h: 945, dpr: 2, mobile: false, ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel", maxTouchPoints: 1 },
  { id: "pc", w: 1920, h: 1080, dpr: 1, mobile: false, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "Win32", maxTouchPoints: 1 },
  { id: "iphone", w: 390, h: 844, dpr: 3, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 },
  { id: "android", w: 393, h: 851, dpr: 2.75, mobile: true, ua: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 },
];
const shot = async (n) => { try { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${n}.png` }); return "ok"; } catch (e) { return "FAIL:" + String(e.message || e).slice(0, 40); } };

const geo = () => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), shown: !e.classList.contains('hidden') && b.width > 0 && b.height > 0 };
  };
  const overlaps = (a, b) => { if (!a || !b || !a.shown || !b.shown) return null;
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ox > 0 && oy > 0 ? { overlapPx: ox * oy, ox, oy } : null; };
  const el = { hearts: r('#hearts'), hudLevel: r('#hud-level'), statPanel: r('.stat-panel'), toast: r('#toast'), prompt: r('#prompt'),
    stick: r('#stick'), jump: r('#btnJump'), spin: r('#btnSpin'), cam: r('#btnCam'), tbtns: r('.tbtns') };
  const pairs = [['stick', 'statPanel'], ['stick', 'hearts'], ['stick', 'hudLevel'], ['jump', 'statPanel'], ['jump', 'prompt'], ['stick', 'prompt'], ['tbtns', 'toast'], ['cam', 'prompt']];
  const ov = {}; for (const [a, b] of pairs) { const o = overlaps(el[a], el[b]); if (o) ov[`${a}~${b}`] = o; }
  return { el, overlaps: ov, view: [innerWidth, innerHeight] };
});

const frameCost = () => page.evaluate(() => {
  const g = window.__game;
  const gl = g.renderer.getContext();
  const time = (n, fn) => { gl.finish(); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); gl.finish(); return +((performance.now() - t0) / n).toFixed(2); };
  const base = time(20, () => g.renderer.render(g.scene, g.camera));
  const prBefore = g.renderer.getPixelRatio();
  g.renderer.setPixelRatio(1);
  const atPR1 = time(20, () => g.renderer.render(g.scene, g.camera));
  g.renderer.setPixelRatio(prBefore);
  const shadowOn = g.renderer.shadowMap.enabled;
  const sunOn = g.sun ? g.sun.castShadow : null;
  g.renderer.shadowMap.enabled = false;
  if (g.sun) g.sun.castShadow = false;
  g.scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => (x.needsUpdate = true)); } });
  const noShadow = time(20, () => g.renderer.render(g.scene, g.camera));
  g.renderer.shadowMap.enabled = shadowOn;
  if (g.sun) g.sun.castShadow = sunOn;
  g.scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => (x.needsUpdate = true)); } });
  return { msPerFrame: base, msPerFramePR1: atPR1, msPerFrameNoShadow: noShadow, pixelRatio: prBefore,
    tris: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls,
    shadowMapSize: g.sun ? [g.sun.shadow.mapSize.x, g.sun.shadow.mapSize.y] : null,
    antialiasUsed: g.renderer.getContext().getContextAttributes().antialias,
    budget60: +(1000 / 60).toFixed(1) };
});

const clickables = () => page.evaluate(() => [...document.querySelectorAll('button, [data-act], [onclick]')]
  .filter((e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })
  .map((e) => ({ tag: e.tagName, act: e.dataset.act || null, id: e.id || null, text: (e.textContent || '').trim().slice(0, 10) })));

const results = {};
for (const p of profiles) {
  const rec = { profile: p.id, viewport: [p.w, p.h], dpr: p.dpr, mobile: p.mobile, shots: {} };
  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: p.mobile, screenOrientation: { type: p.mobile ? "portraitPrimary" : "landscapePrimary", angle: 0 } });
    await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: p.mobile, maxTouchPoints: p.maxTouchPoints });
    await page.cdp("Emulation.setUserAgentOverride", { userAgent: p.ua, platform: p.platform });
    await page.goto(URL);
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
    rec.shots.title = await shot(`${p.id}_r3_title`);

    // 标题界面可点元素（人能看到什么）
    rec.titleButtons = await clickables();
    rec.titleGeo = await geo();

    // 帮助面板
    await page.click("[data-act=help]"); await page.waitForTimeout(600);
    rec.shots.help = await shot(`${p.id}_r3_help`);
    rec.helpGeo = await page.evaluate(() => { const e = document.querySelector('#help .panel'); const b = e.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), scrollable: e.scrollHeight > e.clientHeight, contentH: e.scrollHeight, viewportH: innerHeight }; });
    await page.click("[data-act=totitle]"); await page.waitForTimeout(500);

    // 鉴赏
    await page.click("[data-act=gallery]"); await page.waitForTimeout(1500);
    rec.shots.gallery = await shot(`${p.id}_r3_gallery`);
    await page.click("[data-act=totitle]"); await page.waitForTimeout(500);

    // 进入游戏
    await page.click("[data-act=start]");
    await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
    await page.waitForTimeout(2500);
    rec.geo = await geo();
    rec.inGameButtons = await clickables();
    rec.frame = await frameCost();
    rec.shots.play = await shot(`${p.id}_r3_play`);

    if (p.mobile) {
      // 移动端：横屏几何
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.h, height: p.w, deviceScaleFactor: p.dpr, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
      await page.waitForTimeout(1200);
      rec.geoLandscape = await geo();
      rec.shots.landscape = await shot(`${p.id}_r3_landscape`);
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
      await page.waitForTimeout(800);
    } else {
      // 桌面：按住 Q/E 400ms（真人按键时长）+ 滚轮缩放 + 鼠标视角（pointer lock）
      const y0 = await page.evaluate(() => window.__game.rig.yaw);
      await page.keyboard.down("q"); await page.waitForTimeout(400); await page.keyboard.up("q"); await page.waitForTimeout(150);
      const y1 = await page.evaluate(() => window.__game.rig.yaw);
      await page.keyboard.down("e"); await page.waitForTimeout(400); await page.keyboard.up("e"); await page.waitForTimeout(150);
      const y2 = await page.evaluate(() => window.__game.rig.yaw);
      rec.keyHold = { yawStart: +y0.toFixed(3), afterQ: +y1.toFixed(3), afterE: +y2.toFixed(3) };
      const d0 = await page.evaluate(() => window.__game.rig.dist);
      await page.mouse.move(p.w / 2, p.h / 2); await page.mouse.wheel(0, 600); await page.waitForTimeout(300);
      const d1 = await page.evaluate(() => window.__game.rig.dist);
      rec.wheelZoom = { before: +d0.toFixed(2), after: +d1.toFixed(2) };
      // 左键第一次=请求指针锁定，第二次=攻击
      await page.mouse.click(p.w / 2, p.h / 2); await page.waitForTimeout(500);
      rec.pointerLock = await page.evaluate(() => ({ locked: !!document.pointerLockElement, spin: window.__game.player.spinning === undefined ? null : !!window.__game.player.spinning }));
      await page.mouse.click(p.w / 2, p.h / 2); await page.waitForTimeout(400);
      rec.click2 = await page.evaluate(() => ({ spinning: !!window.__game.player.spinT, locked: !!document.pointerLockElement }));
      // Esc 之后是否还能移动（指针锁定残留）
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      rec.escState = await page.evaluate(() => window.__game.state);
      await page.click("[data-act=resume]"); await page.waitForTimeout(400);
    }
  } catch (e) { rec.error = String(e && (e.message || e)).slice(0, 200); }
  results[p.id] = rec;
  await fs.writeFile(`${OUT}/round3.json`, JSON.stringify(results, null, 1));
  console.log("profile done:", p.id, rec.error || "ok", rec.frame ? `ms/frame=${rec.frame.msPerFrame}` : "");
}
console.log("ROUND3 DONE");
