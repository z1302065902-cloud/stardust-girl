# 星屑少女 · STARDUST GIRL

一个 **3D 网页（浏览器）收集跳跃闯关游戏**：主角是一位动画风格的少女，
`Blender` 建模 + 骨骼动画，`Draco` 压缩的 `glTF`，`Krita` 绘制贴图，
`three.js` 在浏览器里实时渲染。**打开即玩，无需下载客户端。**

---

## 一、怎么玩

**双击 `启动游戏.command`**（会自动起本地服务器并打开浏览器）。
或者在终端里：

```bash
cd ~/Desktop/3d-web-game
python3 serve.py 8123          # 然后浏览器打开 http://127.0.0.1:8123/index.html
```

> 必须用本地服务器打开（ES Module + Draco 解码器需要 http 协议；
> `serve.py` 同时设置了 `.wasm → application/wasm` 这个关键 MIME，否则 Draco 解码器会被浏览器拒绝加载）。

### 操作

| 按键 | 作用 |
|---|---|
| `W A S D` / 方向键 | 移动（相机相对方向） |
| `Shift` | 奔跑 |
| `空格` | 跳跃，空中再按一次 = 二段跳 |
| `J` / 鼠标左键 | 回旋攻击（击飞敌人） |
| 鼠标移动 / `Q` `E` | 转视角 |
| 滚轮 | 拉近拉远 |
| `Esc` | 暂停 · `R` 重开本关 · `M` 静音 |

**目标**：收集关卡里全部星屑 → 终点光环亮起 → 跳进去过关。踩头或回旋攻击可击退敌人，被撞到掉一颗心。

### 三个关卡

| 关卡 | 主题 | 特点 |
|---|---|---|
| 1 云海花园 | 晴空白云、树岛花园 | 入门，平台间距宽松 |
| 2 黄昏遗迹 | 夕阳断柱、升降平台 | 出现移动平台与空中幽灵 |
| 3 星夜之巅 | 星空冰晶 | 平台更远更高、敌人更快、冰晶装饰 |

另有 **角色鉴赏模式**（标题页按钮进入）：可自由旋转镜头、逐个播放 9 段角色动画。

---

## 二、目录结构

```
3d-web-game/
├── index.html              入口（importmap + UI 结构）
├── serve.py                本地服务器（修正 .wasm / .glb MIME）
├── 启动游戏.command          双击即玩
├── src/
│   ├── main.js             游戏主循环、状态机（标题/游玩/暂停/结算/鉴赏）、输入、关卡切换
│   ├── girl.js             角色装配：DRACOLoader 加载 girl.glb → 卡通材质 + 描边 + 动画 + 眨眼
│   ├── world.js            三关程序化生成（浮空岛、平台、星屑、敌人、装饰、天空）
│   ├── player.js           角色控制器：胶囊碰撞、走/跑/跳/二段跳、平台承载、受伤无敌
│   ├── gameplay.js         第三人称相机（含避障）、敌人 AI、粒子、关卡进程
│   ├── character.js        程序化角色（glTF 加载失败时的兜底，纯代码生成）
│   ├── audio.js            WebAudio 程序化音效与 BGM（无需音频素材）
│   └── ui.css              界面样式
├── assets/
│   ├── girl.glb            主角 A：自建动漫少女（骨骼 + 9 段动画 + 内嵌贴图，Draco 压缩）
│   ├── quaternius_girl.glb 主角 B：下载的 CC0 女性角色 + UAL 动画（重定向烘焙，604KB）
│   ├── props/              50 个免费 CC0 模型（Kenney 自然套件 + Quaternius 平台/水晶/云/敌人）
│   ├── packs/              素材原始包与仓库快照（存档用，游戏不加载）
│   ├── girl.blend          Blender 源文件
│   └── tex/{face,body}.png 角色贴图（由 Krita 管线产出）
├── krita/
│   ├── face.kra            脸部 Krita 工程（可直接手绘修改）
│   └── body.kra            身体图集 Krita 工程
├── tools/
│   ├── build_girl.py       ★ Blender 脚本：建模 + UV + 绑定 + 动画 + Draco 导出 + 预览渲染
│   ├── make_textures.py    程序化生成贴图（脸部两帧：睁眼/闭眼；身体图集）
│   ├── krita_pipeline.sh   ★ 贴图管线：生成 → Krita 工程 → Krita 导出成品 PNG
│   ├── retarget_girl.py    ★ 把 CC0《UAL 动画库》重定向到 CC0 女性角色并导出 GLB
│   ├── check_pose_numbers.py  数值核验：每段动画里头/髋/脚的世界坐标是否正常
│   └── check_export.py     渲染核验：把导出的 GLB 各动作渲一帧肉眼看
├── vendor/                 three.js r180 + GLTFLoader / DRACOLoader + Draco 解码器（本地化，离线可用）
├── test/character.html     角色动作预览页（开发用）
└── research/               市场调查原始数据 + 建模迭代渲染图 + 游戏截图
```

