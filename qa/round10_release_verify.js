// 发布前验证：1) 纯静态托管（无 COOP/COEP，等价 Vercel/itch）能跑；2) iframe 内 pointer lock 被拒时的鼠标回退
const fs = await import("node:fs/promises");
const task = await taskSpace("stardust release verify");
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const BASE = "http://127.0.0.1:8199/index.html";
const out = {};

await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1512, height: 945, deviceScaleFactor: 2, mobile: false });
await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
await page.cdp("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel" });

// ---- 1) 静态托管：加载 + 资源完整性 + 可玩 ----
const reqs = [];
page.cdp("Network.enable").catch(() => {});
await page.goto(BASE);
await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
await page.waitForTimeout(2500);
out.static = await page.evaluate(() => {
  const res = performance.getEntriesByType("resource").map((r) => r.name.replace(location.origin + "/", ""));
  return { resources: res.length, list: res,
    errors: window.__errors.slice(0, 8), ready: !!window.__ready,
    pixelRatio: window.__game.renderer.getPixelRatio(), tris: window.__game.renderer.info.render.triangles,
    dprCapRespected: window.__game.renderer.getPixelRatio() <= 2 };
});
await page.click("[data-act=start]");
await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
await page.waitForTimeout(2000);
const p0 = await page.evaluate(() => [...window.__game.player.pos.toArray()]);
await page.keyboard.down("w"); await page.waitForTimeout(1500); await page.keyboard.up("w");
const p1 = await page.evaluate(() => [...window.__game.player.pos.toArray()]);
out.static.playable = { moved: +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2), fps: await page.evaluate(() => window.__game.fps) };
await page.screenshot({ path: `${OUT}/rel_static_play.png` }).catch(() => {});

// ---- 2) 正常环境：点击两次 = 先锁定、再攻击 ----
await page.mouse.click(756, 500); await page.waitForTimeout(600);
out.normal_firstClick = await page.evaluate(() => ({ locked: !!document.pointerLockElement, lockUnavailable: window.__game.lockUnavailable }));
await page.mouse.click(756, 500); await page.waitForTimeout(250);
out.normal_secondClick = await page.evaluate(() => ({ spinning: window.__game.player.spinT > 0, locked: !!document.pointerLockElement, lockUnavailable: window.__game.lockUnavailable }));

// ---- 3) 模拟 iframe 权限策略拒绝 pointer lock ----
await page.evaluate(() => {
  window.__game.lockUnavailable = false;
  window.__lockAttempts = 0;
  const c = document.querySelector("#game");
  c.requestPointerLock = () => { window.__lockAttempts++; document.dispatchEvent(new Event("pointerlockerror")); return Promise.reject(new Error("denied by permissions policy")); };
});
await page.mouse.click(756, 500); await page.waitForTimeout(700);
out.denied_firstClick = await page.evaluate(() => ({ attempts: window.__lockAttempts, lockUnavailable: window.__game.lockUnavailable, locked: !!document.pointerLockElement }));
await page.evaluate(() => { window.__game.player.spinT = 0; });
await page.mouse.click(756, 500); await page.waitForTimeout(250);
out.denied_secondClick = await page.evaluate(() => ({ spinning: window.__game.player.spinT > 0, attempts: window.__lockAttempts, lockUnavailable: window.__game.lockUnavailable }));

// ---- 4) 键盘 J 攻击仍然可用 ----
await page.evaluate(() => { window.__game.player.spinT = 0; });
await page.keyboard.press("j"); await page.waitForTimeout(200);
out.keyJ = await page.evaluate(() => ({ spinning: window.__game.player.spinT > 0 }));

// ---- 5) 移动端触摸在静态托管下也正常 ----
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await page.goto(BASE);
await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
const startBtn = await page.evaluate(() => { const r = document.querySelector("[data-act=start]").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startBtn[0], y: startBtn[1], id: 1, radiusX: 12, radiusY: 12, force: 1 }] });
await page.waitForTimeout(80);
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
out.mobile = await page.evaluate(() => ({ state: window.__game.state, touchUI: !document.querySelector("#touch").classList.contains("hidden"),
  pauseBtn: document.querySelector("#btnPause").getBoundingClientRect().width, errors: window.__errors.slice(0, 5), size: [window.__game.canvasSize ? null : document.querySelector("#game").width, document.querySelector("#game").height] }));
await page.screenshot({ path: `${OUT}/rel_mobile_play.png` }).catch(() => {});

await fs.writeFile(`${OUT}/release_verify.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 2600));
await task.finish({ keep: [] });
