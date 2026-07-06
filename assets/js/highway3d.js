/* TX Highway 3D — cinematic night edition.
 * Physically-based night scene: PMREM environment reflections, ACES tone
 * mapping, UnrealBloom over emissive headlights/stripes/LED gantries, soft
 * directional shadows, instanced multi-part vehicles (paint / glass /
 * chrome / tires / lights / beams), guardrails, concrete median, glowing
 * light poles, layered low-poly trees, city-glow horizon.
 * Same live data layer as the classic site; DEMO mode drives a labeled
 * simulated feed for guaranteed-busy traffic.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const U = window.TXH.util;
const CFG = window.TXH.config;

/* ---------- layout constants ---------- */

const Z_SPAWN = -185;
const Z_GONE = 54;
const Z_GANTRY = 6;
const ROAD_HALF_W = 6.6;
const ROAD_X = { btc: -10.6, eth: 10.6 };
const LANE_OFF = [-4.95, -1.65, 1.65, 4.95];
const RUN = Z_GONE - Z_SPAWN;
const AGG_USD = 1000;

const CAR_COLORS = [0xb8202e, 0xe8e8ea, 0x14161a, 0xb9bec7, 0x1f4fbf, 0x2e6b3d, 0x6b1fbf, 0xd07000];
const GOLD = 0xf2b01e;

/* ---------- renderer / scene / camera ---------- */

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b16);
scene.fog = new THREE.FogExp2(0x0a0f1e, 0.0085);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700);
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* environment reflections for car paint & chrome */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

/* lighting: cool moonlight key + dim sky bounce */
scene.add(new THREE.HemisphereLight(0x36466e, 0x0a0d14, 0.8));
const moon = new THREE.DirectionalLight(0xbdd4ff, 1.4);
moon.position.set(-55, 80, -30);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -45; moon.shadow.camera.right = 45;
moon.shadow.camera.top = 40; moon.shadow.camera.bottom = -120;
moon.shadow.camera.far = 260;
moon.shadow.bias = -0.0006;
scene.add(moon);

/* post: bloom is what sells the night look */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.87);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- small helpers ---------- */

function mergeGeos(list) {
  // list: [{geo, x,y,z, rx,ry,rz, sx,sy,sz}] -> one non-indexed geometry
  const pos = [], nor = [], uv = [];
  const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const it of list) {
    const g = it.geo.toNonIndexed();
    e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    q.setFromEuler(e);
    s.set(it.sx || 1, it.sy || 1, it.sz || 1);
    m.compose(new THREE.Vector3(it.x || 0, it.y || 0, it.z || 0), q, s);
    g.applyMatrix4(m);
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    g.dispose();
    if (g !== it.geo) it.geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (r1, r2, h, seg) => new THREE.CylinderGeometry(r1, r2, h, seg || 14);

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/* ---------- world materials ---------- */

const M = {
  // wet-look night asphalt: low roughness picks up stripe + light reflections
  asphalt: new THREE.MeshStandardMaterial({ color: 0x191b20, roughness: 0.55, metalness: 0.08, envMapIntensity: 0.55 }),
  ground: new THREE.MeshStandardMaterial({ color: 0x0d1610, roughness: 1 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x585c63, roughness: 0.85 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x8d949e, roughness: 0.35, metalness: 0.85 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.6 }),
  dash: new THREE.MeshStandardMaterial({ color: 0xa9abb2, roughness: 0.6, emissive: 0x84868f, emissiveIntensity: 0.12 }),
  mountain: new THREE.MeshStandardMaterial({ color: 0x0b1222, roughness: 1, flatShading: true, fog: false }),
  stripeBtc: new THREE.MeshStandardMaterial({ color: 0x30190a, emissive: 0xff8a00, emissiveIntensity: 1.05 }),
  stripeEth: new THREE.MeshStandardMaterial({ color: 0x0c1230, emissive: 0x3f6cff, emissiveIntensity: 1.05 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffc37a, emissiveIntensity: 2.3 }),
  treeLeaf: new THREE.MeshStandardMaterial({ color: 0x14351f, roughness: 0.95, flatShading: true }),
  treeLeaf2: new THREE.MeshStandardMaterial({ color: 0x1c4527, roughness: 0.95, flatShading: true }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x3a2b1c, roughness: 1 })
};

/* ---------- static world ---------- */

function addMerged(list, material, opts) {
  const mesh = new THREE.Mesh(mergeGeos(list), material);
  if (opts && opts.shadow) mesh.castShadow = true;
  if (opts && opts.receive) mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 760), M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.06, -140);
  ground.receiveShadow = true;
  scene.add(ground);

  const slabs = [], dashes = [], btcStripes = [], ethStripes = [], rails = [], concrete = [];
  for (const chain of ['btc', 'eth']) {
    const cx = ROAD_X[chain];
    slabs.push({ geo: B(ROAD_HALF_W * 2 + 1.6, 0.12, 280), x: cx, y: 0, z: -85 });
    // edge lines
    for (const sx of [-ROAD_HALF_W, ROAD_HALF_W]) {
      dashes.push({ geo: B(0.2, 0.13, 280), x: cx + sx, y: 0.015, z: -85 });
    }
    // glowing chain stripes on the outer shoulders
    const target = chain === 'btc' ? btcStripes : ethStripes;
    for (const sx of [-(ROAD_HALF_W + 0.6), ROAD_HALF_W + 0.6]) {
      target.push({ geo: B(0.42, 0.14, 280), x: cx + sx, y: 0.012, z: -85 });
    }
    // dashed lane separators
    for (let li = 0; li < LANE_OFF.length - 1; li++) {
      const lx = cx + (LANE_OFF[li] + LANE_OFF[li + 1]) / 2;
      for (let z = -215; z < 52; z += 9) {
        dashes.push({ geo: B(0.15, 0.13, 3.2), x: lx, y: 0.02, z });
      }
    }
    // guardrails on the outer edge: posts + w-beam
    const rx = cx + Math.sign(cx) * (ROAD_HALF_W + 1.7);
    rails.push({ geo: B(0.09, 0.34, 274), x: rx, y: 0.72, z: -85 });
    for (let z = -215; z < 50; z += 8) {
      rails.push({ geo: B(0.14, 0.72, 0.14), x: rx, y: 0.36, z });
    }
  }
  // concrete median barrier between the two highways
  concrete.push({ geo: B(1.15, 0.55, 280), x: 0, y: 0.27, z: -85 });
  concrete.push({ geo: B(0.7, 0.5, 280), x: 0, y: 0.78, z: -85 });

  addMerged(slabs, M.asphalt, { receive: true });
  addMerged(dashes, M.dash);
  addMerged(btcStripes, M.stripeBtc);
  addMerged(ethStripes, M.stripeEth);
  addMerged(rails, M.rail, { shadow: true });
  addMerged(concrete, M.concrete, { shadow: true, receive: true });

  buildTrees();
  buildLightPoles();
  buildSkyDressing();
}