---

## 三、素材来源与许可（全部免费可商用）

场景与可选角色**全部来自免费下载的 CC0（公共领域）素材**，无需署名、可商用：

| 用途 | 素材包 | 来源 | 许可 |
|---|---|---|---|
| 树木 / 岩石 / 花草 / 蘑菇 / 木桩（31 个模型） | Kenney **Nature Kit** | kenney.nl，经 GitHub 镜像 `shorepine/kenney` 按需取单个 glTF-binary | CC0 |
| 浮空岩石平台、云、金币星、旗子 | Quaternius **Platformer Game Pack** | quaternius.com（GitHub 镜像） | CC0 |
| 星屑收集物（水晶 4 种） | Quaternius **RPG Items Pack** | 同上 | CC0 |
| **默认主角**：动漫少女（148 骨骼、31k 面） | VRoid 官方样例 **千駄ヶ谷 シノ** | vroid.com（pixiv 官方 FAQ 确认） | CC0 |
| 备选主角（51 骨骼女性角色） | Quaternius **modular_women / Casual** | 同上 | CC0 |
| 主角 B 的 9 段骨骼动画 | Quaternius **Universal Animation Library (UAL1_Standard)** | 同上，120+ 段动作里挑 9 段 | CC0 |
| 主角 A（动漫少女）+ 脸部/身体贴图 | 本项目自建：Blender 脚本化建模 + Krita 贴图 | `tools/build_girl.py` / `tools/make_textures.py` | 本项目原创 |

**为什么模型是「一个个下」而不是整包**：Kenney 官网直连只有 ~8 KB/s（10.5MB 的整包要 20 分钟），
而 GitHub raw 经 `gh-proxy.com` 可达 300+ KB/s，于是改成从 glTF-binary 镜像里按需取 31 个文件（共 332KB）。
交易物/平台等则从 Quaternius 的 GitHub 镜像仓库整包解出（852 个 GLB 里只取了 19 个）。
所有下载都记录了来源仓库与许可，`assets/packs/` 保留原始包以便追溯。

**三套主角可切换**（鉴赏模式里点「切换主角」按钮循环切换）：

| 启动参数 | 主角 | 说明 |
|---|---|---|
| （默认） | VRoid 千駄ヶ谷シノ | 动漫少女，CC0，129 万面→ Draco 后 2.3MB |
| `?girl=anime` | 自建动漫少女 | Blender 脚本建模 + Krita 贴图 |
| `?girl=cc0` | Quaternius CC0 女性 | 低多边形风格 |

三套主角的动画都来自 UAL 动画库（重定向烘焙），且**朝向自动校正**：游戏约定「角色面朝 +Z」，
载入时用「脚踝→脚趾」骨骼向量量出模型原生前向再修正（实测 Shino 原生朝 −Z，自动转了 180°）。
验收口径是数值：脚前向 ≈ +Z、手骨前向分量为正、**移动方向与面朝方向的点积 = 1.000**（走的方向就是脸的方向）。

---

## 四、技术管线

### 角色：Blender 脚本化建模 → Draco glTF

```bash
# 1) 生成贴图（含 Krita 环节）
./tools/krita_pipeline.sh

# 2) 建模 + 绑定 + 动画 + 导出 + 预览渲染
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_girl.py -- --preview --tag=v1
```

`tools/build_girl.py` 用纯 Python 在 Blender 里生成整套角色：

* **几何**：回转体（`revolve`，带百褶裙褶皱调制）、管道（`tube`，头发/马尾）、图元（球/盒）
  → 每个部件加细分曲面并光滑，再合并成一个网格（≈11 万三角面）。
* **UV**：按部件自动展开。头部用「前密后疏」的角度映射（`u = 0.5 ± 0.5·√|φ/π|`），
  让只占头部圆周 18% 的正脸拿到 42% 的贴图宽度；身体/头发用柱面展开，接缝藏在背后。
