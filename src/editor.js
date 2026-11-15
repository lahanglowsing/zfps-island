
/* ====================================================================
   平面配置編輯器：只在平面地圖上調整物件位置，發布後所有人看到同一份配置
   ==================================================================== */
let PAUSED = false;
const ED = { open: false, objs: [], sel: null, undo: [], view: { cx: 0, cz: -450, s: 0.8 }, layers: { house: true, lm: true, campus: true, ubike: true, bubu: true }, placing: null, art: null, base: null, dirty: false, roadBox: null };
const ED_TYPES = {
  house: { label: '部落房舍', color: '#8c9096', rot: true, order: 0 },
  lm: { label: '部落地標', color: '#e7c14a', rot: true, order: 1 },
  campus: { label: '校園物件', color: '#5aa0cf', rot: true, order: 2 },
  ubike: { label: 'ubike 站', color: '#f0a020', rot: true, order: 3 },
  bubu: { label: '愛心專車站', color: '#2e8b57', rot: true, order: 4 },
};
const LM_FP = {
  '石板屋': { w: 8, d: 6 }, '古風教會': { w: 11, d: 21.5, oz: 1.6 }, '教會球場': { w: 20, d: 13 },
  'Masa雜貨店': { w: 10.4, d: 5.8, ox: 0.6, label: 'Masa 雜貨店' }, 'Isu雜貨店': { w: 11, d: 7.2, ox: 0.5, label: 'Isu 雜貨店' }, '消防隊': { w: 13.4, d: 16.4 },
  '白端部落聚會所 Silupatan': { w: 47, d: 33, base: Math.PI / 2, label: '白端部落聚會所' }, '天主堂': { w: 9.8, d: 15, oz: 0.3 },
  '智榮商號': { w: 8.5, d: 7.5 }, '藝沙泥溫工作室': { w: 8.5, d: 8.5, oz: 1 }, '貓頭鷹之家': { w: 11.7, d: 8.7 },
};
const edMsg = (t, warn = false) => { const el = $('ed-msg'); el.textContent = t; el.style.color = warn ? 'var(--ed-warn)' : 'var(--ink-soft)'; };

/* ---------- 物件清單 ---------- */
function edCollect() {
  const objs = [];
  D.buildings.forEach((b, k) => {
    objs.push({ key: 'h' + k, type: 'house', idx: k, name: `房舍 #${k + 1}`, x: b[0], z: b[1], ry: b[4], w: b[2], d: b[3], fill: b[5], orig: [BLD0[k][0], BLD0[k][1], BLD0[k][4]] });
  });
  for (const [name, fp] of Object.entries(LM_FP)) {
    if (!LM_POS[name]) continue;
    const base = -RAD + (fp.base || 0);
    objs.push({ key: 'l:' + name, type: 'lm', lm: name, name: fp.label || name, x: LM_POS[name][0], z: LM_POS[name][1], ry: base + LM_ROT(name), base, w: fp.w, d: fp.d, ox: fp.ox || 0, oz: fp.oz || 0, orig: [LM_POS0[name][0], LM_POS0[name][1], base] });
  }
  for (const [id, it] of Object.entries(CAMPUS_ITEMS)) {
    const [dpe, dpn] = campusOff(id), [x, z] = fromPlan(it.pe + dpe, it.pn + dpn), [x0, z0] = fromPlan(it.pe, it.pn);
    objs.push({ key: 'c:' + id, type: 'campus', cid: id, name: it.name, x, z, ry: -RAD + (campusOff(id)[2] || 0), w: it.w, d: it.d, ox: 0, oz: it.oz || 0, orig: [x0, z0, -RAD] });
  }
  const ub = Array.isArray(LAYOUT.ubike) ? LAYOUT.ubike : UBIKE_DEFAULT;
  const bb = (Array.isArray(LAYOUT.bubu) && LAYOUT.bubu.length) ? LAYOUT.bubu : BUBU_DEFAULT;
  const dflt = (list, id) => list.find(s => s.id === id);
  for (const s of ub) { const o = dflt(UBIKE_DEFAULT, s.id); objs.push({ key: 'u:' + s.id, type: 'ubike', sid: s.id, name: s.name, x: s.x, z: s.z, ry: s.ry, w: STATION_FP.w, d: STATION_FP.d, ox: 0, oz: STATION_FP.oz, orig: o ? [o.x, o.z, o.ry] : null }); }
  for (const s of bb) { const o = dflt(BUBU_DEFAULT, s.id); objs.push({ key: 'b:' + s.id, type: 'bubu', sid: s.id, name: s.name, x: s.x, z: s.z, ry: s.ry, w: STOP_FP.w, d: STOP_FP.d, ox: 0, oz: 0, orig: o ? [o.x, o.z, o.ry] : null }); }
  return objs;
}

