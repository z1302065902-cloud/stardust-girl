// QA round 1 (v3): macOS + Windows desktop — resilient, incremental results
const fs = await import("node:fs/promises");
const task = await taskSpace(4);            // resume the QA space created earlier
const page = task.page("p1");
const OUT = "/Users/guanjun/Desktop/3d-web-game/qa-devices";
const URL = "http://127.0.0.1:8123/index.html";

const devs = [
  { id: "mac", name: "苹果电脑 macOS Chrome", w: 1512, h: 945, dpr: 2,
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "MacIntel" },
  { id: "pc", name: "PC Windows Chrome", w: 1920, h: 1080, dpr: 1,
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", platform: "Win32" },
];

const readState = () => page.evaluate(() => {
  const g = window.__game, c = document.querySelector('#game');
  const wgl = c.getContext('webgl2') || c.getContext('webgl');
  const vis = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), shown: !e.classList.contains('hidden') && r.width > 0 }; };
  return {
    errors: (window.__errors || []).slice(0, 10), state: g && g.state, level: g && g.levelIndex, fps: g && g.fps,
    tris: g && g.renderer ? g.renderer.info.render.triangles : null,
    pixelRatio: g && g.renderer ? g.renderer.getPixelRatio() : null,
    pos: g && g.player ? [+g.player.pos.x.toFixed(2), +g.player.pos.y.toFixed(2), +g.player.pos.z.toFixed(2)] : null,
    collected: g && g.run ? g.run.collected : null, total: g && g.run ? g.run.total : null,
    hearts: g && g.hearts, touchEnabled: g && g.touchEnabled,
    yaw: g && g.rig ? +g.rig.yaw.toFixed(3) : null, camPitch: g && g.rig ? +g.rig.pitch.toFixed(3) : null,
    hud: vis('#hud'), touch: vis('#touch'),
    canvasCss: [c.clientWidth, c.clientHeight], canvasBuf: [c.width, c.height], dpr: window.devicePixelRatio,
    gl: (() => { try { const d = wgl.getExtension('WEBGL_debug_renderer_info'); return d ? wgl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { return 'n/a'; } })(),
    hudText: { crystal: (document.querySelector('#hud-crystal') || {}).textContent, score: (document.querySelector('#hud-score') || {}).textContent,
               time: (document.querySelector('#hud-time') || {}).textContent, level: (document.querySelector('#hud-level') || {}).textContent },
    scroll: { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight },
  };
});
const shot = async (name) => { try { await page.waitForTimeout(350); await page.screenshot({ path: `${OUT}/${name}.png` }); return name + " ok"; }
  catch (e) { return name + " FAILED: " + String(e.message || e).slice(0, 80); } };
const sampleY = async (ms, step = 120) => { const o = []; for (let t = 0; t < ms; t += step) { o.push((await readState()).pos[1]); await page.waitForTimeout(step); } return o; };

const results = {};
fs.writeFile(`${OUT}/round1.json`, JSON.stringify(results)).catch(() => {});
for (const d of devs) {
  const rec = { device: d.name, viewport: [d.w, d.h], dpr: d.dpr, shots: [], notes: [] };
  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: false });
    await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
    await page.cdp("Emulation.setUserAgentOverride", { userAgent: d.ua, platform: d.platform });
    await page.goto(URL);
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 90000 });
    rec.boot = await readState();
    rec.shots.push(await shot(`${d.id}_01_title`));

    await page.click("[data-act=start]");
    await page.waitForFunction(() => window.__game.state === "play", undefined, { timeout: 30000 });
    await page.waitForTimeout(2500);
    rec.playStart = await readState();
    rec.shots.push(await shot(`${d.id}_02_play`));

    const p0 = rec.playStart.pos;
    await page.keyboard.down("w"); await page.waitForTimeout(2000); await page.keyboard.up("w");
    await page.waitForTimeout(300);
    const p1 = (await readState()).pos;
    rec.walk = { from: p0, to: p1, dist: +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2) };

    await page.keyboard.press(" ");
    rec.jumpSeries = await sampleY(1200);

    const yaw0 = (await readState()).yaw;
    await page.keyboard.press("q"); await page.waitForTimeout(350);
    rec.lookQ = { before: yaw0, after: (await readState()).yaw };
    const pitch0 = (await readState()).camPitch;
    await page.keyboard.press("e"); await page.waitForTimeout(350);
    rec.lookE = { pitchBefore: pitch0, pitchAfter: (await readState()).camPitch };

    await page.keyboard.press("j"); await page.waitForTimeout(700);
    rec.afterSpin = { fps: (await readState()).fps, state: (await readState()).state };

    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    const pausedState = await page.evaluate(() => window.__game.state);
    rec.shots.push(await shot(`${d.id}_03_pause`));
    await page.click("[data-act=resume]"); await page.waitForTimeout(600);
    rec.pause = { afterEsc: pausedState, afterResumeClick: await page.evaluate(() => window.__game.state) };

    await page.keyboard.down("Shift"); await page.keyboard.down("w");
    await page.waitForTimeout(4500); rec.run45 = await readState();
    await page.waitForTimeout(4500);
    await page.keyboard.up("w"); await page.keyboard.up("Shift");
    rec.run9 = await readState();
    rec.shots.push(await shot(`${d.id}_04_run`));

    // 人：缩放窗口
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 640, deviceScaleFactor: d.dpr, mobile: false });
    await page.waitForTimeout(1500);
    rec.afterResize = await readState();
    rec.shots.push(await shot(`${d.id}_05_resized`));
  } catch (e) {
    rec.error = String(e && (e.message || e)).slice(0, 200);
  }
  results[d.id] = rec;
  await fs.writeFile(`${OUT}/round1.json`, JSON.stringify(results, null, 1));
  console.log("device done:", d.id, rec.error || "ok");
}
console.log("ROUND1 DONE");
