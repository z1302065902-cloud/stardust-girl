# 星屑少女 · 四设备试玩 QA 报告

日期：2026-09-29 · 被测版本：`~/Desktop/3d-web-game`（本地 `python3 serve.py 8123`）
方法：用 ego-browser（Chromium + CDP 设备仿真）分别扮演**苹果电脑 / PC / 苹果手机 / 安卓手机**四类玩家，
按真人操作顺序试玩（进标题 → 操作说明 → 鉴赏 → 开始游戏 → 移动/奔跑/跳跃/攻击/转视角/暂停/缩放/旋转屏幕），
记录渲染成本、控制台报错与所有 UI 元素的几何关系（`getBoundingClientRect` 重叠检测），再看截图人工复核。

## 一、四档配置与结果

| 档位 | 视口 / DPR | 实际缓冲 | 触屏 UI | JS 报错 | 渲染成本 |
|---|---|---|---|---|---|
| 苹果电脑 macOS Chrome | 1512×945 @2 | 3024×1890（pixelRatio 2） | 不显示（正确） | 无 | 0.72 ms/帧，67 draw calls |
| PC Windows Chrome | 1920×1080 @1 | 1920×1080 | 不显示（正确） | 无 | 0.51 ms/帧，70 draw calls |
| 苹果手机（iPhone 竖/横） | 390×844 @3 | 780×1688（pixelRatio 封顶 2） | 显示 | 无 | 0.54 ms/帧，59 draw calls |
| 安卓手机（Pixel 竖/横） | 393×851 @2.75 | 786×1702（封顶 2） | 显示 | 无 | 0.22 ms/帧，25 draw calls |

## 二、发现的问题与修复

### 1)【高｜手机】移动端完全没有暂停入口
- 现象：触屏 UI 只有「跳 / 旋 / 视」三个按钮。桌面按 `Esc` 才能打开暂停面板（继续/重玩/回到标题/音效），
  手机没有键盘 → **暂停、重玩本关、返回标题、静音在手机上全部无法使用**。
- 证据：第三轮「游戏中可点元素」清单，手机档仅 `button(跳/旋/视)`；桌面档为空（靠 Esc）。
- 修复：`index.html` 在 `#touch` 内新增顶部居中 `#btnPause`（46×46）；`src/main.js` 绑定 `down($('btnPause'), () => this.togglePause())`，
  并新增 `clearHeldInput()`，暂停时清空按住的方向/跳跃输入并复位摇杆，避免暂停后角色继续跑。
- 验证：iPhone / 安卓点按 → `state=pause`、暂停面板显示、触屏层自动隐藏（防止误触）、输入归零 `{x:0,z:0,run:false,jump:false}`；
  点「继续游戏」→ `state=play`、触屏层恢复。

### 2)【高｜手机竖屏】「操作说明」面板被裁切，按键文字丢失
- 现象：390px 宽屏幕上帮助面板宽 480px、左移到 x=-45，左侧按键列被切掉：
  `WASD→ASD`、`空格→格`、`滚轮→轮`、`Esc→C`。横屏手机（视口高 390）面板高 537px，上下也会被截断。
- 根因：`.panel.wide { min-width: 480px }` 的 `min-width` 压过了媒体查询里的 `width: 92vw`。
- 修复：`src/ui.css` 小屏媒体查询补 `min-width: 0; max-width: 92vw`；新增 `@media (max-height: 560px)`
  （`max-height: 90vh; overflow-y: auto` + 缩小内边距/字号）覆盖横屏手机。
- 验证：iPhone 390 → 面板 x=16、宽 359，完整在屏内；横屏 844×390 → 776×351（fitsH=true）；截图复核文字完整。

### 3)【中｜手机竖屏】星屑提示条压住摇杆和按钮
- 现象：提示条（"再收集 N 颗星屑就能开启光环"）与摇杆重叠 4171px²、与「跳」重叠 1638px²、与「视」重叠 66px²。
- 修复：竖屏触屏专用规则把提示条移到操作区上方的左侧空白区（`bottom: 188px + 安全区`、左对齐、`max-width: 55vw`、字号 13px）。
- 验证：四档重叠集合全部为空。

### 4)【中｜手机竖屏】摇杆与「跳」按钮边界重叠
- 现象：摇杆（x 28–160）与「跳」（x 116–194）横向重叠 44px、纵向 78px —— 同一个手指位置可能落到两个控件上。
- 修复：竖屏触屏把摇杆 132→112、按钮 78→68、「视」60→54，右内边距 26→24、间距 16→12。
- 验证：重叠为 0；缩小后摇杆推动仍位移 5.8 单位、点「跳」仍到 1.56 高度（功能未受影响）。