* **贴图**：`make_textures.py` 在「平面正视坐标系」里按米为单位精确绘制五官，
  再按同一套 UV 反解重采样进 2048×4096 的贴图 —— 贴到球面上不会变形。
  贴图上下两帧（睁眼 / 闭眼），运行时切换 `map.offset.y` 即可**眨眼**。
* **骨骼**：31 根骨骼（脊柱/四肢/双马尾 4 段/鬓发），自动权重绑定。
* **动画**：9 段关键帧动画（Idle / Walk / Run / Jump / Fall / Spin / Hurt / Win / Pose），
  全部由参数化姿态函数逐帧生成。
* **导出**：`Draco` 网格压缩（level 6，位置 14bit / 法线 10bit / UV 12bit），
  3.6MB → 1.2MB（≈9.5×），并渲染 4 个角度的预览图用于迭代。

### 网页端

* `three.js` r180（本地 `vendor/`，可离线运行）
* `GLTFLoader` + `DRACOLoader`（解码器本地托管在 `vendor/draco/`）
* 加载后把所有材质转成 `MeshToonMaterial`（4 阶色阶贴图，卡通渲染）
* **描边**：给每个蒙皮网格挂一份「反向外壳」副本，把沿法线的位移注入标准顶点着色器
  （`transformed += objectNormal * uWidth`），因此描边会跟着骨骼一起形变
* 阴影用方向光跟随角色；相机带地形避障

---

## 五、市场调查（itch.io，2026-09）

数据来自 itch.io 标签浏览页实测抓取（原始数据：`research/itch_*.json`）：

| 维度 | 数量 |
|---|---|
| 全站 Web（浏览器可玩）游戏 | 741,939 |
| 标签 `3D` | 156,344 |
| 标签 `3D` + Web 可玩 | 40,389 |
| 标签 `Female Protagonist` | 12,422 |
| 标签 `3D` + `Female Protagonist` | **1,518** |
| `Female Protagonist` + `Anime` | 1,210 |
| `3D Platformer` + `Female Protagonist` | 157 |

**结论与定位**

1. **「3D + 女主角」有稳定受众（1518 款）但绝大多数是桌面下载版**
   （Godot / Unity / Unreal 导出 Windows 包），浏览器可玩的 3D 女主角游戏是明显稀薄的一层。
2. **免费原型为主，付费集中在 $2–$12**：`3D Platformer + Female Protagonist` 前 36 款里 28 款免费、
   8 款付费（如 `Fumiko! $6.99`、`Celestial Hacker Girl Jessica $1.99`）。
   变现路径普遍是「免费 Demo / 原型 → Patreon 或后续完整版」。
3. **高评分作品的共同特征**（`elfware_2000` 4.7★/41 评、`Project Feline`、`Linepharia` 5★）：
   复古低模审美（PSX/N64）、第三人称收集跳跃、单局几分钟、美术风格统一。
4. **我们的差异化**：把「第三人称收集跳跃 + 女主角」做成 **打开即玩、无下载、无插件** 的网页版本，
   并把角色做成可鉴赏的资产（角色鉴赏模式）——这正是 itch 上最缺的一格。

> 说明：itch 浏览页的 `?sort=` 参数与三标签组合 URL 会被前端路由吞掉，
> 因此上表的交集数量以标签页实测为准，未做付费/评分维度的全量统计。

---

## 六、视觉设计系统（美化依据）

按「克制的设计系统」原则重做了一轮，具体落地：

### UI（`src/ui.css`）

| 原则 | 落地 |
|---|---|
| 60-30-10 配色 | 60% 深夜蓝紫 `#16122b/#241a45`、30% 靛紫 `#6c5ce7`、10% 樱花粉 `#ff6fa5`；金色只留给终点/评级 |
| 留白代替分割线 | 信息容器只用半透明底 + 圆角 + 内距，去掉所有边框线 |
| 视觉层次 | 主 CTA 加大加高（21px 内距 / 18px 字号）+ 高饱和粉；次级按钮改描边风格，不只靠颜色区分 |
| 信息层级 | 标题页左侧 1/3 放 UI，右侧留给角色；HUD 只占四角，中间留给场景 |
| 留白与呼吸 | 一屏 4 个 HUD 元素封顶；右侧三项合成一块面板，避免碎片化 |
| 微交互 | 悬停 90–120ms、放大 1.04–1.06；提示 1Hz 脉冲（并遵循 `prefers-reduced-motion`） |
| 触屏 | 热区 ≥48px（摇杆 132px、按钮 78px） |
| 响应式 | 1024 / 768 / 400px 三档断点 |

