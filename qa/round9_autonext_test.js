// Quick feature test: 通关 → 倒计时 → 自动进入下一关（以及玩家触碰即取消）
const fs = await import("node:fs/promises");
const task = await taskSpace(7);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";

const st = () => page.evaluate(() => {
  const g = window.__game;
  return { state: g.state, level: g.levelIndex, name: g.level ? g.level.theme.name : null,
    resultVisible: !document.querySelector("#result").classList.contains("hidden"),
    title: (document.querySelector("#result-title") || {}).textContent,
    autoText: ((document.querySelector("#autoNext") || {}).textContent || "").trim(),
    nextBtnText: (document.querySelector("#nextBtn") || {}).textContent,
    errors: window.__errors.slice(0, 5) };
});

const out = {};
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1512, height: 945, deviceScaleFactor: 2, mobile: false });
await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
await page.cdp("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel" });
await page.goto(URL);
await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
await page.click("[data-act=start]");
await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });

// ---- 1) 通关 → 倒计时文案 ----
await page.evaluate(() => window.__game.finishLevel(false));
await page.waitForTimeout(1200);
out.afterFinish = await st();
await page.screenshot({ path: `${OUT}/r9_result_countdown.png` }).catch(() => {});

// ---- 2) 什么都不点，等自动切关 ----
const t0 = Date.now();
let advanced = null;
while (Date.now() - t0 < 12000) {
  const s = await st();
  if (s.state === "play" && s.level === 1) { advanced = { level: s.level, name: s.name, sec: +((Date.now() - t0) / 1000).toFixed(1) }; break; }
  await page.waitForTimeout(400);
}
out.autoAdvanced = advanced;
await page.screenshot({ path: `${OUT}/r9_level2_start.png` }).catch(() => {});

// ---- 3) 玩家触碰结算面板 → 取消自动继续 ----
await page.evaluate(() => window.__game.finishLevel(false));
await page.waitForTimeout(900);
const beforeCancel = await st();
await page.mouse.click(756, 600);            // 点结算面板（pointerdown 即取消）
await page.waitForTimeout(1500);
const afterCancel = await st();
await page.waitForTimeout(7000);             // 超过倒计时时长，确认它真的没有自己切关
const stillThere = await st();
out.cancel = { beforeText: beforeCancel.autoText, afterText: afterCancel.autoText, stillOnLevel: stillThere.level, stillResult: stillThere.resultVisible };

// ---- 4) 手动点「下一关」仍然可用 ----
await page.click("[data-act=next]");
await page.waitForTimeout(2500);
out.manualNext = await st();

// ---- 5) 最后一关：文案应变成「全部关卡完成！」，自动继续后回到标题 ----
await page.evaluate(() => { window.__game.levelIndex = 2; window.__game.startLevel(2, false); });
await page.waitForFunction(() => window.__game.state === "play" && window.__game.levelIndex === 2, undefined, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.finishLevel(false));
await page.waitForTimeout(1200);
out.lastLevelResult = await st();
const t1 = Date.now();
while (Date.now() - t1 < 12000) {
  const s = await st();
  if (s.state === "title") { out.lastLevelAutoTo = { state: s.state, sec: +((Date.now() - t1) / 1000).toFixed(1) }; break; }
  await page.waitForTimeout(400);
}
out.errorsAtEnd = (await st()).errors;
await fs.writeFile(`${OUT}/round9.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
