import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ====================================================================
   卓楓學區探索地圖 · 第一階段
   座標系：x = 東（公尺），z = 南（公尺），y = 海拔（公尺）
   原點 = 卓楓國小操場中心（TWD97 277864, 2571279）
   ==================================================================== */

const D = window.ZF_DATA;
/* ---------- 物件配置（由平面地圖編輯器產生；發布後所有人看到同一份） ---------- */
const LAYOUT_PUBLISHED = (() => { try { return JSON.parse(document.getElementById('zf-layout')?.textContent || '{}') || {}; } catch { return {}; } })();
const PREVIEW = (() => { try { const v = sessionStorage.getItem('zf-preview'); return v ? JSON.parse(v) : null; } catch { return null; } })();
const LAYOUT = PREVIEW || LAYOUT_PUBLISHED;
const BLD0 = D.buildings.map(b => b.slice());                 // 空拍描繪的原始位置
for (const [k, v] of Object.entries(LAYOUT.houses || {})) { const b = D.buildings[+k]; if (b && Array.isArray(v)) { b[0] = v[0]; b[1] = v[1]; b[4] = v[2]; } }
const NX = D.nx, NZ = D.nz, CELL = D.cell, X0 = D.x0, Z0 = D.z0;
const XMAX = X0 + (NX - 1) * CELL, ZMAX = Z0 + (NZ - 1) * CELL;
const HRAW = new Float32Array(NX * NZ);
{
  const bin = atob(D.h);
  for (let i = 0; i < NX * NZ; i++) HRAW[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) / 10;
}
const H = HRAW.slice();

// 校園「圖面北方」實際朝向北偏東 20°
const RAD = THREE.MathUtils.degToRad(20), CB = Math.cos(RAD), SB = Math.sin(RAD);
const toPlan = (x, z) => [x * CB + z * SB, x * SB - z * CB];
const fromPlan = (pe, pn) => [pe * CB + pn * SB, pe * SB - pn * CB];

const PAD = 185.2;                       // 校園整地高程
const CAMPUS = { pe0: -96, pe1: 42, pn0: -99, pn1: 63 };
const campusDist = (x, z) => {
  const [pe, pn] = toPlan(x, z);
  const dx = Math.max(CAMPUS.pe0 - pe, 0, pe - CAMPUS.pe1);
  const dz = Math.max(CAMPUS.pn0 - pn, 0, pn - CAMPUS.pn1);
  return Math.hypot(dx, dz);
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

// ---------- 高程取樣（與地形三角形一致）
function sampleGrid(arr, x, z) {
  const fx0 = clamp((x - X0) / CELL, 0, NX - 1.0001), fz0 = clamp((z - Z0) / CELL, 0, NZ - 1.0001);
  const i = Math.floor(fx0), j = Math.floor(fz0), fx = fx0 - i, fz = fz0 - j;
  const a = arr[j * NX + i], b = arr[j * NX + i + 1], c = arr[(j + 1) * NX + i], d = arr[(j + 1) * NX + i + 1];
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
const realElev = (x, z) => sampleGrid(HRAW, x, z);
/* ---------- 校地三層地基（相對操場）：第一層操場 0、第二層教室中庭 +0.8 m、第三層宿舍球場 +1.8 m ---------- */
const LV1 = 0, LV2 = 0.8, LV3 = 1.8, PAD_TOP = 0.02;
const L12 = -16.2;                                    // 第一、二層交界（圖面東經）
const LVW = LV2 + 0.8;                                // 西棟教室大樓：再比第二層高約 80 cm
const WW = { pe0: -61.6, pe1: -47.9, pn0: -31.6, pn1: 0.9 };
const inWestWing = (pe, pn, m = 0) => pe > WW.pe0 - m && pe < WW.pe1 + m && pn > WW.pn0 - m && pn < WW.pn1 + m;
function LVobj(pe, pn) { return inWestWing(pe, pn, 0.9) ? LVW : LV(pe, pn); }   // 建物構件（含屋簷外伸）
const STAGE = { pe0: -24.5, pe1: L12, pn0: -38.8, pn1: -11.7 }, LVS = LV2 + 0.45;   // 司令台平台：前緣就是面向跑道的擋土牆
const inStage = (pe, pn) => pe >= STAGE.pe0 && pe <= STAGE.pe1 && pn >= STAGE.pn0 && pn <= STAGE.pn1;
/* ---------- 操場南側的土丘：大楓樹下的高台，再往南是一座座起伏的小山坡 ---------- */
const HILLS = [[12, -50, 8, 2.0], [24, -45, 7, 1.6], [3, -57, 7, 1.7], [18, -62, 9, 2.2], [32, -58, 7, 1.6], [8, -71, 8, 1.9], [26, -75, 8, 2.0], [-1, -83, 7, 1.5], [14, -87, 9, 1.9], [34, -89, 7, 1.6], [37, -40, 6, 1.4]];
function hillBump(pe, pn) {
  if (pn > -22 || pe < -8.5) return 0;
  // 不蓋到跑道、直線跑道與沙坑
  const tr = Math.max(0, Math.hypot(pe - 0.3, Math.max(0, Math.abs(pn + 3.2) - 11.2)) - 14.1);
  const mask = smooth(clamp((tr - 1.2) / 3.5, 0, 1)) * smooth(clamp((pe + 7.5) / 4, 0, 1));
  if (mask <= 0) return 0;
  const mo = LAYOUT.campus?.maple || [0, 0], so = LAYOUT.campus?.stonehouse || [0, 0];
  const mpe = 8 + mo[0], mpn = -32.4 + mo[1];
  const dm = Math.hypot(pe - mpe, pn - mpn);
  let h = 2.4 * smooth(clamp((11 - dm) / 6.5, 0, 1));                 // 大楓樹下的高台（頂部平緩）
  for (const [cp, cn, r, hh] of HILLS) { const d = Math.hypot(pe - cp, pn - cn); if (d < r) h = Math.max(h, hh * smooth(1 - d / r)); }
  const ds = Math.hypot(pe - 17.3 - so[0], pn + 34.7 - so[1]);        // 石板屋周邊保持平地
  h *= smooth(clamp((ds - 4.5) / 3, 0, 1));
  return h * mask;
}
function LV(pe, pn) {                                 // 該點所在層的地基高度
  if (inWestWing(pe, pn)) return LVW;
  if (inStage(pe, pn)) return LVS;
  if ((pe < -62.5 && pn < 2) || (pe < -52.5 && pn < -52)) return LV3;
  if (pe < L12) return LV2;
  return LV1 + hillBump(pe, pn);
}
const STAIRS = [                                      // 階梯（設在較低的一側，靠著擋土牆）
  { pe0: L12, pe1: L12 + 2, pn0: -11.7, pn1: 25, axis: 'pe', hiAt: L12, lo: LV1, hi: LV2, n: 5, bleacher: true }, // 操場看台（磨石長條座椅，升旗台正前方是草坡）
  { pe0: L12, pe1: L12 + 2, pn0: -45, pn1: -38.8, axis: 'pe', hiAt: L12, lo: LV1, hi: LV2, n: 5, bleacher: true }, // 司令台南側的看台
  { pe0: -23.8, pe1: -17.2, pn0: -11.7, pn1: -10.5, axis: 'pn', hiAt: -11.7, lo: LV2, hi: LVS, n: 3 },     // 司令台北端上台的階梯
  { pe0: -62.5, pe1: -60, pn0: -45, pn1: -41, axis: 'pe', hiAt: -62.5, lo: LV2, hi: LV3, n: 5 },       // 西棟南側上宿舍、遊樂場
  { pe0: -52.5, pe1: -50, pn0: -72, pn1: -68, axis: 'pe', hiAt: -52.5, lo: LV2, hi: LV3, n: 5 },       // 上球場
  { pe0: -76, pe1: -72, pn0: 2, pn1: 4.5, axis: 'pn', hiAt: 2, lo: LV2, hi: LV3, n: 5 },               // 回收室旁上宿舍
  { pe0: -47.9, pe1: -45.4, pn0: -14, pn1: -9, axis: 'pe', hiAt: -47.9, lo: LV2, hi: LVW, n: 4 },      // 中庭上西棟
  { pe0: -55, pe1: -51, pn0: -34.1, pn1: -31.6, axis: 'pn', hiAt: -31.6, lo: LV2, hi: LVW, n: 4 },     // 西棟南端
  { pe0: -52, pe1: -48.6, pn0: 0.9, pn1: 3.4, axis: 'pn', hiAt: 0.9, lo: LV2, hi: LVW, n: 4 },         // 西棟接北棟走廊
];
function LVwalk(pe, pn) {                             // 行走用（階梯處連續）
  for (const st of STAIRS) {
    if (pe >= st.pe0 && pe <= st.pe1 && pn >= st.pn0 && pn <= st.pn1) {
      const v = st.axis === 'pe' ? pe : pn, a = st.axis === 'pe' ? st.pe0 : st.pn0, b = st.axis === 'pe' ? st.pe1 : st.pn1;
      const t = st.hiAt === a ? (v - a) / (b - a) : (b - v) / (b - a);
      return st.hi + (st.lo - st.hi) * t;
    }
  }
  return LV(pe, pn);
}
const lvlLocal = (x, z) => LVobj(x, -z);
function edgeLevel(x, z) {
  const [pe, pn] = toPlan(x, z), C = CAMPUS;
  const cp = (a, b) => LV(clamp(a, C.pe0, C.pe1), clamp(b, C.pn0, C.pn1));
  return Math.min(cp(pe, pn), cp(pe + 20, pn), cp(pe - 20, pn), cp(pe, pn + 20), cp(pe, pn - 20));
}
function ground(x, z) {
  if (campusDist(x, z) <= 0) { const [pe, pn] = toPlan(x, z); return PAD + PAD_TOP + LVwalk(pe, pn); }
  return sampleGrid(H, x, z);
}

// ---------- 折線工具
function densify(pts, step) {
  const v = pts.map(p => new THREE.Vector3(p[0], 0, p[1]));
  if (v.length < 2) return pts.map(p => [p[0], p[1]]);
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  const n = Math.max(2, Math.ceil(curve.getLength() / step));
  return curve.getSpacedPoints(n).map(p => [p.x, p.z]);
}
function distToPolyline(x, z, pts) {
  let best = Infinity, bi = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    let t = L ? ((x - ax) * dx + (z - az) * dz) / L : 0; t = clamp(t, 0, 1);
    const ex = ax + dx * t - x, ez = az + dz * t - z, d = ex * ex + ez * ez;
    if (d < best) { best = d; bi = k + t; }
  }
  return { d: Math.sqrt(best), i: bi };
}
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

// ---------- 河川：水位與河槽
const RIVER = densify(D.river, 10);
const RIVER_WL = RIVER.map((p, i) => {
  const a = RIVER[Math.max(0, i - 1)], b = RIVER[Math.min(RIVER.length - 1, i + 1)];
  let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
  let m = Infinity;
  for (let o = -26; o <= 26; o += 6.5) m = Math.min(m, realElev(p[0] - tz * o, p[1] + tx * o));
  return m + 0.5;
});
for (let i = 1; i < RIVER_WL.length; i++) RIVER_WL[i] = Math.min(RIVER_WL[i], RIVER_WL[i - 1]);
// 地圖東界：秀姑巒溪中線（以東移除）
const RIVER_BY_Z = RIVER.map((p, k) => [p[1], p[0], RIVER_WL[k]]).sort((a, b) => a[0] - b[0]);
function riverAt(z) {
  const R = RIVER_BY_Z, n = R.length;
  let k = 0; while (k < n - 2 && R[k + 1][0] < z) k++;
  const [z0, x0, w0] = R[k], [z1, x1, w1] = R[k + 1], t = (z - z0) / ((z1 - z0) || 1);
  return [x0 + (x1 - x0) * t, w0 + (w1 - w0) * clamp(t, 0, 1)];
}
const riverX = z => riverAt(z)[0];
const eastOfRiver = (x, z) => x > riverX(z);
const CREEKS = Object.entries(D.creeks).map(([name, pts]) => ({ name, pts: densify(pts, 6) }));
const VILLAGE_ROADS = Object.entries(D.roads).filter(([k]) => k !== 'main').map(([k, p]) => densify(p, 4));
const MAIN_ROAD = densify(D.roads.main, 4);
const ALL_ROADS = [MAIN_ROAD, ...VILLAGE_ROADS];

// 地形修整：校園整地、河槽與溪溝下切
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const x = X0 + i * CELL, z = Z0 + j * CELL, k = j * NX + i;
  const cd = campusDist(x, z);
  if (cd <= 0) H[k] = PAD - 0.6;
  else if (cd < 50) { const t = cd <= 12 ? 0 : smooth((cd - 12) / 38); H[k] = lerp(PAD + edgeLevel(x, z) - 0.3, H[k], t); }
  const r = distToPolyline(x, z, RIVER);
  if (r.d < 24) { const wl = RIVER_WL[Math.round(clamp(r.i, 0, RIVER.length - 1))]; H[k] = Math.min(H[k], wl - 0.9); }
  for (const c of CREEKS) { const q = distToPolyline(x, z, c.pts); if (q.d < 13) H[k] -= 1.1 * (1 - q.d / 13); }
}

// ---------- 地表分類（地形著色、樹木、小地圖共用）
const GF_FRAME = D.gfFrame, BD_FRAME = D.bdFrame;
const PAL = {
  gravel: ['#d3c6a5', '#c7b996', '#dcd1b6', '#c0b28f'],
  forestLow: ['#5a9442', '#4f8a3c', '#62a047', '#4a8439'],
  forestHigh: ['#3f7639', '#376b34', '#46803e', '#33652f'],
  cliff: ['#7c8a58', '#6f7f4f'],
  paddy: ['#8fd15a', '#9fd96a', '#7fc451', '#b3dc77', '#71b84b', '#a6d063', '#86c95a'],
  paddyWet: ['#86c3a8', '#7db99f'],
  village: ['#a9c77c', '#b2cd84'],
  orchard: ['#b6b56a', '#a8ab62'],
};
function slopeAt(x, z) {
  const dx = (sampleGrid(H, x + 10, z) - sampleGrid(H, x - 10, z)) / 20;
  const dz = (sampleGrid(H, x, z + 10) - sampleGrid(H, x, z - 10)) / 20;
  return Math.hypot(dx, dz);
}
function classify(x, z) {
  const h = realElev(x, z), s = slopeAt(x, z);
  const r = distToPolyline(x, z, RIVER).d;
  if (r < 150 + 25 * Math.sin(z / 90)) return 'gravel';
  for (const c of CREEKS) if (distToPolyline(x, z, c.pts).d < 9 && h < 200) return 'gravel';
  if (h > 201 || s > 0.27) return h > 300 ? 'forestHigh' : (s > 0.9 ? 'cliff' : 'forestLow');
  if (campusDist(x, z) < 6) return 'village';
  if (pointInPoly(x, z, GF_FRAME) || pointInPoly(x, z, BD_FRAME)) return 'village';
  const m = distToPolyline(x, z, MAIN_ROAD).d;
  const [pe] = toPlan(x, z);
  if (h > 189 && m < 260 && pe < -40) return 'orchard';
  return 'paddy';
}
function colorFor(type, x, z) {
  const p = PAL[type];
  if (type === 'paddy') {
    const [pe, pn] = toPlan(x, z);
    const ci = Math.floor(pe / 46), cj = Math.floor(pn / 30);
    const r = hash2(ci, cj);
    if (r > 0.9) return PAL.paddyWet[Math.floor(hash2(cj, ci) * 2)];
    return p[Math.floor(r * p.length) % p.length];
  }
  return p[Math.floor(hash2(Math.floor(x / 23), Math.floor(z / 19)) * p.length) % p.length];
}

/* ====================================================================
   場景
   ==================================================================== */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const LOW_POWER = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const SKY = '#bfe3f2';
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#6fb6e6'); gr.addColorStop(0.55, '#a9d8f0'); gr.addColorStop(1, '#e4f2f2');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.fog = new THREE.Fog(SKY, 700, 4200);

const camera = new THREE.PerspectiveCamera(55, 1, 0.8, 14000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
controls.minDistance = 5; controls.maxDistance = 2600;
controls.enablePan = false;

const hemi = new THREE.HemisphereLight('#e3f1ff', '#6d7d4c', 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4dc', 2.6);
const SUN_OFF = new THREE.Vector3(260, 420, 190);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW_POWER ? 1024 : 2048, LOW_POWER ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 10, far: 1400 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

/* ---------- 靜態幾何批次合併（同色合併，減少繪製次數） ---------- */
const MATS = new Map();
function lambert(color) {
  if (!MATS.has(color)) MATS.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return MATS.get(color);
}
const BATCH = new Map();
function addGeo(geo, color, matrix) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone());
  g.deleteAttribute('uv');
  g.applyMatrix4(matrix);
  if (!BATCH.has(color)) BATCH.set(color, []);
  BATCH.get(color).push(g);
}
function flushBatch() {
  for (const [color, list] of BATCH) {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of list) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, lambert(color)); m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }
  BATCH.clear();
}

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 7),
  pyr: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
  ico: new THREE.IcosahedronGeometry(1, 0),
  sph: new THREE.SphereGeometry(1, 10, 8),
  gable: (() => {
    const v = [-.5, 0, -.5, .5, 0, -.5, 0, 1, -.5, .5, 0, .5, -.5, 0, .5, 0, 1, .5];
    const idx = [0, 2, 1, 3, 5, 4, 0, 4, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3];
    const p = []; for (const i of idx) p.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals(); return g;
  })(),
};
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
function M(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
/** 局部座標框架：以 (x, y, z, rotY) 為原點，局部 +x、+z 方向隨旋轉 */
class Frame {
  constructor(x, y, z, ry = 0) { this.m = M(x, y, z, ry); this.ry = ry; this.o = new THREE.Vector3(x, y, z); }
  put(geo, color, x, y, z, ry, sx, sy, sz, rx, rz) { addGeo(geo, color, this.m.clone().multiply(M(x, y, z, ry, sx, sy, sz, rx, rz))); }
  box(x, y0, z, w, h, d, color, ry = 0) { this.put(G.box, color, x, y0 + h / 2, z, ry, w, h, d); }
  cyl(x, y0, z, r, h, color, seg6 = false) { this.put(seg6 ? G.cyl6 : G.cyl, color, x, y0 + h / 2, z, 0, r, h, r); }
  world(x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(this.m); }
}

/* ---------- 建物碰撞（角色不能穿牆） ---------- */
const OBST = [];
function block(F, x, z, w, d, ry = 0, pad = 0.45) {
  const p = F.world(x, 0, z), r = F.ry + ry + (F === CF && COFF ? COFF.a : 0);
  OBST.push({ x: p.x, z: p.z, hw: w / 2 + pad, hd: d / 2 + pad, c: Math.cos(r), s: Math.sin(r), R: Math.hypot(w, d) / 2 + pad });
}
function blocked(x, z) {
  for (const o of OBST) {
    const dx = x - o.x, dz = z - o.z;
    if (dx * dx + dz * dz > o.R * o.R) continue;
    const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
    if (Math.abs(lx) < o.hw && Math.abs(lz) < o.hd) return true;
  }
  return false;
}
function freeSpot(x, z) {
  if (!blocked(x, z)) return [x, z];
  for (let r = 3; r < 60; r += 3) for (let a = 0; a < 16; a++) {
    const t = a / 16 * Math.PI * 2, nx = x + Math.cos(t) * r, nz = z + Math.sin(t) * r;
    if (!blocked(nx, nz)) return [nx, nz];
  }
  return [x, z];
}

/* ====================================================================
   地形
   ==================================================================== */
function buildTerrain() {
  const tris = (NX - 1) * (NZ - 1) * 2;
  const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), col = new Float32Array(tris * 9);
  const c = new THREE.Color(); let o = 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  const V = (i, j, out) => {
    const x = X0 + i * CELL, z = Z0 + j * CELL, xr = riverX(z);
    return x <= xr ? out.set(x, H[j * NX + i], z) : out.set(xr, sampleGrid(H, xr, z), z);   // 以東的格點收到中線上
  };
  function tri(a, b, cc) {
    t1.subVectors(b, a); t2.subVectors(cc, a); n.crossVectors(t1, t2);
    if (n.y < 0) { const tmp = b.clone(); b.copy(cc); cc.copy(tmp); n.negate(); }
    n.normalize();
    const cx = (a.x + b.x + cc.x) / 3, cz = (a.z + b.z + cc.z) / 3;
    c.set(colorFor(classify(cx, cz), cx, cz));
    for (const p of [a, b, cc]) {
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; o += 3;
    }
  }
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    tri(V(i, j, A), V(i, j + 1, C), V(i + 1, j, B));
    tri(V(i + 1, j, A), V(i, j + 1, C), V(i + 1, j + 1, B));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true; mesh.name = 'terrain';
  scene.add(mesh);

  // 立體模型的土層側邊與底座
  const BASE = 138, sp = [], sc = [], sn = [];
  const top = new THREE.Color('#6b4f36'), bot = new THREE.Color('#3f2e21');
  function edge(pts, nx, nz) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const ha = sampleGrid(H, ax, az), hb = sampleGrid(H, bx, bz);
      const q = [[ax, ha, az, top], [bx, hb, bz, top], [bx, BASE, bz, bot], [ax, ha, az, top], [bx, BASE, bz, bot], [ax, BASE, az, bot]];
      const tA = new THREE.Vector3(bx - ax, hb - ha, bz - az), tB = new THREE.Vector3(0, BASE - hb, 0), nn = new THREE.Vector3().crossVectors(tA, tB);
      const flip = nn.x * nx + nn.z * nz < 0;
      const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
      for (const ii of order) { const v = q[ii]; sp.push(v[0], v[1], v[2]); sc.push(v[3].r, v[3].g, v[3].b); sn.push(nx, 0, nz); }
    }
  }
  const row = (j) => { const z = Z0 + j * CELL, xr = riverX(z), pts = []; for (let i = 0; i < NX && X0 + i * CELL < xr; i++) pts.push([X0 + i * CELL, z]); pts.push([xr, z]); return pts; };
  const colm = (i) => Array.from({ length: NZ }, (_, j) => [X0 + i * CELL, Z0 + j * CELL]);
  const riverEdge = []; for (let z = Z0; z <= ZMAX + 0.01; z += CELL / 2) riverEdge.push([riverX(z), z]);
  edge(row(0), 0, -1); edge(row(NZ - 1), 0, 1); edge(colm(0), -1, 0); edge(riverEdge, 1, 0);
  // 河道剖面：中線上的水，像模型切開的斷面
  {
    const wp = [], wi = [];
    riverEdge.forEach(([x, z], k) => { const wl = riverAt(z)[1], g = sampleGrid(H, x, z); wp.push(x + 0.02, Math.max(g, wl), z, x + 0.02, Math.min(g, wl), z); if (k) { const a = (k - 1) * 2; wi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals();
    scene.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: '#3d8fc8', side: THREE.DoubleSide, transparent: true, opacity: 0.85 })));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
  sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  scene.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const bs = new THREE.Shape(); bs.moveTo(X0, -Z0); bs.lineTo(X0, -ZMAX);
  for (let k = riverEdge.length - 1; k >= 0; k--) bs.lineTo(riverEdge[k][0], -riverEdge[k][1]);
  const base = new THREE.Mesh(new THREE.ShapeGeometry(bs).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#3f2e21', side: THREE.DoubleSide }));
  base.position.y = BASE; scene.add(base);
  return mesh;
}