### 5)【低｜手机】触屏控件贴住 iPhone 底部手势区，且对比度过低
- 现象：控件距底仅 38–44px，未考虑 Home Indicator；摇杆底色 α.08、「视」按钮 α.14，视觉上几乎消失。
- 修复：`viewport-fit=cover` + 所有触屏控件的 `bottom/top` 使用 `env(safe-area-inset-*)`；
  对比度提升（摇杆 α.14/边框 .34、按钮 α.22、「视」α.26、暂停 α.74 + 模糊底衬）。

## 三、确认没有问题的部分（有数据）

- **性能不是瓶颈**：同步渲染 0.22–0.72 ms/帧，25–70 个 draw call，2048² 阴影贴图 + 抗锯齿，离 60fps 的 16.7ms 预算有约 20 倍余量。
  运行中观测到的 20–30fps 属**测试环境假象**：ego 浏览器窗口被最小化时 rAF 掉到 1.3fps、`Page.captureScreenshot` 直接超时，
  还原窗口后恢复（详见"测试方法坑"）。
- **触摸交互链路完整**：摇杆（含推满判定 run）、跳跃/二段跳、回旋攻击、右半屏拖动转视角、视按钮转向、
  横竖屏旋转后控件重排、横屏下仍可移动 —— 全部生效，四档控制台零报错。
- **桌面键鼠正常**：WASD 位移、按住 Q/E 转视角（瞬时 1ms 按键会被 30fps 采样漏掉，是测试假象不是缺陷）、
  滚轮缩放、Esc 暂停/继续；窗口缩放到 1100×640 后画布、HUD 正常。
- DPR 归一（`setPixelRatio(min(devicePixelRatio, 2))`）在 DPR 3 / 2.75 的真机模拟下按预期封顶。
- 移动端无滚动条、无横向溢出（`scrollWidth == innerWidth`）。

## 四、未能验证的部分（诚实说明）

- **这不是真机测试**。四档都是 Chromium + CDP 设备仿真，iPhone 档用的是 **Chromium 内核而非 iOS Safari/WebKit**，
  因此 iOS 的 WebGL 限制、Safari 音频解锁策略、真机 DPR 3 渲染、真实触摸延迟、iPhone 刘海/圆角安全区
  都**没有**被真正覆盖；安卓同理（真实 Chrome 会更接近但仍非真机）。正式验收建议在 iPhone Safari + 一台安卓真机上各跑一次。
- **帧率**：受窗口节流影响，只给出渲染成本（ms/帧）与 draw call，不给真机 fps 结论。

## 五、测试方法坑（复现用）

1. ego-browser 窗口**最小化**时 Chromium 会把整个浏览器降频：rAF ≈1.3fps、截图必然 `CDP request timed out`。
   跑渲染类测试前先 `AXMinimized=false` + activate，或直接看窗口是否可见。
2. 读游戏状态用自带调试钩子 `window.__game`（`state/fps/player.pos/run.collected/hearts/rig.yaw/input`）与 `window.__ready`，
   比截图比对可靠得多。
3. 键盘测试要**按住**（`keyboard.down/up` 间隔 ≥100ms）：`keyboard.press()` 的瞬时 down+up 会落在同一帧里被采样漏掉。
4. 触摸用 `page.cdp("Input.dispatchTouchEvent", …)`；断言布局用 `getBoundingClientRect` 两两求交，比人眼看截图准。

## 六、改动文件

- `index.html`：viewport 加 `viewport-fit=cover`；`#touch` 内新增暂停按钮。
- `src/ui.css`：触屏控件安全区/对比度/暂停按钮样式；竖屏触屏的摇杆-按钮尺寸与提示条位置；小屏与矮屏的面板约束。
- `src/main.js`：绑定触屏暂停按钮；新增 `clearHeldInput()` 并在暂停时调用。

## 七、证据文件（同目录）

- 修复前：`iphone_r3_help.png`（帮助面板被裁）、`iphone_r3_play.png`（提示条压住控件）、`*_r3_*`
- 修复后：`iphone_r4_help.png`、`iphone_r5_play.png`、`iphone_r4_pause.png`、`*_r4_*`、`*_r5_*`
- 原始数据：`round1.json`（桌面）、`round2.json`（触摸）、`round3.json`（几何/帧成本）、`round4.json`（修复验证）、`round5.json`（布局回归）、`smoke.json`（桌面冒烟）
- 可复跑脚本：`round1_desktop.js` … `round6_smoke_cleanup.js`
