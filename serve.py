#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""星屑少女 本地服务器 —— 关键点：.wasm / .glb 必须带正确的 MIME 类型，
否则 Chrome 会拒绝加载 Draco 解码器（application/wasm）而报错。"""
import http.server
import socketserver
import mimetypes
import os
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
ROOT = os.path.dirname(os.path.abspath(__file__))

mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('model/gltf-binary', '.glb')
mimetypes.add_type('model/gltf+json', '.gltf')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('image/png', '.png')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '.wasm' in (args[0] if args else '') or 'girl.glb' in (args[0] if args else ''):
            sys.stderr.write("[serve] %s\n" % (args[0] if args else ''))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    os.chdir(ROOT)
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        url = f'http://127.0.0.1:{PORT}/index.html'
        print(f'星屑少女 已启动： {url}')
        print('按 Ctrl+C 停止')
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()
