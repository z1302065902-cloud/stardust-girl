# 发布指南（GitHub / Vercel / itch.io）

## 线上地址（已发布，2026-09-29 实核）

| 目标 | 地址 | 核验方式 |
|---|---|---|
| GitHub | https://github.com/z1302065902-cloud/stardust-girl （public, MIT） | `git ls-remote` HEAD == 本地 HEAD；仓库页 200 |
| Vercel | https://stardust-girl.vercel.app （生产, HTTPS） | 匿名 200；页面内 `window.__ready === true`、canvas 1 |
| itch.io 商店页 | https://zsy2026.itch.io/stardust-girl （**PUBLISHED**，Genre=Platformer） | 匿名 200；作者栏显示绿色 PUBLISHED |
| itch 播放器（CDN 上的构建） | https://html-classic.itch.zone/html/19480002/index.html | `__ready === true`、canvas 1、66 个资源、0 报错 |

itch 的嵌入是**懒加载**：页面里先是 `div.iframe_placeholder` + `button.load_iframe_btn`（"Run game"），
点击后才把 `data-iframe` 里的 `<iframe id="game_drop">`（854×480）注入。所以「静态 HTML 里搜不到 iframe」
是正常的，不是构建没上传——判断方法：点按钮后看 `iframe#game_drop` 是否出现、占位是否消失。

定价：`payment_mode=paid` + `min_price=$1.00`。注意 itch 的原话：
*"Setting a minimum price will only restrict access to downloadable files. Embedded content is freely
available."* —— 本项目只有内嵌 build、没有可下载文件，所以这 $1 目前**不产生收入**，页面只多一个
"Support This Game" 打赏入口。真要收费得先提供可下载版本。

本目录是一份**精简后的可发布版本**：`index.html + src/ + vendor/ + assets/{3 个 glb, props/, tex/}`，
共约 10MB / 87 个文件。素材源文件（`assets/packs` 里的 VRM/FBX/tar、Blender 工程、Krita 源文件、
研究截图）不在其中——运行时用不到。

封面：`cover-630x500.png`（线上在用，高调版）、`cover-1260x1000.png`（高清）、
`cover-dark-630x500.png`（深色 Blender 版留档）、`cover-thumb-preview-315x250.png`（缩略图预检）。
可复现脚本在 `qa-devices/round20_keyart_blender.py`、`round21_keyart_blender_highkey.py`
与两个合成页 `keyart_composite*.html`。

## 本地跑

```bash
python3 serve.py 8199        # 或 python3 -m http.server 8199
# 浏览器打开 http://127.0.0.1:8199/index.html
```

已验证：**纯静态服务器就能跑**（不需要 COOP/COEP 头，Draco 的 wasm 走标准 MIME）。

## GitHub

```bash
cd ~/Desktop/3d-web-game-release
git init && git add -A && git commit -m "星屑少女 Stardust Girl: 3D web collect-and-jump game"
gh repo create stardust-girl --public --source=. --push
```

改可见性：`gh repo edit --visibility private`。

## Vercel（免费静态托管，自带 HTTPS 与全球 CDN）

```bash
cd ~/Desktop/3d-web-game-release
npx vercel login          # 首次：浏览器/邮箱登录（需要你自己完成）
npx vercel --prod         # 部署到生产环境，命令会打印 https://<project>.vercel.app
```

或者不装 CLI：把上面的 GitHub 仓库在 Vercel 控制台里 Import，之后每次 `git push` 自动部署。
`vercel.json` 已配好 `.wasm` / `.glb` 的 MIME 与静态资源缓存。

## itch.io（可以收费）

1. 打包（`index.html` 必须在压缩包根目录）：

```bash
cd ~/Desktop/3d-web-game-release
zip -r -X ../stardust-girl-itch.zip . -x '.*' -x '__MACOSX/*'
```

2. 上传二选一：
   - **网页手动**：itch.io → Create new project → Kind of project 选 **HTML** →
     勾选 *This file will be played in the browser* → 上传 `stardust-girl-itch.zip` →
     Viewport 建议 `854×480`，勾选 *Mobile friendly*（游戏有触屏操作）。
   - **命令行（butler，后续更新只需一条命令）**：

```bash
brew install butler            # 或从 https://itch.io/docs/butler/ 下载
butler login                   # 浏览器授权，需要你自己完成
butler push ../stardust-girl-itch.zip <你的用户名>/stardust-girl:html5
```

3. 定价建议（参考同类 web 可玩的 3D 女主游戏）：**「Name your own price」设 $3 起**，
   或先免费试玩版引流 + Patreon/后续完整版变现；单局 3 关、几分钟一局，适合做 demo 引流。

4. 封面图：`cover-630x500.png`（itch 要求的尺寸）已随本目录生成，可直接用。

## 已知限制（写进 itch 页面会更诚实）

- 内嵌在 itch 的 iframe 里时浏览器会拒绝指针锁定，游戏已自动退化为「点击即攻击」，
  视角改用 `Q`/`E` 或触摸拖动。
- iPhone 上是 Chromium 仿真验证，未在真机 Safari 上测过。
- 首次加载约 10MB（已 Draco 压缩），弱网下需要等待加载条。
