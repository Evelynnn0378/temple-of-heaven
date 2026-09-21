/**
 * hero3d.js — 祈年殿三维开屏（替换原 120 帧图片序列）
 *
 * 职责：
 *  1. 阻止旧 hero 帧序列下载（main.js 顶层 framesPromise 在桌面端无条件预载
 *     /assets/hero-video(-dark)/ 的 120 张 webp；本模块在 main.js 之前执行，
 *     对该路径的 Image.src 赋值直接以 error 事件回绝，framesPromise 正常 settle，
 *     preloader 流程不受影响）。仅此一路径被拦截，其余图片加载不受影响。
 *  2. 用 three.js（../vendor/three.module.js，r160，MIT）程序化建模祈年殿：
 *     三层汉白玉圆台基（栏板/望柱）、28 根朱红柱（4 龙井柱 + 12 金柱 + 12 檐柱）、
 *     隔扇门窗、三重檐攒尖顶（黛蓝琉璃瓦）、鎏金宝顶；祥云 sprite 缓漂、
 *     远景飞鹤剪影（克制）。
 *  3. 交互：鼠标视差（阻尼 lerp 0.1）、滚动 scrub 镜头轨道（内景藻井 → 穿出
 *     隔扇门 → 环绕拉远 → 全景），滚动行程与原序列一致
 *     （trigger .hero-scroll-area, start "top top", end "75% bottom", scrub 0.25）。
 *  4. 昼夜：hour>=7 && hour<24 为昼（与 main.js 判断一致），光照氛围缓动切换。
 *  5. 性能：IntersectionObserver 离屏暂停、resize 自适应、
 *     DPR ≤ 2（桌面）/ ≤ 1.5（移动）。
 *
 * 不修改 main.js 任何字节；依赖全局 gsap / ScrollTrigger（在其后注册，幂等）。
 */

/* ---- 1. 拦截旧 hero 帧序列下载（必须先于 main.js 执行） ---------------- */
(() => {
  const proto = HTMLImageElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'src');
  if (!desc || !desc.set) return;
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get ? desc.get.call(this) : ''; },
    set(value) {
      if (typeof value === 'string' && value.indexOf('/assets/hero-video') !== -1) {
        const img = this;
        // 异步触发 error，让 main.js 里 t.onerror → resolve(null)，framesPromise 正常完成
        setTimeout(() => { try { img.dispatchEvent(new Event('error')); } catch (e) {} }, 0);
        return;
      }
      desc.set.call(this, value);
    }
  });
})();

import * as THREE from '../vendor/three.module.js';

/* ---- 2. 调色板（与站点一致） ------------------------------------------- */
const PAL = {
  cinnabar: 0x9D2933,   // 朱砂（柱/门窗）
  wallRed: 0x7A2E2A,    // 宫墙绛红
  darkMaroon: 0x3B1B18, // 玄绛（天空）
  paper: 0xF2EAD9,      // 宣纸（汉白玉/雾/云）
  gold: 0xC6A15B,       // 鎏金（宝顶/檐口/饰件）
  blueTile: 0x37505C    // 黛蓝（琉璃瓦）
};

const BREAKPOINT = 992; // 与 main.js breakPoint 一致

/* ---- 3. 工具 ------------------------------------------------------------ */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => t * t * (3 - 2 * t);

/** 分段关键帧插值：xs 单调递增，ys 等长 */
function keys(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) {
      const t = smooth((x - xs[i]) / (xs[i + 1] - xs[i]));
      return lerp(ys[i], ys[i + 1], t);
    }
  }
  return ys[ys.length - 1];
}

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial(Object.assign(
    { color, roughness: 0.85, metalness: 0.0, flatShading: true }, opts));
}