function buildTrees() {
  const leaf = [], leaf2 = [], trunks = [];
  for (let i = 0; i < 64; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (23 + Math.random() * 60);
    const z = -230 + Math.random() * 270;
    const h = 4 + Math.random() * 5;
    trunks.push({ geo: CYL(0.16, 0.24, h * 0.5, 6), x, y: h * 0.25, z });
    const blobs = 3 + ((Math.random() * 2) | 0);
    for (let bi = 0; bi < blobs; bi++) {
      const r = (h * 0.34) * (1 - bi * 0.2);
      const target = (bi % 2) ? leaf2 : leaf;
      target.push({
        geo: new THREE.IcosahedronGeometry(r, 0),
        x: x + (Math.random() - 0.5) * r * 0.7,
        y: h * 0.42 + bi * r * 0.85,
        z: z + (Math.random() - 0.5) * r * 0.7,
        ry: Math.random() * 3
      });
    }
  }
  // median bushes
  for (let z = -210; z < 40; z += 23) {
    (Math.random() < 0.5 ? leaf : leaf2).push({
      geo: new THREE.IcosahedronGeometry(0.55 + Math.random() * 0.3, 0),
      x: (Math.random() - 0.5) * 0.5, y: 0.45, z, ry: Math.random() * 3
    });
  }
  addMerged(leaf, M.treeLeaf, { shadow: true });
  addMerged(leaf2, M.treeLeaf2, { shadow: true });
  addMerged(trunks, M.trunk);
}

function buildLightPoles() {
  const poles = [], lamps = [], pools = [];
  const poolTex = radialTexture('rgba(255,190,110,.28)', 'rgba(255,190,110,0)');
  for (const chain of ['btc', 'eth']) {
    const cx = ROAD_X[chain];
    const side = Math.sign(cx);
    for (let z = -200; z < 40; z += 34) {
      const px = cx + side * (ROAD_HALF_W + 2.6);
      poles.push({ geo: CYL(0.09, 0.13, 7.6, 8), x: px, y: 3.8, z });
      poles.push({ geo: B(2.6, 0.12, 0.12), x: px - side * 1.2, y: 7.55, z });
      lamps.push({ geo: B(0.55, 0.16, 0.3), x: px - side * 2.4, y: 7.46, z });
      pools.push({ x: px - side * 2.4, z });
    }
  }
  addMerged(poles, M.pole, { shadow: true });
  addMerged(lamps, M.lamp);
  // soft light pools on the asphalt under each lamp (additive decals)
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const poolGeo = new THREE.PlaneGeometry(7.5, 10);
  for (const p of pools) {
    const m = new THREE.Mesh(poolGeo, poolMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.03, p.z);
    scene.add(m);
  }
  // a handful of real point lights near the camera for actual illumination
  for (const p of pools.filter((pp) => pp.z > -50)) {
    const pl = new THREE.PointLight(0xffbe6e, 14, 26, 2);
    pl.position.set(p.x, 7.2, p.z);
    scene.add(pl);
  }
}

function buildSkyDressing() {
  // faint city glow hugging the horizon
  const glowTex = radialTexture('rgba(96,130,255,.13)', 'rgba(96,130,255,0)');
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 70),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  glow.position.set(0, 8, -330);
  scene.add(glow);
  // distant mountain silhouettes for horizon depth
  const mtns = [];
  for (let i = 0; i < 9; i++) {
    const x = -260 + i * 62 + (Math.random() - 0.5) * 30;
    const h = 26 + Math.random() * 42;
    mtns.push({ geo: new THREE.ConeGeometry(34 + Math.random() * 26, h, 5), x, y: h / 2 - 4, z: -300 - Math.random() * 25, ry: Math.random() * 3 });
  }
  addMerged(mtns, M.mountain);
  // stars
  const N = 320, sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    sp[i * 3] = (Math.random() - 0.5) * 700;
    sp[i * 3 + 1] = 40 + Math.random() * 220;
    sp[i * 3 + 2] = -330 - Math.random() * 60;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.9, fog: false, transparent: true, opacity: 0.8 })));
  // moon
  const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(235,242,255,1)', 'rgba(235,242,255,0)'), fog: false, transparent: true
  }));
  moonSpr.scale.set(26, 26, 1);
  moonSpr.position.set(-120, 120, -320);
  scene.add(moonSpr);
}

/* ---------- LED gantries: big three-row telemetry boards ---------- */

