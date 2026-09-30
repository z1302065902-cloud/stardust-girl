#!/usr/bin/env python3
"""把 release 版打包成单文件 HTML（双击即玩、无需服务器）。

做法：
1. 复制 src/ 到 build-src/，把 `three` / `three/addons/...` 的裸模块名改写成相对路径
2. esbuild 把这些模块打成单个 IIFE
3. 所有 glb / draco 解码器 base64 内联进 HTML，并劫持 fetch 从内联数据返回
   （DRACOLoader 在主线程用 fetch 读 wrapper 与 wasm，再塞进 blob worker，所以主线程劫持足够）
"""
import base64, json, os, re, shutil, subprocess, sys

REL = os.path.expanduser("~/Desktop/3d-web-game-release")
OUT = os.path.expanduser("~/Desktop/standalone-build")
BUILD_SRC = os.path.join(REL, ".build-src")   # 放进 release 内，../vendor 相对路径才解析得到
STANDALONE = os.path.expanduser("~/Desktop/stardust-girl-standalone.html")
ESBUILD = os.path.join(OUT, "node_modules/.bin/esbuild")


def rewrite_imports():
    if os.path.exists(BUILD_SRC):
        shutil.rmtree(BUILD_SRC)
    shutil.copytree(os.path.join(REL, "src"), BUILD_SRC)
    for name in os.listdir(BUILD_SRC):
        if not name.endswith(".js"):
            continue
        p = os.path.join(BUILD_SRC, name)
        s = open(p, encoding="utf-8").read()
        # three/addons/xxx -> ../vendor/jsm/xxx ；three -> ../vendor/three.module.min.js
        s = re.sub(r'(["\'])three/addons/([^"\']+)\1', r'\1../vendor/jsm/\2\1', s)
        s = re.sub(r'(["\'])three\1', r'\1../vendor/three.module.min.js\1', s)
        open(p, "w", encoding="utf-8").write(s)
    print("① 模块说明符已改写（three / three/addons → 相对路径）")


def bundle():
    out = os.path.join(OUT, "bundle.js")
    cmd = [ESBUILD, os.path.join(BUILD_SRC, "main.js"), "--bundle", "--format=iife",
           "--target=es2020", "--outfile=" + out, "--log-level=warning",
           "--alias:three=./vendor/three.module.min.js"]
    r = subprocess.run(cmd, cwd=REL, capture_output=True, text=True)
    if r.returncode != 0:
        print("esbuild 失败:\n", r.stdout, r.stderr)
        sys.exit(1)
    print(f"② 打包完成: {os.path.getsize(out) / 1024:.0f} KB（{r.stderr.strip()[:200]}）")
    return open(out, encoding="utf-8").read()


def collect_assets():
    files = []
    for root, _dirs, names in os.walk(os.path.join(REL, "assets")):
        for n in names:
            if n.endswith((".glb", ".png", ".jpg", ".ktx2")):
                files.append(os.path.relpath(os.path.join(root, n), REL))
    for n in ("draco_wasm_wrapper.js", "draco_decoder.wasm"):
        p = os.path.join(REL, "vendor/draco", n)
        if os.path.exists(p):
            files.append(os.path.relpath(p, REL))
    emb = {}
    total = 0
    for rel in sorted(files):
        p = os.path.join(REL, rel)
        raw = open(p, "rb").read()
        total += len(raw)
        emb[rel] = base64.b64encode(raw).decode()
    print(f"③ 内联素材 {len(emb)} 个，原始 {total / 1024 / 1024:.1f} MB → base64 约 {total * 1.34 / 1024 / 1024:.1f} MB")
    return emb