/* ---------- 水面與道路（沿地形鋪設的帶狀網格） ---------- */
function ribbon(pts, width, yAt, material, { meander = 0, seed = 1 } = {}) {
  const p = [], nrm = [], idx = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    const nx = -tz, nz = tx;
    const off = meander ? Math.sin(k * 0.13 + seed) * meander + Math.sin(k * 0.047 + seed * 2) * meander * 0.8 : 0;
    const cx = pts[k][0] + nx * off, cz = pts[k][1] + nz * off;
    const w = width / 2;
    const lx = cx + nx * w, lz = cz + nz * w, rx = cx - nx * w, rz = cz - nz * w;
    p.push(lx, yAt(lx, lz, k), lz, rx, yAt(rx, rz, k), rz);
    nrm.push(0, 1, 0, 0, 1, 0);
    if (k > 0) { const i0 = (k - 1) * 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material); m.receiveShadow = true;
  scene.add(m); return m;
}
const waterMat = new THREE.MeshPhongMaterial({ color: '#3d9ad6', specular: '#ffffff', shininess: 60, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const roadMat = new THREE.MeshLambertMaterial({ color: '#8f8c84', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const laneMat = new THREE.MeshLambertMaterial({ color: '#f2cf57', polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

function buildWaterAndRoads() {
  {
    const p = [], idx = [];
    RIVER_BY_Z.forEach(([z, x, wl], k) => { p.push(x, wl, z, x - 13 + Math.sin(k * 0.13 + 2) * 4, wl, z); if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, waterMat.clone()); m.material.side = THREE.DoubleSide; m.receiveShadow = true; scene.add(m);
  }
  for (const c of CREEKS) ribbon(c.pts.filter(([x, z]) => x < riverX(z) - 2), 5, (x, z) => sampleGrid(H, x, z) + 0.45, waterMat);
  ribbon(MAIN_ROAD, 6, (x, z) => ground(x, z) + 0.35, roadMat);
  ribbon(MAIN_ROAD, 0.25, (x, z) => ground(x, z) + 0.38, laneMat);
  for (const r of VILLAGE_ROADS) ribbon(r, 4.4, (x, z) => ground(x, z) + 0.33, roadMat);
}

/* ====================================================================
   樹木（InstancedMesh）
   ==================================================================== */
const TREES = { broad: [], conifer: [], maple: [] };
function addTree(kind, x, z, s, y = null) { TREES[kind].push([x, y ?? ground(x, z), z, s]); }
function nearRoad(x, z, r) { for (const road of ALL_ROADS) if (distToPolyline(x, z, road).d < r) return true; return false; }
function scatterTrees() {
  const rnd = mulberry32(7);
  for (let z = Z0 + 8; z < ZMAX - 8; z += 14) for (let x = X0 + 8; x < XMAX - 8; x += 14) {
    const px = x + (rnd() - 0.5) * 12, pz = z + (rnd() - 0.5) * 12;
    if (campusDist(px, pz) < 4 || px > riverX(pz) - 3) continue;
    const t = classify(px, pz);
    let p = 0;
    if (t === 'forestLow') p = 0.5; else if (t === 'forestHigh') p = 0.55; else if (t === 'cliff') p = 0.3;
    else if (t === 'orchard') p = 0.18; else if (t === 'village') p = 0.05; else if (t === 'gravel') p = 0.012;
    else if (t === 'paddy') p = 0.004;
    if (rnd() > p) continue;
    if ((t === 'village' || t === 'orchard') && nearRoad(px, pz, 7)) continue;
    if (blocked(px, pz)) continue;
    const h = realElev(px, pz);
    const s = t === 'orchard' ? 0.45 + rnd() * 0.2 : 0.95 + rnd() * 0.6;
    addTree(h > 330 && rnd() < 0.5 ? 'conifer' : 'broad', px, pz, s);
  }
}
function buildTrees() {
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.38, 3.2, 5).translate(0, 1.6, 0);
  const crownGeo = new THREE.IcosahedronGeometry(3.4, 0).scale(1, 0.92, 1).translate(0, 5.6, 0);
  const coneGeo = new THREE.ConeGeometry(2.8, 8.5, 6).translate(0, 6.6, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#7a5636', flatShading: true });
  const crownMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  const rnd = mulberry32(11), m4 = new THREE.Matrix4(), c = new THREE.Color();
  const greens = ['#4f9a3f', '#5ba745', '#448b39', '#68ad4b', '#3f8236'];
  const reds = ['#d9542e', '#e37b2e', '#c9442b'];
  const all = [...TREES.broad.map(t => ['broad', t]), ...TREES.conifer.map(t => ['conifer', t]), ...TREES.maple.map(t => ['maple', t])];
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, all.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, all.length - TREES.conifer.length);
  const cones = new THREE.InstancedMesh(coneGeo, crownMat, Math.max(1, TREES.conifer.length));
  let ic = 0, io = 0;
  all.forEach(([kind, [x, y, z, s]], i) => {
    m4.compose(new THREE.Vector3(x, y - 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)), new THREE.Vector3(s, s * (0.9 + rnd() * 0.25), s));
    trunks.setMatrixAt(i, m4);
    if (kind === 'conifer') { cones.setMatrixAt(io, m4); cones.setColorAt(io, c.set(['#2f6b3a', '#3a7a40', '#2c5f35'][io % 3])); io++; }
    else { crowns.setMatrixAt(ic, m4); crowns.setColorAt(ic, c.set(kind === 'maple' ? reds[ic % 3] : greens[Math.floor(rnd() * greens.length)])); ic++; }
  });
  cones.count = io;
  for (const im of [trunks, crowns, cones]) { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; scene.add(im); }
}

/* ====================================================================
   文字牌（教室名牌、招牌）
   ==================================================================== */
const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Heiti TC", sans-serif';
function textPlate(text, w, h, { bg = '#ffffff', fg = '#1d3a2a', border = '#1d3a2a', size = 0.62, bears = false } = {}) {
  const px = 96, cw = Math.round(px * w / h), c = document.createElement('canvas');
  c.width = Math.min(2048, cw * 2); c.height = px * 2;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.lineWidth = 10; g.strokeStyle = border; g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = c.height * size; g.font = `700 ${fs}px ${FONT}`;
  const maxW = bears ? c.width - c.height * 2.3 : c.width * 0.9;
  while (g.measureText(text).width > maxW && fs > 10) { fs -= 4; g.font = `700 ${fs}px ${FONT}`; }
  g.fillText(text, c.width / 2, c.height / 2 + fs * 0.04);
  if (bears) {
    for (const bx of [c.height * 0.55, c.width - c.height * 0.55]) {
      const by = c.height * 0.52, r = c.height * 0.24;
      g.fillStyle = '#2b1d14';
      g.beginPath(); g.arc(bx - r * 0.75, by - r * 0.78, r * 0.38, 0, Math.PI * 2); g.arc(bx + r * 0.75, by - r * 0.78, r * 0.38, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c99b6a'; g.beginPath(); g.ellipse(bx, by + r * 0.35, r * 0.42, r * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(bx - r * 0.38, by - r * 0.18, r * 0.12, 0, Math.PI * 2); g.arc(bx + r * 0.38, by - r * 0.18, r * 0.12, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: false }));
  return mesh;
}

/* ====================================================================
   地標登錄
   ==================================================================== */
const LANDMARKS = [];
function landmark(o) {
  const y = (o.y ?? ground(o.x, o.z));
  const L = { radius: 16, labelH: 8, kind: 'landmark', ...o, y };
  L.elev = Math.round(realElev(o.x, o.z));
  LANDMARKS.push(L); return L;
}

/* ====================================================================
   卓楓國小校園（依校長標註的配置圖＋衛星圖實際尺寸）
   局部座標：x = 圖面東（公尺），z = 圖面南（公尺），原點 = 操場中心
   ==================================================================== */
const campusGroup = new THREE.Group();
campusGroup.rotation.y = -RAD; campusGroup.position.set(0, PAD, 0);
scene.add(campusGroup); campusGroup.updateMatrixWorld();
let COFF = null;   // 校園可移動物件的位移（局部座標 dx、dz 與層高差 dy）
class CampusFrame extends Frame {
  // 校園物件依所在位置自動抬到該層地基上
  put(geo, color, x, y, z, ry, sx, sy, sz, rx, rz) {
    if (!COFF) { super.put(geo, color, x, y + lvlLocal(x, z), z, ry, sx, sy, sz, rx, rz); return; }
    const [tx, tz] = coffXZ(x, z);
    addGeo(geo, color, this.m.clone().multiply(COFF.mat).multiply(M(x, y + lvlLocal(tx, tz), z, ry, sx, sy, sz, rx, rz)));
  }
  raw(geo, color, x, y, z, ry, sx, sy, sz, rx, rz) {
    if (!COFF) { super.put(geo, color, x, y, z, ry, sx, sy, sz, rx, rz); return; }
    addGeo(geo, color, this.m.clone().multiply(COFF.mat).multiply(M(x, y + COFF.dy, z, ry, sx, sy, sz, rx, rz)));
  }
  world(x, y, z) { if (COFF) [x, z] = coffXZ(x, z); return super.world(x, y, z); }
}
// 校園裡可以在平面地圖上移動的物件（pe, pn 為校園圖面座標；w, d 為平面佔地，用於編輯器）
const CAMPUS_ITEMS = {
  gate: { name: '校門意象', pe: -57, pn: 29, w: 15, d: 9.4, oz: -0.2 },
  tabletA: { name: '石碑與兩隻小動物', pe: -55.2, pn: 17.6, w: 7, d: 3.2 },
  tabletB: { name: '石碑與兩隻山豬', pe: -23, pn: 17.6, w: 8, d: 3.2 },
  flag: { name: '升旗台與兩棵大樹', pe: -17.8, pn: -4.8, w: 3, d: 11 },
  pavilion: { name: '涼亭', pe: -28.8, pn: -59, w: 6.4, d: 6.4 },
  maple: { name: '大楓樹', pe: 8, pn: -32.4, w: 12, d: 9 },
  stonehouse: { name: '石板屋與布農人偶', pe: 17.3, pn: -34.7, w: 10, d: 6, oz: 0.8 },
  carport: { name: '車棚', pe: -32.25, pn: 40.9, w: 21.1, d: 7 },
  wenjian: { name: '文健站', pe: -71.6, pn: 33.7, w: 14.4, d: 21.8 },
  recycle: { name: '回收室', pe: -72.7, pn: 10.15, w: 8.6, d: 6.9 },
  dorm: { name: '老師宿舍', pe: -74.15, pn: -8.8, w: 12.7, d: 8.8 },
  library: { name: '圖書室', pe: -24.85, pn: -80.85, w: 8.7, d: 12.3 },
  playground: { name: '遊樂場', pe: -70.15, pn: -43.9, w: 13.7, d: 13.8 },
};
const campusOff = id => LAYOUT.campus?.[id] || [0, 0, 0];
// 校園物件的位移與旋轉：先繞物件中心旋轉 a（局部座標的 Y 軸），再平移
function coffXZ(x, z) { const C = COFF, dx = x - C.cx, dz = z - C.cz, c = Math.cos(C.a), s = Math.sin(C.a); return [C.cx + C.dx + dx * c + dz * s, C.cz + C.dz - dx * s + dz * c]; }
function campusItem(id, fn) {
  const it = CAMPUS_ITEMS[id], [dpe = 0, dpn = 0, a = 0] = campusOff(id);
  if (!dpe && !dpn && !a) { fn(0, 0); return; }
  const cx = it.pe, cz = -it.pn;
  const mat = new THREE.Matrix4().makeTranslation(cx + dpe, 0, cz - dpn).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz));
  COFF = { dx: dpe, dz: -dpn, cx, cz, a, mat, dy: LVobj(it.pe + dpe, it.pn + dpn) - LVobj(it.pe, it.pn), dpe, dpn };
  const n0 = campusGroup.children.length;
  try { fn(dpe, dpn); } finally {
    for (let k = n0; k < campusGroup.children.length; k++) {
      const c = campusGroup.children[k], [nx, nz] = coffXZ(c.position.x, c.position.z);
      c.position.x = nx; c.position.z = nz; c.position.y += COFF.dy; c.rotation.y += a;
    }
    COFF = null;
  }
}
const CF = new CampusFrame(0, PAD, 0, -RAD);  // 批次用框架（與 campusGroup 相同）
const P = (pe, pn) => [pe, -pn];             // 圖面 → 局部

function rectXZ(pe0, pe1, pn0, pn1) { return { x: (pe0 + pe1) / 2, z: -(pn0 + pn1) / 2, w: Math.abs(pe1 - pe0), d: Math.abs(pn1 - pn0) }; }
function slab(pe0, pe1, pn0, pn1, y, h, color) { const r = rectXZ(pe0, pe1, pn0, pn1); CF.box(r.x, y, r.z, r.w, h, r.d, color); }
function plate(text, pe, y, pn, rotY, w = 3.2, h = 0.8, opt) {
  const m = textPlate(text, w, h, opt); m.position.set(pe, y + LVobj(pe, pn), -pn); m.rotation.y = rotY; campusGroup.add(m); return m;
}
function campusLM(name, pe, pn, desc, extra = {}) {
  if (COFF) { const [x, z] = coffXZ(pe, -pn); pe = x; pn = -z; }
  const [x, z] = fromPlan(pe, pn);
  return landmark({ name, area: '卓楓國小', x, z, y: PAD + LV(pe, pn), desc, kind: 'campus', radius: 11, labelH: 6, ...extra });
}

function stadium(cx, cz, w, len, inset) {
  const r = w / 2 - inset, half = len / 2 - w / 2;
  const s = new THREE.Shape();
  s.moveTo(cx - r, cz - half); s.lineTo(cx - r, cz + half);
  s.absarc(cx, cz + half, r, Math.PI, 0, true);
  s.lineTo(cx + r, cz - half);
  s.absarc(cx, cz - half, r, 0, Math.PI, true);
  return s;
}
function flatShape(shape, holes, y, color, lvl = 0) {
  if (holes) shape.holes.push(...holes);
  const g = new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2);
  CF.raw(g, color, 0, y + lvl, 0);
}
const FLAG_PN = () => CAMPUS_ITEMS.flag.pn + campusOff('flag')[1];
function buildBleacher(st, box) {
  // 照片：五排磨石長條座椅一階一階往下到跑道，升旗台正前方留一段草坡
  const n = st.n, w = (st.pe1 - st.pe0) / n, fpn = FLAG_PN(), ramp = [fpn - 4.6, fpn + 4.6];
  const hasRamp = ramp[0] > st.pn0 && ramp[1] < st.pn1;
  const segs = hasRamp ? [[st.pn0, ramp[0]], [ramp[1], st.pn1]] : [[st.pn0, st.pn1]];
  for (let k = 0; k < n; k++) {
    const a = st.pe0 + w * k, top = st.lo + (st.hi - st.lo) * (n - k) / (n + 1) + PAD_TOP;
    for (const [p0, p1] of segs) {
      box(a, a + w, p0, p1, st.lo, top - 0.08, '#b9b6ad');
      const len = p1 - p0, col = k % 2 ? '#a7a8a2' : '#c3c3bd';
      CF.raw(G.cyl, col, a + w * 0.55, top - 0.1, -(p0 + p1) / 2, 0, w * 0.52, len - 0.1, 0.17, Math.PI / 2, 0);
    }
  }
  if (!hasRamp) return;
  // 草坡
  const L = st.pe1 - st.pe0, H = st.hi - st.lo, th = Math.atan2(H, L), hyp = Math.hypot(L, H), T = 0.6;
  const xm = (st.pe0 + st.pe1) / 2, ym = st.lo + H / 2 + PAD_TOP;
  CF.raw(G.box, '#78a957', xm - Math.sin(th) * T / 2, ym - Math.cos(th) * T / 2, -fpn, 0, hyp, T, ramp[1] - ramp[0], 0, -th);
  for (let k = 0; k < 7; k++) { const pn = ramp[0] + 1 + k * 1.2, pe = st.pe0 + 0.4 + (k * 0.37 % 1) * 1.3; CF.raw(G.ico, '#5e8f3e', pe, st.hi - (pe - st.pe0) / L * H + 0.08, -pn, k, 0.28, 0.12, 0.28); }
}
function triangleBandTexture() {
  // 司令台柱子上的黑白三角紋
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d'); g.fillStyle = '#f2f1ec'; g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, 256, 6); g.fillRect(0, 42, 256, 6);
  for (let x = 0; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 42); g.lineTo(x + 16, 8); g.lineTo(x + 32, 42); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2; return t;
}
function bigPrunedTree(pe, pn, seed, lean = 0) {
  // 升旗台兩側修剪過的大樹：紅磚樹圍、粗樹幹、往上分叉的枝幹與稀疏的葉叢
  const rnd = mulberry32(seed), lv = LV(pe, pn) + PAD_TOP, x = pe, z = -pn;
  CF.raw(G.box, '#9a4a35', x, lv + 0.22, z, 0, 2.5, 0.44, 2.5);
  CF.raw(G.box, '#6e5a46', x, lv + 0.45, z, 0, 2.1, 0.04, 2.1);
  const TRUNK = '#8a7258', trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 8);
  const limb = (bx, by, bz, a, hd, L, r) => {
    const dx = -Math.sin(a) * Math.cos(hd), dy = Math.cos(a), dz = Math.sin(a) * Math.sin(hd);
    CF.raw(trunkGeo, TRUNK, bx + dx * L / 2, by + dy * L / 2, bz + dz * L / 2, hd, r, L, r, 0, a);
    return [bx + dx * L, by + dy * L, bz + dz * L];
  };
  const top = limb(x, lv + 0.4, z, lean, 0.4, 3.6, 0.5);
  const tufts = [];
  for (let k = 0; k < 5; k++) {
    const hd = k / 5 * Math.PI * 2 + rnd() * 0.6, a = 0.32 + rnd() * 0.3;
    const p1 = limb(...top, a, hd, 2.6 + rnd() * 1.2, 0.3);
    const p2 = limb(...p1, a * 0.6, hd + (rnd() - 0.5) * 0.8, 1.6 + rnd() * 1.2, 0.18);
    CF.raw(G.cyl, '#b48a63', p1[0], p1[1] + 0.05, p1[2], 0, 0.2, 0.1, 0.2);         // 鋸過的切口
    tufts.push(p1, p2);
    if (rnd() < 0.7) tufts.push(limb(...p1, a + 0.5, hd + 1.2, 1.4, 0.12));
  }
  for (const [tx, ty, tz] of tufts) for (let j = 0; j < 4; j++) {          // 剛修剪過，只剩枝端一小簇一小簇的葉子
    const s = 0.28 + rnd() * 0.32;
    CF.raw(G.ico, ['#4c7a36', '#5d8c40', '#3f6b2e', '#6a9a4a'][j], tx + (rnd() - 0.5) * 1.2, ty + (rnd() - 0.3) * 0.9, tz + (rnd() - 0.5) * 1.2, rnd() * 3, s, s * 0.8, s);
  }
}
function mosaicMural(kind) {
  // 北棟東側山牆的馬賽克壁畫：先畫低解析度圖，再一格一格貼成磁磚
  const cols = kind === 'A' ? 30 : 42, rows = 64, tile = 10;
  const src = document.createElement('canvas'); src.width = cols; src.height = rows;
  const g = src.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, rows); sky.addColorStop(0, '#9fd2ee'); sky.addColorStop(1, '#e9f4f7');
  g.fillStyle = sky; g.fillRect(0, 0, cols, rows);
  const person = (cx, base, dress, top, arms) => {
    g.fillStyle = '#1b1b1d'; g.fillRect(cx - 5, base - 12, 10, 12);                                  // 黑色裙
    for (const [y, c] of [[base - 10, '#c53a2f'], [base - 7, '#f2c230'], [base - 5, '#2f8a57'], [base - 3, '#ffffff'], [base - 2, '#c53a2f']]) { g.fillStyle = c; g.fillRect(cx - 5, y, 10, 1); }
    g.fillStyle = '#2b2b2b'; g.fillRect(cx - 3, base, 2, 3); g.fillRect(cx + 1, base, 2, 3);
    g.fillStyle = top; g.fillRect(cx - 5, base - 26, 10, 15);                                         // 藍色上衣
    g.fillStyle = '#f5f1e6'; g.fillRect(cx - 1, base - 26, 2, 15);
    g.fillStyle = '#c98c62'; g.fillRect(cx - 3, base - 33, 6, 7);                                     // 臉
    g.fillStyle = '#1b1613'; g.fillRect(cx - 4, base - 35, 8, 3); g.fillRect(cx - 4, base - 33, 1, 5); g.fillRect(cx + 3, base - 33, 1, 5);
    for (const [k, c] of [[0, '#c53a2f'], [1, '#f2c230'], [2, '#2f8a57']]) { g.fillStyle = c; g.fillRect(cx - 4 + k * 3, base - 32, 3, 1); }   // 頭飾
    g.fillStyle = '#1b1b1d'; g.fillRect(cx - 1, base - 29, 1, 1); g.fillRect(cx + 1, base - 29, 1, 1);
    g.fillStyle = top; for (const [ax, ay] of arms) g.fillRect(ax, ay, 2, 7);
  };
  if (kind === 'A') {
    g.fillStyle = '#e3c25a'; g.fillRect(0, rows - 18, cols, 18);                                      // 小米田
    g.fillStyle = '#d6a43c'; for (let x = 0; x < cols; x += 3) g.fillRect(x, rows - 20 + (x % 2), 2, 4);
    g.fillStyle = '#6f8f3a'; g.beginPath(); g.moveTo(0, 30); g.lineTo(12, 18); g.lineTo(cols, 26); g.lineTo(cols, rows - 18); g.lineTo(0, rows - 18); g.fill();
    person(15, rows - 6, '#1b1b1d', '#2f6fb2', [[8, 30], [20, 30]]);
    g.fillStyle = '#e8c04a'; g.fillRect(4, 22, 8, 12); g.fillRect(19, 20, 8, 13);                     // 手上的小米束
    g.fillStyle = '#c9952c'; for (let y = 22; y < 34; y += 2) { g.fillRect(4, y, 8, 1); g.fillRect(19, y - 2, 8, 1); }
    g.fillStyle = '#2f8a57'; g.fillRect(7, 34, 2, 6); g.fillRect(22, 33, 2, 6);
  } else {
    g.fillStyle = '#c9b59a'; g.fillRect(0, rows - 10, cols, 10);
    person(11, rows - 6, '#1b1b1d', '#3b82c4', [[5, 27], [15, 25]]);
    person(31, rows - 6, '#1b1b1d', '#3b82c4', [[25, 25], [35, 27]]);
    g.fillStyle = '#7a4a2a'; g.fillRect(17, rows - 18, 8, 12); g.fillStyle = '#5b351d'; g.fillRect(17, rows - 18, 8, 2);   // 木臼
    g.fillStyle = '#e8dcc2'; g.fillRect(16, 6, 2, rows - 26); g.fillRect(24, 4, 2, rows - 24);         // 杵
  }
  const out = document.createElement('canvas'); out.width = cols * tile; out.height = rows * tile;
  const o = out.getContext('2d'), d = g.getImageData(0, 0, cols, rows).data, rnd = mulberry32(kind === 'A' ? 5 : 9);
  o.fillStyle = '#d8d2c6'; o.fillRect(0, 0, out.width, out.height);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = (j * cols + i) * 4, border = i < 2 || j < 2 || i >= cols - 2 || j >= rows - 2;
    let r = d[k], gg = d[k + 1], b = d[k + 2];
    if (border) { const v = rnd(); [r, gg, b] = v < 0.5 ? [150, 92, 64] : v < 0.8 ? [118, 70, 50] : [190, 140, 100]; }
    const jit = (rnd() - 0.5) * 34;
    o.fillStyle = `rgb(${clamp(r + jit, 0, 255) | 0},${clamp(gg + jit, 0, 255) | 0},${clamp(b + jit, 0, 255) | 0})`;
    o.fillRect(i * tile + 1, j * tile + 1, tile - 2, tile - 2);
  }
  const t = new THREE.CanvasTexture(out); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function calendarWallTexture(len, h) {
  // 司令台前牆：灰色石塊牆，中段一條白色帶子，上面是布農族曆板式的圖紋（菱形鍊、圓圈、棒狀符號、半圓）
  const ppm = 64, W = Math.round(len * ppm), Hh = Math.round(h * ppm);
  const c = document.createElement('canvas'); c.width = Math.min(W, 4096); c.height = Hh;
  const sx = c.width / W, g = c.getContext('2d'), rnd = mulberry32(17);
  g.fillStyle = '#a9a69d'; g.fillRect(0, 0, c.width, Hh);
  for (let y = 0; y < Hh; y += 18) for (let x = -rnd() * 60; x < c.width; ) { const w = 40 + rnd() * 70; g.fillStyle = `hsl(45,${4 + rnd() * 6}%,${56 + rnd() * 14}%)`; g.fillRect(x + 1, y + 1, w - 2, 16); x += w; }
  g.fillStyle = '#cfccc4'; g.fillRect(0, 0, c.width, 6);
  const by0 = Hh * 0.18, by1 = Hh * 0.62;
  g.fillStyle = '#e9e7e1'; g.fillRect(0, by0, c.width, by1 - by0);
  const ly = by1 - 10;
  g.strokeStyle = '#1e1e1e'; g.fillStyle = '#1e1e1e'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(10, ly); g.lineTo(c.width - 10, ly); g.stroke();
  for (let x = 20; x < c.width - 10; x += 34 * sx + 10) { g.beginPath(); g.moveTo(x, ly - 7); g.lineTo(x + 6, ly); g.lineTo(x, ly + 7); g.lineTo(x - 6, ly); g.fill(); }
  const top = by0 + 8, st = ly - 8;
  const sym = [
    x => { g.beginPath(); g.moveTo(x, st); g.lineTo(x, top + 14); g.stroke(); g.beginPath(); g.arc(x, top + 9, 6, 0, 7); g.stroke(); },
    x => { g.beginPath(); g.moveTo(x, st); g.lineTo(x, top + 18); g.stroke(); g.beginPath(); g.arc(x, top + 11, 8, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x - 8, top + 11); g.lineTo(x + 8, top + 11); g.moveTo(x, top + 3); g.lineTo(x, top + 19); g.stroke(); },
    x => { g.beginPath(); g.moveTo(x, st); g.lineTo(x, top + 16); g.stroke(); g.strokeRect(x - 6, top + 4, 12, 12); },
    x => { g.beginPath(); g.moveTo(x - 4, st); g.lineTo(x - 4, top + 6); g.moveTo(x + 4, st); g.lineTo(x + 4, top + 6); g.stroke(); },
    x => { g.beginPath(); g.moveTo(x, st); g.lineTo(x, top + 12); g.moveTo(x - 7, top + 4); g.lineTo(x, top + 12); g.lineTo(x + 7, top + 4); g.stroke(); },
    x => { g.beginPath(); g.arc(x + 20, st, 26, Math.PI, 0); g.stroke(); g.beginPath(); g.moveTo(x + 14, st); g.lineTo(x + 14, st - 12); g.stroke(); g.strokeRect(x + 22, st - 16, 9, 9); return 52; },
  ];
  for (let x = 40; x < c.width - 40; ) { const k = Math.floor(rnd() * sym.length), adv = sym[k](x) || 18; x += adv + 12 + rnd() * 30; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function graniteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), rnd = mulberry32(3);
  g.fillStyle = '#9d9d98'; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 1400; k++) { const v = rnd(); g.fillStyle = v < 0.45 ? '#6f6f6b' : v < 0.85 ? '#c4c4bf' : '#4d4d4a'; g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 1.6, 1 + rnd() * 1.6); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function buildStage() {
  // 司令台：三片高低錯落的平板屋頂，斜斜的磨石圓柱站在米色方石座上，柱身有黑白三角紋
  const gran = new THREE.MeshLambertMaterial({ map: graniteTexture() }), band = new THREE.MeshLambertMaterial({ map: triangleBandTexture() });
  const base = LVS + PAD_TOP, pf = -17.2, pb = -23.8;                         // 前排、後排柱子的 pe
  const groups = [{ pns: [-37.6, -31.6], top: 4.1 }, { pns: [-19.6, -13.0], top: 4.5 }];
  const tops = [];
  for (const gr of groups) {
    const cpn = (gr.pns[0] + gr.pns[1]) / 2, cpe = (pf + pb) / 2;
    for (const pn of gr.pns) for (const pe of [pf, pb]) {
      CF.raw(G.box, '#d6c7a3', pe, base + 0.33, -pn, 0, 0.95, 0.66, 0.95);          // 米色方石座
      const tpe = pe + (cpe - pe) * 0.1, tpn = pn + (cpn - pn) * 0.12;            // 柱頂往中間傾
      const from = new THREE.Vector3(pe, base + 0.66, -pn), to = new THREE.Vector3(tpe, base + gr.top, -tpn);
      const L = from.distanceTo(to), col = new THREE.Group();
      col.position.copy(from).add(to).multiplyScalar(0.5);
      col.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, L, 18), gran); cyl.castShadow = true; col.add(cyl);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.455, 0.47, 0.55, 22, 1, true), band); b.position.y = -L / 2 + 1.15; col.add(b);
      campusGroup.add(col); tops.push([tpe, tpn, gr.top]);
      block(CF, pe, -pn, 1.0, 1.0, 0, 0.15);
    }
    // 柱頂的磨石大樑
    const [a0, a1] = gr.pns.map(p => p + (cpn - p) * 0.12);
    for (const pe of [pf, pb]) { const e = pe + (cpe - pe) * 0.1; const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, Math.abs(a1 - a0) + 1.6), gran); m.position.set(e, base + gr.top + 0.27, -(a0 + a1) / 2); m.castShadow = true; campusGroup.add(m); }
    for (const p of [a0, a1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(pf - pb) * 0.8 + 1.4, 0.5, 0.6), gran); m.position.set(cpe, base + gr.top + 0.25, -p); campusGroup.add(m); }
  }
  // 中間的長樑：撐起最高的那片屋頂
  for (const pe of [pf + 0.66, pb - 0.66]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 18.6), gran); m.position.set(pe, base + 4.85, 25.3); m.castShadow = true; campusGroup.add(m); }
  // 三片平板屋頂（南片最低、中片最高、北片居中）
  const slabRoof = (pn0, pn1, y) => {
    CF.raw(G.box, '#a4a6a2', -20.5, base + y + 0.2, -(pn0 + pn1) / 2, 0, 10.4, 0.4, pn1 - pn0);
    CF.raw(G.box, '#e3e3df', -20.5, base + y - 0.02, -(pn0 + pn1) / 2, 0, 10.2, 0.05, pn1 - pn0 - 0.2);
    CF.raw(G.box, '#7d7f7b', -20.5, base + y + 0.42, -(pn0 + pn1) / 2, 0, 10.5, 0.04, pn1 - pn0 + 0.1);
  };
  slabRoof(-40.2, -28.6, 4.75);
  slabRoof(-31.5, -16.6, 5.15);
  slabRoof(-21.5, -10.6, 5.05);
}
function buildHills() {
  // 土丘地表：草地夾雜碎石與落葉，越高、越陡的地方越多裸露的碎石土
  const pe0 = -9, pe1 = 41.8, pn0 = -98.8, pn1 = -22, st = 0.8;
  const nx = Math.round((pe1 - pe0) / st) + 1, nz = Math.round((pn1 - pn0) / st) + 1;
  const pos = [], col = [], idx = [], c = new THREE.Color(), grass = new THREE.Color('#86b957'), dry = new THREE.Color('#9e9a6c'), gravel = new THREE.Color('#8f8676');
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const pe = pe0 + i * st, pn = pn0 + j * st, h = hillBump(pe, pn);
    pos.push(pe, LV1 + PAD_TOP + h + 0.012, -pn);
    const sl = Math.hypot(hillBump(pe + 0.5, pn) - hillBump(pe - 0.5, pn), hillBump(pe, pn + 0.5) - hillBump(pe, pn - 0.5));
    const n = hash2(Math.floor(pe * 1.7), Math.floor(pn * 1.7));
    c.copy(grass).lerp(dry, clamp(h * 0.35 + n * 0.3, 0, 0.85)).lerp(gravel, clamp(sl * 1.4 + (h > 1.9 ? 0.35 : 0) - 0.1 + n * 0.25, 0, 0.85));
    col.push(c.r, c.g, c.b);
    if (i && j) { const a = j * nx + i, b = a - 1, d = a - nx, e = d - 1; idx.push(e, d, b, d, a, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g.toNonIndexed(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); m.geometry.computeVertexNormals(); m.receiveShadow = true; m.castShadow = true; campusGroup.add(m);
  // 草丘上的仙丹花叢、高台邊的大石頭、竹架與紅色旗繩
  const rnd = mulberry32(31), at = (pe, pn) => LV(pe, pn) + PAD_TOP;
  for (const [pe, pn] of [[16, -55], [21, -58], [6, -64], [29, -70], [11, -80], [24, -84]]) {
    CF.raw(G.ico, '#3d7a34', pe, at(pe, pn) + 0.55, -pn, rnd() * 3, 0.7, 0.75, 0.7);
    for (let k = 0; k < 7; k++) CF.raw(G.sph, '#d7262b', pe + (rnd() - 0.5) * 1.1, at(pe, pn) + 0.4 + rnd() * 0.8, -pn + (rnd() - 0.5) * 1.1, 0, 0.14, 0.14, 0.14);
  }
  const mo = LAYOUT.campus?.maple || [0, 0], mpe = 8 + mo[0], mpn = -32.4 + mo[1];
  for (let k = 0; k < 9; k++) { const a = -0.4 + k * 0.32, pe = mpe + Math.cos(a) * 9.5 - 3, pn = mpn + Math.sin(a) * 9.5 + 2; const s = 0.4 + rnd() * 0.45; CF.raw(G.ico, ['#7d7f78', '#8f9089', '#6c6e68'][k % 3], pe, at(pe, pn) + s * 0.4, -pn, rnd() * 3, s * 1.3, s * 0.8, s); }
  CF.raw(G.box, '#7f7a70', mpe - 3.5, at(mpe - 3.5, mpn - 2) + 0.35, -(mpn - 2), 0.3, 2.6, 0.18, 1.1);           // 石板長椅
  CF.raw(G.box, '#6f6a60', mpe - 3.5, at(mpe - 3.5, mpn - 2) + 0.13, -(mpn - 2), 0.3, 0.4, 0.26, 0.4);
  // 竹架（傳統器具練習用）
  const bp = mpe - 6, bn = mpn - 9;
  for (const [dp, dn] of [[0, 0], [2.2, 0], [0, 1.6], [2.2, 1.6]]) CF.raw(G.cyl, '#c9b27a', bp + dp, at(bp + dp, bn + dn) + 1.15, -(bn + dn), 0, 0.045, 2.3, 0.045);
  for (const dn of [0, 1.6]) CF.raw(G.cyl, '#c9b27a', bp + 1.1, at(bp, bn) + 2.25, -(bn + dn), 0, 0.04, 2.3, 0.04, 0, Math.PI / 2);
  // 紅色三角旗繩
  const tape = [[mpe + 3, mpn - 8], [mpe + 9, mpn - 12], [mpe + 15, mpn - 13], [mpe + 21, mpn - 11]];
  tape.forEach(([pe, pn], k) => {
    CF.raw(G.cyl, '#c9b27a', pe, at(pe, pn) + 0.6, -pn, 0, 0.03, 1.2, 0.03);
    if (k) { const [qe, qn] = tape[k - 1]; for (let f = 0.1; f < 1; f += 0.15) { const e = qe + (pe - qe) * f, n = qn + (pn - qn) * f; CF.raw(G.cone, '#e8432f', e, at(e, n) + 1.0, -n, 0, 0.09, 0.22, 0.02, Math.PI, 0); } }
  });
}
function buildTerraces() {
  const C = CAMPUS, STONE = '#b9b09f', CAPC = '#cfc8b9', GRASS = '#8cc263', STEP = '#cbc5b8';
  const box = (pe0, pe1, pn0, pn1, y0, y1, color) => { const r = rectXZ(pe0, pe1, pn0, pn1); CF.raw(G.box, color, r.x, (y0 + y1) / 2, r.z, 0, r.w, y1 - y0, r.d); };
  // 各層：石砌擋土牆量體＋草皮
  const tiers = [
    { top: LV1, rects: [[C.pe0, C.pe1, C.pn0, C.pn1]], grass: [[C.pe0 + 0.2, C.pe1 - 0.2, C.pn0 + 0.2, C.pn1 - 0.2]] },
    { top: LV2, rects: [[C.pe0, L12, 2, C.pn1], [-62.5, L12, -52, 2], [-52.5, L12, C.pn0, -52]],
      grass: [[C.pe0 + 0.2, L12 - 0.25, 2, C.pn1 - 0.2], [-62.5, L12 - 0.25, -52, 2], [-52.5, L12 - 0.25, C.pn0 + 0.2, -52]] },
    { top: LV3, rects: [[C.pe0, -62.5, -52, 2], [C.pe0, -52.5, C.pn0, -52]],
      grass: [[C.pe0 + 0.2, -62.75, -52, 1.75], [C.pe0 + 0.2, -52.75, C.pn0 + 0.2, -52]] },
  ];
  for (const t of tiers) {
    for (const r of t.rects) box(...r, -3, t.top - 0.03, STONE);
    for (const r of t.rects) box(r[0] - 0.02, r[1] + 0.02, r[2] - 0.02, r[3] + 0.02, t.top - 0.03, t.top + PAD_TOP - 0.005, CAPC);
    for (const g of t.grass) box(...g, t.top + PAD_TOP - 0.01, t.top + PAD_TOP, GRASS);
  }
  // 司令台平台（比第二層再高 45 cm），面向跑道的是一整面石砌擋土牆，牆上有布農族曆板圖紋
  box(STAGE.pe0, STAGE.pe1, STAGE.pn0, STAGE.pn1, -3, LVS - 0.03, STONE);
  box(STAGE.pe0, STAGE.pe1 + 0.15, STAGE.pn0 - 0.15, STAGE.pn1, LVS - 0.03, LVS + PAD_TOP, '#c7c3b8');
  {
    const len = STAGE.pn1 - STAGE.pn0 + 0.15, h = LVS + PAD_TOP - LV1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshLambertMaterial({ map: calendarWallTexture(len, h) }));
    m.position.set(STAGE.pe1 + 0.16, LV1 + h / 2, -(STAGE.pn0 + STAGE.pn1) / 2 + 0.075); m.rotation.y = Math.PI / 2; m.receiveShadow = true; campusGroup.add(m);
  }
  // 西棟教室大樓的墊高台基
  box(WW.pe0, WW.pe1, WW.pn0, WW.pn1, -3, LVW - 0.03, STONE);
  box(WW.pe0 - 0.02, WW.pe1 + 0.02, WW.pn0 - 0.02, WW.pn1, LVW - 0.03, LVW + PAD_TOP, '#d4cebf');
  // 擋土牆面的石縫線
  const seam = (pe0, pe1, pn0, pn1, y) => box(pe0, pe1, pn0, pn1, y - 0.02, y + 0.02, '#9d9483');
  seam(L12, L12 + 0.03, C.pn0, C.pn1, LV2 / 2);
  for (const y of [LV2 + 0.35, LV2 + 0.7]) { seam(-62.53, -62.5, -52, 2, y); seam(-52.53, -52.5, C.pn0, -52, y); seam(C.pe0, -62.5, 2, 2.03, y); seam(-62.5, -52.5, -52.03, -52, y); }
  // 階梯
  for (const st of STAIRS) {
    if (st.bleacher) { buildBleacher(st, box); continue; }
    for (let k = 0; k < st.n; k++) {
      const h = st.hi - (st.hi - st.lo) * (k + 1) / (st.n + 1) - st.lo;
      if (st.axis === 'pe') {
        const w = (st.pe1 - st.pe0) / st.n, dir = st.hiAt === st.pe0 ? 1 : -1, a = dir > 0 ? st.pe0 + w * k : st.pe1 - w * (k + 1);
        box(a, a + w, st.pn0, st.pn1, st.lo, st.lo + PAD_TOP + h, STEP);
      } else {
        const w = (st.pn1 - st.pn0) / st.n, dir = st.hiAt === st.pn0 ? 1 : -1, a = dir > 0 ? st.pn0 + w * k : st.pn1 - w * (k + 1);
        box(st.pe0, st.pe1, a, a + w, st.lo, st.lo + PAD_TOP + h, STEP);
      }
    }
  }
  // 第三層邊緣的欄杆（階梯處留開口）
  const rail = (pe0, pe1, pn0, pn1, gaps) => {
    const len = Math.hypot(pe1 - pe0, pn1 - pn0), n = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k <= n; k++) {
      const pe = pe0 + (pe1 - pe0) * k / n, pn = pn0 + (pn1 - pn0) * k / n;
      if (gaps.some(([a, b]) => (pe0 === pe1 ? pn : pe) > a && (pe0 === pe1 ? pn : pe) < b)) continue;
      const [x, z] = [pe, -pn]; CF.raw(G.cyl, '#8a8f94', x, LV3 + 0.55, z, 0, 0.05, 1.1, 0.05);
    }
  };
  rail(-62.4, -62.4, -51.9, 1.9, [[-45.5, -40.5]]);
  rail(-95.8, -62.4, 1.9, 1.9, [[-76.5, -71.5]]);
  rail(-62.4, -52.4, -51.9, -51.9, []);
  rail(-52.4, -52.4, C.pn0 + 0.3, -51.9, [[-72.5, -67.5], [-91.5, -53]]);
}