const gantry = {};
function buildGantries() {
  const steel = [];
  for (const chain of ['btc', 'eth']) {
    const cx = ROAD_X[chain];
    const px = ROAD_HALF_W + 1.5;
    for (const sx of [-px, px]) {
      steel.push({ geo: B(0.46, 9.6, 0.46), x: cx + sx, y: 4.8, z: Z_GANTRY });
    }
    steel.push({ geo: B(px * 2 + 0.7, 0.5, 0.5), x: cx, y: 9.4, z: Z_GANTRY });
  }
  addMerged(steel, M.pole, { shadow: true });
  for (const chain of ['btc', 'eth']) {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 400;
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x050607, emissive: 0xffffff, emissiveIntensity: 0.92, emissiveMap: tex, roughness: 0.6
    });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(11.4, 3.4, 0.3), mat);
    panel.position.set(ROAD_X[chain], 7.1, Z_GANTRY);
    scene.add(panel);
    // chain-colored glow washing the asphalt under the board
    const glowC = chain === 'btc' ? 'rgba(255,160,30,.14)' : 'rgba(90,140,255,.16)';
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 11),
      new THREE.MeshBasicMaterial({ map: radialTexture(glowC, 'rgba(0,0,0,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(ROAD_X[chain], 0.045, Z_GANTRY - 1);
    scene.add(pool);
    gantry[chain] = { canvas: c, ctx: c.getContext('2d'), tex, mat, panel, flash: 0, msgIdx: 0 };
    // block shockwave ring expanding across the asphalt from the gantry
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.3, 48),
      new THREE.MeshBasicMaterial({
        color: chain === 'btc' ? 0xffb041 : 0x6f9dff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(ROAD_X[chain], 0.07, Z_GANTRY - 1);
    ring.visible = false;
    scene.add(ring);
    gantry[chain].ring = ring;
    gantry[chain].ringLife = 0;
  }
  renderBoards();
}

/* shrink font until the line fits — board text can never overflow again */
function fitText(x, text, maxW, basePx, weight) {
  let px = basePx;
  do {
    x.font = (weight || '700') + ' ' + px + 'px "IBM Plex Mono", monospace';
    if (x.measureText(text).width <= maxW) break;
    px -= 3;
  } while (px > 16);
  return px;
}

function ledRow(x, text, y, color, basePx) {
  fitText(x, text, 1180, basePx);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  // crisp glyphs: light glow pass, then a hard core pass on top
  x.shadowColor = color;
  x.shadowBlur = 7;
  x.fillStyle = color;
  x.fillText(text, 640, y);
  x.shadowBlur = 0;
  x.fillText(text, 640, y);
}

function drawBoard(chain, rows, allColor) {
  const g = gantry[chain];
  const x = g.ctx;
  x.fillStyle = '#020303';
  x.fillRect(0, 0, 1280, 400);
  // LED dot grid
  x.fillStyle = 'rgba(255,255,255,.03)';
  for (let dy = 7; dy < 400; dy += 14) for (let dx = 7; dx < 1280; dx += 14) x.fillRect(dx, dy, 3.5, 3.5);
  const cMain = allColor || (chain === 'btc' ? '#ffb52e' : '#7fa8ff');
  const cDim = allColor || (chain === 'btc' ? '#e8c98a' : '#b9cdf2');
  const cAlt = allColor || (chain === 'btc' ? '#ffe08a' : '#8fd3ff');
  if (rows[0]) ledRow(x, rows[0], 80, cMain, 84);
  if (rows[1]) ledRow(x, rows[1], 202, cDim, 58);
  if (rows[2]) ledRow(x, rows[2], 322, cAlt, 52);
  g.tex.needsUpdate = true;
}

/* ---------- board data layer: 24h totals, block cadence, session ---------- */

const sess = {
  btc: { tx: 0, vol: 0, whales: 0, biggest: 0, blocks: 0 },
  eth: { tx: 0, vol: 0, whales: 0, biggest: 0, blocks: 0 }
};
const lastBlockAt = { btc: null, eth: null };
const daily = { btc: null, eth: null };
let btcAvgBlockMin = null;

function fetchBoardData() {
  fetch(CFG.endpoints.btcDailyTxs).then((r) => r.json()).then((j) => {
    const v = j && j.values;
    if (v && v.length) daily.btc = Math.round(v[v.length - 1].y);
  }).catch(() => {});
  fetch(CFG.endpoints.btcRecentBlocks).then((r) => r.json()).then((bs) => {
    if (bs && bs.length > 3) {
      if (!lastBlockAt.btc) lastBlockAt.btc = bs[0].timestamp * 1000;
      const span = bs[0].timestamp - bs[bs.length - 1].timestamp;
      btcAvgBlockMin = span / 60 / (bs.length - 1);
      if (!roads.btc.blockHeight) roads.btc.blockHeight = bs[0].height;
    }
  }).catch(() => {});
  const rpc = (method, params) => fetch(CFG.endpoints.ethHttpRPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
  }).then((r) => r.json()).then((j) => j.result);
  rpc('eth_blockNumber').then((tipHex) => {
    const tip = parseInt(tipHex, 16);
    if (!tip) return;
    return Promise.all([0, 900, 1800, 2700].map((o) =>
      rpc('eth_getBlockTransactionCountByNumber', ['0x' + (tip - o).toString(16)]).catch(() => null)
    )).then((counts) => {
      const ns = counts.filter((c) => c != null).map((c) => parseInt(c, 16) || 0);
      if (ns.length >= 2) daily.eth = Math.round(ns.reduce((a, b) => a + b, 0) / ns.length * 7170);
    });
  }).catch(() => {});
  setTimeout(fetchBoardData, 3600000);
}

function agoText(chain) {
  if (!lastBlockAt[chain]) return null;
  const s = Math.max(0, Math.round((Date.now() - lastBlockAt[chain]) / 1000));
  return s < 60 ? s + 'S AGO' : Math.floor(s / 60) + 'M ' + (s % 60) + 'S AGO';
}

function boardMessages(chain) {
  const out = [];
  const S = sess[chain];
  if (daily[chain]) out.push((chain === 'eth' ? '≈' : '') + U.fmtNum(daily[chain]).toUpperCase() + ' TX IN THE LAST 24H');
  if (chain === 'btc' && btcAvgBlockMin) out.push('AVG BLOCK ' + btcAvgBlockMin.toFixed(1) + ' MIN · ~' + Math.round(1440 / btcAvgBlockMin) + ' BLOCKS/DAY');
  if (chain === 'eth') out.push('12S SLOTS · ~7,170 BLOCKS/DAY');
  if (S.tx > 20) out.push('SESSION: ' + U.fmtNum(S.tx).toUpperCase() + ' TX · ' + U.fmtUsd(S.vol).toUpperCase() + ' CROSSED');
  if (S.biggest >= 1e6) out.push('BIGGEST WHALE THIS SESSION: ' + U.fmtUsd(S.biggest).toUpperCase());
  if (S.blocks > 0) out.push(S.blocks + ' BLOCK' + (S.blocks > 1 ? 'S' : '') + ' MINED WHILE YOU WATCHED');
  const ago = agoText(chain);
  if (ago) out.push('LAST BLOCK ' + ago);
  if (!out.length) out.push('WAITING ON NETWORK DATA');
  return out;
}

function renderBoards() {
  for (const chain of ['btc', 'eth']) {
    const g = gantry[chain];
    if (g.flash > 0) continue; // block flash owns the board
    const road = roads[chain];
    const rate = road.rate.length ? road.rate.reduce((a, b) => a + b, 0) / road.rate.length : 0;
    const name = chain === 'btc' ? 'BITCOIN' : 'ETHEREUM';
    const row1 = name + (road.blockHeight ? '  #' + road.blockHeight.toLocaleString('en-US') : '');
    let row2 = (rate < 10 ? rate.toFixed(1) : Math.round(rate)) + ' TX/S';
    try {
      if (chain === 'btc') {
        const st = window.TXH.btcFeed.stats();
        if (st.fastestFee != null) row2 += ' · FEE ' + st.fastestFee + ' SAT/VB';
        if (st.mempoolCount != null) row2 += ' · ' + U.fmtNum(st.mempoolCount).toUpperCase() + ' WAITING';
      } else {
        const st = window.TXH.ethFeed.stats();
        if (st.baseFeeGwei != null) row2 += ' · BASE ' + (st.baseFeeGwei < 1 ? st.baseFeeGwei.toFixed(2) : st.baseFeeGwei.toFixed(1)) + ' GWEI';
        if (st.gasUsedPct != null) row2 += ' · GAS ' + st.gasUsedPct + '%';
      }
    } catch (e) {}
    const msgs = boardMessages(chain);
    drawBoard(chain, [row1, row2, msgs[g.msgIdx % msgs.length]]);
  }
}

/* ---------- vehicle factory: multi-part instanced fleets ---------- */

const VMAT = {
  paint: new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.85, roughness: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.1
  }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0d1219, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.4 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.18, envMapIntensity: 1.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.9 }),
  head: new THREE.MeshStandardMaterial({ color: 0x201d10, emissive: 0xfff3c4, emissiveIntensity: 2.1 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x1c0806, emissive: 0xff2418, emissiveIntensity: 1.9 }),
  beam: new THREE.MeshBasicMaterial({
    color: 0x8f7a42, transparent: true, opacity: 0.011,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }),
  streak: new THREE.MeshBasicMaterial({
    color: 0xff2a1a, transparent: true, opacity: 0.2,
    blending: THREE.AdditiveBlending, depthWrite: false
  })
};

/* wheels: tire + chrome rim, axle at y=0 */
function wheels(parts, positions, r, w) {
  for (const [x, z] of positions) {
    parts.dark.push({ geo: CYL(r, r, w, 14), x, y: r, z, rz: Math.PI / 2 });
    parts.chrome.push({ geo: CYL(r * 0.55, r * 0.55, w + 0.04, 10), x, y: r, z, rz: Math.PI / 2 });
  }
}
function lights(parts, w, y, zFront, zRear, size) {
  const s = size || 0.16;
  for (const sx of [-w / 2 + 0.22, w / 2 - 0.22]) {
    parts.head.push({ geo: B(0.3, s, 0.1), x: sx, y, z: zFront });
    parts.tail.push({ geo: B(0.34, s * 0.9, 0.1), x: sx, y, z: zRear });
  }
  // headlight beams: short subtle cones pointing forward (+z)
  for (const sx of [-w / 2 + 0.22, w / 2 - 0.22]) {
    parts.beam.push({ geo: new THREE.ConeGeometry(0.72, 4.6, 8, 1, true), x: sx, y: y - 0.12, z: zFront + 2.3, rx: -Math.PI / 2 });
  }
  // long-exposure taillight streaks trailing behind
  for (const sx of [-w / 2 + 0.24, w / 2 - 0.24]) {
    parts.streak.push({ geo: B(0.3, 0.05, 3.4), x: sx, y: y - 0.02, z: zRear - 1.8 });
  }
}
const newParts = () => ({ paint: [], glass: [], chrome: [], dark: [], head: [], tail: [], beam: [], streak: [] });

