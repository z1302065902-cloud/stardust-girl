# 发布指南（GitHub / Vercel / itch.io）

本目录是一份**精简后的可发布版本**：`index.html + src/ + vendor/ + assets/{3 个 glb, props/, tex/}`，
共约 10MB / 76 个文件。素材源文件（`assets/packs` 里的 VRM/FBX/tar、Blender 工程、Krita 源文件、
研究截图）不在其中——运行时用不到。

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