function schoolWing({ along, x0, x1, ext, wallLine, corOut, rooms, stairs, chuan = null, arrays }) {
  // along='x'：北棟（沿圖面東西）；along='z'：西棟（沿圖面南北）
  // ext＝教室外牆線、wallLine＝教室與走廊交界、corOut＝走廊外緣
  const F1 = 3.6, H2 = 7.3, WALL = '#eeebe4', BAND = '#d8d3c8', TILE = '#c4532f', TILE2 = '#a9442a';
  const R = (a0, a1, b0, b1) => along === 'x' ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
  const S = (a0, a1, b0, b1, y, h, c) => slab(...R(a0, a1, b0, b1), y, h, c);
  const L = (a, b) => along === 'x' ? [a, -b] : [b, -a];          // 圖面 (沿, 橫) → 局部 x,z
  const out = Math.sign(ext - wallLine);                            // 教室外牆朝外方向
  const cs = Math.sign(corOut - wallLine);                          // 走廊朝外方向
  const lo = Math.min(ext, corOut), hi = Math.max(ext, corOut);
  const segs1F = chuan ? [[x0, chuan[0]], [chuan[1], x1]] : [[x0, x1]];

  // 基座、走廊地坪
  S(x0, x1, lo, hi, 0, 0.32, '#b8b2a6');
  // 教室量體：1F（川堂留空）＋ 2F
  for (const [a, b] of segs1F) { S(a, b, wallLine, ext, 0.32, F1 - 0.32, WALL); block(CF, ...L((a + b) / 2, (wallLine + ext) / 2), along === 'x' ? b - a : Math.abs(ext - wallLine), along === 'x' ? Math.abs(ext - wallLine) : b - a, 0, 0.3); }
  S(x0, x1, wallLine, ext, F1, H2 - F1, WALL);
  if (chuan) { S(chuan[0], chuan[1], wallLine, ext, F1 - 0.3, 0.3, '#e2ddd3'); S(chuan[0], chuan[1], wallLine - cs * 0.01, ext, 0.33, 0.02, '#c9b79c'); }
  // 樓層腰帶
  S(x0 - 0.05, x1 + 0.05, ext - out * 0.0, ext + out * 0.12, F1 - 0.15, 0.3, BAND);
  // 走廊：天花板、2F 欄杆
  S(x0, x1, wallLine, corOut, F1 - 0.25, 0.25, '#e4dfd5');
  S(x0, x1, wallLine, corOut, H2 - 0.3, 0.3, '#e4dfd5');
  // 走廊為懸臂結構，外緣沒有柱子；樓板邊加一道收邊
  S(x0, x1, corOut - cs * 0.12, corOut, F1 - 0.45, 0.45, '#e8e4dc');
  S(x0, x1, corOut - cs * 0.12, corOut, H2 - 0.5, 0.5, '#e8e4dc');
  S(x0, x1, corOut - cs * 0.22, corOut, F1, 1.05, '#f7f6f2');
  S(x0, x1, corOut - cs * 0.3, corOut + cs * 0.04, F1 + 1.05, 0.1, '#9aa0a6');
  // 女兒牆與紅色斜瓦簷（四周）
  S(x0 - 0.1, x1 + 0.1, lo - 0.1, hi + 0.1, H2, 0.55, WALL);
  S(x0, x1, lo + 0.25, hi - 0.25, H2 + 0.2, 0.08, '#4aa384');
  const eave = (side, faceB) => {                                   // 沿長邊
    const [lx, lz] = L((x0 + x1) / 2, faceB + side * 0.55);
    const len = x1 - x0 + 2.2;
    if (along === 'x') CF.put(G.box, TILE, lx, H2 + 0.55, lz, 0, len, 0.14, 1.35, -side * 0.5, 0);
    else CF.put(G.box, TILE, lx, H2 + 0.55, lz, 0, 1.35, 0.14, len, 0, -side * 0.5);
  };
  const eaveEnd = (a, sideA) => {                                   // 兩端山牆
    const [lx, lz] = L(a + sideA * 0.55, (lo + hi) / 2);
    const len = hi - lo + 2.2;
    if (along === 'x') CF.put(G.box, TILE, lx, H2 + 0.55, lz, 0, 1.35, 0.14, len, 0, -sideA * 0.5);
    else CF.put(G.box, TILE, lx, H2 + 0.55, lz, 0, len, 0.14, 1.35, -sideA * 0.5, 0);
  };
  eave(Math.sign(hi - (lo + hi) / 2), hi); eave(-1, lo); eaveEnd(x0, -1); eaveEnd(x1, 1);
  S(x0 - 1.0, x1 + 1.0, lo - 1.0, lo - 0.85, H2 + 0.26, 0.1, TILE2); S(x0 - 1.0, x1 + 1.0, hi + 0.85, hi + 1.0, H2 + 0.26, 0.1, TILE2);

  // 外牆窗戶（每間教室一扇一扇）與冷氣機
  const bays = Math.max(2, Math.round((x1 - x0) / 3.6));
  const bw = (x1 - x0) / bays;
  for (let k = 0; k < bays; k++) {
    const a = x0 + bw * (k + 0.5);
    for (const fy of [0.32, F1]) {
      if (fy < 1 && chuan && a > chuan[0] - 0.8 && a < chuan[1] + 0.8) continue;
      S(a - 1.25, a + 1.25, ext, ext + out * 0.06, fy + 0.95, 1.6, '#ffffff');
      S(a - 1.12, a + 1.12, ext, ext + out * 0.09, fy + 1.05, 1.4, '#45607a');
      S(a - 0.04, a + 0.04, ext, ext + out * 0.1, fy + 1.05, 1.4, '#ffffff');
      if (k % 2 === 0) S(a + 0.6, a + 1.4, ext, ext + out * 0.45, fy + 0.25, 0.55, '#d9dadb');
    }
  }
  // 走廊側：門、窗、名牌
  for (const rm of rooms) {
    const fy = rm.floor === 2 ? F1 : 0.32, w = rm.a1 - rm.a0;
    if (rm.open) continue;
    const door = rm.a0 + Math.min(1.2, w * 0.25);
    S(door - 0.5, door + 0.5, wallLine, wallLine + cs * 0.06, fy, 2.15, '#7a5236');
    for (let a = door + 1.6; a < rm.a1 - 1.0; a += 2.4) S(a - 0.85, a + 0.85, wallLine, wallLine + cs * 0.06, fy + 1.0, 1.25, '#4c6780');
    if (!rm.name) continue;
    const pw = Math.min(3.0, Math.max(1.8, w * 0.6)), mid = (rm.a0 + rm.a1) / 2;
    if (along === 'x') plate(rm.name, mid, fy + 2.6, wallLine + cs * 0.1, cs > 0 ? Math.PI : 0, pw, 0.56);
    else plate(rm.name, wallLine + cs * 0.1, fy + 2.6, mid, cs > 0 ? Math.PI / 2 : -Math.PI / 2, pw, 0.56);
  }
  if (chuan) { const mid = (chuan[0] + chuan[1]) / 2; if (along === 'x') plate('川堂', mid, F1 - 0.75, corOut + cs * 0.02, cs > 0 ? Math.PI : 0, 2.0, 0.55, { bg: '#2f6f8f', fg: '#ffffff', border: '#f2c230' }); }

  // 太陽能板（架高、整齊排列）
  for (const ar of arrays) {
    const { a0, a1, b0, b1 } = ar, tilt = 0;
    const [cx, cz] = L((a0 + a1) / 2, (b0 + b1) / 2);
    const lenA = a1 - a0, lenB = b1 - b0;
    const sx = along === 'x' ? lenA : lenB, sz = along === 'x' ? lenB : lenA;
    CF.put(G.box, '#223860', cx, H2 + 1.35, cz, 0, sx, 0.1, sz, along === 'x' ? tilt : 0, along === 'z' ? -tilt : 0);
    for (let a = a0 + 1.05; a < a1 - 0.2; a += 1.05) { const [px, pz] = L(a, (b0 + b1) / 2); CF.put(G.box, '#7c93b5', px, H2 + 1.41, pz, 0, along === 'x' ? 0.05 : lenB, 0.02, along === 'x' ? lenB : 0.05, along === 'x' ? tilt : 0, along === 'z' ? -tilt : 0); }
    for (let b = b0 + 1.7; b < b1 - 0.3; b += 1.7) { const [px, pz] = L((a0 + a1) / 2, b); CF.put(G.box, '#7c93b5', px, H2 + 1.35 + (along === 'x' ? -(b - (b0 + b1) / 2) * Math.sin(tilt) : (b - (b0 + b1) / 2) * Math.sin(tilt)) * 0 + 0.06, pz, 0, along === 'x' ? lenA : 0.05, 0.02, along === 'x' ? 0.05 : lenA, along === 'x' ? tilt : 0, along === 'z' ? -tilt : 0); }
    for (let a = a0 + 0.3; a <= a1; a += 3) for (const b of [b0 + 0.3, b1 - 0.3]) { const [px, pz] = L(a, b); CF.put(G.box, '#8d959e', px, H2 + 0.75, pz, 0, 0.12, 1.1, 0.12); }
  }
  // 樓梯間與水塔
  for (const [s0, s1] of stairs) {
    S(s0, s1, lo + 0.6, hi - 0.6, H2 + 0.2, 2.6, '#f1efea');
    S(s0 - 0.15, s1 + 0.15, lo + 0.45, hi - 0.45, H2 + 2.8, 0.2, TILE);
    const [tx, tz] = L((s0 + s1) / 2, (lo + hi) / 2);
    CF.cyl(tx - 0.8, H2 + 3.0, tz, 0.6, 1.3, '#c8cdd2'); CF.cyl(tx + 0.8, H2 + 3.0, tz, 0.6, 1.3, '#c8cdd2');
  }
}