const BUILDERS = {
  sedan(lo) { // lo=1 -> compact
    const L = lo ? 3.9 : 4.6, W = 1.78, p = newParts();
    p.paint.push({ geo: B(W, 0.5, L), y: 0.62 });
    p.paint.push({ geo: B(W - 0.06, 0.3, L * 0.94), y: 0.88 });
    p.paint.push({ geo: B(W - 0.34, 0.46, L * 0.48), y: 1.16, z: -L * 0.05 });
    p.glass.push({ geo: B(W - 0.42, 0.36, L * 0.5), y: 1.17, z: -L * 0.05 });
    p.chrome.push({ geo: B(W - 0.5, 0.09, 0.06), y: 0.62, z: L / 2 + 0.01 });
    wheels(p, [[-W / 2 + 0.12, L * 0.32], [W / 2 - 0.12, L * 0.32], [-W / 2 + 0.12, -L * 0.32], [W / 2 - 0.12, -L * 0.32]], 0.34, 0.24);
    lights(p, W, 0.68, L / 2, -L / 2, 0.15);
    return { p, len: L };
  },
  suv() {
    const L = 4.8, W = 1.92, p = newParts();
    p.paint.push({ geo: B(W, 0.72, L), y: 0.78 });
    p.paint.push({ geo: B(W - 0.1, 0.62, L * 0.72), y: 1.42, z: -L * 0.04 });
    p.glass.push({ geo: B(W - 0.34, 0.44, L * 0.7), y: 1.45, z: -L * 0.04 });
    p.dark.push({ geo: B(W + 0.06, 0.2, L * 0.98), y: 0.42 });
    wheels(p, [[-W / 2 + 0.1, L * 0.33], [W / 2 - 0.1, L * 0.33], [-W / 2 + 0.1, -L * 0.33], [W / 2 - 0.1, -L * 0.33]], 0.42, 0.28);
    lights(p, W, 0.88, L / 2, -L / 2, 0.18);
    return { p, len: L };
  },
  pickup() {
    const L = 5.2, W = 1.95, p = newParts();
    p.paint.push({ geo: B(W, 0.66, L), y: 0.76 });
    p.paint.push({ geo: B(W - 0.08, 0.66, L * 0.34), y: 1.42, z: L * 0.12 });
    p.glass.push({ geo: B(W - 0.32, 0.44, L * 0.32), y: 1.46, z: L * 0.12 });
    p.paint.push({ geo: B(W, 0.34, L * 0.42), y: 1.16, z: -L * 0.28 }); // bed walls
    p.dark.push({ geo: B(W - 0.3, 0.06, L * 0.4), y: 1.06, z: -L * 0.28 });
    wheels(p, [[-W / 2 + 0.1, L * 0.32], [W / 2 - 0.1, L * 0.32], [-W / 2 + 0.1, -L * 0.3], [W / 2 - 0.1, -L * 0.3]], 0.44, 0.3);
    lights(p, W, 0.86, L / 2, -L / 2, 0.17);
    return { p, len: L };
  },
  van() { // kei/courier van (pods)
    const L = 3.6, W = 1.62, p = newParts();
    p.paint.push({ geo: B(W, 1.28, L), y: 1.0 });
    p.glass.push({ geo: B(W - 0.26, 0.42, 0.1), y: 1.34, z: L / 2 - 0.03 });
    p.glass.push({ geo: B(0.08, 0.36, L * 0.5), x: W / 2 - 0.01, y: 1.34, z: 0 });
    p.glass.push({ geo: B(0.08, 0.36, L * 0.5), x: -W / 2 + 0.01, y: 1.34, z: 0 });
    wheels(p, [[-W / 2 + 0.1, L * 0.32], [W / 2 - 0.1, L * 0.32], [-W / 2 + 0.1, -L * 0.32], [W / 2 - 0.1, -L * 0.32]], 0.32, 0.24);
    lights(p, W, 0.72, L / 2, -L / 2, 0.15);
    return { p, len: L };
  },
  minibus() { // carpool shuttle
    const L = 5.9, W = 2.05, p = newParts();
    p.paint.push({ geo: B(W, 1.7, L), y: 1.2 });
    p.glass.push({ geo: B(W - 0.24, 0.5, 0.1), y: 1.66, z: L / 2 - 0.03 });
    for (const sx of [W / 2 - 0.01, -W / 2 + 0.01]) {
      for (let zi = -2; zi <= 2; zi++) {
        p.glass.push({ geo: B(0.08, 0.44, 0.78), x: sx, y: 1.6, z: zi * 1.05 });
      }
    }
    p.chrome.push({ geo: B(W - 0.4, 0.1, 0.08), y: 0.62, z: L / 2 + 0.02 });
    wheels(p, [[-W / 2 + 0.12, L * 0.34], [W / 2 - 0.12, L * 0.34], [-W / 2 + 0.12, -L * 0.34], [W / 2 - 0.12, -L * 0.34]], 0.42, 0.3);
    lights(p, W, 0.8, L / 2, -L / 2, 0.18);
    return { p, len: L };
  },
  semi(gold) {
    const L = gold ? 12.6 : 10.8, W = 2.45, p = newParts();
    const cabL = 2.7, trailL = L - cabL - 0.7;
    // tractor
    p.paint.push({ geo: B(W * 0.92, 1.6, cabL), y: 1.25, z: L / 2 - cabL / 2 });
    p.paint.push({ geo: B(W * 0.92, 0.9, cabL * 0.55), y: 2.5, z: L / 2 - cabL * 0.68 });
    p.glass.push({ geo: B(W * 0.8, 0.52, 0.1), y: 2.52, z: L / 2 - cabL * 0.42 });
    p.chrome.push({ geo: B(W * 0.8, 0.3, 0.14), y: 0.62, z: L / 2 + 0.04 }); // bumper
    p.chrome.push({ geo: CYL(0.1, 0.1, 1.5, 8), x: W * 0.34, y: 2.2, z: L / 2 - cabL - 0.05 }); // exhaust stack
    // trailer
    const tc = gold ? GOLD : 0xffffff; // painted via instance color anyway
    p.paint.push({ geo: B(W, 2.5, trailL), y: 1.95, z: -L / 2 + trailL / 2 });
    p.chrome.push({ geo: B(W + 0.05, 0.12, trailL), y: 3.14, z: -L / 2 + trailL / 2 });
    p.dark.push({ geo: B(W - 0.3, 0.5, trailL * 0.9), y: 0.5, z: -L / 2 + trailL / 2 });
    wheels(p, [
      [-W / 2 + 0.12, L / 2 - 0.85], [W / 2 - 0.12, L / 2 - 0.85],
      [-W / 2 + 0.12, -L / 2 + 0.9], [W / 2 - 0.12, -L / 2 + 0.9],
      [-W / 2 + 0.12, -L / 2 + 2.1], [W / 2 - 0.12, -L / 2 + 2.1]
    ], 0.5, 0.32);
    lights(p, W * 0.92, 0.95, L / 2 + 0.02, -L / 2, 0.2);
    return { p, len: L };
  }
};

