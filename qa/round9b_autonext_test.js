// Quick feature test v2: 通关 → 倒计时 → 自动进入下一关；玩家触碰即取消；手动按钮仍可用；最后一关回标题
const fs = await import("node:fs/promises");
const task = await taskSpace(7);
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";
const out = {};
const save = () => fs.writeFile(`${OUT}/round9.json`, JSON.stringify(out, null, 1));

const st = () => page.evaluate(() => {
  const g = window.__game;
  return { state: g.state, level: g.levelIndex, name: g.level ? g.level.theme.name : null,
    resultVisible: !document.querySelector("#result").classList.contains("hidden"),
    title: (document.querySelector("#result-title") || {}).textContent,
    autoText: ((document.querySelector("#autoNext") || {}).textContent || "").trim(),
    nextBtnText: (document.querySelector("#nextBtn") || {}).textContent,
    errors: window.__errors.slice(0, 5) };
});

await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1512, height: 945, deviceScaleFactor: 2, mobile: false });
await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
await page.cdp("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel" });
await page.goto(URL);
await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
await page.click("[data-act=start]");
await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });

// 1) 通关 → 结算 + 倒计时文案
await page.evaluate(() => window.__game.finishLevel(false));
await page.waitForTimeout(1200);
out.step1_afterFinish = await st();
await page.screenshot({ path: `${OUT}/r9_result_countdown.png` }).catch(() => {});
await save();

// 2) 不点任何按钮：等自动进入下一关
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
  const s = await st();
  if (s.state === "play" && s.level === 1) { out.step2_autoAdvanced = { level: s.level, name: s.name, afterSec: +((Date.now() - t0) / 1000).toFixed(1) }; break; }
  await page.waitForTimeout(400);
}
if (!out.step2_autoAdvanced) out.step2_autoAdvanced = { failed: true, state: await st() };
await page.screenshot({ path: `${OUT}/r9_level2_start.png` }).catch(() => {});
await save();

// 3) 玩家只是按下（pointerdown，落在标题上不是按钮）→ 取消自动继续
await page.evaluate(() => window.__game.finishLevel(false));
await page.waitForTimeout(900);
const beforeCancel = await st();
const titlePos = await page.evaluate(() => { const r = document.querySelector("#result-title").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
await page.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: titlePos[0], y: titlePos[1], button: "left", clickCount: 1 });
await page.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: titlePos[0], y: titlePos[1], button: "left", clickCount: 1 });
await page.waitForTimeout(1200);
const afterCancel = await st();
await page.waitForTimeout(7500);
const stillThere = await st();
out.step3_cancel = { beforeText: beforeCancel.autoText, afterText: afterCancel.autoText, levelNow: stillThere.level, stillOnResult: stillThere.resultVisible };
await save();

// 4) 手动点「下一关」仍然可用
await page.click("[data-act=next]");
await page.waitForTimeout(2500);
out.step4_manualNext = await st();
await save();

// 5) 最后一关：文案变「全部关卡完成！」，自动继续后回到标题
await page.evaluate(() => window.__game.startLevel(2, false));
await page.waitForFunction(() => window.__game.state === "play" && window.__game.levelIndex === 2, undefined, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.finishLevel(false));
await page.waitForTimeout(1200);
out.step5_lastLevelResult = await st();
const t1 = Date.now();
while (Date.now() - t1 < 12000) {
  const s = await st();
  if (s.state === "title") { out.step5_autoToTitle = { state: s.state, afterSec: +((Date.now() - t1) / 1000).toFixed(1) }; break; }
  await page.waitForTimeout(400);
}
if (!out.step5_autoToTitle) out.step5_autoToTitle = { failed: true, state: await st() };
out.errorsAtEnd = (await st()).errors;
await save();
console.log(JSON.stringify(out, null, 1));