function muralTexture() {
  const c = document.createElement('canvas'); c.width = 768; c.height = 512;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, '#8fd0ef'); sky.addColorStop(1, '#e8f6fb');
  g.fillStyle = sky; g.fillRect(0, 0, 768, 512);
  g.fillStyle = '#f6c945'; g.beginPath(); g.arc(640, 90, 48, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5c9e5a'; g.beginPath(); g.moveTo(0, 330); g.lineTo(150, 210); g.lineTo(290, 300); g.lineTo(430, 190); g.lineTo(600, 290); g.lineTo(768, 230); g.lineTo(768, 512); g.lineTo(0, 512); g.fill();
  g.fillStyle = '#8cc56a'; g.fillRect(0, 400, 768, 112);
  const kid = (x, shirt, hair, skirt) => {
    g.fillStyle = '#2b2f3a'; g.fillRect(x - 26, 360, 20, 90); g.fillRect(x + 6, 360, 20, 90);
    g.fillStyle = shirt; g.beginPath(); g.moveTo(x - 50, 250); g.lineTo(x + 50, 250); g.lineTo(skirt ? x + 62 : x + 44, 375); g.lineTo(skirt ? x - 62 : x - 44, 375); g.closePath(); g.fill();
    g.fillStyle = '#f4f0e6'; g.fillRect(x - 50, 300, 100, 14); g.fillStyle = '#b8322a'; g.fillRect(x - 50, 314, 100, 10); g.fillStyle = '#f2c230'; g.fillRect(x - 50, 324, 100, 6);
    g.fillStyle = '#c98c62'; g.beginPath(); g.arc(x, 205, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = hair; g.beginPath(); g.arc(x, 196, 48, Math.PI, 0); g.fill();
    g.fillStyle = '#1e1e1e'; g.beginPath(); g.arc(x - 15, 210, 5, 0, Math.PI * 2); g.arc(x + 15, 210, 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#7a3a2a'; g.lineWidth = 4; g.beginPath(); g.arc(x, 222, 14, 0.2, Math.PI - 0.2); g.stroke();
  };
  kid(280, '#2f6fb2', '#1d1a18', false); kid(470, '#3a84c4', '#2a1d16', true);
  g.fillStyle = '#ffffff'; g.fillRect(345, 290, 60, 44); g.strokeStyle = '#2f6fb2'; g.lineWidth = 3; g.strokeRect(345, 290, 60, 44); g.beginPath(); g.moveTo(375, 290); g.lineTo(375, 334); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function buildCampus() {
  // 校地鋪面
  buildTerraces();
  buildHills();
  slab(-62.4, L12 - 0.3, -46, 18, 0.03, 0.06, '#d4cebf');     // 建築周邊鋪面
  slab(-63, -19.5, 18, 40.5, 0.03, 0.08, '#b9b5ab');          // 停車場
  slab(-62.7, -57.4, 40, 63, 0.03, 0.09, '#9b988f');          // 校門道路
  slab(-47.6, -24.4, -27.8, 0.2, 0.06, 0.08, '#79bf5a');      // 中庭草地

  // 北棟：走廊在南側（面向中庭），1F 川堂可穿越到停車場
  const fx = u => -61.2 + (u - 150) / 308 * 40.7;
  schoolWing({
    along: 'x', x0: -61.2, x1: -20.5, ext: 15.6, wallLine: 4.9, corOut: 0.9,
    chuan: [fx(238), fx(282)],
    stairs: [[fx(212), fx(238)]],
    arrays: [{ a0: -60.2, a1: -21.5, b0: 2.2, b1: 8.4 }, { a0: -60.2, a1: -21.5, b0: 9.0, b1: 14.8 }],
    rooms: [
      { name: '電腦教室', a0: fx(150), a1: fx(212), floor: 2 }, { name: '潛能教室', a0: fx(238), a1: fx(300), floor: 2 },
      { name: '', a0: fx(300), a1: fx(340), floor: 2 }, { name: '原住民族資源教室', a0: fx(340), a1: fx(458), floor: 2 },
      { name: '辦公室', a0: fx(150), a1: fx(212), floor: 1 }, { name: '川堂', a0: fx(238), a1: fx(282), floor: 1, open: true },
      { name: '幼兒園', a0: fx(282), a1: fx(344), floor: 1 }, { name: '校長室', a0: fx(344), a1: fx(394), floor: 1 },
      { name: '保健室', a0: fx(394), a1: fx(458), floor: 1 },
    ],
  });
  // 西棟：走廊在東側（面向中庭）
  const gz = v => 0.9 - (v - 374) / 224 * 32.2;
  schoolWing({
    along: 'z', x0: gz(598), x1: gz(374), ext: -61.2, wallLine: -52.3, corOut: -48.3,
    stairs: [[gz(398), gz(374)], [gz(576), gz(554)]],
    arrays: [{ a0: -29.8, a1: -23.4, b0: -60.2, b1: -49.6 }, { a0: -17.8, a1: -11.4, b0: -60.2, b1: -49.6 }, { a0: -6.4, a1: 0.0, b0: -60.2, b1: -49.6 }],
    rooms: [
      { name: '三年級', a0: gz(450), a1: gz(398), floor: 1 }, { name: '二年級', a0: gz(502), a1: gz(450), floor: 1 }, { name: '一年級', a0: gz(554), a1: gz(502), floor: 1 },
      { name: '四年級', a0: gz(450), a1: gz(398), floor: 2 }, { name: '五年級', a0: gz(502), a1: gz(450), floor: 2 }, { name: '六年級', a0: gz(554), a1: gz(502), floor: 2 },
      { name: '廁所', a0: gz(598), a1: gz(576), floor: 1 }, { name: '廁所', a0: gz(598), a1: gz(576), floor: 2 },
    ],
  });
  // 北棟東側山牆：兩幅馬賽克壁畫（左：手拿小米的族人；右：兩位婦女搗小米），中間是二樓的白磁磚陽台、一樓是入口
  for (const [kind, p0, p1] of [['A', 4.9, 8.6], ['B', 10.7, 15.6]]) {
    const w = p1 - p0, m = new THREE.Mesh(new THREE.PlaneGeometry(w, 6.6), new THREE.MeshLambertMaterial({ map: mosaicMural(kind) }));
    m.position.set(-20.5 + 0.04, LV2 + 0.32 + 3.4, -(p0 + p1) / 2); m.rotation.y = Math.PI / 2; m.receiveShadow = true; campusGroup.add(m);
  }
  slab(-20.5, -19.5, 8.6, 10.7, 3.5, 1.9, '#f1f0eb');                // 二樓陽台
  slab(-19.52, -19.47, 8.85, 10.45, 4.35, 0.9, '#3a3f45');
  slab(-19.6, -19.45, 8.6, 10.7, 4.1, 0.08, '#3b3b3b');
  slab(-20.54, -20.46, 9.1, 10.2, 0.3, 2.3, '#3c3a36');              // 一樓入口

  // 操場：跑道（含西側直線跑道）
  const tcx = 0.3, tcz = 3.2, TW = 28.2, TL = 50.6;
  flatShape(stadium(tcx, tcz, TW, TL, 0), [stadium(tcx, tcz, TW, TL, 4.2)], 0.06, '#c8553d');
  flatShape(stadium(tcx, tcz, TW, TL, 4.2), null, 0.07, '#86c95a');
  for (const ins of [1.05, 2.1, 3.15]) flatShape(stadium(tcx, tcz, TW, TL, ins - 0.06), [stadium(tcx, tcz, TW, TL, ins + 0.06)], 0.075, '#f4efe6');
  slab(-14.2, -9.9, -46.2, 28.5, 0.05, 0.05, '#c8553d');
  for (const a of [-13.15, -12.1, -11.05]) slab(a - 0.06, a + 0.06, -46.2, 28.5, 0.1, 0.02, '#f4efe6');
  slab(-14.2, -9.9, -46.1, -45.9, 0.1, 0.02, '#f4efe6');
  campusLM('跑道', 0.3, 3.2, '環繞操場的紅色跑道，西側有一段長長的直線跑道，可以練習短跑。操場在校地最低的第一層，西邊的看台階梯往上就是第二層。', { labelH: 3 });

  // 中庭、司令台、升旗台
  campusLM('中庭', -36, -13.8, '被北棟與西棟教室圍起來的草地中庭。中庭、教室、生態池和圖書室都在校地的第二層，比操場高約 80 公分。', { labelH: 2.5 });
  buildStage();
  campusLM('司令台', -20.7, -25.2, '面向操場的司令台：三片高低錯落的平板屋頂，由斜斜的磨石圓柱撐起，柱身有黑白三角紋。平台前緣是一整面石牆，牆上畫著布農族曆板般的圖紋，要從北端的階梯上台。', { labelH: 6 });
  campusItem('flag', () => {
  // 升旗台：一列三根不鏽鋼旗桿（中間最高）立在長條水泥台上，兩側各有一棵修剪過的大樹
  CF.box(-17.8, 0, 4.8, 1.3, 0.35, 3.6, '#c9c6bd');
  for (const [dz, h] of [[-1.25, 8.6], [0, 10.2], [1.25, 8.6]]) { CF.cyl(-17.8, 0.35, 4.8 + dz, 0.06, h, '#d6dade'); CF.put(G.sph, '#e7eaed', -17.8, 0.35 + h + 0.08, 4.8 + dz, 0, 0.1, 0.1, 0.1); }
  bigPrunedTree(-17.9, -4.8 - 4.1, 41, 0.08);
  bigPrunedTree(-17.9, -4.8 + 4.1, 57, -0.06);
  campusLM('升旗台', -17.8, -4.8, '看台正上方的升旗台：一列三根旗桿，中間那根最高。兩旁各有一棵修剪過的大樹，背後就是中庭和教室。', { labelH: 11 });
  });

  // 生態池與雕塑、水道、涼亭
  const pond = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  CF.put(new THREE.TorusGeometry(1, 0.08, 6, 28).rotateX(Math.PI / 2), '#a7a196', -34.5, 0.25, 39.3, 0, 8.2, 3, 6.7);
  CF.put(pond, '#3d93c4', -34.5, 0.12, 39.3, 0, 8, 1, 6.5);
  for (const [a, b, r] of [[-36.5, 38, 0.4], [-33, 40.5, -0.6], [-35, 41.5, 1.2]]) CF.put(G.box, '#8d8a83', a, 1.3, b, r, 2.6, 2.6, 0.5, 0.25, 0);
  campusLM('生態池', -34.5, -39.3, '中庭南邊的生態池，池中有彎曲的石牆雕塑，池水沿著水道流向操場。', { labelH: 4 });
  const ch = [[-34.5, -46.2], [-38, -57.7], [-35.7, -64.6], [-24.2, -67.5], [-15, -63.5], [-12.1, -53.1]].map(([pe, pn]) => [pe, -pn]);
  const chPts = densify(ch, 1.5);
  {
    const p = [], idx = [];
    chPts.forEach((pt, k) => {
      const a = chPts[Math.max(0, k - 1)], b = chPts[Math.min(chPts.length - 1, k + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const wy = 0.1 + LVwalk(pt[0], -pt[1]);
      p.push(pt[0] - tz * 1.3, wy, pt[1] + tx * 1.3, pt[0] + tz * 1.3, wy, pt[1] - tx * 1.3);
      if (k) { const i0 = (k - 1) * 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, waterMat); m.receiveShadow = true; campusGroup.add(m);
  }
  campusLM('水道', -37.5, -60, '從生態池流出的水道，繞過涼亭南邊，一路流到沙坑附近。', { labelH: 2.5, radius: 8 });
  campusItem('pavilion', () => {
  for (const [pe, pn] of [[-30.8, -57], [-26.8, -57], [-30.8, -61], [-26.8, -61]]) CF.cyl(pe, 0, -pn, 0.16, 2.6, '#8a6a48');
  CF.put(G.pyr, '#9c5a3c', -28.8, 3.4, 59, 0, 6, 1.6, 6);
  campusLM('涼亭', -28.8, -59, '水道環繞的小涼亭，可以坐下來休息、觀察生態池。', { labelH: 5 });
  });

  // 沙坑、大楓樹、石板屋與布農人偶
  slab(-14, -10.2, -51.8, -46.6, 0.04, 0.1, '#e8d39a');
  campusLM('沙坑', -12.1, -49.2, '直線跑道南端的沙坑，練習跳遠的地方。', { labelH: 2.5, radius: 7 });
  campusItem('maple', (ope, opn) => {
    const [x, z] = fromPlan(8 + ope, -32.4 + opn), my = PAD + PAD_TOP + LV(8 + ope, -32.4 + opn);
    for (const [dx, dz, s] of [[0, 0, 1.7], [-2.5, 1.5, 1.2], [2.2, -1.2, 1.25]]) addTree('maple', x + dx, z + dz, s, my);
    animalStatue(CF, 4.5, 34.5, 0.6, '#e07a43', 0.9); animalStatue(CF, 9.5, 31.5, -2.4, '#a9a23a', 1.35);
    campusLM('大楓樹', 8, -32.4, '操場南邊的大楓樹，長在一座比操場高約 2.4 公尺的土丘上，樹下有橘色的動物雕像和編織紋的鹿雕像，旁邊有石板長椅。再往南是一座座起伏的小山坡，種著仙丹花。', { labelH: 14 });
  });
  campusItem('stonehouse', () => {
    const sx = 17.3, sz = 34.7;
    CF.box(sx, 0, sz, 4.2, 1.9, 3.2, '#8a8c88'); for (let k = 0; k < 4; k++) CF.box(sx, 0.35 + k * 0.42, sz + 1.62, 4.25, 0.06, 0.04, '#6c6e6a');
    CF.put(G.gable, '#5c5f63', sx, 1.9, sz, Math.PI / 2, 3.8, 1.0, 4.8);
    bununFigure(CF, sx - 2.9, sz + 2.2, 0); bununFigure(CF, sx + 2.9, sz + 2.2, 0, true);
    campusLM('石板屋與布農人偶', 17.3, -34.7, '校園裡的小石板屋，前面站著兩位穿傳統服飾的布農人偶。', { labelH: 5, radius: 9 });
  });

  // 校門口：石板堆砌的校門意象（校徽＋校名牌）
  campusItem('gate', () => gateMonument(-57, 29));
  // 石碑
  campusItem('tabletA', () => {
  stoneTablet(CF, -55.2, -17.6, '#7a7e80');
  animalStatue(CF, -57.4, -16.2, 0.5, '#b49a74', 0.6); animalStatue(CF, -53, -16.2, -0.5, '#b49a74', 0.6);
  campusLM('石碑與兩隻小動物', -55.2, 17.6, '停車場旁的石碑，旁邊有兩隻小動物雕像。', { labelH: 4.5, radius: 8 });
  });
  campusItem('tabletB', () => {
  stoneTablet(CF, -23, -17.6, '#6f7375');
  boar(CF, -25.4, -16, 0.4); boar(CF, -20.6, -16, -0.4);
  campusLM('石碑與兩隻山豬', -23, 17.6, '停車場東側的石碑，有兩隻山豬守在旁邊。', { labelH: 4.5, radius: 8 });
  });

  // 停車場車棚、周邊建築
  campusItem('carport', () => {
  for (const pe of [-42, -32, -22.5]) for (const pn of [38, 43.6]) CF.cyl(pe, 0, -pn, 0.12, 2.9, '#c9ccc9');
  slab(-42.8, -21.7, 37.4, 44.4, 2.9, 0.18, '#9cc7a8');
  campusLM('車棚', -32, 41, '停車場北邊的車棚。', { labelH: 5, radius: 9 });
  });
  campusItem('wenjian', () => {
  simpleBuilding(CF, rectXZ(-78.8, -64.4, 22.8, 44.6), 3.6, '#f0ebe0', '#7aa3b8', '文健站', Math.PI / 2, 'east');
  campusLM('文健站', -71.6, 33.7, '校門西側的文化健康站。', { labelH: 6 });
  });
  campusItem('recycle', () => {
  simpleBuilding(CF, rectXZ(-77, -68.4, 6.7, 13.6), 2.8, '#e6e1d4', '#4f7fc0', '回收室', Math.PI / 2, 'east');
  campusLM('回收室', -72.7, 10.2, '做資源回收的小屋。', { labelH: 5, radius: 9 });
  });
  campusItem('dorm', () => {
  simpleBuilding(CF, rectXZ(-80.5, -67.8, -13.2, -4.4), 3.4, '#f2eee4', '#b9b3a6', '老師宿舍', Math.PI / 2, 'east');
  campusLM('老師宿舍', -74.2, -8.8, '西棟旁邊的老師宿舍。', { labelH: 5.5 });
  });
  campusItem('library', () => {
  simpleBuilding(CF, rectXZ(-29.2, -20.5, -87, -74.7), 4, '#f4f1ea', '#8a8f96', '圖書室', 0, 'north');
  campusLM('圖書室', -24.9, -80.9, '校園南側的圖書室，借書、看書的地方。', { labelH: 6.5 });
  });

  // 遊樂場
  campusItem('playground', () => {
  slab(-77, -63.3, -50.8, -37, 0.04, 0.06, '#d77a4a');
  CF.box(-73, 0, 41, 2, 2.4, 2, '#3d7fc4'); CF.put(G.box, '#e04b3b', -70.4, 1.3, 41, 0, 3.6, 0.15, 1.1, 0, -0.62);
  for (const pe of [-68.5, -65]) CF.cyl(pe, 0, 47.5, 0.1, 2.6, '#f2c230'); slab(-68.6, -64.9, -47.6, -47.4, 2.6, 0.12, '#f2c230');
  campusLM('遊樂場', -70, -44, '溜滑梯和盪鞦韆都在這裡。', { labelH: 4.5, radius: 9 });
  });

  // 球場
  slab(-87.4, -54, -91, -53.7, 0.04, 0.06, '#b5523f');
  slab(-85.8, -55.6, -89.4, -55.3, 0.06, 0.06, '#3f8a63');
  slab(-85.8, -55.6, -72.6, -72.1, 0.11, 0.02, '#f4efe6');
  for (const pn of [-57.3, -87.4]) { CF.cyl(-70.7, 0, -pn, 0.12, 3, '#d8dde2'); CF.box(-70.7, 3, -pn + (pn > -70 ? 0.4 : -0.4), 1.8, 1.1, 0.08, '#ffffff'); }
  for (const pe of [-87.4, -54]) for (let pn = -91; pn <= -53.7; pn += 4.66) CF.cyl(pe, 0, -pn, 0.06, 3.2, '#3c8a74');
  for (const pn of [-91, -53.7]) for (let pe = -87.4; pe <= -54; pe += 4.17) CF.cyl(pe, 0, -pn, 0.06, 3.2, '#3c8a74');
  campusLM('球場', -70.7, -72.3, '校園西南角的球場，可以打籃球、玩躲避球。球場、遊樂場和老師宿舍在校地最高的第三層，比第二層再高約 1 公尺。', { labelH: 5 });

  // 校園樹木：東側樹籬、南側山坡、池邊
  const rnd = mulberry32(3);
  for (let pn = -92; pn <= 46; pn += 4.6) { const [x, z] = fromPlan(27 + rnd() * 2.5, pn); addTree('broad', x, z, 0.62 + rnd() * 0.2, PAD + PAD_TOP); }
  for (let k = 0; k < 34; k++) { const pe = -12 + rnd() * 50, pn = -60 - rnd() * 36; if (pe > 22 && pn > -70) continue; const [x, z] = fromPlan(pe, pn); addTree('broad', x, z, 0.75 + rnd() * 0.4, PAD + PAD_TOP + LV(pe, pn)); }
  for (const [pe, pn] of [[-44, -36], [-41, -45], [-27, -33], [-46, -50], [-50, -40], [-48, 22], [-66, 15], [-84, -20], [-88, -30], [-60, -60], [-45, -84]]) { const [x, z] = fromPlan(pe, pn); addTree('broad', x, z, 0.7 + rnd() * 0.3, PAD + PAD_TOP + LV(pe, pn)); }

  // 校園整體標籤
  { const [x, z] = fromPlan(-30, 10); landmark({ name: '卓楓國小', area: '卓楓國小', x, z, y: PAD + LV2, kind: 'area', labelH: 24, radius: 0, desc: '' }); }
  campusLM('教學大樓', -40.8, 8.2, 'L 型兩層樓教學大樓：北棟有辦公室、幼兒園、校長室、保健室與專科教室，西棟是一到六年級教室。西棟蓋在比第二層再高約 80 公分的台基上，從中庭、北棟走廊或南端都要走幾階樓梯上去。屋頂鋪滿太陽能板。', { labelH: 11, radius: 14 });
}

function simpleBuilding(F, r, h, wall, roof, name, plateRot, face) {
  F.box(r.x, 0, r.z, r.w, h, r.d, wall); block(F, r.x, r.z, r.w, r.d);
  F.box(r.x, h, r.z, r.w + 0.5, 0.35, r.d + 0.5, roof);
  if (name) {
    const m = textPlate(name, Math.min(4, r.w * 0.6), 0.85);
    const off = face === 'east' ? [r.x + r.w / 2 + 0.06, r.z] : [r.x, r.z - r.d / 2 - 0.06];
    m.position.set(off[0], h - 0.9 + lvlLocal(r.x, r.z), off[1]); m.rotation.y = face === 'east' ? Math.PI / 2 : Math.PI;
    campusGroup.add(m);
  }
}
function slateTexture() {
  // 一片片疊起來的黑色板岩
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#16181b'; g.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(5);
  let y = 0;
  while (y < 256) {
    const h = Math.min(256 - y, 4 + rnd() * 7);
    let x = -rnd() * 50;
    while (x < 256) {
      const w = 18 + rnd() * 70, l = 24 + rnd() * 24, sat = 3 + rnd() * 7;
      g.fillStyle = `hsl(${200 + rnd() * 20}, ${sat}%, ${l}%)`;
      for (const o of [-256, 0, 256]) g.fillRect(x + o + 0.8, y + 0.8, w - 1.6, h - 1.4);
      if (rnd() < 0.3) { g.fillStyle = `hsla(0,0%,${55 + rnd() * 20}%,.25)`; for (const o of [-256, 0, 256]) g.fillRect(x + o + 3, y + 1, w * 0.4, 1); }
      x += w;
    }
    y += h;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function scaledBox(w, h, d, unit = 1.4) {
  // 讓每一面的石板紋路大小一致
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / unit, uv.getY(i) * dims[f][1] / unit); }
  return g;
}
function emblemTexture() {
  // 卓楓校徽：橘色楓葉、藍底、紅黑三角紋外圈
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), C = 256;
  g.fillStyle = '#f7f5ef'; g.beginPath(); g.arc(C, C, 252, 0, Math.PI * 2); g.fill();
  const N = 22;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2, da = Math.PI / N;
    const P = (r, t) => [C + Math.cos(t) * r, C + Math.sin(t) * r];
    g.fillStyle = '#d23a3a'; g.beginPath(); g.moveTo(...P(196, a - da * 0.9)); g.lineTo(...P(244, a)); g.lineTo(...P(196, a + da * 0.9)); g.fill();
    g.fillStyle = '#1d1d1f'; g.beginPath(); g.moveTo(...P(244, a + da * 0.15)); g.lineTo(...P(200, a + da)); g.lineTo(...P(244, a + da * 1.85)); g.fill();
  }
  g.fillStyle = '#1d1d1f'; g.beginPath(); g.arc(C, C, 196, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(C, C, 188, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2f73c6'; g.beginPath(); g.arc(C, C, 178, 0, Math.PI * 2); g.fill();
  const half = [[0, 1], [0.13, 0.66], [0.36, 0.82], [0.3, 0.42], [0.76, 0.62], [0.62, 0.3], [0.96, 0.2], [0.6, 0.0], [0.7, -0.2], [0.3, -0.1], [0.07, -0.3], [0.05, -0.32], [0.05, -0.88]];
  const leaf = [...half, ...half.slice().reverse().map(([x, y]) => [-x, y])];
  g.save(); g.translate(C, C + 6); g.rotate(-0.18); g.scale(150, -150);
  g.fillStyle = '#f0a03a'; g.beginPath(); leaf.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  g.strokeStyle = '#c87920'; g.lineWidth = 0.025; g.beginPath(); g.moveTo(0, -0.85); g.lineTo(0, 0.85); g.moveTo(0, 0.05); g.lineTo(0.6, 0.45); g.moveTo(0, 0.05); g.lineTo(-0.6, 0.45); g.moveTo(0, -0.1); g.lineTo(0.55, -0.05); g.moveTo(0, -0.1); g.lineTo(-0.55, -0.05); g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function schoolSignTexture() {
  // 黑底金字校名牌
  const c = document.createElement('canvas'); c.width = 1040; c.height = 500;
  const g = c.getContext('2d');
  g.fillStyle = '#141414'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#3a3a3a'; g.lineWidth = 14; g.strokeRect(7, 7, c.width - 14, c.height - 14);
  g.fillStyle = '#efd98f'; g.textBaseline = 'middle'; g.textAlign = 'center';
  const line = (txt, y, size) => {
    g.font = `700 ${size}px ${FONT}`;
    const chars = [...txt], span = c.width - 120, step = span / chars.length;
    chars.forEach((ch, k) => g.fillText(ch, 60 + step * (k + 0.5), y));
  };
  line('花蓮縣卓溪鄉', 115, 132); line('卓楓國民小學', 270, 132);
  g.font = `700 64px ${FONT}`; g.save(); g.translate(c.width / 2, 412); g.scale(0.86, 1);
  g.fillText('Hungungaz uvaz tu pasnanavan', 0, 0); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function roundRectShape(x0, x1, y0, y1, r) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
  s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2);
  s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
  return s;
}
function gateMonument(pe, pn) {
  // 依校門口照片：寬大石板底座、中段石台、高塔（校徽）、右側黑底金字校名牌；正面朝北迎接來訪的人
  const slate = new THREE.MeshLambertMaterial({ map: slateTexture() });
  const put = (w, h, d, ce, y0, cn) => {
    const m = new THREE.Mesh(scaledBox(w, h, d), slate);
    m.position.set(ce, LV2 + y0 + h / 2, -cn); m.castShadow = m.receiveShadow = true; campusGroup.add(m); return m;
  };
  // 草地安全島與路緣
  flatShape(roundRectShape(pe - 7.6, pe + 7.2, pn - 4.4, pn + 4.6, 2.6), null, 0.13, '#c9c5bb', LV2);
  flatShape(roundRectShape(pe - 7.3, pe + 6.9, pn - 4.1, pn + 4.3, 2.4), null, 0.15, '#7dbf55', LV2);
  // 底座（約 11 m 寬、0.9 m 高）與鋪面
  put(11, 0.9, 4.2, pe, 0.1, pn);
  slab(pe - 5.4, pe + 5.4, pn - 2.0, pn + 2.0, 1.0, 0.04, '#7b8086');
  for (let k = 0; k < 6; k++) slab(pe - 5.2 + k * 1.75, pe - 4.0 + k * 1.75, pn + 1.3, pn + 1.95, 1.04, 0.015, k % 2 ? '#80868e' : '#8a9099');
  // 中段石台（偏東）與高塔（約 6.5 m）
  put(4.2, 1.5, 2.5, pe + 2.6, 1.0, pn - 0.2);
  const tower = put(2.3, 5.6, 1.9, pe + 2.0, 1.0, pn - 0.3);
  // 校徽
  const em = new THREE.Mesh(new THREE.CircleGeometry(0.75, 48), new THREE.MeshBasicMaterial({ map: emblemTexture(), color: '#e6e6e6' }));
  em.position.set(pe + 2.0, LV2 + 5.35, -(pn - 0.3 + 0.97)); em.rotation.y = Math.PI; campusGroup.add(em);
  // 校名牌（中段石台西側，立在底座上）
  CF.box(pe - 1.35, 1.0, -(pn + 0.55), 3.0, 1.5, 0.3, '#151515');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.4), new THREE.MeshBasicMaterial({ map: schoolSignTexture(), color: '#dcdcdc' }));
  sign.position.set(pe - 1.35, LV2 + 1.75, -(pn + 0.71)); sign.rotation.y = Math.PI; campusGroup.add(sign);
  // 底座上的小草叢
  for (const [dx, dz] of [[1.6, 1.4], [3.4, 1.3], [-3.6, -1.2]]) CF.put(G.ico, '#6aa846', pe + dx, 1.15, -(pn + dz), 0, 0.35, 0.2, 0.35);
  block(CF, pe, -pn, 11, 4.2, 0, 0.35);
  campusLM('校門口石柱', pe, pn, '用一片片黑色板岩堆起來的校門意象。高塔上是橘色楓葉的卓楓校徽，外圈是紅黑三角紋；旁邊的黑底金字牌寫著「花蓮縣卓溪鄉卓楓國民小學」，下面一行是族語 Hungungaz uvaz tu pasnanavan。', { labelH: 8, radius: 10 });
}
function stoneTablet(F, pe, z, color) {
  F.box(pe, 0, z, 2.2, 0.45, 1.2, '#a49d90');
  F.put(G.box, color, pe, 1.55, z, 0.08, 1.7, 2.2, 0.38, -0.08, 0);
}
function animalStatue(F, x, z, ry, color, s = 1) {
  F.put(G.box, color, x, 0.75 * s, z, ry, 1.5 * s, 0.75 * s, 0.7 * s);
  const hx = Math.cos(-ry) * 0.85 * s, hz = Math.sin(-ry) * 0.85 * s;
  F.put(G.box, color, x + hx, 1.25 * s, z + hz, ry, 0.6 * s, 0.6 * s, 0.6 * s);
  for (const [lx, lz] of [[-0.5, -0.25], [-0.5, 0.25], [0.5, -0.25], [0.5, 0.25]]) {
    const c = Math.cos(-ry), sn = Math.sin(-ry);
    F.put(G.box, color, x + (lx * c - lz * sn) * s, 0.2 * s, z + (lx * sn + lz * c) * s, ry, 0.2 * s, 0.45 * s, 0.2 * s);
  }
  F.box(x, 0, z, 1.9 * s, 0.12, 1.1 * s, '#9d978a');
}
function boar(F, x, z, ry) {
  const C = '#4b3a2e';
  F.put(G.sph, C, x, 0.85, z, ry, 1.05, 0.62, 0.58);
  const c = Math.cos(-ry), s = Math.sin(-ry);
  F.put(G.cone, C, x + c * 1.15, 0.8, z + s * 1.15, ry, 0.42, 0.9, 0.42, 0, -Math.PI / 2);
  F.put(G.box, '#f3ead8', x + c * 1.25 - s * 0.22, 0.7, z + s * 1.25 + c * 0.22, ry, 0.35, 0.06, 0.06);
  F.put(G.box, '#f3ead8', x + c * 1.25 + s * 0.22, 0.7, z + s * 1.25 - c * 0.22, ry, 0.35, 0.06, 0.06);
  for (const [lx, lz] of [[-0.55, -0.28], [-0.55, 0.28], [0.5, -0.28], [0.5, 0.28]]) F.put(G.box, C, x + lx * c - lz * s, 0.22, z + lx * s + lz * c, ry, 0.18, 0.45, 0.18);
  F.box(x, 0, z, 2.6, 0.1, 1.2, '#9d978a');
}
function bununFigure(F, x, z, ry, female = false) {
  F.box(x, 0, z, 1, 0.3, 1, '#9d978a');
  F.put(G.cyl, '#2a2a2a', x, 0.85, z, ry, 0.28, 1.1, 0.28);
  F.put(G.cyl6, '#f4f0e6', x, 1.75, z, ry, 0.42, 1.0, 0.36);
  F.put(G.cyl6, female ? '#2e2e3a' : '#b8322a', x, 1.45, z, ry, 0.44, 0.22, 0.38);
  F.put(G.cyl6, '#f2c230', x, 1.95, z, ry, 0.43, 0.1, 0.37);
  F.put(G.sph, '#b9825a', x, 2.55, z, ry, 0.3, 0.32, 0.3);
  F.put(G.cyl, '#2a2a2a', x, 2.78, z, ry, 0.32, 0.14, 0.32);
}

/* ====================================================================
   部落：地標建物與房舍
   ==================================================================== */
const LM_POS0 = Object.fromEntries(D.landmarks.map(l => [l.name, l.p.slice()]));
const LM_POS = Object.fromEntries(D.landmarks.map(l => [l.name, (LAYOUT.lm?.[l.name] || l.p).slice(0, 2)]));
const LM_ROT = name => (LAYOUT.lm?.[name]?.[2]) || 0;
function lmFrame(name, ry = -RAD) { const [x, z] = LM_POS[name]; return new Frame(x, ground(x, z), z, ry + LM_ROT(name)); }
function signBoard(frame, text, x, y, z, ry, w, h, opt) {
  const m = textPlate(text, w, h, opt);
  m.position.copy(frame.world(x, y, z)); m.rotation.y = frame.ry + ry; scene.add(m);
}
function foundation(F, x, z, w, d, ry = 0) { F.box(x, -3, z, w + 0.3, 3, d + 0.3, '#b7ad9b', ry); }
function house(F, x, z, w, d, floors, roofColor, wall = '#f1ede3', roofType = 'gable', ry = 0) {
  const h = floors * 3.2;
  block(F, x, z, w, d, ry);
  foundation(F, x, z, w, d, ry);
  F.box(x, 0, z, w, h, d, wall, ry);
  if (roofType === 'gable') F.put(G.gable, roofColor, x, h, z, ry, w + 0.7, clamp(w * 0.2, 1.1, 2.6), d + 0.7);
  else { F.box(x, h, z, w + 0.2, 0.5, d + 0.2, roofColor, ry); }
  // 窗與門
  const c = Math.cos(-ry), s = Math.sin(-ry), fz = d / 2 + 0.03;
  for (let f = 0; f < floors; f++) F.put(G.box, '#3e566e', x - s * fz, f * 3.2 + 1.7, z + c * fz, ry, w * 0.55, 0.9, 0.05);
  F.put(G.box, '#6e4a2f', x - s * fz + c * w * 0.3, 1.05, z + c * fz + s * w * 0.3, ry, 0.95, 2.1, 0.06);
}

function buildVillages() {
  // 古楓部落
  {
    const F = lmFrame('石板屋');
    F.box(0, 0, 0, 8, 2.3, 6, '#8b8d89'); block(F, 0, 0, 8, 6);
    for (let k = 0; k < 5; k++) F.box(0, 0.3 + k * 0.42, 3.03, 8.05, 0.07, 0.05, '#6c6e6a');
    F.put(G.gable, '#575a5e', 0, 2.3, 0, Math.PI / 2, 7, 1.1, 9);
    F.box(-1.5, 0, 3.05, 1, 1.8, 0.06, '#4a3a2c');
    const [x, z] = LM_POS['石板屋'];
    landmark({ name: '石板屋', area: '古楓部落', x, z, desc: '古楓部落老街上的石板屋，牆面用一片片石板堆疊起來。', labelH: 7 });
  }
  {
    const F = lmFrame('古風教會');
    F.box(0, 0, 0, 10, 6, 17, '#f6f3ec'); block(F, 0, 0.9, 10, 18.8); F.put(G.gable, '#c8553d', 0, 6, 0, 0, 10.8, 3.4, 17.6);
    F.box(0, 0, 9.6, 3.6, 12, 3.6, '#f6f3ec'); F.put(G.pyr, '#c8553d', 0, 12, 9.6, 0, 4.4, 3, 4.4);
    F.box(0, 15, 9.6, 0.35, 3.2, 0.35, '#f2c230'); F.box(0, 16.6, 9.6, 1.8, 0.35, 0.35, '#f2c230');
    F.box(0, 0, 11.45, 1.6, 2.6, 0.06, '#6e4a2f');
    const [cx, cz] = LM_POS['教會球場'];
    const C = new Frame(cx, ground(cx, cz), cz, -RAD + LM_ROT('教會球場'));
    C.box(0, -0.4, 0, 20, 0.5, 13, '#e0814a'); C.box(0, 0.05, 0, 17, 0.06, 10, '#4a9a6a');
    C.cyl(-8, 0, 0, 0.1, 3, '#dfe3e6'); C.cyl(8, 0, 0, 0.1, 3, '#dfe3e6');
    const [x, z] = LM_POS['古風教會'];
    landmark({ name: '古風教會', area: '古楓部落', x, z, desc: '臺灣基督長老教會古風教會，旁邊有一座彩色球場。', labelH: 21 });
  }
  {
    const F = lmFrame('Masa雜貨店');
    house(F, 0, 0, 5.8, 9.2, 1, '#4f7fc0', '#f4efe2', 'flat', Math.PI / 2);   // 依空拍實際大小，店面朝東（面向馬路）
    F.put(G.box, '#e4572e', 5.0, 2.6, 0, 0, 1.2, 0.12, 5.6, 0, -0.35);
    signBoard(F, 'Masa 雜貨店', 4.7, 3.4, 0, Math.PI / 2, 4.6, 0.9, { bg: '#fff3c4', fg: '#7a2e12', border: '#e4572e' });
    const [x, z] = LM_POS['Masa雜貨店'];
    landmark({ name: 'Masa 雜貨店', area: '古楓部落', x, z, desc: '部落入口路口的雜貨店。', labelH: 7, radius: 9 });
  }
  {
    const F = lmFrame('Isu雜貨店');
    house(F, 0, 0, 7.2, 10, 1, '#6fa38a', '#f4efe2', 'flat', Math.PI / 2);
    F.put(G.box, '#2f86c9', 5.5, 2.6, 0, 0, 1.0, 0.12, 7.0, 0, -0.35);
    signBoard(F, 'Isu 雜貨店', 5.15, 3.4, 0, Math.PI / 2, 4.6, 0.9, { bg: '#e2f2ff', fg: '#103a5e', border: '#2f86c9' });
    const [x, z] = LM_POS['Isu雜貨店'];
    landmark({ name: 'Isu 雜貨店', area: '古楓部落', x, z, desc: '部落入口路口的另一家雜貨店，和 Masa 雜貨店相鄰。', labelH: 7, radius: 9 });
  }
  {
    const F = lmFrame('消防隊');
    F.box(0, 0, 0, 13, 7.5, 16, '#f3f1ec'); block(F, 0, 0, 13, 16); F.box(0, 7.5, 0, 13.4, 0.5, 16.4, '#c9322b');
    F.box(0, 3.4, 8.03, 13, 0.6, 0.05, '#c9322b');
    for (const dx of [-3.4, 3.4]) F.box(dx, 0, 8.05, 4.4, 3.1, 0.06, '#d8d4cc');
    signBoard(F, '消防隊', 0, 5.2, 8.12, 0, 4.6, 1.1, { bg: '#c9322b', fg: '#ffffff', border: '#ffffff' });
    const [x, z] = LM_POS['消防隊'];
    landmark({ name: '消防隊', area: '古楓部落', x, z, desc: '部落入口南側、主幹道旁的消防隊。', labelH: 11 });
  }

  // 白端部落
  {
    const F = lmFrame('白端部落聚會所 Silupatan', -RAD + Math.PI / 2);
    const RX = 22, RZ = 15;
    F.box(0, -0.6, 0, RX * 2 + 3, 0.7, RZ * 2 + 3, '#c9c3b6');
    F.put(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), '#b5523f', 0, 0.12, 0, 0, RX - 1, 1, RZ - 1);
    F.box(0, 0.1, 0, 26, 0.06, 15, '#3f8a63');
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; F.cyl(Math.cos(a) * RX, 0, Math.sin(a) * RZ, 0.35, 8.5, '#9aa1a8', true); }
    for (let k = 0; k < 18; k += 2) { const a = k / 18 * Math.PI * 2 + 0.17; F.put(G.box, '#8c939a', Math.cos(a) * RX, 4.2, Math.sin(a) * RZ, -a + Math.PI / 2, 0.15, 9.5, 0.15, 0, 0.75); }
    const dome = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.32);
    F.put(dome, '#a9b4bd', 0, 3.8, 0, 0, RX * 1.36, 8.2, RZ * 1.36);
    F.put(new THREE.TorusGeometry(1, 0.03, 4, 40).rotateX(Math.PI / 2), '#6f7b86', 0, 8.6, 0, 0, RX + 0.6, 1, RZ + 0.6);
    for (const s of [-1, 1]) { F.cyl(s * 11, 0, 0, 0.12, 3, '#f0f0f0'); }
    // 招牌：Silupatan 與兩隻熊
    signBoard(F, '白端部落聚會所 Silupatan', 0, 9.6, RZ + 1.2, 0, 15, 1.9, { bg: '#1f4e6b', fg: '#ffe9a8', border: '#f2c230', size: 0.5, bears: true });
    const [x, z] = LM_POS['白端部落聚會所 Silupatan'];
    landmark({ name: '白端部落聚會所 Silupatan', area: '白端部落', x, z, desc: '白端部落的聚會所。圓形鋼構、四周沒有牆，弧形屋頂下是一座籃球場。招牌上寫著 Silupatan，還畫了兩隻熊。', labelH: 17, radius: 26 });
  }
  {
    const F = lmFrame('天主堂');
    F.box(0, 0, 0, 9, 5.5, 14, '#f7f5ef'); block(F, 0, 0, 9, 14); F.put(G.gable, '#8b939c', 0, 5.5, 0, 0, 9.8, 2.8, 14.6);
    F.box(0, 8.3, 7.2, 0.3, 2.8, 0.3, '#ffffff'); F.box(0, 9.5, 7.2, 1.5, 0.3, 0.3, '#ffffff');
    F.box(0, 0, 7.03, 1.8, 2.6, 0.06, '#6e4a2f');
    const [x, z] = LM_POS['天主堂'];
    landmark({ name: '天主堂', area: '白端部落', x, z, desc: '聚會所南方的天主堂，位在主幹道和西側平行道路之間。', labelH: 13 });
  }
  {
    const F = lmFrame('智榮商號');
    house(F, 0, 0, 8, 7, 2, '#c8553d', '#f3eee2', 'flat', 0);
    signBoard(F, '智榮商號', 0, 3.4, 3.62, 0, 4.2, 0.9, { bg: '#fff3c4', fg: '#7a2e12', border: '#c8553d' });
    const [x, z] = LM_POS['智榮商號'];
    landmark({ name: '智榮商號', area: '白端部落', x, z, desc: '聚會所西北方街角的商號。', labelH: 10, radius: 10 });
  }
  {
    const F = lmFrame('藝沙泥溫工作室');
    house(F, 0, 0, 8, 6, 1, '#d9773f', '#efe6d6', 'gable', 0);
    for (const [px, ps] of [[-3, 0.5], [-2, 0.38], [2.6, 0.45]]) F.put(G.sph, '#b5653a', px, ps, 4, 0, ps, ps * 1.3, ps);
    signBoard(F, '藝沙泥溫工作室', 0, 2.6, 3.06, 0, 4.6, 0.8, { bg: '#f7e6d0', fg: '#6b3216', border: '#b5653a' });
    const [x, z] = LM_POS['藝沙泥溫工作室'];
    landmark({ name: '藝沙泥溫工作室', area: '白端部落', x, z, desc: '聚會所北側的工作室，門口擺著陶土作品。', labelH: 8, radius: 10 });
  }
  {
    const F = lmFrame('貓頭鷹之家');
    house(F, 0, 0, 11, 8, 2, '#d9603b', '#f1ece2', 'gable', 0);
    const OW = '#8a5a34';
    F.put(G.sph, OW, 0, 9.4, 0, 0, 1.1, 1.4, 1); F.put(G.sph, OW, 0, 10.9, 0, 0, 0.9, 0.85, 0.85);
    for (const s of [-1, 1]) { F.put(G.sph, '#fff4c7', s * 0.38, 11.0, 0.72, 0, 0.3, 0.3, 0.12); F.put(G.sph, '#1d1d1d', s * 0.38, 11.0, 0.82, 0, 0.13, 0.13, 0.06); F.put(G.cone, OW, s * 0.55, 11.8, 0, 0, 0.18, 0.5, 0.18); }
    F.put(G.cone, '#f2c230', 0, 10.75, 0.85, 0, 0.12, 0.3, 0.12, Math.PI / 2, 0);
    const [x, z] = LM_POS['貓頭鷹之家'];
    landmark({ name: '貓頭鷹之家', area: '白端部落', x, z, desc: '北側街區西北角、靠近山腳的貓頭鷹之家。屋頂上有一隻貓頭鷹。', labelH: 14 });
  }

  // 房舍：依衛星空拍圖逐棟描繪（位置、大小、方向、屋頂顏色），數量與空拍一致
  const FLAT = new Set(['#e9e6de', '#d8cdb5']);
  for (const [x, z, L, W, ry, roof, floors] of D.buildings) {
    const F = new Frame(x, ground(x, z), z, 0);
    house(F, 0, 0, W, L, floors, roof, '#f3efe6', FLAT.has(roof) ? 'flat' : 'gable', ry + Math.PI / 2);
  }
  return D.buildings.length;
}

/* ====================================================================
   角色
   ==================================================================== */
function wovenTexture() {
  // 白底背心＋布農族菱形織紋（紅、黃、黑、紫）
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f5f1e6'; g.fillRect(0, 0, 256, 256);
  const band = (y, h) => {
    g.fillStyle = '#1f1d24'; g.fillRect(0, y, 256, h);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = '#c0342c'; g.beginPath(); g.moveTo(x + 16, y + 2); g.lineTo(x + 30, y + h / 2); g.lineTo(x + 16, y + h - 2); g.lineTo(x + 2, y + h / 2); g.fill();
      g.fillStyle = '#f2c230'; g.beginPath(); g.moveTo(x + 16, y + h * 0.28); g.lineTo(x + 23, y + h / 2); g.lineTo(x + 16, y + h * 0.72); g.lineTo(x + 9, y + h / 2); g.fill();
    }
    g.fillStyle = '#6b3f8f'; g.fillRect(0, y - 4, 256, 4); g.fillRect(0, y + h, 256, 4);
  };
  band(150, 34); band(214, 26);
  g.fillStyle = '#c0342c'; g.fillRect(0, 40, 256, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
function buildAvatar() {
  const M_ = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...o });
  const SKIN = M_('#c48a60'), HAIR = M_('#1b1613', { roughness: 0.55 }), SHIRT = M_('#2f6fb2'), SHORTS = M_('#263246');
  const SOCK = M_('#f2f0ea'), SHOE = M_('#e8e6e1'), SOLE = M_('#c4402f'), WHITE = M_('#ffffff', { roughness: 0.3 }), DARK = M_('#1a1a1c', { roughness: 0.3 });
  const VEST = new THREE.MeshStandardMaterial({ map: wovenTexture(), roughness: 0.85 });
  const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.8; body.add(hips);
  mk(new THREE.CylinderGeometry(0.135, 0.15, 0.17, 18), SHORTS, hips, 0, -0.02, 0).scale.z = 0.78;
  const legs = [-1, 1].map(sd => {
    const thigh = new THREE.Group(); thigh.position.set(sd * 0.075, -0.04, 0); hips.add(thigh);
    mk(cap(0.06, 0.2), SHORTS, thigh, 0, -0.1, 0).scale.set(1.08, 0.7, 1.05);
    mk(cap(0.056, 0.22), SKIN, thigh, 0, -0.2, 0);
    const knee = new THREE.Group(); knee.position.y = -0.36; thigh.add(knee);
    mk(cap(0.05, 0.22), SKIN, knee, 0, -0.15, 0);
    mk(new THREE.CylinderGeometry(0.052, 0.05, 0.1, 12), SOCK, knee, 0, -0.29, 0);
    const shoe = mk(cap(0.055, 0.12), SHOE, knee, 0, -0.36, 0.035); shoe.rotation.x = Math.PI / 2; shoe.scale.set(1.05, 1, 0.75);
    const sole = mk(new THREE.BoxGeometry(0.11, 0.025, 0.23), SOLE, knee, 0, -0.405, 0.035);
    return { thigh, knee };
  });
  const torso = new THREE.Group(); torso.position.y = 0.8; body.add(torso);
  mk(cap(0.135, 0.2), SHIRT, torso, 0, 0.25, 0).scale.set(1.08, 1, 0.72);
  const vest = mk(cap(0.142, 0.18), VEST, torso, 0, 0.23, 0); vest.scale.set(1.1, 1, 0.76); vest.rotation.y = Math.PI;
  mk(new THREE.BoxGeometry(0.05, 0.32, 0.02), SHIRT, torso, 0, 0.26, 0.112);
  mk(new THREE.CylinderGeometry(0.042, 0.048, 0.09, 12), SKIN, torso, 0, 0.47, 0);
  // 頭部
  const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
  mk(new THREE.SphereGeometry(0.125, 28, 22), SKIN, head).scale.set(0.95, 1.06, 1.0);
  const hair = mk(new THREE.SphereGeometry(0.133, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.46), HAIR, head, 0, 0.012, -0.012);
  hair.scale.set(0.98, 1.08, 1.05); hair.rotation.x = -0.42;
  mk(new THREE.SphereGeometry(0.129, 22, 12, Math.PI * 0.97, Math.PI * 1.06, Math.PI * 0.3, Math.PI * 0.36), HAIR, head, 0, 0.004, -0.004).scale.set(0.99, 1.06, 1.04);
  for (const [x, rz] of [[-0.06, 0.25], [-0.015, 0.05], [0.035, -0.12], [0.075, -0.3]]) { const f = mk(new THREE.BoxGeometry(0.055, 0.04, 0.025), HAIR, head, x, 0.098, 0.098); f.rotation.set(-0.6, 0, rz); }
  for (const sd of [-1, 1]) {
    mk(new THREE.SphereGeometry(0.03, 12, 10), SKIN, head, sd * 0.12, 0.0, 0).scale.set(0.6, 1, 0.9);
    const eye = mk(new THREE.SphereGeometry(0.024, 16, 12), WHITE, head, sd * 0.046, 0.012, 0.105); eye.scale.set(1, 1.15, 0.55);
    mk(new THREE.SphereGeometry(0.0155, 14, 10), DARK, head, sd * 0.046, 0.011, 0.117).scale.set(1, 1.1, 0.5);
    mk(new THREE.SphereGeometry(0.005, 8, 6), WHITE, head, sd * 0.046 + 0.006, 0.019, 0.124);
    const brow = mk(new THREE.BoxGeometry(0.042, 0.009, 0.01), HAIR, head, sd * 0.047, 0.055, 0.113); brow.rotation.z = sd * -0.12;
    mk(new THREE.SphereGeometry(0.02, 10, 8), M_('#e0907a', { transparent: true, opacity: 0.55 }), head, sd * 0.07, -0.03, 0.098).scale.set(1, 0.6, 0.4);
  }
  mk(new THREE.SphereGeometry(0.016, 12, 10), SKIN, head, 0, -0.018, 0.124).scale.set(1, 0.9, 0.8);
  const mouth = mk(new THREE.TorusGeometry(0.024, 0.0045, 6, 16, Math.PI), M_('#7a2f25'), head, 0, -0.052, 0.117); mouth.rotation.z = Math.PI;
  // 手臂
  const arms = [-1, 1].map(sd => {
    const sh = new THREE.Group(); sh.position.set(sd * 0.175, 0.4, 0); sh.rotation.z = sd * 0.1; torso.add(sh);
    mk(cap(0.05, 0.06), SHIRT, sh, 0, -0.045, 0);
    mk(cap(0.042, 0.16), SKIN, sh, 0, -0.13, 0);
    const el = new THREE.Group(); el.position.y = -0.25; sh.add(el);
    mk(cap(0.038, 0.14), SKIN, el, 0, -0.1, 0);
    mk(new THREE.SphereGeometry(0.043, 14, 12), SKIN, el, 0, -0.22, 0.005).scale.set(0.85, 1, 0.75);
    return { sh, el };
  });
  // 布農織紋側背袋
  const strap = mk(new THREE.BoxGeometry(0.025, 0.44, 0.012), M_('#b8322a'), torso, 0.02, 0.22, 0.116); strap.rotation.z = 0.68;
  const strapB = mk(new THREE.BoxGeometry(0.025, 0.44, 0.012), M_('#b8322a'), torso, 0.02, 0.22, -0.116); strapB.rotation.z = 0.68;
  const bag = mk(new THREE.BoxGeometry(0.15, 0.17, 0.05), VEST, torso, 0.19, 0.03, 0.02); bag.rotation.z = 0.08;
  // 腳下光圈
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.85, depthWrite: false }));
  ring.position.y = 0.03; root.add(ring);
  root.userData = { body, torso, head, legs, arms, ring };
  root.scale.setScalar(1.3);
  scene.add(root);
  return root;
}
function animateRider(g, phase, amt, now) {
  // 騎腳踏車：坐在座墊上、雙腳踩踏板、雙手握把手
  const { body, torso, head, legs, arms } = g.userData;
  body.position.y = -0.04; torso.rotation.x = 0.22; torso.rotation.y = 0; torso.scale.y = 1; head.rotation.set(-0.15, 0, 0);
  const p = phase * 1.1;
  legs[0].thigh.rotation.x = -1.0 + Math.sin(p) * 0.38; legs[1].thigh.rotation.x = -1.0 - Math.sin(p) * 0.38;
  legs[0].knee.rotation.x = 1.35 - Math.cos(p) * 0.35; legs[1].knee.rotation.x = 1.35 + Math.cos(p) * 0.35;
  for (const a of arms) { a.sh.rotation.x = -1.0; a.el.rotation.x = -0.25; }
  if (T.bike) { const v = phase * 1.6; T.bike.userData.wheels.forEach(w => { w.rotation.x = v; }); T.bike.userData.crank.rotation.x = -p; }
}
function animateAvatar(g, phase, amt, run, now) {
  const { body, torso, head, legs, arms } = g.userData;
  const A = (run ? 0.85 : 0.55) * amt;
  const sp = Math.sin(phase), cp = Math.cos(phase);
  legs[0].thigh.rotation.x = -sp * A; legs[1].thigh.rotation.x = sp * A;
  legs[0].knee.rotation.x = A * 1.3 * Math.max(0, cp) + 0.04; legs[1].knee.rotation.x = A * 1.3 * Math.max(0, -cp) + 0.04;
  arms[0].sh.rotation.x = sp * A * 0.9; arms[1].sh.rotation.x = -sp * A * 0.9;
  arms[0].el.rotation.x = arms[1].el.rotation.x = -(0.15 + (run ? 0.9 : 0.35) * amt);
  body.position.y = Math.abs(sp) * 0.035 * amt;
  torso.rotation.x = (run ? 0.2 : 0.05) * amt;
  torso.rotation.y = sp * 0.08 * amt;
  const idle = 1 - amt;
  torso.scale.y = 1 + Math.sin(now / 650) * 0.012 * idle;
  head.rotation.y = Math.sin(now / 2300) * 0.35 * idle;
  head.rotation.x = -torso.rotation.x * 0.6;
}