/* type registry with instance capacity */
const TYPES = {
  compact: { build: () => BUILDERS.sedan(1), cap: 30 },
  sedan: { build: () => BUILDERS.sedan(0), cap: 30 },
  suv: { build: () => BUILDERS.suv(), cap: 20 },
  pickup: { build: () => BUILDERS.pickup(), cap: 16 },
  van: { build: () => BUILDERS.van(), cap: 18 },
  minibus: { build: () => BUILDERS.minibus(), cap: 14 },
  semi: { build: () => BUILDERS.semi(false), cap: 10 },
  whale: { build: () => BUILDERS.semi(true), cap: 4 }
};
const CLASS_TYPE = {
  pod: ['van'], bike: ['compact'], car: ['compact', 'sedan'], sedan: ['sedan'],
  truck: ['suv', 'pickup'], bus: ['minibus'], semi: ['semi'], whale: ['whale']
};

const fleets = {}; // type -> { meshes: {part: InstancedMesh}, free: [], len }
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

function buildFleets() {
  for (const [type, def] of Object.entries(TYPES)) {
    const { p, len } = def.build();
    const meshes = {};
    for (const [part, list] of Object.entries(p)) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(mergeGeos(list), VMAT[part], def.cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.userData.type = type;
      if (part === 'paint') im.castShadow = true;
      for (let i = 0; i < def.cap; i++) im.setMatrixAt(i, ZERO);
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      meshes[part] = im;
    }
    fleets[type] = { meshes, free: Array.from({ length: def.cap }, (_, i) => i).reverse(), len };
  }
}

/* ---------- traffic sim (ported semantics from the 2D engine) ---------- */

const roads = { btc: mkRoad('btc'), eth: mkRoad('eth') };
function mkRoad(chain) {
  return {
    chain, lanes: LANE_OFF.map(() => []), queue: [], batch: newBatch(),
    vehicles: [], surge: 0, blockHeight: null, rate: [], rateCur: 0
  };
}
function newBatch() { return { count: 0, totalUsd: 0, maxUsd: 0, calls: 0, age: 0, items: [] }; }

function laneOrderFor(band) {
  if (band === 'fast') return [0, 1, 2, 3];
  if (band === 'cheap') return [3, 2, 1, 0];
  return [1, 2, 0, 3];
}

function spawn(tx) {
  const road = roads[tx.chain];
  if (!road) return;
  const usd = tx.usd != null ? tx.usd : window.TXH.prices.usd(tx.chain, tx.value);
  if (usd != null) tx.usd = usd;
  road.rateCur++;
  const S = sess[tx.chain];
  S.tx++;
  if (usd) S.vol += usd;
  if (usd != null && usd >= 1e6) {
    S.whales++;
    if (usd > S.biggest) S.biggest = usd;
    whaleToast(tx.chain, usd);
  }
  if (usd == null || usd < AGG_USD) {
    const b = road.batch;
    b.count++; b.totalUsd += usd || 0;
    if ((usd || 0) > b.maxUsd) b.maxUsd = usd || 0;
    if (tx.isContractCall) b.calls++;
    if (b.items.length < 4) b.items.push(tx);
    return;
  }
  if (road.queue.length < 200) road.queue.push(tx);
}

function flushBatch(road) {
  const b = road.batch;
  if (b.count >= 4) {
    if (road.queue.length < 200) {
      road.queue.push({ chain: road.chain, isBatch: true, count: b.count, usd: b.totalUsd, maxUsd: b.maxUsd, calls: b.calls });
    }
  } else {
    for (const t of b.items) if (road.queue.length < 200) road.queue.push(t);
  }
  road.batch = newBatch();
}

function materialize(road, tx) {
  let cls;
  if (tx.isBatch) cls = { id: 'bus', label: 'carpool', crossSec: 13 };
  else cls = window.TXH.vehicles.classify(tx.usd, tx);
  let fast = false, cheap = false;
  if (tx.chain === 'btc' && tx.feeRate) {
    const going = window.TXH.btcFeed && window.TXH.btcFeed.stats().halfHourFee;
    if (going) { fast = tx.feeRate > going * 2; cheap = tx.feeRate < going * 0.7; }
  } else if (tx.chain === 'eth' && tx.gasPriceGwei) {
    const base = window.TXH.ethFeed && window.TXH.ethFeed.stats().baseFeeGwei;
    if (base) { fast = tx.gasPriceGwei > base * 2.5; cheap = tx.gasPriceGwei < base * 1.02; }
  }
  const band = tx.isBatch || cheap ? 'cheap' : (fast ? 'fast' : 'mid');
  const typeOpts = CLASS_TYPE[cls.id] || CLASS_TYPE.car;
  const type = typeOpts[(Math.random() * typeOpts.length) | 0];
  const fleet = fleets[type];
  if (!fleet.free.length) return false;
  const len = fleet.len, gap = 3.4 + len * 0.42;
  let laneIdx = -1, z = Z_SPAWN - Math.random() * 8;
  for (const li of laneOrderFor(band)) {
    const list = road.lanes[li];
    const tail = list[list.length - 1];
    if (!tail || tail.z - tail.len / 2 > Z_SPAWN + len + gap) { laneIdx = li; break; }
  }
  if (laneIdx === -1) return false;
  const tail = road.lanes[laneIdx][road.lanes[laneIdx].length - 1];
  if (tail) z = Math.min(z, tail.z - gap - len);
  const slot = fleet.free.pop();
  // paint color: whales gold, semis white/steel, everyone else car colors
  let color;
  if (cls.id === 'whale') color = GOLD;
  else if (type === 'semi') color = [0xdcdfe4, 0x27436e, 0x6e2727, 0x2c2f34][(Math.random() * 4) | 0];
  else color = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
  const paint = fleet.meshes.paint;
  paint.setColorAt(slot, tmpC.set(color));
  if (paint.instanceColor) paint.instanceColor.needsUpdate = true;
  const v = {
    tx, cls, type, slot,
    x: ROAD_X[road.chain] + LANE_OFF[laneIdx] + (Math.random() - 0.5) * 0.26,
    z, len, gap, laneIdx,
    speed: RUN / (cls.crossSec * (0.92 + Math.random() * 0.2)) * (fast ? 1.15 : cheap ? 0.88 : 1),
    badge: null
  };
  if (cls.id === 'whale') {
    v.badge = whaleMarker(road.chain, tx.usd || 0);
    // golden underglow rolling with the rig (whale fleet caps at 4 lights)
    v.light = new THREE.PointLight(0xffc24d, 9, 17, 2);
    scene.add(v.light);
  }
  if (tx.isBatch) {
    const bc = document.createElement('canvas');
    bc.width = 256; bc.height = 96;
    const bx = bc.getContext('2d');
    bx.fillStyle = 'rgba(10,12,16,.78)';
    bx.beginPath();
    bx.roundRect(28, 12, 200, 72, 22);
    bx.fill();
    bx.strokeStyle = 'rgba(255,255,255,.7)';
    bx.lineWidth = 4;
    bx.stroke();
    bx.font = '700 44px "IBM Plex Mono", monospace';
    bx.textAlign = 'center'; bx.textBaseline = 'middle';
    bx.fillStyle = '#fff';
    bx.fillText('×' + tx.count, 128, 50);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(bc), depthTest: false, transparent: true }));
    sp.scale.set(2.9, 1.1, 1);
    scene.add(sp);
    v.badge = sp;
  }
  road.lanes[laneIdx].push(v);
  road.vehicles.push(v);
  return true;
}

