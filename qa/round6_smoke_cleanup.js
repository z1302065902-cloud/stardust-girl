import fs from "node:fs/promises";
const task = await taskSpace(4);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";

// 桌面回归（改完 CSS/JS 后确认没有把桌面弄坏）
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1512, height: 945, deviceScaleFactor: 2, mobile: false });
await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
await page.cdp("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel" });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
await page.click("[data-act=start]");
await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
await page.waitForTimeout(2500);
const state = await page.evaluate(() => ({
  errors: window.__errors, state: window.__game.state, fps: window.__game.fps,
  touchLayerShown: !document.querySelector('#touch').classList.contains('hidden'),
  pauseBtnVisible: document.querySelector('#btnPause').getBoundingClientRect().width > 0,
  promptBottom: Math.round(document.querySelector('#prompt').getBoundingClientRect().bottom),
  helpPanel: (() => { const b = document.querySelector('#help .panel').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; })(),
}));
// 键盘回归：走、跳、暂停
await page.keyboard.down("w"); await page.waitForTimeout(1200); await page.keyboard.up("w");
const after = await page.evaluate(() => ({ pos: [+window.__game.player.pos.x.toFixed(2), +window.__game.player.pos.z.toFixed(2)], collected: window.__game.run.collected, total: window.__game.run.total }));
await page.keyboard.press("Escape"); await page.waitForTimeout(400);
const paused = await page.evaluate(() => window.__game.state);
await page.screenshot({ path: `${OUT}/mac_r6_final.png` }).catch(() => {});
console.log("SMOKE", JSON.stringify({ ...state, afterWalk: after, pauseState: paused }));

// 收尾：关掉本次 QA 用到的两个空间
await fs.writeFile(`${OUT}/smoke.json`, JSON.stringify({ ...state, afterWalk: after, pauseState: paused }, null, 1));
await task.finish({ keep: [] });
const probe = await taskSpace(5);
await probe.finish({ keep: [] });
console.log("SPACES CLOSED");