/* ====================================================================
   介面
   ==================================================================== */
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無法存取時略過 */ } },
};
const found = new Set(store.get('zf-found', []));
let labelsOn = true;

function makeLabels() {
  const host = $('labels');
  for (const L of LANDMARKS) {
    const el = document.createElement('button');
    el.className = 'lbl lbl-' + L.kind + (L.sub ? ' lbl-' + L.sub : ''); el.type = 'button';
    el.textContent = L.name;
    el.addEventListener('click', () => { if (L.kind === 'transport') openTransit(L.sub); else if (L.kind !== 'area') openCard(L); });
    host.appendChild(el); L.el = el;
  }
}
const _v = new THREE.Vector3();
function updateLabels() {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const camPos = camera.position;
  const camHigh = camPos.y - ground(camPos.x, camPos.z);
  for (const L of LANDMARKS) {
    const el = L.el; if (!el) continue;
    const dist = camPos.distanceTo(_v.set(L.x, L.y, L.z));
    const high = camHigh > 60;
    const max = L.kind === 'transport' ? (high ? 700 : 160) : L.kind === 'area' ? (high ? 9000 : 700) : L.kind === 'natural' ? (high ? 5000 : 400) : L.kind === 'campus' ? 50 : (high ? 900 : 220);
    const min = L.kind === 'area' ? 140 : 0;
    _v.set(L.x, L.y + L.labelH, L.z).project(camera);
    const vis = labelsOn && _v.z < 1 && dist < max && dist > min && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    if (!vis) { if (!el.hidden) el.hidden = true; continue; }
    el.hidden = false;
    const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.zIndex = String(10000 - Math.round(dist));
    el.classList.toggle('found', found.has(L.name));
  }
}