function despawn(road, v) {
  const fleet = fleets[v.type];
  for (const im of Object.values(fleet.meshes)) {
    im.setMatrixAt(v.slot, ZERO);
    im.instanceMatrix.needsUpdate = true;
  }
  fleet.free.push(v.slot);
  if (v.badge) {
    scene.remove(v.badge);
    v.badge.material.map.dispose();
    v.badge.material.dispose();
  }
  if (v.light) scene.remove(v.light);
  const li = road.lanes[v.laneIdx], i = li.indexOf(v);
  if (i !== -1) li.splice(i, 1);
  const j = road.vehicles.indexOf(v);
  if (j !== -1) road.vehicles.splice(j, 1);
}

/* ---------- events: blocks, whales, confetti ---------- */

const confetti = {};
function mkConfetti(chain) {
  const N = 150;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.5, color: chain === 'btc' ? 0xffb52e : 0x7fa8ff,
    transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  pts.visible = false;
  scene.add(pts);
  confetti[chain] = { pts, vel: new Float32Array(N * 3), life: 0, N };
}

function blockPulse(chain, height) {
  const road = roads[chain];
  road.surge = 1;
  if (height) road.blockHeight = height;
  sess[chain].blocks++;
  lastBlockAt[chain] = Date.now();
  gantry[chain].flash = 1;
  gantry[chain].ringLife = 1;
  drawBoard(chain, [
    'BLOCK MINED',
    height ? '#' + Number(height).toLocaleString('en-US') : (chain === 'btc' ? 'BITCOIN' : 'ETHEREUM'),
    'SEALED — GATE OPEN, ROLL THROUGH'
  ], '#41ff8a');
  const c = confetti[chain];
  const p = c.pts.geometry.getAttribute('position');
  for (let i = 0; i < c.N; i++) {
    p.setXYZ(i, ROAD_X[chain] + (Math.random() - 0.5) * 11, 6.2 + Math.random() * 1.6, Z_GANTRY + (Math.random() - 0.5) * 2);
    c.vel[i * 3] = (Math.random() - 0.5) * 8;
    c.vel[i * 3 + 1] = 2.5 + Math.random() * 5.5;
    c.vel[i * 3 + 2] = (Math.random() - 0.5) * 8;
  }
  p.needsUpdate = true;
  c.life = 1;
  c.pts.visible = !reduced;
  try { window.TXH.sound.play('block'); } catch (e) {}
}

let toastT = null;
function whaleToast(chain, usd) {
  const el = document.getElementById('toast3');
  el.textContent = U.fmtUsd(usd) + ' WHALE — ' + (chain === 'btc' ? 'BITCOIN' : 'ETHEREUM') + ' HIGHWAY';
  el.className = 'toast3 t-' + chain;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 5200);
  bloom.strength = 1.2; // brief glow swell, eased back in the loop
  // the camera glances toward the whale's road for a few seconds
  focusX = ROAD_X[chain] * 0.55;
  focusUntil = simT + 4.5;
  try { window.TXH.sound.play('whale'); } catch (e) {}
}
let focusX = 0, focusUntil = 0, lookX = 0;

/* floating chain-colored marker that rides above the whale rig */
function whaleMarker(chain, usd) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 200;
  const x = c.getContext('2d');
  const col = chain === 'btc' ? '#ffb52e' : '#7fa8ff';
  x.fillStyle = 'rgba(8,10,14,.85)';
  x.beginPath();
  x.roundRect(20, 16, 280, 96, 26);
  x.fill();
  x.strokeStyle = col;
  x.lineWidth = 7;
  x.stroke();
  const label = 'WHALE ' + U.fmtUsd(usd);
  let px = 52;
  do {
    x.font = '700 ' + px + 'px "IBM Plex Mono", monospace';
    if (x.measureText(label).width <= 252) break;
    px -= 3;
  } while (px > 20);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = col;
  x.fillText(label, 160, 65);
  // downward arrow
  x.beginPath();
  x.moveTo(120, 118); x.lineTo(200, 118); x.lineTo(160, 176); x.closePath();
  x.fillStyle = col;
  x.fill();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(4.6, 2.9, 1);
  scene.add(sp);
  return sp;
}

/* ---------- frame loop ---------- */

let lastT = performance.now();
let frames = 0;
let simT = 0;
const eul = new THREE.Euler();
const quat = new THREE.Quaternion().setFromEuler(eul);
const one = new THREE.Vector3(1, 1, 1);
const pos = new THREE.Vector3();

function frame(t) {
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  step(dt);
  if (bloom.strength > 0.55) bloom.strength = Math.max(0.55, bloom.strength - dt * 0.5);
  if (!reduced) {
    camera.position.x = Math.sin(t / 11000) * 2.6;
    camera.position.y += (camBaseY + Math.sin(t / 7000) * 0.5 - camera.position.y) * 0.05;
    const targetX = simT < focusUntil ? focusX : 0;
    lookX += (targetX - lookX) * Math.min(1, dt * 1.6);
    camera.lookAt(lookX, 1.6, -60);
  }
  composer.render();
  frames++;
  requestAnimationFrame(frame);
}