/* ---- 4. 程序化建模：祈年殿 --------------------------------------------- */
function buildHall() {
  const g = new THREE.Group();

  const marbleMat = std(0xEFE6D0, { roughness: 0.9 });
  const marbleDark = std(0xD8CBB0, { roughness: 0.9 });
  const redMat = std(PAL.cinnabar, { roughness: 0.7 });
  const tileMat = std(PAL.blueTile, { roughness: 0.55, metalness: 0.1, emissive: 0x0D1820, emissiveIntensity: 0.6, side: THREE.DoubleSide });
  const goldMat = std(PAL.gold, { roughness: 0.35, metalness: 0.65, emissive: PAL.gold, emissiveIntensity: 0.08 });

  /* -- 台基：三层圆台 -- */
  const TIER_R = [34, 30, 26];
  const TIER_H = 2.2;
  TIER_R.forEach((r, i) => {
    const y = i * TIER_H;
    // 每层之间的水平封板（封住缝隙，栏板不再悬空）
    if (i > 0) {
      const shelf = new THREE.Mesh(
        new THREE.CylinderGeometry(TIER_R[i - 1] - 0.8, TIER_R[i - 1] - 0.8, TIER_H, 96), marbleMat);
      shelf.position.y = y - TIER_H / 2;
      g.add(shelf);
    }
    const tier = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.4, TIER_H, 96), marbleMat);
    tier.position.y = y + TIER_H / 2;
    g.add(tier);
    // 须弥座束腰：上下两道线脚
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.55, r + 0.55, 0.35, 96), marbleDark);
    trim.position.y = y + TIER_H - 0.18;
    g.add(trim);

    /* 栏板 + 望柱（instanced） */
    const topY = y + TIER_H;
    const railR = r - 0.7;
    const circ = 2 * Math.PI * railR;
    const nPosts = Math.round(circ / 4.2);
    // 栏板：连续矮带
    const panel = new THREE.Mesh(
      new THREE.CylinderGeometry(railR, railR, 0.55, 96, 1, true), marbleMat);
    panel.material = marbleMat.clone();
    panel.material.side = THREE.DoubleSide;
    panel.position.y = topY + 0.55;
    g.add(panel);
    // 扶手带
    const hand = new THREE.Mesh(
      new THREE.CylinderGeometry(railR + 0.12, railR + 0.12, 0.22, 96, 1, true),
      marbleDark.clone());
    hand.material.side = THREE.DoubleSide;
    hand.position.y = topY + 1.28;
    g.add(hand);
    // 望柱：lathe 小柱 + 圆头
    const prof = [];
    prof.push(new THREE.Vector2(0.16, 0));
    prof.push(new THREE.Vector2(0.13, 0.15));
    prof.push(new THREE.Vector2(0.13, 1.15));
    prof.push(new THREE.Vector2(0.2, 1.25));
    prof.push(new THREE.Vector2(0.12, 1.42));
    prof.push(new THREE.Vector2(0.0, 1.58));
    const postGeo = new THREE.LatheGeometry(prof, 6);
    const posts = new THREE.InstancedMesh(postGeo, marbleMat, nPosts);
    const m = new THREE.Matrix4();
    for (let k = 0; k < nPosts; k++) {
      const a = (k / nPosts) * Math.PI * 2;
      m.makeTranslation(Math.sin(a) * railR, topY, Math.cos(a) * railR);
      posts.setMatrixAt(k, m);
    }
    posts.instanceMatrix.needsUpdate = true;
    g.add(posts);

    /* 南面台阶 */
    for (let s = 0; s < 3; s++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(7, TIER_H / 3, 1.4), marbleDark);
      step.position.set(0, y + TIER_H - (s + 0.5) * (TIER_H / 3), r + 0.4 + (s - 1) * 1.3 + 1.2);
      g.add(step);
    }
  });

  const baseY = TIER_R.length * TIER_H; // 6.6 台基顶

  /* 台基顶面环板（封住台基顶部，殿内地板即最高层顶面） */
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(TIER_R[2] + 0.55, TIER_R[2] + 0.55, 0.3, 96), marbleMat);
  cap.position.y = baseY - 0.15;
  g.add(cap);

  /* -- 殿身柱网：28 柱（外檐 12 / 中金 12 / 内龙井 4） -- */
  function columnGeo(h) {
    const p = [];
    p.push(new THREE.Vector2(0.85, 0));
    p.push(new THREE.Vector2(0.62, 0.25));
    p.push(new THREE.Vector2(0.55, 1.2));
    p.push(new THREE.Vector2(0.5, h * 0.55));
    p.push(new THREE.Vector2(0.55, h - 1.0));
    p.push(new THREE.Vector2(0.78, h - 0.45));
    p.push(new THREE.Vector2(0.78, h - 0.05));
    p.push(new THREE.Vector2(0.0, h));
    return new THREE.LatheGeometry(p, 12);
  }
  const rings = [
    { n: 12, r: 12.0, h: 15.2 },  // 檐柱
    { n: 12, r: 8.0, h: 21.2 },   // 金柱
    { n: 4, r: 4.6, h: 27.0 }     // 龙井柱
  ];
  rings.forEach(ring => {
    const im = new THREE.InstancedMesh(columnGeo(ring.h), redMat, ring.n);
    const m = new THREE.Matrix4();
    for (let k = 0; k < ring.n; k++) {
      const a = (k / ring.n) * Math.PI * 2 + (ring.n === 4 ? Math.PI / 4 : Math.PI / 12);
      m.makeTranslation(Math.sin(a) * ring.r, baseY, Math.cos(a) * ring.r);
      im.setMatrixAt(k, m);
    }
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  });

  /* -- 隔扇墙（南面留门洞，相机由此穿出） -- */
  const DOOR_HALF = 0.115; // 弧度半径（门宽约 2.7m）
  const wallH = 12.6;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(11.4, 11.4, wallH, 72, 1, true, DOOR_HALF, Math.PI * 2 - DOOR_HALF * 2),
    std(PAL.wallRed, { roughness: 0.8, side: THREE.DoubleSide }));
  wall.position.y = baseY + wallH / 2;
  g.add(wall);

  /* 隔扇纹理（菱花格，canvas 绘制） */
  const latCanvas = document.createElement('canvas');
  latCanvas.width = 512; latCanvas.height = 512;
  const lc = latCanvas.getContext('2d');
  lc.fillStyle = '#6E2723';
  lc.fillRect(0, 0, 512, 512);
  lc.strokeStyle = 'rgba(198,161,91,0.55)';
  lc.lineWidth = 5;
  for (let i = 0; i <= 8; i++) {
    lc.beginPath(); lc.moveTo(i * 64, 0); lc.lineTo(i * 64, 512); lc.stroke();
    lc.beginPath(); lc.moveTo(0, i * 64); lc.lineTo(512, i * 64); lc.stroke();
  }
  lc.strokeStyle = 'rgba(242,234,217,0.28)';
  lc.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      lc.strokeRect(i * 64 + 14, j * 64 + 14, 36, 36);
    }
  }
  const latTex = new THREE.CanvasTexture(latCanvas);
  latTex.colorSpace = THREE.SRGBColorSpace;
  latTex.wrapS = latTex.wrapT = THREE.RepeatWrapping;
  latTex.repeat.set(10, 1);
  const latBand = new THREE.Mesh(
    new THREE.CylinderGeometry(11.46, 11.46, 5.4, 72, 1, true, DOOR_HALF + 0.02, Math.PI * 2 - DOOR_HALF * 2 - 0.04),
    new THREE.MeshStandardMaterial({ map: latTex, roughness: 0.8, side: THREE.DoubleSide }));
  latBand.position.y = baseY + 4.2;
  g.add(latBand);

  /* 门：敞开的隔扇门（镜头由门洞穿出）+ 鎏金门框（两立柱+门楣，不封门洞） */
  [-1, 1].forEach(sgn => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 6.9, 0.34), goldMat);
    post.position.set(sgn * 1.62, baseY + 3.45, 11.5);
    g.add(post);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.4, 0.34), goldMat);
  lintel.position.set(0, baseY + 6.95, 11.5);
  g.add(lintel);
  const leafMat = new THREE.MeshStandardMaterial({ map: latTex, roughness: 0.8, side: THREE.DoubleSide });
  [-1, 1].forEach(sgn => {
    const hinge = new THREE.Group();
    hinge.position.set(sgn * 1.45, baseY + 3.2, 11.45);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 6.4), leafMat);
    leaf.position.x = -sgn * 0.725;
    hinge.add(leaf);
    hinge.rotation.y = sgn * Math.PI * 0.86; // 向外大开，贴到墙面
    g.add(hinge);
  });

  /* -- 檐部：斗拱带（简化为两道环带 + 小斗拱块；openEnded 否则底盖封死藻井） -- */
  const band1 = new THREE.Mesh(new THREE.CylinderGeometry(12.6, 12.6, 1.0, 72, 1, true), std(0x2C3E48, { roughness: 0.75, side: THREE.DoubleSide }));
  band1.position.y = baseY + wallH + 0.5;
  g.add(band1);
  const band2 = new THREE.Mesh(new THREE.CylinderGeometry(12.9, 12.9, 0.5, 72, 1, true), goldMat.clone());
  band2.material.side = THREE.DoubleSide;
  band2.position.y = baseY + wallH + 1.25;
  g.add(band2);

  /* -- 三重檐攒尖顶 -- */
  function roof(rEave, y0, rTop, h) {
    const pts = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // 凹曲屋面：檐口微翘，上部收分
      const rr = lerp(rEave, rTop, Math.pow(t, 0.78));
      const yy = y0 + h * t + Math.sin((1 - t) * Math.PI) * 0.9 - (1 - t) * 0.9 + (i === 0 ? 0.5 : 0);
      pts.push(new THREE.Vector2(rr, yy));
    }
    pts.push(new THREE.Vector2(0, y0 + h + 0.2));
    return new THREE.LatheGeometry(pts, 72);
  }
  const roofDefs = [
    { rE: 20.0, y0: baseY + wallH + 1.5, rT: 13.6, h: 7.2 },
    { rE: 16.6, y0: baseY + wallH + 8.2, rT: 10.2, h: 6.6 },
    { rE: 13.2, y0: baseY + wallH + 14.4, rT: 1.0, h: 10.4 }
  ];
  roofDefs.forEach(d => {
    const r = new THREE.Mesh(roof(d.rE, d.y0, d.rT, d.h), tileMat);
    g.add(r);
    // 檐口鎏金边
    const rim = new THREE.Mesh(new THREE.TorusGeometry(d.rE, 0.28, 8, 72), goldMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = d.y0 + 0.42;
    g.add(rim);
    // 檐下阴影环
    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(d.rE - 0.15, d.rE - 0.15, 0.5, 72, 1, true),
      std(0x1E2B33, { side: THREE.DoubleSide }));
    under.position.y = d.y0 - 0.05;
    g.add(under);
  });

  /* -- 鎏金宝顶 -- */
  const finialProf = [];
  finialProf.push(new THREE.Vector2(1.5, 0));
  finialProf.push(new THREE.Vector2(1.1, 0.5));
  finialProf.push(new THREE.Vector2(0.55, 1.0));
  finialProf.push(new THREE.Vector2(1.15, 1.9));
  finialProf.push(new THREE.Vector2(0.9, 2.9));
  finialProf.push(new THREE.Vector2(0.35, 3.6));
  finialProf.push(new THREE.Vector2(0.0, 4.4));
  const finial = new THREE.Mesh(new THREE.LatheGeometry(finialProf, 24), goldMat);
  finial.position.y = baseY + wallH + 24.4;
  g.add(finial);

  /* -- 藻井（殿内仰视，开篇镜头所见） -- */
  const caisCanvas = document.createElement('canvas');
  caisCanvas.width = caisCanvas.height = 512;
  const cc = caisCanvas.getContext('2d');
  cc.fillStyle = '#3B1B18';
  cc.fillRect(0, 0, 512, 512);
  for (let i = 10; i > 0; i--) {
    cc.beginPath();
    cc.arc(256, 256, i * 25, 0, Math.PI * 2);
    cc.strokeStyle = i % 2 ? 'rgba(198,161,91,0.85)' : 'rgba(157,41,51,0.9)';
    cc.lineWidth = i % 2 ? 7 : 16;
    cc.stroke();
  }
  cc.beginPath();
  cc.arc(256, 256, 22, 0, Math.PI * 2);
  cc.fillStyle = '#C6A15B';
  cc.fill();
  const caisTex = new THREE.CanvasTexture(caisCanvas);
  caisTex.colorSpace = THREE.SRGBColorSpace;
  const caisson = new THREE.Mesh(
    new THREE.CircleGeometry(9.5, 48),
    new THREE.MeshBasicMaterial({ map: caisTex }));
  caisson.rotation.x = Math.PI / 2; // 朝下
  caisson.position.y = baseY + wallH + 0.9; // 殿内吊顶高度（仰拍开场所见）
  g.add(caisson);

  return g;
}