### 3D（打光与特效）

- **三点布光**：主光（暖色，固定 45° 侧上方）+ 半球补光（冷色）+ 轮廓光（摆在**相对相机**的角色背后，用主光的互补色）——昼/昏/夜三套配置
- **菲涅尔边缘光**：给角色加一层发光外壳（`smoothstep` 菲涅尔 + 加色混合），保证任何背景下轮廓都能跳出来
- **环境光遮蔽写进贴图**：领口、下摆、腋下、裙腰、四肢接缝处压暗，消除「贴纸感」
- **特效克制**：粒子数量/尺寸下调，收集反馈改为短促、若有若无的闪烁
- **配色带入**：第一关的花海用实例化网格铺出（1 个 draw call / 320 株），把品牌粉带进场景

### 角色与服装（设计原则）

- **剪影优先**：双马尾 + 呆毛 + 百褶裙，远处也能一眼认出
- **细节精而不多**：水手领、胸口蝴蝶结、袜口花边三处重点，其余留白
- **服装不脱离身体**：贴图 AO + 关节处体积过渡 + 袖子/袜子的包覆关系
- **服装随动作活起来**：双马尾 4 段骨骼 + 鬓发骨骼，跑跳时整体摆动

---

## 七、已知限制 / 下一步

* **Mixamo 动画**：`www.mixamo.com` 在当前网络环境下卡在 “LOADING MIXAMO” 无法进入
  （需要 Adobe 账号登录 + 稳定的国际连接）。目前角色动画由 Blender 脚本参数化生成。
  若要用 Mixamo：登录后上传 `assets/girl.fbx`（可从 `girl.blend` 导出）→ 自动绑骨 →
  逐条下载 FBX → 导入 Blender 推入 NLA → 用 `build_girl.py` 的导出段重新导出 GLB。
  游戏侧 `girl.js` 已按动画名（Idle/Walk/Run/Jump/Fall/Spin/Hurt/Win/Pose）做映射，
  换成 Mixamo 动作只需保证同名。
* 主岛现在是**岩石拼接**（顶面仍是平整圆台，保证走位稳定；岛身与底部倒锥用岩石平台模型拼出）。
  若想更粗犷，把 `src/world.js` 里 `rockyIsland()` 的三圈岩石数量加大、宽度方差调大即可。
* 角色是**程序化低模风格**（非写实），若要更精致可：提高 `build_girl.py` 里的 `sub` 细分级别、
  在 Krita 里给 `krita/*.kra` 手绘更多细节（发丝高光、衣服花纹、脸部阴影）。
* 触屏操作已实现（虚拟摇杆 + 跳/旋转按钮），但未在真机充分测试。
* **场景也不是「整包下载」而是按需取文件**：`assets/packs/` 里保留了素材原始包
  （`kenney-nature-full/`、`tars/*.tgz`），只作追溯用，游戏运行时不加载；不需要可以直接删。

### 主角 B（CC0 下载角色）的动画是怎么来的

Quaternius 的 `modular_women` 角色**自带骨骼但不带动画**，动画在另一份素材里
（UAL 动画库 120+ 段）。两者骨架命名完全不同（`upperarm_l` vs `UpperArm.L`）、
两个 armature 的物体旋转也相反（`(0,0,180°)` vs `(-90°,0,0)`），所以做了**世界空间增量重定向**：

```
每个骨骼    新世界朝向 = M · (源动画世界朝向 · 源静止世界朝向⁻¹) · M · 目标静止世界朝向
每帧        先把全身 matrix_basis 归零，再按父→子顺序赋值（否则父级旋转会被算两次）
髋部        竖直起伏用「绝对高度 + 增量」，水平位移不搬（保证原地循环）
M           diag(-1,1,1)：两套 rig 左右轴相反，镜像共轭后手臂才对；
            腿部前后摆动是绕 X 的旋转，镜像不影响它，所以腿不会被搞坏
```

跑 `tools/retarget_girl.py` 重新生成，`tools/check_pose_numbers.py` 数值核验，
`tools/check_export.py` 把成品 GLB 渲成图肉眼看。三步都要过：
数值上看 Idle 的手应在髋部高度（实测 0.95m，源动画 0.90m ✓）。