function step(dt) {
  simT += dt;
  for (const chain of ['btc', 'eth']) {
    const road = roads[chain];
    const b = road.batch;
    b.age += dt;
    if (b.count && (b.count >= 16 || b.age >= 1.8)) flushBatch(road);
    let budget = 6;
    while (budget-- > 0 && road.queue.length && road.vehicles.length < 60) {
      if (!materialize(road, road.queue[0])) break;
      road.queue.shift();
    }
    const surgeK = 1 + road.surge * 0.9;
    for (const lane of road.lanes) {
      for (let i = 0; i < lane.length; i++) {
        const v = lane[i];
        v.z += v.speed * surgeK * dt;
        if (i > 0) {
          const lead = lane[i - 1];
          const maxZ = lead.z - lead.len / 2 - v.gap - v.len / 2;
          if (v.z > maxZ) v.z = maxZ;
        }
      }
      while (lane.length && lane[0].z > Z_GONE) despawn(road, lane[0]);
    }
    // write instance matrices
    const touched = new Set();
    for (const v of road.vehicles) {
      const fleet = fleets[v.type];
      pos.set(v.x, 0, v.z);
      tmpM.compose(pos, quat, one);
      for (const im of Object.values(fleet.meshes)) im.setMatrixAt(v.slot, tmpM);
      touched.add(v.type);
      if (v.badge) {
        const whaleRig = v.cls.id === 'whale';
        const baseY = whaleRig ? 5.6 : 3.4;
        v.badge.position.set(v.x, baseY + (whaleRig ? Math.sin(simT * 3 + v.slot) * 0.35 : 0), v.z);
      }
      if (v.light) v.light.position.set(v.x, 2.4, v.z);
    }
    for (const type of touched) {
      for (const im of Object.values(fleets[type].meshes)) im.instanceMatrix.needsUpdate = true;
    }
    if (road.surge > 0) road.surge = Math.max(0, road.surge - dt / 1.8);
    const g = gantry[chain];
    if (g.flash > 0) {
      g.flash = Math.max(0, g.flash - dt * 0.4);
      g.mat.emissiveIntensity = 0.92 + g.flash * 0.6;
      if (g.flash === 0) renderBoards();
    }
    if (g.ringLife > 0) {
      g.ringLife = Math.max(0, g.ringLife - dt / 1.15);
      const s = 1 + (1 - g.ringLife) * 7.5;
      g.ring.scale.setScalar(s);
      g.ring.material.opacity = g.ringLife * 0.5;
      g.ring.visible = g.ringLife > 0 && !reduced;
    }
    const c = confetti[chain];
    if (c.life > 0) {
      c.life -= dt * 0.5;
      const p = c.pts.geometry.getAttribute('position');
      for (let i = 0; i < c.N; i++) {
        c.vel[i * 3 + 1] -= 7.5 * dt;
        p.setXYZ(i, p.getX(i) + c.vel[i * 3] * dt, p.getY(i) + c.vel[i * 3 + 1] * dt, p.getZ(i) + c.vel[i * 3 + 2] * dt);
      }
      p.needsUpdate = true;
      c.pts.material.opacity = Math.max(0, c.life);
      if (c.life <= 0) c.pts.visible = false;
    }
  }
}

/* ---------- interaction ---------- */

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const cardEl = document.getElementById('card3');

canvas.addEventListener('pointerdown', (e) => {
  ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / window.innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, camera);
  const targets = [];
  for (const f of Object.values(fleets)) {
    for (const key of ['paint', 'glass', 'dark']) if (f.meshes[key]) targets.push(f.meshes[key]);
  }
  // three caches instanced bounding spheres from boot (when all slots were
  // zero-scaled) and never invalidates them — recompute at click time
  for (const t of targets) t.boundingSphere = null;
  const hits = ray.intersectObjects(targets, false);
  if (!hits.length) { cardEl.hidden = true; return; }
  const type = hits[0].object.userData.type, slot = hits[0].instanceId;
  let hit = null;
  for (const c of ['btc', 'eth']) for (const v of roads[c].vehicles) {
    if (v.type === type && v.slot === slot) hit = v;
  }
  if (!hit) { cardEl.hidden = true; return; }
  showCard(hit, e.clientX, e.clientY);
  try { window.TXH.sound.play('honk'); } catch (err) {}
});

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function showCard(v, cx, cy) {
  const tx = v.tx;
  const cfg = CFG.chains[tx.chain];
  let html = '<div class="k">' + cfg.name + ' · ' + esc(v.cls.label) + (tx.sim ? ' · simulated' : '') + '</div>';
  if (tx.isBatch) {
    html += '<div class="row"><span>riders</span><span class="mono">' + tx.count + ' small tx</span></div>' +
      '<div class="row"><span>combined</span><span class="mono">' + U.fmtUsd(tx.usd) + '</span></div>' +
      '<div class="row"><span>largest</span><span class="mono">' + U.fmtUsd(tx.maxUsd) + '</span></div>';
  } else {
    html += '<div class="row"><span>value</span><span class="mono">' + U.fmtCoin(tx.value, cfg.unit) +
      (tx.usd != null ? ' (' + U.fmtUsd(tx.usd) + ')' : '') + '</span></div>' +
      '<div class="row"><span>tx</span><span class="mono">' + esc(U.shortHash(tx.hash)) + '</span></div>';
    if (!tx.sim) {
      const url = tx.chain === 'btc' ? CFG.endpoints.btcExplorer(tx.hash) : CFG.endpoints.ethExplorer(tx.hash);
      html += '<a href="' + esc(url) + '" target="_blank" rel="noopener">view on explorer ↗</a>';
    }
  }
  cardEl.innerHTML = html;
  cardEl.hidden = false;
  cardEl.style.left = Math.min(cx + 12, window.innerWidth - 252) + 'px';
  cardEl.style.top = Math.min(cy + 12, window.innerHeight - 130) + 'px';
}

/* ---------- live feeds + demo generator ---------- */

let mode = 'live';
try { if (localStorage.getItem('txh3d-mode') === 'demo') mode = 'demo'; } catch (e) {}

const preBuffer = [];
function handleTx(tx) {
  if (mode === 'demo') return; // demo generator drives the road instead
  const prices = window.TXH.prices.get();
  if (!prices.ready) {
    if (preBuffer.length < 120) preBuffer.push(tx);
    return;
  }
  tx.usd = window.TXH.prices.usd(tx.chain, tx.value);
  spawn(tx); // spawn handles session stats + whale moments
}

function initFeeds() {
  window.TXH.prices.init();
  window.TXH.prices.onUpdate((p) => {
    if (p.btc) document.getElementById('p3-btc').textContent = U.fmtPrice(p.btc);
    if (p.eth) document.getElementById('p3-eth').textContent = U.fmtPrice(p.eth);
    if (p.ready && mode === 'live') preBuffer.splice(0).forEach(handleTx);
  });
  window.TXH.btcFeed.init();
  window.TXH.ethFeed.init();
  window.TXH.btcFeed.on('tx', handleTx);
  window.TXH.ethFeed.on('tx', handleTx);
  window.TXH.btcFeed.on('stats', (s) => { if (s.height != null) roads.btc.blockHeight = s.height; });
  window.TXH.ethFeed.on('stats', (s) => { if (s.height != null) roads.eth.blockHeight = s.height; });
  window.TXH.btcFeed.on('block', (ev) => { if (mode === 'live') blockPulse('btc', ev.height); });
  window.TXH.ethFeed.on('block', (ev) => { if (mode === 'live') blockPulse('eth', ev.height); });
}

/* demo mode: honest simulation (labeled), tuned to look alive */
let demoTimers = [];
function startDemo() {
  let i = 0;
  const val = () => {
    const r = Math.random();
    if (r < 0.62) return 5 + Math.random() * 950;
    if (r < 0.82) return 1e3 + Math.random() * 9e3;
    if (r < 0.94) return 1e4 + Math.random() * 9e4;
    return 1e5 + Math.random() * 8e5;
  };
  demoTimers.push(setInterval(() => {
    for (let k = 0; k < 7; k++) {
      const usd = val();
      spawn({ chain: 'eth', value: usd / 2500, usd, hash: 'sim' + (i++), sim: true, isContractCall: Math.random() < 0.35 });
    }
    for (let k = 0; k < 2; k++) {
      const usd = val();
      spawn({ chain: 'btc', value: usd / 60000, usd, hash: 'sim' + (i++), sim: true });
    }
  }, 500));
  demoTimers.push(setInterval(() => {
    const usd = 1.2e6 + Math.random() * 6e7;
    spawn({ chain: Math.random() < 0.5 ? 'btc' : 'eth', value: usd / 60000, usd, hash: 'sim-whale' + (i++), sim: true });
  }, 52000));
  demoTimers.push(setInterval(() => blockPulse('eth', (roads.eth.blockHeight || 25474000) + 1), 12000));
  demoTimers.push(setInterval(() => blockPulse('btc', (roads.btc.blockHeight || 956900) + 1), 46000));
  // one immediate whale so the first minute already has a moment
  demoTimers.push(setTimeout(() => {
    const usd = 4.2e7;
    spawn({ chain: 'eth', value: usd / 2500, usd, hash: 'sim-w0', sim: true });
  }, 6000));
}
function stopDemo() {
  demoTimers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  demoTimers = [];
}