/* ---- 5. 环境：地面 / 雾气 / 云 / 鹤 ----------------------------------- */
function buildGround() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#2A1411';
  x.fillRect(0, 0, 1024, 1024);
  // 建筑底部接触阴影
  const grad = x.createRadialGradient(512, 512, 40, 512, 512, 200);
  grad.addColorStop(0, 'rgba(20,8,6,0.9)');
  grad.addColorStop(1, 'rgba(20,8,6,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 1024, 1024);
  // 广场砖缝细环
  x.strokeStyle = 'rgba(242,234,217,0.05)';
  x.lineWidth = 2;
  for (let i = 1; i <= 9; i++) {
    x.beginPath();
    x.arc(512, 512, i * 52, 0, Math.PI * 2);
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(520, 72),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  return ground;
}

/** 宣纸雾盘 */
function buildMist() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(242,234,217,0.16)');
  grad.addColorStop(0.6, 'rgba(242,234,217,0.07)');
  grad.addColorStop(1, 'rgba(242,234,217,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mist = new THREE.Mesh(
    new THREE.PlaneGeometry(340, 340),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mist.rotation.x = -Math.PI / 2;
  mist.position.y = 1.2;
  return mist;
}

/** 祥云纹理：取自 _assets_src/design/orn_ruyi_cloud.svg 的路径数据，Path2D 描边 */
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 512, 256);
  x.strokeStyle = 'rgba(242,234,217,0.85)';
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.lineWidth = 10;
  x.stroke(new Path2D('M 96 176 A 56 56 0 0 1 152 76 A 64 64 0 0 1 264 72 A 52 52 0 0 1 320 160 Q 322 176 308 176 Z'));
  x.lineWidth = 8;
  x.stroke(new Path2D('M 208 150 A 26 26 0 1 1 234 124 A 14 14 0 1 0 220 110'));
  x.lineWidth = 10;
  x.stroke(new Path2D('M 300 176 C 360 190 400 160 452 176'));
  x.lineWidth = 7;
  x.stroke(new Path2D('M 316 204 C 368 216 408 190 470 206'));
  x.stroke(new Path2D('M 110 206 C 160 218 220 218 280 206'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildClouds() {
  const tex = cloudTexture();
  const group = new THREE.Group();
  const items = [];
  const defs = [
    { r: 95, y: 46, s: 42, speed: 0.006, a0: 0.4, o: 0.75 },
    { r: 130, y: 60, s: 58, speed: -0.004, a0: 1.7, o: 0.6 },
    { r: 80, y: 38, s: 30, speed: 0.008, a0: 2.9, o: 0.8 },
    { r: 160, y: 72, s: 66, speed: 0.003, a0: 4.2, o: 0.5 },
    { r: 110, y: 54, s: 38, speed: -0.005, a0: 5.3, o: 0.65 },
    { r: 190, y: 84, s: 74, speed: 0.0025, a0: 3.5, o: 0.42 }
  ];
  defs.forEach(d => {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: d.o, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(d.s, d.s / 2, 1);
    group.add(sp);
    items.push({ sp, d, a: d.a0 });
  });
  return { group, items };
}

/** 飞鹤剪影（远景、克制） */
function craneTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(29,13,11,0.9)';
  x.beginPath(); // 展开双翼的鹤剪影
  x.moveTo(128, 78);
  x.quadraticCurveTo(92, 30, 38, 34);
  x.quadraticCurveTo(88, 52, 118, 82);
  x.quadraticCurveTo(112, 92, 128, 90);
  x.quadraticCurveTo(144, 92, 138, 82);
  x.quadraticCurveTo(168, 52, 218, 34);
  x.quadraticCurveTo(164, 30, 128, 78);
  x.fill();
  x.beginPath(); // 长颈与头
  x.moveTo(134, 84);
  x.quadraticCurveTo(160, 88, 176, 100);
  x.lineTo(170, 104);
  x.quadraticCurveTo(152, 94, 132, 90);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCranes() {
  const tex = craneTexture();
  const group = new THREE.Group();
  const items = [];
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(14, 7, 1);
    group.add(sp);
    items.push({ sp, phase: i * 19.0, speed: 3.2 + i * 0.7, y: 55 + i * 14 });
  }
  return { group, items };
}

/* ---- 6. 主初始化（幂等，可随 Barba 重入） ------------------------------ */
function initHero3D() {
  const canvas = document.querySelector('[data-hero3d]');
  if (!canvas || canvas.__hero3dActive) return;
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    return; // 无 WebGL：保留 .scroll-video 海报兜底
  }
  canvas.__hero3dActive = true;
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const isDesktopMQ = window.matchMedia(`(min-width: ${BREAKPOINT}px)`);
  const isDay = () => { const h = new Date().getHours(); return h >= 7 && h < 24; };

  /* 场景 */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.darkMaroon);
  scene.fog = new THREE.Fog(PAL.darkMaroon, 110, 380);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);

  scene.add(buildGround());
  scene.add(buildMist());
  const hall = buildHall();
  scene.add(hall);
  const clouds = buildClouds();
  scene.add(clouds.group);
  const cranes = buildCranes();
  scene.add(cranes.group);

  /* 光照 */
  const hemi = new THREE.HemisphereLight(0x8A6A50, 0x2A1411, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xFFE8C8, 2.0);
  sun.position.set(60, 90, 40);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xC6A15B, 0.5);
  rim.position.set(-70, 40, -60);
  scene.add(rim);
  const inner = new THREE.PointLight(0xE8B96A, 60, 90, 1.4);
  inner.position.set(0, 15, 0);
  scene.add(inner);
  const fill = new THREE.DirectionalLight(0xD8C9B0, 0.4);
  fill.position.set(-50, 70, 90);
  scene.add(fill);

  /* 昼夜氛围目标值 */
  const DAY = {
    sky: new THREE.Color(0x4B241E), fogNear: 120, fogFar: 400,
    sunC: new THREE.Color(0xFFE8C8), sunI: 2.1,
    hemiS: new THREE.Color(0x8A6A50), hemiG: new THREE.Color(0x2A1411), hemiI: 0.95,
    rimI: 0.55, innerI: 95, fillI: 0.45, exposure: 1.05, cloudO: 1.0
  };
  const NIGHT = {
    sky: new THREE.Color(0x180B09), fogNear: 70, fogFar: 300,
    sunC: new THREE.Color(0xA8C0D8), sunI: 0.5,
    hemiS: new THREE.Color(0x2E3A46), hemiG: new THREE.Color(0x120806), hemiI: 0.55,
    rimI: 0.9, innerI: 130, fillI: 0.15, exposure: 0.92, cloudO: 0.45
  };
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  /* 尺寸 */
  function parentBox() {
    const p = canvas.parentElement;
    const r = p ? p.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    return { w: Math.max(2, Math.round(r.width)), h: Math.max(2, Math.round(r.height)) };
  }
  function resize() {
    const { w, h } = parentBox();
    const cap = isDesktopMQ.matches ? 2 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* 移动端：把 canvas 搬进 .mob_hero-w_bg；桌面搬回 .hero-w_bg .img-w */
  function reparent() {
    if (isDesktopMQ.matches) {
      const desk = document.querySelector('.hero-w_bg .img-w');
      if (desk && canvas.parentElement !== desk) desk.appendChild(canvas);
    } else {
      const mob = document.querySelector('.mob_hero-w_bg');
      if (mob && canvas.parentElement !== mob) {
        const img = mob.querySelector('.mob_hero-w_bg_img');
        if (img && img.nextSibling) mob.insertBefore(canvas, img.nextSibling);
        else mob.appendChild(canvas);
      }
    }
    resize();
  }
  reparent();
  isDesktopMQ.addEventListener('change', reparent);
  window.addEventListener('resize', resize);

  /* 滚动叙事：与原 initScrollVideo 相同行程 */
  const scroll = { p: 0 };
  gsap.to(scroll, {
    p: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: '.hero-scroll-area',
      start: 'top top',
      end: '75% bottom',
      scrub: 0.25
    }
  });

  /* 鼠标 / 触摸视差 */
  const par = { azT: 0, az: 0, pitT: 0, pit: 0 };
  window.addEventListener('mousemove', e => {
    par.azT = (e.clientX / window.innerWidth - 0.5) * 0.3;
    par.pitT = (0.5 - e.clientY / window.innerHeight) * 4.0;
  }, { passive: true });
  let touchX = null, touchY = null;
  window.addEventListener('touchstart', e => {
    if (e.touches.length) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (!e.touches.length || touchX === null) return;
    par.azT = clamp(par.azT + (e.touches[0].clientX - touchX) * 0.0022, -0.3, 0.3);
    par.pitT = clamp(par.pitT - (e.touches[0].clientY - touchY) * 0.02, -4, 4);
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });

  /* 镜头轨道关键帧（内景藻井 → 穿出隔扇门 → 环绕 → 全景） */
  const KX = [0, 0.16, 0.34, 0.58, 0.82, 1];
  const K_R = [2.6, 5.5, 17, 42, 78, 112];
  const K_H = [8.5, 9.5, 10.5, 18, 28, 38];
  const K_TY = [20, 16.5, 14, 16, 18, 19];
  const K_AZ = [0, 0, 0.12, Math.PI * 0.5, Math.PI * 0.9, Math.PI * 1.12];

  /* 离屏暂停 */
  let inView = true;
  const io = new IntersectionObserver(entries => {
    inView = entries[0] ? entries[0].isIntersecting : true;
  }, { threshold: 0 });
  const scrollArea = document.querySelector('.hero-scroll-area');
  if (scrollArea) io.observe(scrollArea);

  /* 氛围插值状态（初始直接到位，避免开场闪变） */
  let env = isDay() ? 1 : 0; // 1=昼 0=夜
  function applyEnv(t) {
    const A = NIGHT, B = DAY;
    scene.background.copy(A.sky).lerp(B.sky, t);
    scene.fog.color.copy(scene.background);
    scene.fog.near = lerp(A.fogNear, B.fogNear, t);
    scene.fog.far = lerp(A.fogFar, B.fogFar, t);
    sun.color.copy(A.sunC).lerp(B.sunC, t);
    sun.intensity = lerp(A.sunI, B.sunI, t);
    hemi.color.copy(A.hemiS).lerp(B.hemiS, t);
    hemi.groundColor.copy(A.hemiG).lerp(B.hemiG, t);
    hemi.intensity = lerp(A.hemiI, B.hemiI, t);
    rim.intensity = lerp(A.rimI, B.rimI, t);
    inner.intensity = lerp(A.innerI, B.innerI, t);
    fill.intensity = lerp(A.fillI, B.fillI, t);
    renderer.toneMappingExposure = lerp(A.exposure, B.exposure, t);
    clouds.items.forEach(it => { it.sp.material.opacity = it.d.o * lerp(A.cloudO, B.cloudO, t); });
  }
  applyEnv(env);

  /* 渲染循环 */
  const clock = new THREE.Clock();
  let dayCache = isDay();
  function frame() {
    requestAnimationFrame(frame);
    if (!document.contains(canvas)) return;       // Barba 换页后旧实例静默退出
    if (!inView || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    // 昼夜缓动
    const target = isDay() ? 1 : 0;
    if (target !== dayCache) { dayCache = target; }
    env += (target - env) * Math.min(1, dt * 0.6);
    applyEnv(env);

    // 视差阻尼（0.1：跟手不晃）
    par.az += (par.azT - par.az) * 0.1;
    par.pit += (par.pitT - par.pit) * 0.1;

    // 镜头轨道
    const p = clamp(scroll.p, 0, 1);
    const aspectFix = camera.aspect < 1 ? 1 + (1 - camera.aspect) * 0.85 : 1;
    const radius = keys(KX, K_R, p) * aspectFix;
    const height = keys(KX, K_H, p) + par.pit;
    const az = keys(KX, K_AZ, p) + par.az + Math.sin(t * 0.11) * 0.012;
    const ty = keys(KX, K_TY, p);
    camera.position.set(Math.sin(az) * radius, height, Math.cos(az) * radius);
    camera.lookAt(0, ty + par.pit * 0.4, 0);

    // 云缓漂
    clouds.items.forEach(it => {
      it.a += it.d.speed * dt * 10;
      it.sp.position.set(
        Math.sin(it.a) * it.d.r,
        it.d.y + Math.sin(t * 0.3 + it.d.a0) * 2,
        Math.cos(it.a) * it.d.r);
    });
    // 鹤远景掠过
    cranes.items.forEach(it => {
      const tt = (t * it.speed + it.phase * 30) % 600;
      const x = tt - 300;
      it.sp.position.set(x, it.y + Math.sin(t * 0.5 + it.phase) * 1.5, -180 - it.phase);
    });

    renderer.render(scene, camera);
  }
  resize();
  frame();
}

/* ---- 7. 启动 + Barba 重入 ---------------------------------------------- */
initHero3D();
if (window.barba && window.barba.hooks && window.barba.hooks.beforeEnter) {
  window.barba.hooks.beforeEnter(() => {
    // 新 DOM 插入后重挂（首页以外无 [data-hero3d]，幂等跳过）
    setTimeout(initHero3D, 0);
  });
}