let cardFor = null, cardAuto = false;
function openCard(L, auto = false) {
  cardFor = L; cardAuto = auto;
  $('card-area').textContent = L.area;
  $('card-name').textContent = L.name;
  $('card-elev').textContent = `海拔 ${L.elev} m`;
  $('card-desc').textContent = L.desc;
  $('card').hidden = false; document.body.classList.add('has-card');
}
$('card-close').addEventListener('click', () => { $('card').hidden = true; cardFor = null; document.body.classList.remove('has-card'); });
$('card-go').addEventListener('click', () => { if (cardFor) { teleport(cardFor.x, cardFor.z, cardFor); } });

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}
const DISCOVERABLE = () => LANDMARKS.filter(l => l.kind !== 'area' && l.kind !== 'transport');
function updateProgress() { $('progress').textContent = `${[...found].filter(n => DISCOVERABLE().some(l => l.name === n)).length} / ${DISCOVERABLE().length}`; }

function buildPlaceMenu() {
  const list = $('places-list'); list.innerHTML = '';
  for (const area of ['卓楓國小', '古楓部落', '白端部落', '溪流']) {
    const items = DISCOVERABLE().filter(l => l.area === area);
    if (!items.length) continue;
    const sec = document.createElement('section');
    const h = document.createElement('h3'); h.textContent = area; sec.appendChild(h);
    const ul = document.createElement('div'); ul.className = 'place-grid';
    for (const L of items) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'place';
      b.innerHTML = `<span class="dot"></span><span></span>`;
      b.lastChild.textContent = L.name;
      b.classList.toggle('found', found.has(L.name));
      b.addEventListener('click', () => { closePanel(); teleport(L.x, L.z, L); });
      ul.appendChild(b);
    }
    sec.appendChild(ul); list.appendChild(sec);
  }
  const sec = document.createElement('section'); sec.innerHTML = '<h3>交通</h3>';
  const ul = document.createElement('div'); ul.className = 'place-grid';
  for (const L of LANDMARKS.filter(l => l.kind === 'transport')) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'place';
    b.innerHTML = `<span class="dot" style="border-color:${L.sub === 'ubike' ? '#f0a020' : '#2e8b57'};background:${L.sub === 'ubike' ? '#f0a020' : '#2e8b57'}"></span><span></span>`;
    b.lastChild.textContent = L.name;
    b.addEventListener('click', () => { closePanel(); teleport(L.x, L.z + 5); });
    ul.appendChild(b);
  }
  sec.appendChild(ul); list.appendChild(sec);
}
function openPanel() { closeTransit(); buildPlaceMenu(); $('places').hidden = false; $('btn-places').setAttribute('aria-expanded', 'true'); }
function closePanel() { $('places').hidden = true; $('btn-places').setAttribute('aria-expanded', 'false'); }
$('btn-places').addEventListener('click', () => ($('places').hidden ? openPanel() : closePanel()));
$('places-close').addEventListener('click', closePanel);

/* ---------- 小地圖 ---------- */
const MM = { scale: 2, base: null };
function buildMinimap() {
  const c = document.createElement('canvas'); c.width = NX * MM.scale; c.height = NZ * MM.scale;
  const g = c.getContext('2d');
  const img = g.createImageData(NX, NZ), col = new THREE.Color();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = X0 + i * CELL, z = Z0 + j * CELL;
    col.set(colorFor(classify(x, z), x, z));
    const h = HRAW[j * NX + i], hl = HRAW[j * NX + Math.max(0, i - 1)], hu = HRAW[Math.max(0, j - 1) * NX + i];
    const shade = clamp(1 + ((hl - h) + (hu - h)) * 0.025, 0.6, 1.25);
    const k = (j * NX + i) * 4;
    img.data[k] = clamp(col.r * 255 * shade, 0, 255); img.data[k + 1] = clamp(col.g * 255 * shade, 0, 255); img.data[k + 2] = clamp(col.b * 255 * shade, 0, 255); img.data[k + 3] = eastOfRiver(x, z) ? 0 : 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = NX; tmp.height = NZ; tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(tmp, 0, 0, c.width, c.height);
  const toM = (x, z) => [(x - X0) / CELL * MM.scale, (z - Z0) / CELL * MM.scale];
  const line = (pts, w, color) => { g.beginPath(); pts.forEach((p, k) => { const [a, b] = toM(p[0], p[1]); k ? g.lineTo(a, b) : g.moveTo(a, b); }); g.lineWidth = w; g.strokeStyle = color; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); };
  line(RIVER, 5, '#3d9ad6'); for (const cr of CREEKS) line(cr.pts, 2, '#3d9ad6');
  line(MAIN_ROAD, 2.4, '#ffffff'); for (const r of VILLAGE_ROADS) line(r, 1.4, '#f5f2ea');
  // 等高線 200 m（黃）與 360 m（紅）
  for (const [lv, color] of [[200, 'rgba(242,194,48,.95)'], [360, 'rgba(184,50,42,.8)']]) {
    g.fillStyle = color;
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const a = HRAW[j * NX + i], b = HRAW[j * NX + i + 1], d = HRAW[(j + 1) * NX + i];
      if (((a - lv) * (b - lv) < 0 || (a - lv) * (d - lv) < 0) && !eastOfRiver(X0 + i * CELL, Z0 + j * CELL)) g.fillRect(i * MM.scale, j * MM.scale, 1.6, 1.6);
    }
  }
  MM.base = c;
}
function drawMinimap(player, heading) {
  const c = $('minimap'), g = c.getContext('2d');
  if (c.width < 20 && c.clientWidth > 0) { c.width = c.clientWidth * 2; c.height = Math.round(c.width * NZ / NX); }
  const W = c.width, Hh = c.height;
  g.clearRect(0, 0, W, Hh); g.drawImage(MM.base, 0, 0, W, Hh);
  const sx = W / MM.base.width * MM.scale / CELL, sz = Hh / MM.base.height * MM.scale / CELL;
  for (const L of DISCOVERABLE()) {
    if (L.kind === 'campus') continue;
    g.beginPath(); g.arc((L.x - X0) * sx, (L.z - Z0) * sz, 3.2, 0, Math.PI * 2);
    g.fillStyle = found.has(L.name) ? '#f2c230' : '#ffffff'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#1b2a22'; g.stroke();
  }
  for (const L of LANDMARKS) {
    if (L.kind !== 'transport') continue;
    g.fillStyle = L.sub === 'ubike' ? '#f0a020' : '#2e8b57'; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
    const a = (L.x - X0) * sx, b = (L.z - Z0) * sz; g.fillRect(a - 3.5, b - 3.5, 7, 7); g.strokeRect(a - 3.5, b - 3.5, 7, 7);
  }
  if (T.bus) {
    for (const c of T.cars) { if (c.state === 'idle') continue; const a = (c.mesh.position.x - X0) * sx, b = (c.mesh.position.z - Z0) * sz; g.beginPath(); g.arc(a, b, 3.5, 0, Math.PI * 2); g.fillStyle = c.color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#ffffff'; g.stroke(); }
    const a = (T.bus.mesh.position.x - X0) * sx, b = (T.bus.mesh.position.z - Z0) * sz; g.fillStyle = '#ffffff'; g.fillRect(a - 5, b - 4, 10, 8); g.lineWidth = 2; g.strokeStyle = '#e9a23b'; g.strokeRect(a - 5, b - 4, 10, 8);
  }
  const px = (player.x - X0) * sx, pz = (player.z - Z0) * sz;
  g.save(); g.translate(px, pz); g.rotate(heading);
  g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath();
  g.fillStyle = '#b8322a'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.stroke(); g.restore();
}
$('minimap').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const x = X0 + (e.clientX - r.left) / r.width * (XMAX - X0), z = Z0 + (e.clientY - r.top) / r.height * (ZMAX - Z0);
  teleport(x, z);
});

/* ====================================================================
   操作
   ==================================================================== */
const keys = new Set();
const isTyping = () => document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
addEventListener('keydown', e => {
  if (isTyping()) return;
  const k = e.key.toLowerCase(); keys.add(k);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (k === 'm') toggleBird();
  if (k === 'escape') { $('card').hidden = true; closePanel(); if (typeof closeTransit === 'function') closeTransit(); }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const joy = { x: 0, y: 0, id: null };
{
  const pad = $('joystick'), knob = $('joystick-knob');
  const R = 46;
  const move = e => {
    const r = pad.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const L = Math.hypot(dx, dy); if (L > R) { dx *= R / L; dy *= R / L; }
    joy.x = dx / R; joy.y = dy / R; knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  pad.addEventListener('pointerdown', e => { joy.id = e.pointerId; pad.setPointerCapture(e.pointerId); move(e); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === joy.id) move(e); });
  const end = e => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
}

let running = false, bird = false;
$('btn-run').addEventListener('click', () => { running = !running; $('btn-run').setAttribute('aria-pressed', String(running)); });
$('btn-labels').addEventListener('click', () => { labelsOn = !labelsOn; $('btn-labels').setAttribute('aria-pressed', String(labelsOn)); });
$('btn-bird').addEventListener('click', () => toggleBird());

const avatar = { g: null };
const player = new THREE.Vector3();
let heading = Math.PI; // 面向（0 = 北）
const CENTER = new THREE.Vector3(40, 190, -440);

let camTween = null;
function tweenCamera(toPos, toTarget, ms = 1100) {
  camTween = { fromP: camera.position.clone(), fromT: controls.target.clone(), toP: toPos, toT: toTarget, t0: performance.now(), ms };
}
function followOffset() { return new THREE.Vector3(Math.sin(heading) * -14, 8.5, Math.cos(heading) * 14).multiplyScalar(1); }
function toggleBird(force) {
  bird = force ?? !bird;
  $('btn-bird').setAttribute('aria-pressed', String(bird));
  document.body.classList.toggle('is-bird', bird);
  if (bird) {
    controls.maxDistance = 4200;
    tweenCamera(new THREE.Vector3(CENTER.x + 900, 1550, CENTER.z + 1650), CENTER.clone());
    $('hint').textContent = '點一下地面，就能把角色傳送到那裡';
  } else {
    controls.maxDistance = 900;
    const t = player.clone().add(new THREE.Vector3(0, 2.4, 0));
    tweenCamera(t.clone().add(new THREE.Vector3(Math.sin(heading) * -17, 12, -Math.cos(heading) * -17)), t);
    $('hint').textContent = hintText();
  }
}
function hintText() { return matchMedia('(pointer: coarse)').matches ? '左下角搖桿移動 · 單指拖曳轉視角 · 雙指縮放' : 'WASD／方向鍵移動 · Shift 加速 · E 互動 · 拖曳轉視角 · M 鳥瞰'; }

function teleport(x, z, L) {
  z = clamp(z, Z0 + 15, ZMAX - 15); x = clamp(x, X0 + 15, riverX(z) - 4);
  if (L) { const off = (L.radius || 10) * 0.6 + 4; z += off; }
  [x, z] = freeSpot(x, z);
  player.set(x, ground(x, z), z);
  if (bird) toggleBird(false);
  else {
    const t = player.clone().add(new THREE.Vector3(0, 2.4, 0));
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize().multiplyScalar(17);
    tweenCamera(t.clone().add(dir).add(new THREE.Vector3(0, 13, 0)), t, 700);
  }
  if (L) openCard(L);
}

// 鳥瞰時點地面傳送
const ray = new THREE.Raycaster(); let terrainMesh = null; let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY, performance.now()]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!bird || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  if (moved > 6 || performance.now() - downAt[2] > 450) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera({ x: (e.clientX - r.left) / r.width * 2 - 1, y: -(e.clientY - r.top) / r.height * 2 + 1 }, camera);
  const hit = ray.intersectObject(terrainMesh, false)[0];
  if (hit) teleport(hit.point.x, hit.point.z);
});

function areaName(x, z) {
  if (campusDist(x, z) <= 0) return '卓楓國小';
  if (pointInPoly(x, z, GF_FRAME)) return '古楓部落';
  if (pointInPoly(x, z, BD_FRAME)) return '白端部落';
  if (distToPolyline(x, z, RIVER).d < 150) return '秀姑巒溪河床';
  for (const c of CREEKS) if (distToPolyline(x, z, c.pts).d < 25) return c.name;
  if (realElev(x, z) > 201) return '山林';
  return '田野';
}

/* ====================================================================
   交通：ubike（公共自行車）與社區愛心專車（bubu 車）
   ==================================================================== */
// 收費設定：目前全面免費。未來要收費時，把 free 改成 false、填入價格即可，畫面與紀錄會自動顯示費用。
const FARES = {
  ubike: { free: true, unitMinutes: 30, unitPrice: 10 },   // 每 30 分鐘 10 元（尚未啟用）
  bubu: { free: true, perPerson: 20 },                      // 預約轎車：每人每趟 20 元（尚未啟用）
  bus: { free: true, perRide: 15 },                         // 定時幸福巴士：每趟 15 元（尚未啟用）
};
const BUBU_RULES = { minAdvanceMin: 2, maxPassengers: 4, waitMinutes: 5, speed: 9 };
const BUS_RULES = { speed: 8, dwell: 20, seats: 20 };       // 小巴：每站停 20 秒
const CAR_FLEET = [{ id: 'c1', name: '銀色轎車', color: '#c4c8cd' }, { id: 'c2', name: '藍色轎車', color: '#2c5490' }, { id: 'c3', name: '紅色轎車', color: '#a8322b' }];
const ubikeFee = mins => FARES.ubike.free ? 0 : Math.max(1, Math.ceil(mins / FARES.ubike.unitMinutes)) * FARES.ubike.unitPrice;
const bubuFee = people => FARES.bubu.free ? 0 : people * FARES.bubu.perPerson;
const busFee = () => FARES.bus.free ? 0 : FARES.bus.perRide;
const money = n => n === 0 ? '免費' : `${n} 元`;

// 使用紀錄：第一階段存在這台裝置；第二階段改送到伺服器，並綁定學生帳號的學習歷程
function saveRecord(kind, data) {
  const all = store.get('zf-records', []);
  all.unshift({ kind, at: Date.now(), ...data });
  store.set('zf-records', all.slice(0, 200));
}