/* ---------- 幾何 ---------- */
function edToLocal(o, px, pz) { const dx = px - o.x, dz = pz - o.z, c = Math.cos(o.ry), s = Math.sin(o.ry); return [dx * c - dz * s - (o.ox || 0), dx * s + dz * c - (o.oz || 0)]; }
function edToWorld(o, lx, lz) { lx += o.ox || 0; lz += o.oz || 0; const c = Math.cos(o.ry), s = Math.sin(o.ry); return [o.x + lx * c + lz * s, o.z - lx * s + lz * c]; }
function edCorners(o) { return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => edToWorld(o, a * o.w / 2, b * o.d / 2)); }
function edRoadBoxes() {
  if (ED.roadBox) return ED.roadBox;
  ED.roadBox = ALL_ROADS.map((r, k) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { r, hw: k === 0 ? 3.0 : 2.2, x0, x1, z0, z1 };
  });
  return ED.roadBox;
}
function edCheck(o) {
  // 是否壓到馬路（以佔地內 5×5 個取樣點檢查）
  const R = Math.hypot(o.w, o.d) / 2 + 4;
  o.onRoad = false;
  const pts = [];
  for (let a = -0.42; a <= 0.43; a += 0.21) for (let b = -0.42; b <= 0.43; b += 0.21) pts.push(edToWorld(o, a * 2 * o.w / 2, b * 2 * o.d / 2));
  for (const rb of edRoadBoxes()) {
    if (o.x + R < rb.x0 || o.x - R > rb.x1 || o.z + R < rb.z0 || o.z - R > rb.z1) continue;
    for (const [x, z] of pts) if (distToPolyline(x, z, rb.r).d < rb.hw) { o.onRoad = true; return; }
  }
  o.farFromRoad = o.type === 'bubu' ? Math.round(distToPolyline(o.x, o.z, MAIN_ROAD).d) : 0;
}