function applyMode() {
  const btn = document.getElementById('btn3-mode');
  const tag = document.getElementById('sim-tag');
  if (mode === 'demo') { startDemo(); btn.textContent = 'DEMO'; btn.classList.add('demo'); tag.hidden = false; }
  else { stopDemo(); btn.textContent = 'LIVE'; btn.classList.remove('demo'); tag.hidden = true; }
  try { localStorage.setItem('txh3d-mode', mode); } catch (e) {}
}

document.getElementById('btn3-mode').addEventListener('click', () => {
  mode = mode === 'demo' ? 'live' : 'demo';
  applyMode();
});

/* ---------- HUD chips / resize / boot ---------- */

let boardTick = 0;
setInterval(() => {
  boardTick++;
  for (const chain of ['btc', 'eth']) {
    const road = roads[chain];
    road.rate.push(road.rateCur);
    road.rateCur = 0;
    if (road.rate.length > 10) road.rate.shift();
    const avg = road.rate.reduce((a, b) => a + b, 0) / Math.max(1, road.rate.length);
    document.getElementById('r3-' + chain).textContent =
      (road.blockHeight ? '#' + road.blockHeight.toLocaleString('en-US') + ' · ' : '') +
      (avg < 10 ? avg.toFixed(1) : Math.round(avg)) + ' tx/s';
    if (boardTick % 6 === 0) gantry[chain].msgIdx++;
  }
  const total = ['btc', 'eth'].reduce((a, c) =>
    a + (roads[c].rate.length ? roads[c].rate.reduce((s, n) => s + n, 0) / roads[c].rate.length : 0), 0);
  if (total > 0.5) document.title = Math.round(total) + ' tx/s live — TX Highway 3D';
  renderBoards();
}, 1000);

let camBaseY = 22;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  camera.aspect = w / h;
  const portrait = h > w;
  // phones: boards scale up so LED text stays readable at the longer camera
  for (const chain of ['btc', 'eth']) {
    if (gantry[chain] && gantry[chain].panel) gantry[chain].panel.scale.setScalar(portrait ? 1.3 : 1);
  }
  camera.fov = portrait ? 62 : 50;
  camBaseY = portrait ? 28 : 22;
  camera.position.set(0, camBaseY, portrait ? 56 : 43);
  camera.lookAt(0, 1.6, -60);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    for (const c of ['btc', 'eth']) { roads[c].queue.length = 0; roads[c].batch = newBatch(); }
    lastT = performance.now();
  }
});

/* one-tap share: live WebGL frame + branded banner (preserveDrawingBuffer on) */
function share3d() {
  try {
    const src = renderer.domElement;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    const k = src.width / Math.max(1, src.clientWidth);
    const bh = 46 * k;
    x.fillStyle = 'rgba(6, 8, 12, .92)';
    x.fillRect(0, c.height - bh, c.width, bh);
    x.textBaseline = 'middle';
    x.fillStyle = '#ffc652';
    x.font = '700 ' + 15 * k + 'px "Fredoka", sans-serif';
    x.fillText('TX HIGHWAY 3D — LIVE BITCOIN & ETHEREUM TRAFFIC', 14 * k, c.height - bh * 0.64);
    const pb = document.getElementById('p3-btc'), pe = document.getElementById('p3-eth');
    x.fillStyle = '#9cc8ff';
    x.font = '600 ' + 11 * k + 'px "IBM Plex Mono", monospace';
    x.fillText('BTC ' + (pb ? pb.textContent : '') + ' · ETH ' + (pe ? pe.textContent : '') +
      ' · every vehicle is a real transaction · txhighway.onrender.com/3d.html', 14 * k, c.height - bh * 0.24);
    c.toBlob((blob) => {
      if (!blob) return;
      let file = null;
      try { file = new File([blob], 'tx-highway-3d.png', { type: 'image/png' }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file], title: 'TX Highway 3D',
          text: 'Live Bitcoin & Ethereum transactions as night traffic',
          url: 'https://txhighway.onrender.com/3d.html'
        }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'tx-highway-3d.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      }
    });
  } catch (e) {}
}
document.getElementById('btn3-share').addEventListener('click', share3d);

// H to honk — because why not
document.addEventListener('keydown', (e) => {
  if (e.key === 'h' && !e.metaKey && !e.ctrlKey) {
    try { window.TXH.sound.play('honk'); } catch (err) {}
  }
});

const soundBtn = document.getElementById('btn3-sound');
soundBtn.textContent = window.TXH.sound.init() ? '🔊' : '🔇';
soundBtn.addEventListener('click', () => {
  soundBtn.textContent = window.TXH.sound.toggle() ? '🔊' : '🔇';
});

buildWorld();
buildGantries();
buildFleets();
mkConfetti('btc');
mkConfetti('eth');
resize();
initFeeds();
fetchBoardData();
applyMode();
requestAnimationFrame(frame);

/* debug hooks for tests */
window.TXH3D = {
  spawn, blockPulse, whaleToast,
  setMode: (m) => { mode = m; applyMode(); },
  counts: () => ({
    btc: roads.btc.vehicles.length, eth: roads.eth.vehicles.length,
    drawCalls: renderer.info.render.calls
  }),
  fps: () => { const f = frames; frames = 0; return f; },
  warp: (s) => { for (let i = 0; i < s * 30; i++) step(1 / 30); },
  rayTest: (cx, cy) => {
    ptr.x = (cx / window.innerWidth) * 2 - 1;
    ptr.y = -(cy / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const targets = [];
    for (const f of Object.values(fleets)) {
      for (const key of ['paint', 'glass', 'dark']) if (f.meshes[key]) targets.push(f.meshes[key]);
    }
    for (const t of targets) t.boundingSphere = null;
    const hits = ray.intersectObjects(targets, false);
    return hits.slice(0, 3).map((h) => ({ type: h.object.userData.type, id: h.instanceId, d: Math.round(h.distance) }));
  },
  nearestScreen: () => {
    const w = window.innerWidth, h = window.innerHeight;
    let best = null;
    for (const c of ['btc', 'eth']) for (const v of roads[c].vehicles) {
      const p = new THREE.Vector3(v.x, 1, v.z).project(camera);
      const sx = (p.x + 1) / 2 * w, sy = (1 - p.y) / 2 * h;
      if (sx > w * 0.15 && sx < w * 0.85 && sy > h * 0.35 && sy < h * 0.82) {
        if (!best || v.z > best.z) best = { z: v.z, x: sx, y: sy };
      }
    }
    return best;
  }
};