const T = { stations: [], stops: [], bike: null, riding: null, bus: null, cars: [], rideVeh: null, bookings: [], mode: 'walk', fast: 1 };

/* ---------- 模型 ---------- */
function rod(parent, a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 8), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  parent.add(m); return m;
}
const BIKE_MAT = {
  frame: new THREE.MeshStandardMaterial({ color: '#f0a020', roughness: 0.45, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: '#26282c', roughness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: '#b9bec4', roughness: 0.35, metalness: 0.7 }),
  basket: new THREE.MeshStandardMaterial({ color: '#d98a12', roughness: 0.6, transparent: true, opacity: 0.92 }),
};
function makeBike(shadow = true) {
  // 單位：公尺；車頭朝 +z
  const g = new THREE.Group(), M = BIKE_MAT, wheels = [];
  for (const z of [-0.52, 0.52]) {
    const w = new THREE.Group(); w.position.set(0, 0.33, z); g.add(w); wheels.push(w);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 8, 26), M.dark); tire.rotation.y = Math.PI / 2; w.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.012, 6, 26), M.metal); rim.rotation.y = Math.PI / 2; w.add(rim);
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.54, 0.01), M.metal); sp.rotation.x = k * Math.PI / 4; w.add(sp); }
  }
  const BB = [0, 0.3, 0.02], HEAD = [0, 0.86, 0.38], SEAT = [0, 0.84, -0.16];
  rod(g, BB, [0, 0.42, 0.24], 0.028, M.frame); rod(g, [0, 0.42, 0.24], HEAD, 0.028, M.frame);       // 低跨式車架
  rod(g, BB, SEAT, 0.026, M.frame);
  rod(g, BB, [0, 0.33, -0.52], 0.016, M.frame); rod(g, SEAT, [0, 0.33, -0.52], 0.016, M.frame);
  rod(g, HEAD, [0, 0.33, 0.52], 0.022, M.frame);
  rod(g, HEAD, [0, 1.0, 0.33], 0.02, M.metal); rod(g, [-0.27, 1.0, 0.3], [0.27, 1.0, 0.3], 0.016, M.metal);
  for (const s of [-1, 1]) { const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8), M.dark); grip.rotation.z = Math.PI / 2; grip.position.set(s * 0.25, 1.0, 0.3); g.add(grip); }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.26), M.dark); seat.position.set(0, 0.89, -0.17); g.add(seat);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.27), M.basket); basket.position.set(0, 0.93, 0.6); g.add(basket);
  const fenderF = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 4, 14, Math.PI * 0.55), M.frame); fenderF.rotation.y = Math.PI / 2; fenderF.position.set(0, 0.33, 0.52); fenderF.rotation.z = 0.55; g.add(fenderF);
  const fenderR = fenderF.clone(); fenderR.position.z = -0.52; fenderR.rotation.z = 1.6; g.add(fenderR);
  const crank = new THREE.Group(); crank.position.set(0, 0.3, 0.02); g.add(crank);
  for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.03), M.metal); arm.position.set(s * 0.1, s * 0.085, 0); crank.add(arm); const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.06), M.dark); pedal.position.set(s * 0.15, s * 0.17, 0); crank.add(pedal); }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff6c4' })); lamp.position.set(0, 0.86, 0.47); g.add(lamp);
  g.traverse(o => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = false; } });
  g.userData = { wheels, crank };
  return g;
}
// 卓溪幸福巴士標誌（兩種專車都貼）
const LOGO_TEX = new THREE.TextureLoader().load('data:image/png;base64,__LOGO_B64__');
LOGO_TEX.colorSpace = THREE.SRGBColorSpace; LOGO_TEX.anisotropy = 4;
function logoDecal(g, x, y, z, size, side) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.96), new THREE.MeshBasicMaterial({ map: LOGO_TEX, toneMapped: false }));
  m.position.set(x, y, z); m.rotation.y = side * Math.PI / 2; g.add(m); return m;
}
function signTex(text, bg, fg, w = 512, h = 96) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = `700 ${h * 0.58}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeMinibus() {
  // 定時班次：20 人座白色小型巴士（車頭朝 +z）
  const g = new THREE.Group();
  const S = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.1, ...o });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const WHITE = S('#ffffff', { roughness: 0.55, metalness: 0, emissive: '#2a2a2a' }), GLASS = S('#33495c', { roughness: 0.15, metalness: 0 }), DARK = S('#1d1d1f'), GRAY = S('#c9ccd0');
  add(new THREE.BoxGeometry(2.05, 2.2, 6.9), WHITE, 0, 1.55, 0);                                     // 車身
  add(new THREE.BoxGeometry(2.0, 0.15, 6.7), WHITE, 0, 2.72, -0.05);                                 // 車頂
  add(new THREE.BoxGeometry(1.9, 0.12, 2.2), GRAY, 0, 2.84, -1.2);                                   // 冷氣機
  for (const sd of [-1, 1]) {
    add(new THREE.BoxGeometry(0.04, 0.8, 5.5), GLASS, sd * 1.03, 2.08, -0.55);                    // 側窗帶
    for (let k = 0; k <= 6; k++) add(new THREE.BoxGeometry(0.06, 0.82, 0.12), WHITE, sd * 1.035, 2.08, -3.3 + k * 0.917);   // 窗柱
  }
  const ws = add(new THREE.BoxGeometry(1.9, 1.05, 0.08), GLASS, 0, 2.05, 3.44); ws.rotation.x = -0.12;     // 擋風玻璃
  add(new THREE.BoxGeometry(0.06, 1.6, 0.85), GLASS, 1.03, 1.55, 2.6);                                // 右前車門
  add(new THREE.BoxGeometry(2.07, 0.12, 6.92), S('#e9a23b'), 0, 1.3, 0);                             // 橘色腰線
  add(new THREE.BoxGeometry(2.1, 0.32, 7.0), DARK, 0, 0.55, 0);                                       // 保險桿與裙邊
  for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.32, 0.16, 0.05), S('#fff6c4', { emissive: '#7a6a26' }), sd * 0.7, 1.0, 3.47);
  for (const [x, z] of [[-0.95, 2.3], [0.95, 2.3], [-0.95, -2.2], [0.95, -2.2]]) { const w = add(new THREE.CylinderGeometry(0.45, 0.45, 0.32, 18), DARK, x, 0.45, z); w.rotation.z = Math.PI / 2; }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.26), new THREE.MeshBasicMaterial({ map: signTex('幸福巴士 卓楓⇄白端', '#151515', '#ffb43a'), toneMapped: false }));
  sign.position.set(0, 2.5, 3.5); g.add(sign);
  for (const sd of [-1, 1]) logoDecal(g, sd * 1.04, 1.45, -1.6, 1.15, sd);
  scene.add(g); return g;
}
function makeSedan(color) {
  // 預約制：私人轎車，每台顏色不同，車門貼幸福巴士標誌（車頭朝 +z）
  const g = new THREE.Group();
  const S = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.05, ...o });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const BODY = S(color), GLASS = S('#2a3a48', { roughness: 0.15 }), DARK = S('#1a1a1a');
  add(new THREE.BoxGeometry(1.8, 0.62, 4.5), BODY, 0, 0.62, 0);
  add(new THREE.BoxGeometry(1.6, 0.58, 2.3), BODY, 0, 1.2, -0.25);
  add(new THREE.BoxGeometry(1.62, 0.44, 2.0), GLASS, 0, 1.2, -0.25);
  const wf = add(new THREE.BoxGeometry(1.5, 0.05, 0.85), GLASS, 0, 1.2, 1.15); wf.rotation.x = 0.62;
  const wr = add(new THREE.BoxGeometry(1.5, 0.05, 0.7), GLASS, 0, 1.2, -1.62); wr.rotation.x = -0.7;
  add(new THREE.BoxGeometry(1.84, 0.2, 4.56), DARK, 0, 0.36, 0);
  for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.34, 0.12, 0.05), S('#fff6c4', { emissive: '#7a6a26' }), sd * 0.62, 0.72, 2.26);
  for (const [x, z] of [[-0.82, 1.4], [0.82, 1.4], [-0.82, -1.4], [0.82, -1.4]]) { const w = add(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16), DARK, x, 0.33, z); w.rotation.z = Math.PI / 2; }
  for (const sd of [-1, 1]) logoDecal(g, sd * 0.905, 0.62, 0.15, 0.62, sd);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.2), new THREE.MeshBasicMaterial({ map: signTex('幸福巴士', '#ffffff', '#d9631e', 256, 80), toneMapped: false, side: THREE.DoubleSide }));
  roof.position.set(0, 1.62, -0.25); g.add(roof);
  scene.add(g); return g;
}

/* ---------- 站點 ---------- */
function roadTangent(i) { const a = MAIN_ROAD[Math.max(0, i - 2)], b = MAIN_ROAD[Math.min(MAIN_ROAD.length - 1, i + 2)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; }
function nearestRoadIndex(x, z) { let bi = 0, bd = Infinity; MAIN_ROAD.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; }
function curb(i, off) { const [tx, tz] = roadTangent(i), p = MAIN_ROAD[i]; return [p[0] + tz * off, p[1] - tx * off]; }   // off > 0：道路西側

const STOP_FP = { w: 3.6, d: 1.6 }, STATION_FP = { w: 7.2, d: 2.2, oz: -0.2 };
let UBIKE_DEFAULT = [], BUBU_DEFAULT = [];
function defaultStations() {
  const gfLM = LM_POS0['Masa雜貨店'], bdLM = LM_POS0['白端部落聚會所 Silupatan'];
  const iS = nearestRoadIndex(...fromPlan(45, 8)), iG = nearestRoadIndex(...gfLM), iB = nearestRoadIndex(...bdLM);
  BUBU_DEFAULT = [['卓楓國小站', iS], ['古楓部落站', iG], ['白端部落站', iB], ['白端北口站', Math.min(MAIN_ROAD.length - 3, iB + 60)]].map(([name, i], k) => {
    let [x, z] = curb(i, 6.5); if (blocked(x, z)) [x, z] = curb(i, -6.5); [x, z] = freeSpot(x, z);
    const [tx, tz] = roadTangent(i);
    return { id: 'b' + k, name, x: +x.toFixed(1), z: +z.toFixed(1), ry: +Math.atan2(-tz, tx).toFixed(3) };
  });
  const c = LM_POS0['古風教會'], cf = new Frame(c[0], 0, c[1], -RAD).world(12, 0, 6);
  UBIKE_DEFAULT = [['卓楓國小站', fromPlan(-48, 49.5)], ['古楓部落站', curb(iG + 4, -9)], ['古風教會站', [cf.x, cf.z]], ['白端部落站', curb(iB - 8, -9)]].map(([name, p], k) => {
    const [x, z] = freeSpot(p[0], p[1]);
    return { id: 'u' + k, name, x: +x.toFixed(1), z: +z.toFixed(1), ry: +(-RAD).toFixed(3) };
  });
}
function buildStops() {
  defaultStations();
  const stops = (Array.isArray(LAYOUT.bubu) && LAYOUT.bubu.length) ? LAYOUT.bubu : BUBU_DEFAULT;
  const stations = Array.isArray(LAYOUT.ubike) ? LAYOUT.ubike : UBIKE_DEFAULT;
  for (const sp of stops) {
    const { name, x, z, ry } = sp, i = nearestRoadIndex(x, z);
    const F = new Frame(x, ground(x, z), z, ry);
    F.box(0, 0, 0, 3.6, 0.15, 1.6, '#cfd3cc');
    F.box(0, 0.45, -0.3, 2.2, 0.08, 0.5, '#7a5236'); F.box(-0.9, 0, -0.3, 0.1, 0.45, 0.4, '#555'); F.box(0.9, 0, -0.3, 0.1, 0.45, 0.4, '#555');
    F.box(0, 2.4, -0.1, 3.4, 0.1, 1.6, '#2e8b57'); F.box(-1.6, 0, -0.75, 0.1, 2.4, 0.1, '#888'); F.box(1.6, 0, -0.75, 0.1, 2.4, 0.1, '#888');
    signBoard(F, '愛心專車站 · ' + name.replace(/站$/, ''), 0, 2.85, -0.1, 0, 3.2, 0.62, { bg: '#2e8b57', fg: '#ffffff', border: '#f2c230', size: 0.52 });
    const L = landmark({ name: '愛心專車 ' + name, area: '交通', x, z, kind: 'transport', sub: 'bubu', radius: 0, labelH: 4.2, desc: '卓溪幸福巴士（愛心專車）停靠站：白色的定時小巴每一站都會停，不用預約；私人轎車要先在「交通 → 預約轎車」預約，車子會在預約時間開到這裡。' });
    T.stops.push({ name, i, x, z, L });
  }
  for (const sp of stations) {
    const { name, x, z, ry } = sp, F = new Frame(x, ground(x, z), z, ry);
    F.box(0, 0, 0, 7.2, 0.12, 2.2, '#c9ccc4');
    F.box(-3.4, 0, 0.9, 0.12, 2.4, 0.12, '#666'); signBoard(F, 'ubike · ' + name.replace(/站$/, ''), -3.4, 2.55, 0.9, 0, 2.6, 0.55, { bg: '#f0a020', fg: '#3d2600', border: '#ffffff', size: 0.55 });
    const docks = [];
    for (let k = 0; k < 6; k++) {
      const dx = -2.5 + k * 1.0;
      F.box(dx, 0, -0.75, 0.16, 0.85, 0.2, '#4d5560'); F.box(dx, 0.62, -0.75, 0.2, 0.12, 0.22, '#f0a020');
      const b = makeBike(false); const p = F.world(dx, 0.12, -0.15); b.position.copy(p); b.rotation.y = ry + Math.PI; scene.add(b);
      if (k >= 4) b.visible = false;
      docks.push(b);
    }
    block(F, 0, -0.6, 6.6, 1.2);
    const L = landmark({ name: 'ubike ' + name, area: '交通', x, z, kind: 'transport', sub: 'ubike', radius: 0, labelH: 3.4, desc: '公共自行車站，所有人都能借車。' });
    T.stations.push({ name, x, z, docks, L });
  }
  // 定時幸福巴士：沿主幹道依序停靠每一站，到端點折返
  const route = T.stops.slice().sort((a, b) => a.i - b.i).filter((s, k, arr) => k === 0 || Math.abs(s.i - arr[k - 1].i) > 3);
  T.bus = { mesh: makeMinibus(), route, k: 0, dir: 1, s: route[0].i, state: 'dwell', wait: 8, lane: 2.3 };
  placeVehicle(T.bus);
  // 預約制轎車：每台顏色不同，平時停在第一站旁
  const home = route[0].i;
  T.cars = CAR_FLEET.map((c, k) => ({ ...c, mesh: makeSedan(c.color), home: clamp(home - 4 - k * 2.2, 0, MAIN_ROAD.length - 1), s: clamp(home - 4 - k * 2.2, 0, MAIN_ROAD.length - 1), state: 'idle', booking: null, target: null, dir: 1, lane: 2.0 }));
  T.cars.forEach(placeVehicle);
  // 騎乘用的車（掛在角色身上）
  T.bike = makeBike(true); T.bike.visible = false;
  const holder = new THREE.Group(); holder.scale.setScalar(1 / 1.3); holder.position.z = 0.12; holder.add(T.bike);
  T.bikeHolder = holder;
  T.bookings = store.get('zf-bubu', []).map(b => (b.carId && !T.cars.some(c => c.id === b.carId)) ? { ...b, carId: null } : b).map(b => (!stopByName(b.from) || !stopByName(b.to)) && !['done', 'cancelled', 'expired'].includes(b.status) ? { ...b, status: 'cancelled' } : b).map(b => (['booked'].includes(b.status) && b.time < Date.now() - BUBU_RULES.waitMinutes * 60000) || ['arriving', 'waiting', 'riding'].includes(b.status) ? { ...b, status: 'expired' } : b);
  saveBookings();
}
function roadPoint(s) {
  const i = clamp(Math.floor(s), 0, MAIN_ROAD.length - 2), f = clamp(s - i, 0, 1), a = MAIN_ROAD[i], b = MAIN_ROAD[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
function placeVehicle(v) {
  const dir = v.dir || 1, [x0, z0] = roadPoint(v.s);
  const [tx, tz] = roadTangent(clamp(Math.round(v.s), 0, MAIN_ROAD.length - 1)), off = -v.lane * dir;   // 靠右行駛
  const x = x0 + tz * off, z = z0 - tx * off;
  v.mesh.position.set(x, ground(x, z) + 0.36, z);   // 路面高出地面 0.35 m，輪胎貼在路面上
  v.mesh.rotation.y = Math.atan2(tx * dir, tz * dir);
}
const SEG = 4;  // MAIN_ROAD 每段約 4 m
function etaSeconds(fromS, toS, speed = BUBU_RULES.speed) { return Math.abs(toS - fromS) * SEG / speed; }

/* ---------- ubike ---------- */
function nearStation(r = 7) { return T.stations.find(s => Math.hypot(s.x - player.x, s.z - player.z) < r); }
function nearStop(r = 12) { return T.stops.find(s => Math.hypot(s.x - player.x, s.z - player.z) < r); }
function rentBike(st) {
  const b = st.docks.find(d => d.visible);
  if (!b) { toast('這一站目前沒有車，換一站試試'); return; }
  b.visible = false;
  T.mode = 'bike'; T.riding = { from: st.name, t0: Date.now(), dist: 0 };
  avatar.g.add(T.bikeHolder); T.bike.visible = true;
  toast(`借車成功：${st.name}（${FARES.ubike.free ? '目前免費' : '依時間計費'}）`);
}
function returnBike(st) {
  const b = st.docks.find(d => !d.visible);
  if (!b) { toast('這一站車位滿了，請騎到別站還車'); return; }
  b.visible = true;
  const mins = (Date.now() - T.riding.t0) / 60000, fee = ubikeFee(mins);
  saveRecord('ubike', { from: T.riding.from, to: st.name, minutes: +mins.toFixed(1), meters: Math.round(T.riding.dist), fee });
  T.mode = 'walk'; T.riding = null; T.bike.visible = false; avatar.g.remove(T.bikeHolder);
  toast(`還車完成：${st.name} · 費用 ${money(fee)}`);
}

/* ---------- 定時幸福巴士 ---------- */
function busNext(k, dir, n) { let d = dir; if (k + d < 0 || k + d >= n) d = -d; return [Math.max(0, Math.min(n - 1, k + d)), d]; }
function updateBus(dt) {
  const b = T.bus, fast = T.rideVeh === b ? T.fast : 1;
  if (b.state === 'dwell') {
    b.wait -= dt;                                            // 停站時間不快轉，才來得及下車
    if (b.wait <= 0 && b.route.length > 1) { [b.k, b.dir] = busNext(b.k, b.dir, b.route.length); b.state = 'drive'; }
  } else {
    const target = b.route[b.k].i, sp = BUS_RULES.speed / SEG * dt * fast, d = target - b.s;
    if (d) b.face = Math.sign(d);
    if (Math.abs(d) <= sp) {
      b.s = target; b.state = 'dwell'; b.wait = BUS_RULES.dwell;
      if (T.rideVeh === b) toast(`幸福巴士到站：${b.route[b.k].name}`);
    } else b.s += Math.sign(d) * sp;
    placeVehicle({ ...b, dir: b.face || b.dir });
  }
}
function busHeadingTo(b) { const [, d] = busNext(b.k, b.dir, b.route.length); return (d > 0 ? b.route[b.route.length - 1] : b.route[0]).name; }
function busEta(stopName) {
  // 推算幸福巴士下一次到某站的秒數
  const b = T.bus, n = b.route.length, target = b.route.findIndex(s => s.name === stopName);
  if (target < 0) return null;
  let t = 0, k = b.k, dir = b.dir, s = b.s;
  if (b.state === 'dwell') { if (k === target) return 0; t += Math.max(0, b.wait); }
  else { t += etaSeconds(s, b.route[k].i, BUS_RULES.speed); s = b.route[k].i; if (k === target) return t; t += BUS_RULES.dwell; }
  for (let step = 0; step < n * 2 + 2; step++) {
    [k, dir] = busNext(k, dir, n);
    t += etaSeconds(s, b.route[k].i, BUS_RULES.speed); s = b.route[k].i;
    if (k === target) return t;
    t += BUS_RULES.dwell;
  }
  return null;
}
function boardBus() {
  if (T.mode === 'bike') { toast('請先把 ubike 還到車站，再搭幸福巴士'); return; }
  const b = T.bus; T.mode = 'bus'; T.rideVeh = b; T.busFrom = b.route[b.k].name;
  avatar.g.visible = false; $('card').hidden = true; document.body.classList.remove('has-card');
  toast(`上車了：幸福巴士 往 ${busHeadingTo(b)}（${money(busFee())}）`);
}
function alight(stop) {
  const [x, z] = freeSpot(stop.x, stop.z); player.set(x, ground(x, z), z);
  avatar.g.visible = true; T.mode = 'walk'; T.rideVeh = null; T.fast = 1;
  const t = player.clone().add(new THREE.Vector3(0, 2.4, 0));
  tweenCamera(t.clone().add(new THREE.Vector3(Math.sin(heading) * -17, 11, -Math.cos(heading) * -17)), t, 900);
}
function leaveBus() {
  const b = T.bus, stop = b.route[b.k];
  saveRecord('bus', { from: T.busFrom, to: stop.name, fee: busFee() });
  alight(stop); toast(`在「${stop.name}」下車，謝謝搭乘卓溪幸福巴士`);
}

/* ---------- 預約制轎車 ---------- */
function saveBookings() { store.set('zf-bubu', T.bookings); }
function stopByName(n) { return T.stops.find(s => s.name === n); }
const carOf = b => T.cars.find(c => c.id === b.carId);
function dispatchCars(now) {
  for (const b of T.bookings.filter(x => x.status === 'booked').sort((a, c) => a.time - c.time)) {
    if (b.time < now - BUBU_RULES.waitMinutes * 60000) { b.status = 'expired'; saveBookings(); renderBubu(); continue; }
    const pick = stopByName(b.from), free = T.cars.filter(c => c.state === 'idle' || c.state === 'returning');
    const car = free.find(c => c.id === b.carId) || free.sort((a, c) => Math.abs(a.s - pick.i) - Math.abs(c.s - pick.i))[0];
    if (!car) continue;
    if (now >= b.time - etaSeconds(car.s, pick.i) * 1000) { b.status = 'arriving'; b.carId = car.id; car.booking = b; car.target = pick.i; car.state = 'toPickup'; saveBookings(); renderBubu(); }
  }
}
function updateCars(dt) {
  const now = Date.now(); dispatchCars(now);
  for (const c of T.cars) {
    if (c.target != null) {
      const sp = BUBU_RULES.speed / SEG * dt * (T.rideVeh === c ? T.fast : 1), d = c.target - c.s;
      c.dir = Math.sign(d) || c.dir || 1;
      if (Math.abs(d) <= sp) { c.s = c.target; c.target = null; carArrive(c); } else c.s += Math.sign(d) * sp;
      placeVehicle(c);
    }
    if (c.state === 'waiting' && now - c.waitStart > BUBU_RULES.waitMinutes * 60000) {
      c.booking.status = 'expired'; c.booking = null; c.state = 'returning'; c.target = c.home; saveBookings(); renderBubu(); toast('預約轎車等候逾時，這筆預約已取消');
    }
  }
}
function carArrive(c) {
  const b = c.booking;
  if (c.state === 'toPickup') {
    c.state = 'waiting'; c.waitStart = Date.now(); b.status = 'waiting'; saveBookings(); renderBubu();
    toast(`${c.name}已到「${b.from}」，請在 ${BUBU_RULES.waitMinutes} 分鐘內上車`);
  } else if (c.state === 'riding') {
    b.status = 'done'; saveBookings();
    saveRecord('car', { from: b.from, to: b.to, people: b.people, fee: b.fee, name: b.name, car: c.name });
    c.state = 'returning'; c.booking = null; c.target = c.home;
    alight(stopByName(b.to)); renderBubu(); toast(`抵達「${b.to}」，謝謝搭乘卓溪幸福巴士`);
  } else if (c.state === 'returning') c.state = 'idle';
}
function boardCar(c) {
  const b = c.booking;
  if (T.mode === 'bike') { toast('請先把 ubike 還到車站，再上車'); return; }
  c.state = 'riding'; b.status = 'riding'; c.target = stopByName(b.to).i; T.mode = 'car'; T.rideVeh = c; saveBookings(); renderBubu();
  avatar.g.visible = false; $('card').hidden = true; document.body.classList.remove('has-card');
  toast(`坐上${c.name}，前往「${b.to}」`);
}
function cancelBooking(id) {
  const b = T.bookings.find(x => x.id === id); if (!b) return;
  const c = carOf(b);
  if (c && c.booking === b && c.state !== 'riding') { c.booking = null; c.state = 'returning'; c.target = c.home; }
  b.status = 'cancelled'; saveBookings(); renderBubu();
}

/* ---------- 面板 ---------- */
const STATUS = { booked: ['已預約', 'ok'], arriving: ['車子出發中', 'wait'], waiting: ['車子已到站', 'wait'], riding: ['乘車中', 'wait'], done: ['已完成', 'off'], cancelled: ['已取消', 'off'], expired: ['已逾時', 'off'] };
const fmtTime = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function renderUbike() {
  $('ubike-fare').innerHTML = FARES.ubike.free ? '<b>目前全面免費</b><span>未來可能改為每 30 分鐘計費，收費前會先公告。</span>' : `<b>每 ${FARES.ubike.unitMinutes} 分鐘 ${FARES.ubike.unitPrice} 元</b>`;
  const list = $('ubike-stations'); list.innerHTML = '';
  for (const s of T.stations) {
    const n = s.docks.filter(d => d.visible).length;
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="grow"><div></div><div class="sub">可借 ${n} 輛 · 空位 ${6 - n} 個</div></div><button type="button">前往</button>`;
    row.querySelector('.grow div').textContent = s.name;
    row.querySelector('button').addEventListener('click', () => { closeTransit(); teleport(s.x, s.z + 5); });
    list.appendChild(row);
  }
  const h = $('ubike-history'); h.innerHTML = '';
  const recs = store.get('zf-records', []).filter(r => r.kind === 'ubike').slice(0, 5);
  if (!recs.length) h.innerHTML = '<p class="empty">還沒有騎乘紀錄。</p>';
  for (const r of recs) { const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<div class="grow"><div></div><div class="sub"></div></div><span class="badge ok"></span>`; row.querySelector('.grow div').textContent = `${r.from} → ${r.to}`; row.querySelector('.sub').textContent = `${fmtTime(r.at)} · ${r.minutes} 分鐘 · ${r.meters} m`; row.querySelector('.badge').textContent = money(r.fee); h.appendChild(row); }
}
function renderBus() {
  $('bus-fare').innerHTML = FARES.bus.free ? `<b>目前免費</b><span>20 人座白色小巴，不用預約。小巴停在站上時，走過去就能上車。</span>` : `<b>每趟 ${FARES.bus.perRide} 元</b>`;
  const b = T.bus, list = $('bus-stops'); list.innerHTML = '';
  const loop = b.route.reduce((t, s, k) => k ? t + etaSeconds(b.route[k - 1].i, s.i, BUS_RULES.speed) : t, 0) * 2 + BUS_RULES.dwell * Math.max(0, b.route.length * 2 - 2);
  $('bus-loop').textContent = `沿主幹道依序停靠 ${b.route.length} 站，每站停 ${BUS_RULES.dwell} 秒，到端點折返；來回一趟約 ${Math.max(1, Math.round(loop / 60))} 分鐘。`;
  for (const st of b.route) {
    const eta = busEta(st.name), row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="grow"><div></div><div class="sub"></div></div><button type="button">去等車</button>`;
    row.querySelector('.grow div').textContent = st.name;
    row.querySelector('.sub').textContent = eta === 0 ? '小巴現在停在這一站' : eta == null ? '' : `下一班約 ${Math.max(1, Math.round(eta))} 秒後到`;
    row.querySelector('button').addEventListener('click', () => { closeTransit(); teleport(st.x, st.z); });
    list.appendChild(row);
  }
}
function renderBubu() {
  if (!$('bubu-from').options.length) {
    for (const id of ['bubu-from', 'bubu-to']) for (const s of T.stops) $(id).add(new Option(s.name, s.name));
    $('bubu-to').selectedIndex = Math.min(2, T.stops.length - 1);
    for (let k = 1; k <= BUBU_RULES.maxPassengers; k++) $('bubu-people').add(new Option(k + ' 人', k));
    resetTime();
  }
  $('bubu-fare').innerHTML = (FARES.bubu.free ? `<b>目前免費</b>` : `<b>每人每趟 ${FARES.bubu.perPerson} 元</b>`) + `<span>私人轎車，需事先預約，最晚出發前 ${BUBU_RULES.minAdvanceMin} 分鐘。目前有${T.cars.map(c => c.name).join('、')}。</span>`;
  const list = $('bubu-list'); list.innerHTML = '';
  const items = T.bookings.slice().sort((a, b) => b.time - a.time).slice(0, 8);
  if (!items.length) list.innerHTML = '<p class="empty">還沒有預約。填好上面的表單就能預約轎車。</p>';
  for (const b of items) {
    const [label, cls] = STATUS[b.status];
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="grow"><div></div><div class="sub"></div></div><span class="badge ${cls}">${label}</span>`;
    row.querySelector('.grow div').textContent = `${b.from} → ${b.to}`;
    row.querySelector('.sub').textContent = `${fmtTime(b.time)} · ${b.name} · ${b.people} 人 · ${money(b.fee)}${carOf(b) ? ' · ' + carOf(b).name : ''}`;
    if (['booked', 'arriving', 'waiting'].includes(b.status)) {
      const go = document.createElement('button'); go.type = 'button'; go.textContent = '去等車';
      go.addEventListener('click', () => { const s = stopByName(b.from); closeTransit(); teleport(s.x, s.z); });
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '取消';
      x.addEventListener('click', () => cancelBooking(b.id));
      row.append(go, x);
    }
    list.appendChild(row);
  }
}
function resetTime() {
  const d = new Date(Date.now() + 5 * 60000); d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('bubu-time').value = local;
  const mn = new Date(Date.now() + BUBU_RULES.minAdvanceMin * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('bubu-time').min = mn;
}
$('bubu-form').addEventListener('submit', e => {
  e.preventDefault();
  const err = $('bubu-err'), name = $('bubu-name').value.trim(), from = $('bubu-from').value, to = $('bubu-to').value;
  const people = +$('bubu-people').value, time = new Date($('bubu-time').value).getTime();
  if (!name) { err.textContent = '請填寫乘客姓名'; $('bubu-name').focus(); return; }
  if (from === to) { err.textContent = '上車站和下車站不能相同'; return; }
  if (!time || isNaN(time)) { err.textContent = '請選擇出發時間'; return; }
  if (time < Date.now() + BUBU_RULES.minAdvanceMin * 60000 - 30000) { err.textContent = `請至少提前 ${BUBU_RULES.minAdvanceMin} 分鐘登記`; return; }
  if (T.bookings.filter(b => ['booked', 'arriving', 'waiting'].includes(b.status) && Math.abs(b.time - time) < 10 * 60000).length >= T.cars.length) { err.textContent = '這個時段的轎車都被預約了，請換個時間或改搭定時小巴'; return; }
  err.textContent = '';
  const b = { id: Date.now().toString(36), name, from, to, people, time, fee: bubuFee(people), status: 'booked', createdAt: Date.now() };
  T.bookings.push(b); saveBookings(); saveRecord('bubu-booking', { from, to, people, time });
  store.set('zf-name', name);
  resetTime(); renderBubu();
  toast(`預約完成：${fmtTime(time)} 從「${from}」出發`);
});
['bubu-name', 'bubu-from', 'bubu-to', 'bubu-time'].forEach(id => $(id).addEventListener('input', () => { $('bubu-err').textContent = ''; }));
function showTab(t) {
  for (const k of ['ubike', 'bus', 'bubu']) { $('tab-' + k).setAttribute('aria-selected', String(k === t)); $('pane-' + k).hidden = k !== t; }
  if (t === 'ubike') renderUbike(); else if (t === 'bus') renderBus(); else renderBubu();
}
$('tab-ubike').addEventListener('click', () => showTab('ubike'));
$('tab-bus').addEventListener('click', () => showTab('bus'));
$('tab-bubu').addEventListener('click', () => showTab('bubu'));
function openTransit(tab) { closePanel(); $('transit').hidden = false; $('btn-transit').setAttribute('aria-expanded', 'true'); const n = store.get('zf-name', ''); if (n && !$('bubu-name').value) $('bubu-name').value = n; showTab(tab || (!$('pane-bus').hidden ? 'bus' : !$('pane-bubu').hidden ? 'bubu' : 'ubike')); if (!T.busTimer) T.busTimer = setInterval(() => { if (!$('transit').hidden && !$('pane-bus').hidden) renderBus(); }, 1000); }
function closeTransit() { $('transit').hidden = true; $('btn-transit').setAttribute('aria-expanded', 'false'); }
$('btn-transit').addEventListener('click', () => ($('transit').hidden ? openTransit() : closeTransit()));
$('transit-close').addEventListener('click', closeTransit);

/* ---------- 互動按鈕與狀態列 ---------- */
let actionFn = null;
function setAction(text, fn, cls = '') {
  const el = $('action');
  if (!text) { if (!el.hidden) el.hidden = true; actionFn = null; return; }
  const kb = matchMedia('(pointer: coarse)').matches ? '' : ' <kbd>E</kbd>';
  const html = text + kb; if (el.innerHTML !== html) el.innerHTML = html;
  el.className = 'hud ' + cls; el.hidden = false; actionFn = fn;
}
$('action').addEventListener('click', () => actionFn && actionFn());
addEventListener('keydown', e => { if (!isTyping() && e.key.toLowerCase() === 'e' && actionFn) actionFn(); });
$('status-btn').addEventListener('click', () => { T.fast = T.fast === 1 ? 4 : 1; });
function updateTransitUI() {
  if (!started || bird) { setAction(null); return; }
  const b = T.bus, busStop = b.state === 'dwell' ? b.route[b.k] : null;
  if (T.mode === 'bus') {
    if (busStop) setAction(`在「${busStop.name}」下車`, leaveBus, 'bubu'); else setAction(null);
  } else if (T.mode === 'car') setAction(null);
  else {
    const stop = nearStop(), st = nearStation();
    const waitingCar = stop && T.cars.find(c => c.state === 'waiting' && c.booking.from === stop.name);
    if (waitingCar) setAction(`上車：${waitingCar.name} → ${waitingCar.booking.to}`, () => boardCar(waitingCar), 'bubu');
    else if (busStop && stop && stop.name === busStop.name && T.mode === 'walk') setAction(`搭幸福巴士 往 ${busHeadingTo(b)}`, boardBus, 'bubu');
    else if (st && T.mode === 'walk') setAction(`借 ubike（${FARES.ubike.free ? '免費' : '依時間計費'}）· ${st.name}`, () => rentBike(st));
    else if (st && T.mode === 'bike') setAction(`還車 · ${st.name}`, () => returnBike(st));
    else if (stop && T.mode === 'walk') setAction(`幸福巴士時刻 · ${stop.name}`, () => openTransit('bus'), 'bubu');
    else setAction(null);
  }
  const pill = $('status-pill'), btn = $('status-btn');
  const myCar = T.cars.find(c => c.booking && ['toPickup', 'waiting'].includes(c.state));
  if (T.mode === 'bike') {
    const s = Math.floor((Date.now() - T.riding.t0) / 1000);
    pill.className = 'hud'; pill.hidden = false; btn.hidden = true;
    $('status-text').innerHTML = `騎 ubike 中 · <b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b> · ${Math.round(T.riding.dist)} m · ${money(ubikeFee(s / 60))} · 到任一站還車`;
  } else if (T.mode === 'bus') {
    pill.className = 'hud bubu'; pill.hidden = false; btn.hidden = false; btn.textContent = T.fast === 1 ? '快轉 ×4' : '正常速度';
    $('status-text').innerHTML = busStop ? `幸福巴士停靠「${busStop.name}」· 可以下車` : `搭幸福巴士中 · 下一站 <b>${b.route[b.k].name}</b>`;
  } else if (T.mode === 'car') {
    const c = T.rideVeh, left = Math.round(Math.abs((c.target ?? c.s) - c.s) * SEG);
    pill.className = 'hud bubu'; pill.hidden = false; btn.hidden = false; btn.textContent = T.fast === 1 ? '快轉 ×4' : '正常速度';
    $('status-text').innerHTML = `${c.name} → ${c.booking.to} · 剩 <b>${left}</b> m`;
  } else if (myCar) {
    pill.className = 'hud bubu'; pill.hidden = false; btn.hidden = true;
    const eta = myCar.state === 'toPickup' ? Math.ceil(etaSeconds(myCar.s, myCar.target)) : 0;
    $('status-text').innerHTML = myCar.state === 'waiting' ? `${myCar.name}已到「${myCar.booking.from}」等你上車` : `${myCar.name}開往「${myCar.booking.from}」· 約 <b>${eta}</b> 秒後到`;
  } else pill.hidden = true;
}

/* ====================================================================
   啟動
   ==================================================================== */
const status = $('boot-status');
async function boot() {
  try { await Promise.race([document.fonts.load(`700 40px "Noto Sans TC"`), new Promise(r => setTimeout(r, 2500))]); } catch { /* 字型載入失敗時用系統字型 */ }
  status.textContent = '建立地形…';
  await new Promise(r => setTimeout(r, 30));
  terrainMesh = buildTerrain();
  buildWaterAndRoads();
  status.textContent = '蓋校園與部落…';
  await new Promise(r => setTimeout(r, 30));
  buildCampus();
  const nHouses = buildVillages();
  buildStops();
  scatterTrees();
  buildTrees();
  flushBatch();
  // 溪流地標
  {
    const mid = RIVER[Math.floor(RIVER.length * 0.42)];
    landmark({ name: '秀姑巒溪', area: '溪流', x: mid[0], z: mid[1], y: RIVER_WL[Math.floor(RIVER.length * 0.42)], kind: 'natural', labelH: 14, radius: 70, desc: '學區東側的大河。寬闊的礫石河床上，水道分岔又交會（辮狀河道），河水由南往北流。學校東方約 350–500 m 就是河床。' });
    const gf = CREEKS[0].pts[Math.floor(CREEKS[0].pts.length * 0.35)];
    landmark({ name: '古楓溪', area: '溪流', x: gf[0], z: gf[1], kind: 'natural', labelH: 10, radius: 22, desc: '從西側山谷流出，經過卓楓國小南方，向東匯入秀姑巒溪。' });
    const bd = CREEKS[1].pts[Math.floor(CREEKS[1].pts.length * 0.3)];
    landmark({ name: '白端北側支流', area: '溪流', x: bd[0], z: bd[1], kind: 'natural', labelH: 10, radius: 22, desc: '從白端部落北側的山谷流出，向東匯入秀姑巒溪。' });
    const g = LANDMARKS.filter(l => l.area === '古楓部落'), b = LANDMARKS.filter(l => l.area === '白端部落');
    const avg = arr => arr.reduce((s, l) => [s[0] + l.x / arr.length, s[1] + l.z / arr.length], [0, 0]);
    const [gx, gz] = avg(g), [bx, bz] = avg(b);
    landmark({ name: '古楓部落', area: '古楓部落', x: gx - 70, z: gz - 70, kind: 'area', labelH: 70, radius: 0, desc: '' });
    landmark({ name: '白端部落', area: '白端部落', x: bx - 30, z: bz - 20, kind: 'area', labelH: 45, radius: 0, desc: '' });
  }
  makeLabels(); buildMinimap(); updateProgress(); renderBubu(); initEditor();
  $('fact-count').textContent = DISCOVERABLE().length;
  window.__zfDebug = { roadHits: () => {
    const out = [];
    for (const o of OBST) {
      const pts = [];
      for (let a = -1; a <= 1; a += 0.25) for (let b = -1; b <= 1; b += 0.25) {
        const lx = a * (o.hw - 0.45), lz = b * (o.hd - 0.45);
        pts.push([o.x + lx * o.c + lz * o.s, o.z - lx * o.s + lz * o.c]);
      }
      let worst = 0;
      ALL_ROADS.forEach((r, k) => { const hw = k === 0 ? 3 : 2.2; for (const p of pts) { const d = distToPolyline(p[0], p[1], r).d; if (hw - d > worst) { worst = hw - d; o.rk = k; } } });
      if (worst > 0.3) out.push([o.x.toFixed(1), o.z.toFixed(1), worst.toFixed(1), o.rk]);
    }
    return out;
  }, T, placeVehicle, rentBike, boardCar, boardBus, leaveBus, setCam: (p, t) => { camTween = null; camera.position.set(...p); controls.target.set(...t); }, teleport, toggleBird, camera, controls, player, setHeading: h => { heading = h; } };
  window.__zf = { obstacles: OBST.length, houses: nHouses, trees: TREES.broad.length + TREES.conifer.length, landmarks: LANDMARKS.length };

  // 起點：校門口
  const [sx, sz] = fromPlan(-57, 47);
  player.set(sx, ground(sx, sz), sz);
  heading = Math.PI + RAD; // 面向圖面南方（走進校園）
  avatar.g = buildAvatar();
  camera.position.set(CENTER.x + 1200, 1300, CENTER.z + 1700); controls.target.copy(CENTER);
  status.textContent = '';
  $('boot-enter').disabled = false;
  $('hint').textContent = hintText();
  ready = true;
}
let ready = false, started = false, attract = 0;
$('boot-enter').addEventListener('click', () => {
  started = true; $('boot').hidden = true; document.body.classList.add('is-playing');
  const t = player.clone().add(new THREE.Vector3(0, 2.4, 0));
  tweenCamera(t.clone().add(new THREE.Vector3(Math.sin(heading) * -17, 11, -Math.cos(heading) * -17)), t, 1600);
});
$('boot-login').addEventListener('click', () => { $('login-note').hidden = !$('login-note').hidden; });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  const mm = $('minimap'); const cw = mm.clientWidth; mm.width = cw * 2; mm.height = Math.round(cw * 2 * NZ / NX);
}
addEventListener('resize', resize); resize();

const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3();
let walkT = 0, walkAmt = 0, lastNear = null, hudT = 0;
function frame() {
  requestAnimationFrame(frame);
  if (PAUSED) { clock.getDelta(); return; }
  const rawDt = clock.getDelta(), dt = Math.min(rawDt, 0.05);
  if (!ready) { renderer.render(scene, camera); return; }
  const now = performance.now();

  if (camTween) {
    const k = smooth(clamp((now - camTween.t0) / camTween.ms, 0, 1));
    camera.position.lerpVectors(camTween.fromP, camTween.toP, k); controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
    if (k >= 1) camTween = null;
  } else if (!started) {
    attract += dt * 0.05;
    camera.position.set(CENTER.x + Math.sin(attract) * 1900, 1250, CENTER.z + Math.cos(attract) * 1900);
    controls.target.copy(CENTER);
  }

  // 移動
  let ix = 0, iz = 0;
  if (keys.has('w') || keys.has('arrowup')) iz += 1;
  if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  ix += joy.x; iz += -joy.y;
  const mag = Math.min(1, Math.hypot(ix, iz));
  const g = avatar.g;
  if (started && !bird && mag > 0.08 && !camTween && !T.rideVeh) {
    fwd.subVectors(controls.target, camera.position).setY(0).normalize();
    right.crossVectors(fwd, camera.up).normalize();
    mv.copy(fwd).multiplyScalar(iz).addScaledVector(right, ix).normalize();
    const fastKey = running || keys.has('shift');
    const speed = (T.mode === 'bike' ? (fastKey ? 26 : 16) : (fastKey ? 14 : 6)) * mag;
    const nz = clamp(player.z + mv.z * speed * dt, Z0 + 12, ZMAX - 12), nx = clamp(player.x + mv.x * speed * dt, X0 + 12, riverX(nz) - 3);
    let tx = nx, tz = nz;
    if (blocked(tx, tz)) { if (!blocked(nx, player.z)) tz = player.z; else if (!blocked(player.x, nz)) tx = player.x; else { tx = player.x; tz = player.z; } }
    if (campusDist(tx, tz) <= 0 && campusDist(player.x, player.z) <= 0 && Math.abs(ground(tx, tz) - player.y) > 0.5) {
      if (Math.abs(ground(tx, player.z) - player.y) <= 0.5 && !blocked(tx, player.z)) tz = player.z;
      else if (Math.abs(ground(player.x, tz) - player.y) <= 0.5 && !blocked(player.x, tz)) tx = player.x;
      else { tx = player.x; tz = player.z; }
    }
    const ny = ground(tx, tz);
    const delta = new THREE.Vector3(tx - player.x, ny - player.y, tz - player.z);
    player.set(tx, ny, tz);
    camera.position.add(delta); controls.target.add(delta);
    const targetHeading = Math.atan2(mv.x, -mv.z);
    let dh = targetHeading - heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    heading += dh * Math.min(1, dt * 12);
    if (T.mode === 'bike') T.riding.dist += Math.hypot(delta.x, delta.z);
    walkT += dt * (T.mode === 'bike' ? speed * 0.9 : (fastKey ? 11 : 8.5) * mag);
  }
  if (g) {
    g.position.copy(player); g.rotation.y = -heading + Math.PI;
    const moving = started && !bird && mag > 0.08 && !camTween;
    walkAmt += ((moving ? 1 : 0) - walkAmt) * Math.min(1, dt * 8);
    if (T.mode === 'bike') animateRider(g, walkT, walkAmt, now);
    else { g.userData.body.position.y = 0; animateAvatar(g, walkT, walkAmt, running || keys.has('shift'), now); }
    g.userData.ring.material.opacity = 0.55 + Math.sin(now / 300) * 0.3;
    const s = bird ? 12 : 1.3; g.scale.setScalar(s);
  }

  // 愛心專車
  if (T.bus) {
    const rv = T.rideVeh, before = rv ? rv.mesh.position.clone() : null, vdt = Math.min(rawDt, 0.5);
    updateBus(vdt); updateCars(vdt);
    if (rv) {
      const d = rv.mesh.position.clone().sub(before);
      player.copy(rv.mesh.position);
      camera.position.add(d); controls.target.copy(rv.mesh.position).add(new THREE.Vector3(0, 2.2, 0));
    }
  }
  updateTransitUI();

  // 陰影跟隨
  const focus = bird ? controls.target : player;
  sun.target.position.copy(focus); sun.position.copy(focus).add(SUN_OFF); sun.target.updateMatrixWorld();

  controls.update();
  if (!bird && !camTween && started) {
    // 鏡頭不鑽入地面
    const gy = ground(camera.position.x, camera.position.z) + 2.5;
    if (camera.position.y < gy) camera.position.y = gy;
  }
  const far = bird || !started; scene.fog.near = far ? 2500 : 700; scene.fog.far = far ? 9000 : 4200;

  // 接近地標
  if (started && !bird && !T.rideVeh) {
    let best = null, bd = Infinity;
    for (const L of LANDMARKS) {
      if (L.kind === 'area') continue;
      const d = Math.hypot(L.x - player.x, L.z - player.z);
      if (d < L.radius && d < bd) { best = L; bd = d; }
    }
    if (!best && lastNear && cardAuto) { $('card').hidden = true; document.body.classList.remove('has-card'); cardFor = null; }
    if (best && best !== lastNear) {
      openCard(best, true);
      if (!found.has(best.name)) { found.add(best.name); store.set('zf-found', [...found]); updateProgress(); toast(`發現新地點：${best.name}`); }
    }
    lastNear = best;
  }

  camera.updateMatrixWorld();
  updateLabels();
  hudT += dt;
  if (hudT > 0.12) {
    hudT = 0;
    $('elev').textContent = Math.round(realElev(player.x, player.z));
    $('where').textContent = areaName(player.x, player.z);
    $('dist').textContent = Math.round(Math.hypot(player.x, player.z));
    const cd = new THREE.Vector3().subVectors(controls.target, camera.position);
    const camHeading = Math.atan2(cd.x, -cd.z);
    $('compass-needle').style.transform = `rotate(${-camHeading}rad)`;
    drawMinimap(player, heading);
  }
  renderer.render(scene, camera);
}
boot().then(() => { requestAnimationFrame(frame); }).catch(err => { status.textContent = '載入失敗：' + err.message; console.error(err); });