/* ---------- 底圖 ---------- */
function edBuildBase() {
  const c = document.createElement('canvas'); c.width = NX; c.height = NZ;
  const g = c.getContext('2d'), img = g.createImageData(NX, NZ), col = new THREE.Color();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = X0 + i * CELL, z = Z0 + j * CELL;
    col.set(colorFor(classify(x, z), x, z));
    const h = HRAW[j * NX + i], hl = HRAW[j * NX + Math.max(0, i - 1)], hu = HRAW[Math.max(0, j - 1) * NX + i];
    const sh = clamp(1 + ((hl - h) + (hu - h)) * 0.02, 0.7, 1.2), k = (j * NX + i) * 4;
    img.data[k] = clamp(col.r * 255 * sh * 0.92 + 18, 0, 255); img.data[k + 1] = clamp(col.g * 255 * sh * 0.92 + 18, 0, 255); img.data[k + 2] = clamp(col.b * 255 * sh * 0.92 + 18, 0, 255); img.data[k + 3] = eastOfRiver(x, z) ? 0 : 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ---------- 視圖 ---------- */
const edCanvas = () => $('ed-canvas');
function edW2S(x, z) { const c = edCanvas(), v = ED.view; return [(x - v.cx) * v.s + c.clientWidth / 2, (z - v.cz) * v.s + c.clientHeight / 2]; }
function edS2W(sx, sy) { const c = edCanvas(), v = ED.view; return [(sx - c.clientWidth / 2) / v.s + v.cx, (sy - c.clientHeight / 2) / v.s + v.cz]; }
function edZoom(f, sx, sy) {
  const c = edCanvas(); sx ??= c.clientWidth / 2; sy ??= c.clientHeight / 2;
  const [wx, wz] = edS2W(sx, sy); ED.view.s = clamp(ED.view.s * f, 0.12, 14);
  const [nx, nz] = edS2W(sx, sy); ED.view.cx += wx - nx; ED.view.cz += wz - nz; edDraw();
}
function edFit(x0, x1, z0, z1) {
  const c = edCanvas(), w = c.clientWidth || 600, h = c.clientHeight || 400;
  ED.view.cx = (x0 + x1) / 2; ED.view.cz = (z0 + z1) / 2; ED.view.s = Math.min(w / (x1 - x0), h / (z1 - z0)) * 0.92; edDraw();
}

function edDraw() {
  const c = edCanvas(); if (!c || !ED.open) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), W = c.clientWidth, Hh = c.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(Hh * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const s = ED.view.s;
  // 地形底圖
  const [bx, by] = edW2S(X0 - CELL / 2, Z0 - CELL / 2);
  g.imageSmoothingEnabled = true; g.drawImage(ED.base, bx, by, NX * CELL * s, NZ * CELL * s);
  const path = (pts, close) => { g.beginPath(); pts.forEach((p, k) => { const [a, b] = edW2S(p[0], p[1]); k ? g.lineTo(a, b) : g.moveTo(a, b); }); if (close) g.closePath(); };
  // 水系
  g.lineCap = g.lineJoin = 'round';
  path(RIVER); g.strokeStyle = 'rgba(61,154,214,.75)'; g.lineWidth = Math.max(3, 26 * s); g.stroke();
  for (const cr of CREEKS) { path(cr.pts); g.lineWidth = Math.max(1.5, 5 * s); g.stroke(); }
  // 校地與固定設施（不能移動，作為參考）
  const planPoly = (pe0, pe1, pn0, pn1) => [[pe0, pn0], [pe1, pn0], [pe1, pn1], [pe0, pn1]].map(([a, b]) => fromPlan(a, b));
  path(planPoly(CAMPUS.pe0, CAMPUS.pe1, CAMPUS.pn0, CAMPUS.pn1), true); g.fillStyle = 'rgba(214,232,196,.85)'; g.fill(); g.strokeStyle = '#7e9a6a'; g.lineWidth = 1; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
  const fixed = [[-61.2, -20.5, 0.9, 15.6, '#cfcac0'], [-61.6, -47.9, -31.6, 0.9, '#cfcac0'], [-87.4, -54, -91, -53.7, '#c9a99a'], [-47.6, -24.4, -27.8, 0.2, '#b5d69a'], [-24.5, -16.2, -38.8, -11.7, '#d9d3c5']];
  for (const [a, b, c2, d, col] of fixed) { path(planPoly(a, b, c2, d), true); g.fillStyle = col; g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke(); }
  { // 跑道
    const pts = [], R = 14.1, hl = 25.3 - 14.1; for (let k = 0; k <= 24; k++) { const t = k / 24 * Math.PI; pts.push(fromPlan(0.3 + Math.cos(t) * R, -3.2 + hl + Math.sin(t) * R)); } for (let k = 0; k <= 24; k++) { const t = Math.PI + k / 24 * Math.PI; pts.push(fromPlan(0.3 + Math.cos(t) * R, -3.2 - hl + Math.sin(t) * R)); }
    path(pts, true); g.fillStyle = '#d9826d'; g.fill();
  }
  if (s > 1.1) { g.fillStyle = 'rgba(40,40,40,.55)'; g.font = `500 ${Math.min(13, 4 * s)}px ${FONT}`; g.textAlign = 'center'; for (const [t, pe, pn] of [['教學大樓（固定）', -40.8, 8.2], ['跑道（固定）', 0.3, -3.2], ['球場（固定）', -70.7, -72.3]]) { const [a, b] = edW2S(...fromPlan(pe, pn)); g.fillText(t, a, b); } }
  // 道路
  g.strokeStyle = '#a19d93'; for (const r of VILLAGE_ROADS) { path(r); g.lineWidth = Math.max(1.5, 4.4 * s); g.stroke(); }
  path(MAIN_ROAD); g.strokeStyle = '#8f8c84'; g.lineWidth = Math.max(2.5, 6 * s); g.stroke();
  if (s > 2) { path(MAIN_ROAD); g.strokeStyle = '#f2cf57'; g.lineWidth = Math.max(0.6, 0.25 * s); g.stroke(); }
  // 物件
  const list = ED.objs.filter(o => ED.layers[o.type]).sort((a, b) => ED_TYPES[a.type].order - ED_TYPES[b.type].order);
  for (const o of list) {
    path(edCorners(o), true);
    g.fillStyle = o.type === 'house' ? o.fill : ED_TYPES[o.type].color; g.globalAlpha = o.type === 'house' ? 0.92 : 0.95; g.fill(); g.globalAlpha = 1;
    g.lineWidth = o === ED.sel ? 3 : 1; g.strokeStyle = o === ED.sel ? '#1f6fb2' : 'rgba(20,30,25,.65)';
    if (o.onRoad) { g.strokeStyle = '#c0392b'; g.lineWidth = Math.max(g.lineWidth, 2.2); g.setLineDash([4, 3]); }
    g.stroke(); g.setLineDash([]);
    if (o.type !== 'house') { // 正面方向小三角
      const [fx, fz] = edToWorld(o, 0, o.d / 2), [a, b] = edW2S(fx, fz); g.beginPath(); g.arc(a, b, Math.max(1.5, Math.min(3, s)), 0, 7); g.fillStyle = 'rgba(0,0,0,.55)'; g.fill();
    }
  }
  // 名稱
  g.textAlign = 'center'; g.textBaseline = 'bottom';
  for (const o of list) {
    if (o.type === 'house') continue;
    if (o.type === 'campus' && s < 1.6) continue;
    if (o.type === 'lm' && s < 0.9) continue;
    const [a, b] = edW2S(o.x, o.z), r = Math.max(o.w, o.d) / 2 * s;
    g.font = `700 ${o.type === 'campus' ? 11 : 12}px ${FONT}`;
    const t = o.type === 'ubike' ? 'ubike ' + o.name : o.type === 'bubu' ? '專車 ' + o.name : o.name, tw = g.measureText(t).width;
    g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(a - tw / 2 - 4, b - r - 19, tw + 8, 16);
    g.fillStyle = o.type === 'ubike' ? '#6a4300' : o.type === 'bubu' ? '#1c5a37' : '#1d2a22'; g.fillText(t, a, b - r - 5);
  }
  // 旋轉把手
  const o = ED.sel;
  if (o && ED_TYPES[o.type].rot && ED.layers[o.type]) {
    const [a, b] = edW2S(o.x, o.z), h = edHandle(o);
    g.beginPath(); g.moveTo(a, b); g.lineTo(h[0], h[1]); g.strokeStyle = '#1f6fb2'; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.arc(h[0], h[1], 9, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2.5; g.stroke();
    g.beginPath(); g.arc(h[0], h[1], 4, 0, 7); g.fillStyle = '#1f6fb2'; g.fill();
  }
  // 比例尺
  const m = [5, 10, 20, 50, 100, 200, 500].find(v => v * s > 60) || 500;
  $('ed-scale').textContent = `比例尺 ${m} m = ${Math.round(m * s)} px`;
}
function edHandle(o) {
  const [a, b] = edW2S(o.x, o.z), R = Math.max(Math.max(o.w, o.d) / 2 * ED.view.s + 22, 34);
  return [a + Math.cos(o.ry) * R, b - Math.sin(o.ry) * R];   // 沿物件局部 x 軸方向
}

/* ---------- 選取面板 ---------- */
const deg = r => Math.round(((r * 180 / Math.PI) % 360 + 360) % 360);
function edPanel() {
  const box = $('ed-sel'), o = ED.sel;
  if (!o) { box.innerHTML = '<p class="ed-empty">在地圖上點一個物件。房舍、部落地標、校園物件和站點都可以移動和旋轉；ubike 站、愛心專車站還可以改名或刪除。</p>'; return; }
  const T_ = ED_TYPES[o.type], isStation = o.type === 'ubike' || o.type === 'bubu';
  const moved = o.orig ? Math.hypot(o.x - o.orig[0], o.z - o.orig[1]) : null;
  box.innerHTML = `<div class="ed-sel">
    <div><div class="k"></div><div class="nm"></div></div>
    ${isStation ? '<label class="k">站名<input type="text" id="ed-name" maxlength="16"></label>' : ''}
    <div class="ed-num" id="ed-pos"></div>
    <div class="ed-row"><span class="k">微調</span><button class="ed-btn" data-n="0,-1">↑</button><button class="ed-btn" data-n="0,1">↓</button><button class="ed-btn" data-n="-1,0">←</button><button class="ed-btn" data-n="1,0">→</button><span class="ed-num">每次 1 m</span></div>
    ${T_.rot ? '<div class="ed-row"><span class="k">旋轉</span><button class="ed-btn" data-r="15">⟲ 15°</button><button class="ed-btn" data-r="-15">⟳ 15°</button><input type="range" id="ed-rot" min="0" max="359" step="1"></div>' : '<p class="ed-num" style="margin:0">校園物件依校園方位擺放，只能移動、不能旋轉。</p>'}
    <div class="ed-row">
      ${o.orig ? `<button class="ed-btn" id="ed-reset">${o.type === 'house' ? '回到空拍位置' : '回到原本位置'}</button>` : ''}
      ${isStation ? '<button class="ed-btn danger" id="ed-del">刪除這個站</button>' : ''}
    </div>
    ${o.onRoad ? '<p class="ed-warn" style="margin:0">這個物件壓到馬路了，請移開。</p>' : ''}
    ${o.type === 'bubu' && o.farFromRoad > 25 ? `<p class="ed-warn" style="margin:0">離主幹道 ${o.farFromRoad} m。愛心專車只走主幹道，會停在最近的主幹道上。</p>` : ''}
  </div>`;
  box.querySelector('.k').textContent = T_.label;
  box.querySelector('.nm').textContent = isStation ? (o.type === 'ubike' ? 'ubike ' : '愛心專車 ') + o.name : o.name;
  box.querySelector('#ed-pos').textContent = `位置：東 ${o.x.toFixed(1)} m、南 ${o.z.toFixed(1)} m（以操場中心為原點）${T_.rot ? ` · 方向 ${deg(o.ry)}°` : ''}${moved != null && moved > 0.05 ? ` · 已移動 ${moved.toFixed(1)} m` : ''}`;
  const nm = box.querySelector('#ed-name');
  if (nm) {
    nm.value = o.name;
    nm.addEventListener('change', () => {
      const v = nm.value.trim();
      if (!v) { edMsg('站名不能空白', true); nm.value = o.name; return; }
      if (ED.objs.some(x => x !== o && x.type === o.type && x.name === v)) { edMsg('已經有同名的站了，請換一個名字', true); nm.value = o.name; return; }
      edPush(); o.name = v; edMsg(''); edAfterChange(o);
    });
  }
  box.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => { const [a, c] = b.dataset.n.split(',').map(Number); edPush(); o.x += a; o.z += c; edAfterChange(o); }));
  box.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => { edPush(); o.ry += +b.dataset.r * Math.PI / 180; edAfterChange(o); }));
  const rr = box.querySelector('#ed-rot');
  if (rr) { rr.value = deg(o.ry); let pushed = false; rr.addEventListener('input', () => { if (!pushed) { edPush(); pushed = true; } o.ry = +rr.value * Math.PI / 180; edCheck(o); edDraw(); box.querySelector('#ed-pos').textContent = `方向 ${rr.value}°`; }); rr.addEventListener('change', () => { pushed = false; edAfterChange(o); }); }
  box.querySelector('#ed-reset')?.addEventListener('click', () => { edPush(); [o.x, o.z, o.ry] = o.orig; edAfterChange(o); });
  const del = box.querySelector('#ed-del');
  if (del) del.addEventListener('click', () => {
    if (o.type === 'bubu' && ED.objs.filter(x => x.type === 'bubu').length <= 1) { edMsg('至少要保留一個愛心專車站', true); return; }
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = '再按一次確定刪除'; return; }
    edPush(); ED.objs.splice(ED.objs.indexOf(o), 1); ED.sel = null; edAfterChange(null);
  });
}
function edAfterChange(o) { if (o) edCheck(o); ED.dirty = true; $('ed-undo').disabled = !ED.undo.length; edPanel(); edWarns(); edDraw(); }
function edPush() { ED.undo.push(JSON.stringify(ED.objs)); if (ED.undo.length > 60) ED.undo.shift(); $('ed-undo').disabled = false; }
function edUndo() {
  const v = ED.undo.pop(); if (!v) return;
  const key = ED.sel?.key; ED.objs = JSON.parse(v); ED.sel = ED.objs.find(o => o.key === key) || null;
  $('ed-undo').disabled = !ED.undo.length; ED.dirty = true; edPanel(); edWarns(); edDraw();
}
function edWarns() {
  const box = $('ed-warns'); box.innerHTML = '';
  const bad = ED.objs.filter(o => o.onRoad || (o.type === 'bubu' && o.farFromRoad > 25));
  if (!bad.length) { box.innerHTML = '<p class="ed-empty">沒有物件壓到馬路。</p>'; return; }
  for (const o of bad.slice(0, 30)) {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = `${o.type === 'ubike' ? 'ubike ' : o.type === 'bubu' ? '專車站 ' : ''}${o.name}：${o.onRoad ? '壓到馬路' : `離主幹道 ${o.farFromRoad} m`}`;
    b.addEventListener('click', () => { ED.sel = o; ED.layers[o.type] = true; edLayers(); ED.view.cx = o.x; ED.view.cz = o.z; ED.view.s = Math.max(ED.view.s, 4); edPanel(); edDraw(); });
    box.appendChild(b);
  }
  if (bad.length > 30) { const p = document.createElement('p'); p.className = 'ed-empty'; p.textContent = `還有 ${bad.length - 30} 個…`; box.appendChild(p); }
}
function edLayers() {
  const box = $('ed-layers'); box.innerHTML = '';
  for (const [k, t] of Object.entries(ED_TYPES)) {
    const n = ED.objs.filter(o => o.type === k).length;
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox"><i></i><span></span>`;
    l.querySelector('input').checked = ED.layers[k]; l.querySelector('i').style.background = t.color;
    l.querySelector('span').textContent = `${t.label} ${n}`;
    l.querySelector('input').addEventListener('change', e => { ED.layers[k] = e.target.checked; if (ED.sel?.type === k && !e.target.checked) { ED.sel = null; edPanel(); } edDraw(); });
    box.appendChild(l);
  }
}