def build_html(bundle_js, emb):
    html = open(os.path.join(REL, "index.html"), encoding="utf-8").read()
    css = open(os.path.join(REL, "src/ui.css"), encoding="utf-8").read()
    favicon = base64.b64encode(open(os.path.join(REL, "favicon.png"), "rb").read()).decode()

    body = html[html.index("<body>"):]
    body = body.replace('<script type="module" src="./src/main.js"></script>', "")
    body = body.replace("</body>", "")

    fetch_patch = """
(function () {
  var EMB = window.__EMBEDDED_ASSETS__ || {};
  var keys = Object.keys(EMB);
  function decode(b64) {
    var bin = atob(b64), n = bin.length, u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function lookup(url) {
    var s = String(url).split(/[?#]/)[0];
    try { if (s.indexOf('://') > -1) s = new URL(s).pathname; } catch (e) {}
    s = s.replace(/^\\.\\//, '');
    if (EMB[s]) return s;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (s.length >= k.length && s.slice(-k.length) === k) return k;
    }
    return null;
  }
  function mime(k) {
    if (/\\.glb$/.test(k)) return 'model/gltf-binary';
    if (/\\.wasm$/.test(k)) return 'application/wasm';
    if (/\\.png$/.test(k)) return 'image/png';
    if (/\\.jpe?g$/.test(k)) return 'image/jpeg';
    if (/\\.js$/.test(k)) return 'text/javascript';
    return 'application/octet-stream';
  }
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var k = lookup(url);
    if (k) {
      return Promise.resolve(new Response(decode(EMB[k]), { status: 200, headers: { 'Content-Type': mime(k) } }));
    }
    return origFetch ? origFetch(input, init) : Promise.reject(new Error('offline: ' + url));
  };
  var OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    var xhr = new OrigXHR(), self = this, key = null;
    this.readyState = 0; this.status = 0; this.response = null; this.responseText = '';
    this.onload = null; this.onerror = null; this.onreadystatechange = null;
    this.open = function (method, url) { key = lookup(url); if (!key) xhr.open(method, url, true); this._url = url; };
    this.setRequestHeader = function (k, v) { if (!key) xhr.setRequestHeader(k, v); };
    this.getAllResponseHeaders = function () { return key ? '' : xhr.getAllResponseHeaders(); };
    this.getResponseHeader = function (n) { return key ? null : xhr.getResponseHeader(n); };
    this.abort = function () { if (!key) xhr.abort(); };
    this.send = function () {
      if (!key) {
        xhr.responseType = self.responseType; xhr.onload = function () { self.status = xhr.status; self.response = xhr.response; self.responseText = xhr.responseText; self.readyState = 4; self.onload && self.onload(); }; 
        xhr.onerror = function (e) { self.onerror && self.onerror(e); }; return xhr.send();
      }
      var bytes = decode(EMB[key]);
      self.status = 200; self.readyState = 4;
      if (self.responseType === 'arraybuffer') self.response = bytes.buffer;
      else if (self.responseType === 'json') self.response = JSON.parse(new TextDecoder().decode(bytes));
      else { self.responseText = new TextDecoder().decode(bytes); self.response = self.responseText; }
      self.onreadystatechange && self.onreadystatechange();
      self.onload && self.onload();
    };
  };
})();
"""

    head_extra = (
        '<link rel="icon" type="image/png" href="data:image/png;base64,' + favicon + '" />\n'
        "<style>\n" + css + "\n</style>\n"
        "<script>\n  window.__errors = [];\n"
        "  addEventListener('error', function (e) { window.__errors.push(String((e && (e.message || e.error)) || e)); });\n"
        "  addEventListener('unhandledrejection', function (e) { window.__errors.push('rejection: ' + String(e && e.reason)); });\n"
        "</script>\n"
        '<script id="embedded-assets">window.__EMBEDDED_ASSETS__ = ' + json.dumps(emb) + ";</script>\n"
        "<script>" + fetch_patch + "</script>\n"
    )

    out_head = html[: html.index("<link rel=\"icon\"")] + head_extra
    # 保留 importmap 之外的头部内容：从 </head> 之后取 body
    out = out_head + "</head>\n" + body + "\n<script>\n" + bundle_js + "\n</script>\n</body>\n</html>\n"
    # importmap 在单文件版里没用了（模块已打包）
    out = re.sub(r'<script type="importmap">.*?</script>\s*', "", out, flags=re.S)
    open(STANDALONE, "w", encoding="utf-8").write(out)
    print(f"④ 单文件已生成: {STANDALONE}  {os.path.getsize(STANDALONE) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    rewrite_imports()
    js = bundle()
    emb = collect_assets()
    build_html(js, emb)
