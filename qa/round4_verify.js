// QA round 4: verify the fixes on all four profiles
const fs = await import("node:fs/promises");
const task = await taskSpace(4);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";

const profiles = [
  { id: "mac", w: 1512, h: 945, dpr: 2, mobile: false, ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel", touch: 1 },
  { id: "pc", w: 1920, h: 1080, dpr: 1, mobile: false, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "Win32", touch: 1 },
  { id: "iphone", w: 390, h: 844, dpr: 3, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", platform: "iPhone", touch: 5 },
  { id: "android", w: 393, h: 851, dpr: 2.75, mobile: true, ua: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l", touch: 5 },
];

const geo = () => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), shown: !e.classList.contains('hidden') && b.width > 0 && b.height > 0 }; };
  const overlaps = (a, b) => { if (!a || !b || !a.shown || !b.shown) return null;
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ox > 0 && oy > 0 ? { ox, oy, area: ox * oy } : null; };
  const el = { prompt: r('#prompt'), stick: r('#stick'), jump: r('#btnJump'), spin: r('#btnSpin'), cam: r('#btnCam'), pause: r('#btnPause'), statPanel: r('.stat-panel'), hearts: r('#hearts') };
  const pairs = [['stick', 'prompt'], ['jump', 'prompt'], ['spin', 'prompt'], ['cam', 'prompt'], ['pause', 'statPanel'], ['pause', 'hearts'], ['jump', 'pause'], ['stick', 'jump'], ['jump', 'cam'], ['stick', 'statPanel']];
  const ov = {}; for (const [a, b] of pairs) { const o = overlaps(el[a], el[b]); if (o) ov[`${a}~${b}`] = o; }
  const cp = el.pause; const inView = cp ? (cp.x >= 0 && cp.y >= 0 && cp.x + cp.w <= innerWidth && cp.y + cp.h <= innerHeight) : null;
  return { el, overlaps: ov, pauseInsideViewport: inView, view: [innerWidth, innerHeight] };
});
const helpBox = () => page.evaluate(() => { const e = document.querySelector('#help .panel'); const b = e.getBoundingClientRect();
  return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth, vh: innerHeight,
    fitsW: b.left >= -1 && b.right <= innerWidth + 1, fitsH: b.top >= -1 && b.bottom <= innerHeight + 1 }; });
const touch = (type, pts) => page.cdp("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 12, radiusY: 12, force: 1 })) });
const tap = async (x, y) => { await touch("touchStart", [[x, y]]); await page.waitForTimeout(90); await touch("touchEnd", []); };
const shot = async (n) => { try { await page.waitForTimeout(320); await page.screenshot({ path: `${OUT}/${n}.png` }); return "ok"; } catch (e) { return "FAIL"; } };

const results = {};
for (const p of profiles) {
  const rec = { profile: p.id, viewport: [p.w, p.h], dpr: p.dpr, shots: {} };
  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: p.mobile, screenOrientation: { type: p.mobile ? "portraitPrimary" : "landscapePrimary", angle: 0 } });
    await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: p.mobile, maxTouchPoints: p.touch });
    await page.cdp("Emulation.setUserAgentOverride", { userAgent: p.ua, platform: p.platform });
    await page.goto(URL);
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });

    // 1) 帮助面板
    await page.click("[data-act=help]"); await page.waitForTimeout(600);
    rec.help = await helpBox();
    rec.shots.help = await shot(`${p.id}_r4_help`);
    await page.click("[data-act=totitle]"); await page.waitForTimeout(400);

    // 2) 进游戏 → 提示条是否还压住操作区
    await page.click("[data-act=start]");
    await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
    await page.waitForTimeout(2000);
    // 强制显示提示条（原本只在缺星屑时出现）
    await page.evaluate(() => { const p = document.querySelector('#prompt'); if (p) { p.classList.remove('hidden'); p.textContent = '再收集 17 颗星屑就能开启光环'; } });
    await page.waitForTimeout(300);
    rec.playGeo = await geo();
    rec.shots.play = await shot(`${p.id}_r4_play`);

    // 3) 移动端暂停按钮：点一下 → 暂停；点「继续游戏」 → 回到游戏
    if (p.mobile) {
      const pb = rec.playGeo.el.pause;
      await page.screenshot({ path: `${OUT}/${p.id}_r4_before_pause.png` }).catch(() => {});
      await tap(pb.x + pb.w / 2, pb.y + pb.h / 2);
      await page.waitForTimeout(700);
      rec.pauseTap = await page.evaluate(() => ({ state: window.__game.state, pauseShown: !document.querySelector('#pause').classList.contains('hidden'),
        touchHidden: document.querySelector('#touch').classList.contains('hidden'), input: { ...window.__game.input } }));
      rec.shots.pause = await shot(`${p.id}_r4_pause`);
      const resume = await page.evaluate(() => { const b = document.querySelector('[data-act=resume]'); const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
      await tap(resume[0], resume[1]);
      await page.waitForTimeout(600);
      rec.resumeTap = await page.evaluate(() => ({ state: window.__game.state, touchShown: !document.querySelector('#touch').classList.contains('hidden') }));

      // 4) 横屏：帮助面板是否还超出高度
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.h, height: p.w, deviceScaleFactor: p.dpr, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
      await page.waitForTimeout(900);
      rec.landscapeGeo = await geo();
      rec.shots.landscape = await shot(`${p.id}_r4_landscape`);
      await page.evaluate(() => { document.querySelector('[data-act=help]') ? null : null; });
      await page.evaluate(() => window.__game.show('help'));
      await page.waitForTimeout(500);
      rec.helpLandscape = await helpBox();
      rec.shots.helpLandscape = await shot(`${p.id}_r4_help_landscape`);
      await page.evaluate(() => window.__game.show(null));
      await page.waitForTimeout(300);
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
      await page.waitForTimeout(600);
    } else {
      rec.pauseBtnOnDesktop = await page.evaluate(() => { const e = document.querySelector('#btnPause'); const b = e.getBoundingClientRect();
        return { exists: !!e, visible: b.width > 0 && !document.querySelector('#touch').classList.contains('hidden') }; });
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      rec.desktopPause = await page.evaluate(() => window.__game.state);
      await page.click("[data-act=resume]"); await page.waitForTimeout(400);
    }
  } catch (e) { rec.error = String(e && (e.message || e)).slice(0, 200); }
  results[p.id] = rec;
  await fs.writeFile(`${OUT}/round4.json`, JSON.stringify(results, null, 1));
  console.log("verify done:", p.id, rec.error || "ok");
}
console.log("ROUND4 DONE");