/* ---------- 指標操作 ---------- */
const edPtrs = new Map(); let edDrag = null;
function edHit(sx, sy) {
  const [wx, wz] = edS2W(sx, sy), tol = 5 / ED.view.s;
  const list = ED.objs.filter(o => ED.layers[o.type]).sort((a, b) => ED_TYPES[b.type].order - ED_TYPES[a.type].order);
  for (const o of list) { const [lx, lz] = edToLocal(o, wx, wz); if (Math.abs(lx) <= o.w / 2 + tol && Math.abs(lz) <= o.d / 2 + tol) return o; }
  return null;
}
function edSetPlacing(t) {
  ED.placing = ED.placing === t ? null : t;
  $('ed-add-ubike').setAttribute('aria-pressed', String(ED.placing === 'ubike'));
  $('ed-add-bubu').setAttribute('aria-pressed', String(ED.placing === 'bubu'));
  edCanvas().classList.toggle('placing', !!ED.placing);
  $('ed-hint').textContent = ED.placing ? `在地圖上點一下，放置新的${ED.placing === 'ubike' ? ' ubike 站' : '愛心專車站'}。再按一次按鈕可以取消。` : '點選物件後拖曳移動；拖曳空白處平移地圖；滾輪或雙指縮放。';
}
function edPlace(x, z) {
  const t = ED.placing, n = ED.objs.filter(o => o.type === t).length + 1;
  let name = `新${t === 'ubike' ? ' ubike ' : '專車'}站 ${n}`;
  while (ED.objs.some(o => o.type === t && o.name === name)) name += '+';
  let ry = -RAD;
  const i = nearestRoadIndex(x, z), [tx, tz] = roadTangent(i); if (t === 'bubu' && distToPolyline(x, z, MAIN_ROAD).d < 30) ry = Math.atan2(-tz, tx);
  edPush();
  const id = (t === 'ubike' ? 'u' : 'b') + Date.now().toString(36);
  const fp = t === 'ubike' ? STATION_FP : STOP_FP;
  const o = { key: (t === 'ubike' ? 'u:' : 'b:') + id, type: t, sid: id, name, x: +x.toFixed(1), z: +z.toFixed(1), ry, w: fp.w, d: fp.d, ox: 0, oz: fp.oz || 0, orig: null };
  ED.objs.push(o); ED.sel = o; ED.layers[t] = true; edSetPlacing(null); edLayers(); edAfterChange(o);
  edMsg(`已新增「${name}」，可以在右邊改站名。`);
}
function edBindPointer() {
  const c = edCanvas();
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId); edPtrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (edPtrs.size === 2) { const [a, b] = [...edPtrs.values()]; edDrag = { pinch: true, d0: Math.hypot(a[0] - b[0], a[1] - b[1]), s0: ED.view.s, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return; }
    const [wx, wz] = edS2W(e.offsetX, e.offsetY);
    if (ED.placing) { edPlace(wx, wz); edDrag = null; return; }
    const o = ED.sel;
    if (o && ED_TYPES[o.type].rot && ED.layers[o.type]) { const h = edHandle(o); if (Math.hypot(e.offsetX - h[0], e.offsetY - h[1]) < 16) { edDrag = { rot: o, pushed: false }; return; } }
    const hit = edHit(e.offsetX, e.offsetY);
    if (hit) { if (ED.sel !== hit) { ED.sel = hit; edPanel(); } edDrag = { move: hit, dx: hit.x - wx, dz: hit.z - wz, pushed: false, sx: e.offsetX, sy: e.offsetY }; edDraw(); return; }
    edDrag = { pan: true, sx: e.offsetX, sy: e.offsetY, cx: ED.view.cx, cz: ED.view.cz, moved: false };
    c.style.cursor = 'grabbing';
  });
  c.addEventListener('pointermove', e => {
    if (!edPtrs.has(e.pointerId)) return;
    edPtrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    const d = edDrag; if (!d) return;
    if (d.pinch && edPtrs.size === 2) { const [a, b] = [...edPtrs.values()]; const f = Math.hypot(a[0] - b[0], a[1] - b[1]) / d.d0; const target = clamp(d.s0 * f, 0.12, 14); edZoom(target / ED.view.s, d.mid[0], d.mid[1]); return; }
    const [wx, wz] = edS2W(e.offsetX, e.offsetY);
    if (d.move) {
      if (!d.pushed) { if (Math.hypot(e.offsetX - d.sx, e.offsetY - d.sy) < 3) return; edPush(); d.pushed = true; }
      d.move.x = +(wx + d.dx).toFixed(2); d.move.z = +(wz + d.dz).toFixed(2); edCheck(d.move); edDraw();
    } else if (d.rot) {
      if (!d.pushed) { edPush(); d.pushed = true; }
      const o = d.rot, [a, b] = edW2S(o.x, o.z); let r = Math.atan2(-(e.offsetY - b), e.offsetX - a);
      if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      o.ry = r; edCheck(o); edDraw();
    } else if (d.pan) {
      d.moved ||= Math.hypot(e.offsetX - d.sx, e.offsetY - d.sy) > 3;
      ED.view.cx = d.cx - (e.offsetX - d.sx) / ED.view.s; ED.view.cz = d.cz - (e.offsetY - d.sy) / ED.view.s; edDraw();
    }
  });
  const end = e => {
    edPtrs.delete(e.pointerId); c.style.cursor = '';
    const d = edDrag; if (!d) return;
    if ((d.move || d.rot) && d.pushed) edAfterChange(d.move || d.rot);
    if (d.pan && !d.moved && ED.sel) { ED.sel = null; edPanel(); edDraw(); }
    if (!d.pinch || edPtrs.size === 0) edDrag = null;
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('wheel', e => { e.preventDefault(); edZoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
}

/* ---------- 開關、預覽、發布 ---------- */
function edLayoutFromObjs() {
  const L = { v: 1, houses: {}, lm: {}, campus: {}, ubike: [], bubu: [], updated: new Date().toISOString() };
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  for (const o of ED.objs) {
    const changed = !o.orig || Math.hypot(o.x - o.orig[0], o.z - o.orig[1]) > 0.05 || Math.abs(Math.atan2(Math.sin(o.ry - o.orig[2]), Math.cos(o.ry - o.orig[2]))) > 0.002;
    if (o.type === 'house' && changed) L.houses[o.idx] = [r2(o.x), r2(o.z), r3(o.ry)];
    else if (o.type === 'lm' && changed) L.lm[o.lm] = [r2(o.x), r2(o.z), r3(o.ry - o.base)];
    else if (o.type === 'campus' && changed) { const it = CAMPUS_ITEMS[o.cid], [pe, pn] = toPlan(o.x, o.z); L.campus[o.cid] = [r2(pe - it.pe), r2(pn - it.pn), r3(Math.atan2(Math.sin(o.ry + RAD), Math.cos(o.ry + RAD)))]; }
    else if (o.type === 'ubike' || o.type === 'bubu') L[o.type].push({ id: o.sid, name: o.name, x: r2(o.x), z: r2(o.z), ry: r3(o.ry) });
  }
  return L;
}
function edSummary(L) {
  const n = k => Object.keys(L[k]).length;
  return `房舍移動 ${n('houses')} 棟、部落地標 ${n('lm')} 個、校園物件 ${n('campus')} 個；ubike 站共 ${L.ubike.length} 站、愛心專車站共 ${L.bubu.length} 站。`;
}
function buildDocument(L) {
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || 'width=device-width,initial-scale=1,viewport-fit=cover';
  const reset = document.head.querySelector('style')?.textContent || ':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}';
  const json = JSON.stringify(L).replace(/</g, '\\u003c');
  const part = id => { const el = document.getElementById(id); if (!el) throw new Error('missing ' + id); return el.outerHTML; };
  return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="' + vp + '"><style>' + reset + '</style></head><body>'
    + '<title>卓楓學區探索地圖</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
    + part('zf-shell') + '\n' + part('zf-mount') + '\n'
    + '<script type="application/json" id="zf-layout">' + json + '</' + 'script>\n'
    + part('zf-data') + '\n' + part('zf-importmap') + '\n' + part('zf-app') + '\n</body></html>';
}
async function edPublish(L) {
  const btns = ['ed-save', 'pv-publish', 'ed-confirm-yes'].map($); btns.forEach(b => { if (b) b.disabled = true; });
  edMsg('發布中…');
  try {
    const html = buildDocument(L);
    if (!ED.art) {
      // 放在 GitHub Pages 等一般網站時：下載新的 index.html，再上傳到 GitHub 取代舊檔
      console.log('[配置] 產生新版網頁', L, html.length);
      try {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = 'index.html';
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        edMsg('已下載新的 index.html。把它上傳到 GitHub 專案、取代原本的 index.html，網站就會更新。');
        toast('已下載新的 index.html');
      } catch { edMsg('這個瀏覽器無法下載檔案，請換一個瀏覽器再試。', true); }
      return;
    }
    try { sessionStorage.removeItem('zf-preview'); } catch { /* 無法使用時略過 */ }
    await ED.art.publish(html);
    edMsg('已發布，頁面會重新載入。');
  } catch (err) {
    const code = err?.code;
    if (code === 'conflict') edMsg('剛好有人更新了網站，頁面會重新載入成最新版本，請再調整一次。', true);
    else if (code === 'not_writer' || code === 'not_granted') { edMsg('你只有瀏覽權限，無法發布配置。', true); $('btn-edit').hidden = true; }
    else if (code === 'rate_limited') edMsg('發布太頻繁了，請稍等一下再試。', true);
    else edMsg('發布失敗：' + (err?.message || err), true);
  } finally { btns.forEach(b => { if (b) b.disabled = false; }); }
}
function edConfirm(L) {
  $('ed-confirm-text').textContent = edSummary(L) + (ED.art ? ' 發布後，所有打開這個網站的人都會看到新的配置。' : ' 按「確定」會下載新的 index.html，上傳到 GitHub 後才會生效。');
  $('ed-confirm').hidden = false; $('ed-confirm-yes').focus();
  $('ed-confirm-yes').onclick = () => { $('ed-confirm').hidden = true; edPublish(L); };
  $('ed-confirm-no').onclick = () => { $('ed-confirm').hidden = true; };
}
function edOpen() {
  if (!ED.base) ED.base = edBuildBase();
  if (!ED.objs.length) { ED.objs = edCollect(); for (const o of ED.objs) edCheck(o); }
  ED.open = true; PAUSED = true; $('editor').hidden = false;
  closePanel(); closeTransit(); $('card').hidden = true;
  edLayers(); edPanel(); edWarns();
  requestAnimationFrame(() => { if (!ED.fitted) { const p = player; edFit(Math.min(p.x, -360), Math.max(p.x, 420), Math.min(p.z, -1100), Math.max(p.z, 140)); ED.fitted = true; } else edDraw(); });
  edMsg(ED.dirty ? '有尚未發布的修改。' : '');
}
function edClose() { ED.open = false; PAUSED = false; $('editor').hidden = true; edSetPlacing(null); if (ED.dirty) toast('修改還沒發布，重新整理頁面就會消失'); }
function initEditor() {
  $('btn-edit').addEventListener('click', edOpen);
  $('ed-close').addEventListener('click', edClose);
  $('ed-undo').addEventListener('click', edUndo);
  $('ed-zin').addEventListener('click', () => edZoom(1.4)); $('ed-zout').addEventListener('click', () => edZoom(1 / 1.4));
  $('ed-fit').addEventListener('click', () => edFit(X0, XMAX, Z0, ZMAX));
  $('ed-add-ubike').addEventListener('click', () => edSetPlacing('ubike'));
  $('ed-add-bubu').addEventListener('click', () => edSetPlacing('bubu'));
  $('ed-save').addEventListener('click', () => edConfirm(edLayoutFromObjs()));
  $('ed-preview').addEventListener('click', () => {
    try { sessionStorage.setItem('zf-preview', JSON.stringify(edLayoutFromObjs())); location.reload(); }
    catch { edMsg('這個瀏覽器無法使用 3D 預覽，請直接發布。', true); }
  });
  $('pv-edit').addEventListener('click', edOpen);
  $('pv-publish').addEventListener('click', () => edConfirm(PREVIEW));
  $('pv-discard').addEventListener('click', () => { try { sessionStorage.removeItem('zf-preview'); } catch { /* 略過 */ } location.reload(); });
  addEventListener('resize', () => { if (ED.open) edDraw(); });
  addEventListener('keydown', e => {
    if (!ED.open || isTyping()) return;
    const o = ED.sel, k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); edUndo(); return; }
    if (k === 'Escape') { if (ED.placing) edSetPlacing(null); else { ED.sel = null; edPanel(); edDraw(); } return; }
    if (!o) return;
    const step = e.shiftKey ? 5 : 0.5, mv = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[k];
    if (mv) { e.preventDefault(); edPush(); o.x += mv[0]; o.z += mv[1]; edAfterChange(o); }
    if ((k === 'q' || k === 'e') && ED_TYPES[o.type].rot) { edPush(); o.ry += (k === 'q' ? 5 : -5) * Math.PI / 180; edAfterChange(o); }
  });
  edBindPointer();
  window.__zfEd = { ED, edFit, edDraw, edLayoutFromObjs, buildDocument, edS2W, edW2S };
  if (PREVIEW) $('preview-bar').hidden = false;
  // 只有能編輯這個網站的人看得到「配置」按鈕
  (async () => {
    const local = /[?&]edit\b/.test(location.search);
    let art = null, can = false;
    try { art = await window.claude?.use?.('artifact'); } catch { art = null; }
    try { const u = await window.claude?.use?.('user'); can = u ? await u.canEdit() : false; } catch { can = false; }
    ED.art = art;
    if (local || PREVIEW || (art && can)) $('btn-edit').hidden = false;
  })();
}
