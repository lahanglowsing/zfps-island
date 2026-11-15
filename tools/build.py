# 把 src/ 裡的檔案組合成網站根目錄的 index.html
# 用法：python3 tools/build.py
# 注意：如果在網頁的配置編輯器裡改過位置並上傳了新的 index.html，
#       請先把 index.html 裡 <script id="zf-layout"> 的內容存回 src/layout.json，再執行本程式，避免配置被蓋掉。
import json, os, re
D=os.path.dirname(os.path.abspath(__file__))+'/../src/'
shell=open(D+'shell.html').read()
m=re.match(r'\s*(<title>.*?</title>)\s*(<meta name="claude:viewport-fit-sides"[^>]*>)\s*', shell, re.S)
head_part=m.group(1)+'\n'+m.group(2)+'\n'; shell_rest=shell[m.end():]
data=open(D+'data.js').read()
app=open(D+'app.js').read()
ed=open(D+'editor.js').read()
app=app.replace('__LOGO_B64__', open(D+'assets/logo.b64').read().strip())
app=app.replace("/* ====================================================================\n   啟動", ed+"\n/* ====================================================================\n   啟動",1)
assert 'function initEditor' in app
assert '</script' not in app.lower() and '</script' not in data.lower()
layout=json.load(open(D+'layout.json')) if os.path.exists(D+'layout.json') else {}
lj=json.dumps(layout,ensure_ascii=False).replace('<','\\u003c')
MOUNT="<script id=\"zf-mount\">(function(){var t=document.getElementById('zf-shell');t.parentNode.insertBefore(t.content.cloneNode(true),t.nextSibling);})();</script>"
def body(three, addons):
    im={"imports":{"three":three,"three/addons/":addons}}
    return (head_part+'<template id="zf-shell">'+shell_rest+'</template>\n'+MOUNT+'\n'
      +'<script type="application/json" id="zf-layout">'+lj+'</script>\n'
      +'<script id="zf-data">'+data+'</script>\n'
      +'<script type="importmap" id="zf-importmap">'+json.dumps(im)+'</script>\n'
      +'<script type="module" id="zf-app">\n'+app+'\n</script>\n')
HEAD='<!doctype html><html lang="zh-Hant"><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
open(D+'../index.html','w').write(HEAD+body("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/")+'</body></html>\n')
print('index.html', os.path.getsize(D+'../index.html')//1024,'KB')
