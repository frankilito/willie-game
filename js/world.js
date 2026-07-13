/* world.js — 解析地形 / 城镇 / 生态 / 天空天气 / 史诗远景
 * 解析式高度函数 height(x,z) 是唯一碰撞源（除圆柱碰撞体）。
 * 黑白灰阶世界：暖黑 + 旧纸白 + 灰。
 */
const World = (function () {
  'use strict';

  // ---------- 常量与地标 ----------
  const WATER_Y = 0.15;
  const LAVA_Y = 24;
  const BORDER = 385;
  const LANDMARKS = {
    SPAWN: { x: 150, z: 230, name: '威利河港' },
    VILLAGE: { x: 195, z: 250, name: '牲畜农庄' },
    SHRINE: { x: 200, z: -120, name: '旧汽笛站' },
    TOWER: { x: 140, z: -50, name: '航标高台' },
    FLOWER: { x: -80, z: -120, name: '芦苇音乐田' },
    VOLCANO: { x: -210, z: -215, name: '黑烟锅炉岛' },
    LAKE: { x: 60, z: 40, name: '回水湾' },
  };

  // ---------- 确定性随机（联机双端一致） ----------
  function LCG(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function sstep(a, b, x) {
    x = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }
  function hash2(x, z) {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function C(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  const dist2 = (x, z, p) => Math.hypot(x - p.x, z - p.z);

  // ---------- 解析地形高度（唯一碰撞源） ----------
  function baseH(x, z) {
    let h = 3.2;
    h += 2.3 * Math.sin(x * 0.010 + 1.3) * Math.cos(z * 0.012 - 0.7);
    h += 1.5 * Math.sin(x * 0.021 - z * 0.016 + 2.1);
    h += 0.9 * Math.cos(x * 0.033 + z * 0.027 + 1.0) * Math.sin(z * 0.019 + 0.5);
    h += 0.45 * Math.sin(x * 0.061 - z * 0.055);
    return h;
  }
  const RIVER = [[60, 40], [95, 110], [130, 170], [150, 230], [170, 300], [185, 385]];
  function riverDist(x, z) {
    let best = 1e9;
    for (let i = 0; i < RIVER.length - 1; i++) {
      const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
  }
  function height(x, z) {
    let h = baseH(x, z);
    // 河道
    const rd = riverDist(x, z);
    if (rd < 12) {
      const bed = WATER_Y - 0.8;
      h = bed + sstep(2.5, 12, rd) * (h - bed);
    }
    // 回水湾湖盆
    const ld = dist2(x, z, LANDMARKS.LAKE);
    if (ld < 36) {
      const bed = WATER_Y - 1.8;
      h = Math.min(h, bed + sstep(9, 36, ld) * (h - bed));
    }
    // 出生城镇台地
    const sd = dist2(x, z, LANDMARKS.SPAWN);
    if (sd < 50) h = h + (2.4 - h) * sstep(50, 28, sd);
    // 农庄
    const gd = dist2(x, z, LANDMARKS.VILLAGE);
    if (gd < 34) h = h + (3.0 - h) * sstep(34, 18, gd);
    // 旧汽笛站台地
    const hd = dist2(x, z, LANDMARKS.SHRINE);
    if (hd < 30) h = h + (6.5 - h) * sstep(30, 16, hd);
    // 芦苇音乐田
    const fd = dist2(x, z, LANDMARKS.FLOWER);
    if (fd < 44) h = h + (1.9 - h) * sstep(44, 26, fd);
    // 航标高台：三层阶梯（坡度≤45°可步行）
    const td = dist2(x, z, LANDMARKS.TOWER);
    if (td < 28) {
      let th = 1.0;
      th += 4.5 * sstep(28, 22, td);
      th += 4.0 * sstep(18.5, 13.5, td);
      th += 4.5 * sstep(11, 6.5, td);
      h = Math.max(h, th);
    }
    // 黑烟锅炉岛 + 白热煤浆湖
    const vd = dist2(x, z, LANDMARKS.VOLCANO);
    if (vd < 82) {
      h += 13 * sstep(82, 46, vd);
      if (vd < 42) h = Math.max(h, 19 + 9 * sstep(42, 28, vd));
      if (vd < 27) {
        const bowl = LAVA_Y - 1.2;
        h = bowl + sstep(11, 27, vd) * (Math.max(h, LAVA_Y + 2.5) - bowl);
      }
    }
    // 世界边界墙
    const r = Math.hypot(x, z);
    if (r > 330) h += (r - 330) * 0.95;
    return h;
  }
  const _n = new THREE.Vector3();
  function normal(x, z, out) {
    const e = 0.75;
    const dx = height(x - e, z) - height(x + e, z);
    const dz = height(x, z - e) - height(x, z + e);
    out = out || _n;
    out.set(dx, 2 * e, dz).normalize();
    return out;
  }
  /** 落水点位向内陆挪移 */
  function landPlace(x, z, minH) {
    minH = minH || WATER_Y + 0.6;
    if (height(x, z) > minH) return { x, z };
    for (let r = 2; r < 60; r += 2) {
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const nx = x + Math.cos(ang) * r, nz = z + Math.sin(ang) * r;
        if (height(nx, nz) > minH && riverDist(nx, nz) > 6) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }
  /** 植被可生长点 */
  function okSpot(x, z) {
    const h = height(x, z);
    if (h < WATER_Y + 0.35) return false;
    if (normal(x, z).y < 0.62) return false;
    if (dist2(x, z, LANDMARKS.SPAWN) < 48) return false;
    if (dist2(x, z, LANDMARKS.VILLAGE) < 30) return false;
    if (dist2(x, z, LANDMARKS.VOLCANO) < 30) return false;
    return true;
  }

  // ---------- 程序化 canvas 纹理 ----------
  function canvasTex(cvs, repeat) {
    const t = new THREE.CanvasTexture(cvs);
    t.encoding = THREE.sRGBEncoding;          // 防坑：canvas 纹理必须 sRGB
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  }
  function noiseCanvas(size, base, contrast, cells) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = 'rgb(' + base + ',' + base + ',' + base + ')';
    g.fillRect(0, 0, size, size);
    const rnd = LCG(size * 7919 + base);
    for (let i = 0; i < cells; i++) {
      const v = Math.max(0, Math.min(255, base + (rnd() - 0.5) * contrast));
      g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      const w = 2 + rnd() * 10;
      g.fillRect(rnd() * size, rnd() * size, w, w * (0.6 + rnd()));
    }
    return c;
  }
  function plankCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rnd = LCG(42);
    for (let i = 0; i < 8; i++) {
      const v = 150 + rnd() * 40;
      g.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v - 14) + ')';
      g.fillRect(0, i * 32, 256, 31);
      g.fillStyle = 'rgba(30,25,18,0.9)';
      g.fillRect(0, i * 32 + 30, 256, 2);
      for (let k = 0; k < 14; k++) { // 磨损
        g.fillStyle = 'rgba(90,80,64,' + (0.2 + rnd() * 0.3) + ')';
        g.fillRect(rnd() * 256, i * 32 + rnd() * 28, 10 + rnd() * 30, 2);
      }
    }
    return c;
  }
  function stripeCanvas(w, h, n, c1, c2) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? c1 : c2;
      g.fillRect(i * w / n, 0, w / n + 1, h);
    }
    return c;
  }
  function cloudCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const rnd = LCG(777);
    for (let i = 0; i < 9; i++) {
      const x = 30 + rnd() * 68, y = 44 + rnd() * 40, r = 16 + rnd() * 22;
      const grd = g.createRadialGradient(x, y, 2, x, y, r);
      grd.addColorStop(0, 'rgba(240,236,226,0.85)');
      grd.addColorStop(1, 'rgba(240,236,226,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    return c;
  }
  function crateCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#b9ab8c'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#3a3024'; g.lineWidth = 5;
    g.strokeRect(6, 6, 116, 116);
    g.beginPath(); g.moveTo(6, 6); g.lineTo(122, 122); g.moveTo(122, 6); g.lineTo(6, 122); g.stroke();
    // 手摇留声机喇叭
    g.fillStyle = '#3a3024';
    g.beginPath(); g.moveTo(44, 74); g.lineTo(84, 52); g.lineTo(84, 96); g.closePath(); g.fill();
    g.fillRect(36, 68, 10, 12);
    g.strokeStyle = '#3a3024'; g.lineWidth = 3;
    g.beginPath(); g.arc(64, 102, 8, 0, Math.PI * 2); g.stroke();
    return c;
  }

  // ---------- 模块状态 ----------
  let scene, camera;
  const colliders = [];        // {x,z,r}
  const updateCbs = [];        // 每帧回调（风车/明轮等）
  const crates = [];           // 音乐货箱
  let terrainMesh, waterMesh, lavaMesh, skyMesh, sunSprite, moonSprite, starsMesh;
  let clouds = [], rainLines = null, rainGeo = null, afterArc = null;
  let mountains = [], farShips = [], towerGroup = null;
  let timeOfDay = 10.0;        // 小时
  const weather = { name: 'clear', rain: 0, windX: 0.15, windZ: 0.05, windPow: 0.2, dark: 0 };
  let weatherTimer = 40;
  const wRnd = LCG(20260713);
  let lightningT = 0;

  // ---------- 地形网格 + 四贴图 splat 着色器 ----------
  function buildTerrain(textures) {
    const SIZE = 800, SEG = 300;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const data = new Float32Array(pos.count * 3);
    const colors = new Float32Array(pos.count * 3);
    const tmpN = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = height(x, z);
      pos.setY(i, h);
      normal(x, z, tmpN);
      const slope = 1 - tmpN.y;
      // 岩石强制区：高台/汽笛站/锅炉岛
      let rock = 0;
      if (dist2(x, z, LANDMARKS.TOWER) < 30) rock = 1;
      if (dist2(x, z, LANDMARKS.SHRINE) < 30) rock = Math.max(rock, 0.7);
      if (dist2(x, z, LANDMARKS.VOLCANO) < 85) rock = 1;
      // 林地：农庄与音乐田周边
      let forest = 0;
      if (dist2(x, z, LANDMARKS.VILLAGE) < 60) forest = 0.8;
      if (dist2(x, z, LANDMARKS.FLOWER) < 55) forest = Math.max(forest, 0.6);
      data[i * 3] = slope; data[i * 3 + 1] = rock; data[i * 3 + 2] = forest;
      // 顶点色色调层（平方写入，抵消 sRGB 洗白）
      let tint = 0.82 + hash2(x * 0.7, z * 0.7) * 0.16 - slope * 0.25;
      if (h < WATER_Y + 0.5) tint *= 0.8;
      const t2 = tint * tint;
      colors[i * 3] = t2; colors[i * 3 + 1] = t2; colors[i * 3 + 2] = t2;
    }
    geo.setAttribute('aData', new THREE.BufferAttribute(data, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.map0 = { value: textures.grass };
      sh.uniforms.map1 = { value: textures.rock };
      sh.uniforms.map2 = { value: textures.sand };
      sh.uniforms.map3 = { value: textures.forest };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aData;\nvarying vec3 vData;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvData = aData;\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D map0;\nuniform sampler2D map1;\nuniform sampler2D map2;\nuniform sampler2D map3;\nvarying vec3 vData;\nvarying vec3 vWPos;')
        .replace('#include <map_fragment>', `
          vec2 uvv = vWPos.xz * 0.085;
          vec3 g0 = texture2D(map0, uvv).rgb;
          vec3 g1 = texture2D(map1, uvv * 1.7).rgb;
          vec3 g2 = texture2D(map2, uvv * 2.3).rgb;
          vec3 g3 = texture2D(map3, uvv * 1.3).rgb;
          float rockW = clamp(vData.x * 2.4 - 0.35, 0.0, 1.0);
          rockW = max(rockW, vData.y);
          float sandW = clamp(1.4 - (vWPos.y - ${WATER_Y.toFixed(2)}) * 0.9, 0.0, 1.0) * (1.0 - rockW);
          float forestW = vData.z * (1.0 - rockW) * (1.0 - sandW);
          float grassW = max(0.0, 1.0 - rockW - sandW - forestW);
          vec3 splat = g0 * grassW + g1 * rockW + g2 * sandW + g3 * forestW;
          splat *= 1.04; /* 亮度补偿 */
          diffuseColor.rgb *= splat;
        `);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    scene.add(mesh);
    terrainMesh = mesh;
  }

  // ---------- 水面 / 煤浆 ----------
  function buildWater() {
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: C('#9a9484'), transparent: true, opacity: 0.72 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      mat.userData.sh = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.y += sin(position.x * 0.09 + uTime * 1.1) * 0.10 + sin(position.z * 0.07 - uTime * 0.9) * 0.10;`);
    };
    const m = new THREE.Mesh(geo, mat);
    m.position.y = WATER_Y;
    m.renderOrder = 1;
    scene.add(m);
    waterMesh = m;
    updateCbs.push((dt, t) => { if (mat.userData.sh) mat.userData.sh.uniforms.uTime.value = t; });

    // 煤浆湖
    const lgeo = new THREE.CircleGeometry(23, 48);
    lgeo.rotateX(-Math.PI / 2);
    const lmat = new THREE.MeshBasicMaterial({ color: C('#e8e0cc') });
    const lm = new THREE.Mesh(lgeo, lmat);
    lm.position.set(LANDMARKS.VOLCANO.x, LAVA_Y - 1.05, LANDMARKS.VOLCANO.z);
    scene.add(lm);
    lavaMesh = lm;
    updateCbs.push((dt, t) => {
      const v = 0.75 + Math.sin(t * 2.3) * 0.12;
      lmat.color.setRGB(v, v * 0.96, v * 0.85);
    });
  }

  // ---------- 天空穹顶（黑白着色器：日晕/月/星空） ----------
  function buildSky() {
    const geo = new THREE.SphereGeometry(720, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uDay: { value: 0.6 }, uWeather: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.2) },
      },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir;
        uniform float uDay; uniform float uWeather; uniform vec3 uSunDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float h = clamp(vDir.y, -0.1, 1.0);
          float night = clamp(0.5 - uDay * 0.9, 0.0, 1.0);
          vec3 zenith = mix(vec3(0.05, 0.05, 0.07), vec3(0.42, 0.42, 0.45), uDay);
          vec3 horizon = mix(vec3(0.10, 0.10, 0.12), vec3(0.78, 0.76, 0.72), uDay);
          vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
          // 太阳/月 + 光晕
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          float disc = smoothstep(0.9975, 0.9995, s);
          float halo = pow(s, 64.0) * 0.5 + pow(s, 8.0) * 0.12;
          vec3 sunCol = mix(vec3(0.85), vec3(1.0, 0.98, 0.92), uDay);
          col += sunCol * (disc + halo) * (0.25 + uDay * 0.75);
          // 星空
          if (night > 0.01 && h > 0.02) {
            vec2 sp = vDir.xz / (vDir.y + 0.15) * 90.0;
            vec2 cell = floor(sp);
            float star = step(0.985, hash(cell)) * smoothstep(0.0, 0.3, h);
            col += vec3(star) * night * (0.5 + 0.5 * hash(cell + 7.0));
          }
          col *= (1.0 - uWeather * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    skyMesh = new THREE.Mesh(geo, mat);
    skyMesh.frustumCulled = false;
    scene.add(skyMesh);

    // 公告板云（Sprite）
    const ctex = new THREE.CanvasTexture(cloudCanvas());
    ctex.encoding = THREE.sRGBEncoding;
    const rnd = LCG(99);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.SpriteMaterial({ map: ctex, transparent: true, opacity: 0.55 + rnd() * 0.3, depthWrite: false, fog: true });
      const s = new THREE.Sprite(m);
      const a = rnd() * Math.PI * 2, r = 200 + rnd() * 380;
      s.position.set(Math.cos(a) * r, 95 + rnd() * 70, Math.sin(a) * r);
      const sc = 60 + rnd() * 90;
      s.scale.set(sc, sc * 0.55, 1);
      scene.add(s);
      clouds.push(s);
    }
  }

  // ---------- 天气状态机 晴→阴→雨→雷暴→雨后乳白光弧 ----------
  const WSTATES = ['clear', 'cloudy', 'rain', 'thunder', 'afterRain'];
  function setWeather(name) {
    weather.name = name;
    if (name === 'clear') { weather.rain = 0; weather.windPow = 0.2; weather.dark = 0; }
    if (name === 'cloudy') { weather.rain = 0; weather.windPow = 0.45; weather.dark = 0.35; }
    if (name === 'rain') { weather.rain = 0.7; weather.windPow = 0.7; weather.dark = 0.5; }
    if (name === 'thunder') { weather.rain = 1.0; weather.windPow = 0.95; weather.dark = 0.72; lightningT = 2 + wRnd() * 5; }
    if (name === 'afterRain') { weather.rain = 0; weather.windPow = 0.35; weather.dark = 0.12; showAfterArc(); }
    if (typeof Sound !== 'undefined' && Sound.ready) Sound.setRain(weather.rain);
  }
  function showAfterArc() {
    if (afterArc) scene.remove(afterArc);
    const geo = new THREE.TorusGeometry(300, 7, 8, 64, Math.PI);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf5f0e2, transparent: true, opacity: 0.8, fog: false, side: THREE.DoubleSide });
    afterArc = new THREE.Mesh(geo, mat);
    afterArc.position.set(0, 10, -420);
    scene.add(afterArc);
    afterArc.userData.life = 35;
  }
  function buildRain() {
    const N = 1400;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      pos[i * 6] = (wRnd() - 0.5) * 90;
      pos[i * 6 + 1] = wRnd() * 45;
      pos[i * 6 + 2] = (wRnd() - 0.5) * 90;
      pos[i * 6 + 3] = pos[i * 6] + 0.4;
      pos[i * 6 + 4] = pos[i * 6 + 1] - 2.2;
      pos[i * 6 + 5] = pos[i * 6 + 2] + 0.4;
    }
    rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xddd8c8, transparent: true, opacity: 0.35, fog: false });
    rainLines = new THREE.LineSegments(rainGeo, mat);
    rainLines.frustumCulled = false;
    rainLines.visible = false;
    scene.add(rainLines);
  }
  function updateWeather(dt, t) {
    weatherTimer -= dt;
    if (weatherTimer <= 0) {
      weatherTimer = 55 + wRnd() * 75;
      const order = { clear: 'cloudy', cloudy: 'rain', rain: 'thunder', thunder: 'afterRain', afterRain: 'clear' };
      // 概率性跳过
      let nx = order[weather.name];
      if (nx === 'rain' && wRnd() < 0.35) nx = 'clear';
      if (nx === 'thunder' && wRnd() < 0.4) nx = 'afterRain';
      setWeather(nx);
    }
    // 风向缓慢漂移
    const wa = t * 0.05;
    weather.windX = Math.cos(wa) * weather.windPow;
    weather.windZ = Math.sin(wa * 0.8 + 1.3) * weather.windPow;
    // 雷暴闪电
    if (weather.name === 'thunder') {
      lightningT -= dt;
      if (lightningT <= 0) {
        lightningT = 4 + wRnd() * 8;
        if (window.UI) UI.flash(0.3);
        if (typeof Sound !== 'undefined') setTimeout(() => Sound.sfx('thunder'), 200 + wRnd() * 900);
      }
    }
    // 雨线跟随玩家
    if (rainLines) {
      rainLines.visible = weather.rain > 0.05;
      rainLines.material.opacity = weather.rain * 0.4;
      if (rainLines.visible && window.G && G.player) {
        rainLines.position.set(G.player.pos.x, G.player.pos.y + 6, G.player.pos.z);
        const p = rainGeo.attributes.position.array;
        for (let i = 0; i < p.length; i += 6) {
          p[i + 1] -= 55 * dt;
          p[i + 4] = p[i + 1] - 2.2;
          p[i] += weather.windX * dt * 6;
          p[i + 3] = p[i] + 0.4;
          if (p[i + 1] < -8) { p[i + 1] += 53; p[i + 4] = p[i + 1] - 2.2; }
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
    }
    // 雨后弧光
    if (afterArc) {
      afterArc.userData.life -= dt;
      afterArc.material.opacity = Math.max(0, Math.min(0.8, afterArc.userData.life / 10));
      if (afterArc.userData.life <= 0) { scene.remove(afterArc); afterArc = null; }
    }
  }

  // ---------- 昼夜循环 ----------
  let sunLight, hemiLight;
  function buildLights() {
    hemiLight = new THREE.HemisphereLight(0xe8e2d2, 0x4a453c, 0.85);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff6e8, 0.9);
    sunLight.position.set(120, 180, 80);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -160;
    sunLight.shadow.camera.right = 160;
    sunLight.shadow.camera.top = 160;
    sunLight.shadow.camera.bottom = -160;
    sunLight.shadow.camera.far = 600;
    scene.add(sunLight);
    scene.add(sunLight.target);
  }
  function updateDayNight(dt, t) {
    timeOfDay = (timeOfDay + dt * 2.4 / 60) % 24;   // 10 分钟一天
    const h = timeOfDay;
    // day factor: 0 夜晚 .. 1 正午
    let day = Math.sin((h - 6) / 12 * Math.PI);
    day = Math.max(-0.25, day);
    const dayN = Math.max(0, day);
    // 太阳方向
    const ang = (h - 6) / 12 * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.75, Math.sin(ang) * 0.9 + 0.06, 0.35).normalize();
    skyMesh.material.uniforms.uDay.value = Math.max(0.04, dayN);
    skyMesh.material.uniforms.uWeather.value = weather.dark;
    skyMesh.material.uniforms.uSunDir.value.copy(sunDir);
    sunLight.position.copy(sunDir).multiplyScalar(240);
    if (window.G && G.player) sunLight.target.position.copy(G.player.pos);
    sunLight.intensity = 0.15 + dayN * 0.85 * (1 - weather.dark * 0.6);
    hemiLight.intensity = 0.35 + dayN * 0.55 * (1 - weather.dark * 0.4);
    // 雾色随天光
    const fv = 0.32 + dayN * 0.42 - weather.dark * 0.18;
    scene.fog.color.setRGB(fv, fv * 0.98, fv * 0.92);
    if (scene.background) scene.background.copy(scene.fog.color);
    // 远山大气透视（fog:false 材质，手动 lerp 雾色）
    mountains.forEach(m => {
      m.material.color.copy(scene.fog.color).lerp(m.userData.baseCol, 0.55);
    });
  }

  // ---------- 碰撞体 ----------
  function addCollider(x, z, r) { colliders.push({ x, z, r }); }

  // ---------- 城镇构件 ----------
  function meshAt(geo, mat, x, z, yOff) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, height(x, z) + (yOff || 0), z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  const MAT = {};
  function buildMaterials() {
    MAT.wood = new THREE.MeshLambertMaterial({ map: canvasTex(plankCanvas(), 1) });
    MAT.dark = new THREE.MeshLambertMaterial({ color: C('#2a2620') });
    MAT.paper = new THREE.MeshLambertMaterial({ color: C('#d8cdb2') });
    MAT.gray = new THREE.MeshLambertMaterial({ color: C('#8b8577') });
    MAT.iron = new THREE.MeshLambertMaterial({ color: C('#45403a') });
    MAT.roof = new THREE.MeshLambertMaterial({ map: canvasTex(stripeCanvas(128, 128, 8, '#7d7668', '#5e584b'), 1) });
    MAT.awning = new THREE.MeshLambertMaterial({ map: canvasTex(stripeCanvas(128, 64, 8, '#e8dcc0', '#3a342a'), 1), side: THREE.DoubleSide });
    MAT.glow = new THREE.MeshBasicMaterial({ color: 0xf5ecd6 });
  }
  function domeHouse(x, z, ry, s, gray) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3),
      new THREE.MeshLambertMaterial({ color: C(gray) }));
    base.position.y = 1.1;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 14, 1, false, 0, Math.PI), MAT.roof);
    roof.rotation.x = Math.PI / 2; roof.rotation.z = Math.PI / 2;
    roof.position.y = 2.2;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.3), MAT.dark);
    door.position.set(0, 0.75, 1.51);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), MAT.glow);
    win.position.set(0, 1.6, 1.51);
    g.add(base, roof, door, win);
    g.position.set(x, height(x, z), z);
    g.rotation.y = ry;
    g.scale.setScalar(s || 1);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    addCollider(x, z, 2.3 * (s || 1));
    return g;
  }
  const HOUSE_TINTS = ['#cfc7b4', '#b3ab96', '#9a917d', '#ddd5c0', '#857d6c'];
  function boxHouse(x, z, ry, s, tintIdx) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: C(HOUSE_TINTS[tintIdx % 5]) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 2.8), mat);
    base.position.y = 1.2;
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 1.9), MAT.dark);
    r1.position.set(0, 2.55, 0.75); r1.rotation.x = -0.62;
    const r2 = r1.clone(); r2.position.z = -0.75; r2.rotation.x = 0.62;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.4), MAT.dark);
    door.position.set(0, 0.8, 1.41);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), MAT.glow);
    win.position.set(0.9, 1.5, 1.41);
    g.add(base, r1, r2, door, win);
    g.position.set(x, height(x, z), z);
    g.rotation.y = ry;
    g.scale.setScalar(s);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    addCollider(x, z, 2.4 * s);
    return g;
  }
  function marketStall(x, z, ry) {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), MAT.dark);
      post.position.set(i < 2 ? -1.2 : 1.2, 1.1, i % 2 ? -0.9 : 0.9);
      g.add(post);
    }
    const awn = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.2), MAT.awning);
    awn.rotation.x = -Math.PI / 2 + 0.18; awn.position.y = 2.25;
    g.add(awn);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.9), MAT.wood);
    counter.position.y = 0.55; g.add(counter);
    const rnd = LCG((x * 31 + z * 17) | 0);
    const props = ['apple', 'crate', 'music', 'pot'];
    for (let i = 0; i < 4; i++) {
      const k = props[(i + ((x | 0) % 4)) % 4];
      let m;
      if (k === 'apple') m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), MAT.paper);
      else if (k === 'crate') m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), MAT.wood);
      else if (k === 'music') m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), MAT.paper);
      else m = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 8), MAT.iron);
      m.position.set(-0.8 + i * 0.5 + rnd() * 0.15, 0.95, rnd() * 0.3 - 0.15);
      g.add(m);
    }
    g.position.set(x, height(x, z), z);
    g.rotation.y = ry;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    addCollider(x, z, 1.6);
    return g;
  }
  let lightCount = 0;
  function pointLight(x, y, z, intensity, dist) {
    if (lightCount >= 5) return;
    lightCount++;
    const l = new THREE.PointLight(0xffe8c0, intensity, dist, 1.8);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  }
  function smithy(x, z, ry) {
    const g = new THREE.Group();
    const shed = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), MAT.dark);
    shed.position.y = 1.3;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.25, 3.4), MAT.iron);
    roof.position.y = 2.7;
    const forge = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.0), MAT.iron);
    forge.position.set(1.0, 0.5, 0);
    const fire = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), MAT.glow);
    fire.position.set(1.0, 0.65, 0.51);
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.3), MAT.iron);
    anvil.position.set(-0.9, 0.9, 0.4);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.7, 8), MAT.wood);
    stump.position.set(-0.9, 0.35, 0.4);
    g.add(shed, roof, forge, fire, anvil, stump);
    g.position.set(x, height(x, z), z);
    g.rotation.y = ry;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    addCollider(x, z, 2.6);
    pointLight(x + Math.cos(ry) * 1.2, height(x, z) + 1.2, z - Math.sin(ry) * 1.2, 0.9, 14);
    return g;
  }
  function lampPost(x, z, withLight) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6), MAT.dark);
    pole.position.y = 1.6;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), MAT.glow);
    lamp.position.y = 3.25;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 8), MAT.dark);
    cap.position.y = 3.5;
    g.add(pole, lamp, cap);
    g.position.set(x, height(x, z), z);
    scene.add(g);
    if (withLight) pointLight(x, height(x, z) + 3.2, z, 0.55, 12);
    return g;
  }
  function flagPole(x, z, h) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6), MAT.iron);
    pole.position.y = h / 2;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6, 4, 1),
      new THREE.MeshLambertMaterial({ color: C('#d8cdb2'), side: THREE.DoubleSide }));
    flag.position.set(0.6, h - 0.5, 0);
    g.add(pole, flag);
    g.position.set(x, height(x, z), z);
    scene.add(g);
    updateCbs.push((dt, t) => { flag.rotation.y = Math.sin(t * 2 + x) * 0.35; });
    return g;
  }
  function barn(x, z, ry, s) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(5, 3.4, 4), MAT.gray);
    body.position.y = 1.7;
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.35, 2.6), MAT.dark);
    r1.position.set(0, 3.6, 1.05); r1.rotation.x = -0.68;
    const r2 = r1.clone(); r2.position.z = -1.05; r2.rotation.x = 0.68;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), MAT.dark);
    door.position.set(0, 1.1, 2.01);
    g.add(body, r1, r2, door);
    g.position.set(x, height(x, z), z);
    g.rotation.y = ry; g.scale.setScalar(s || 1);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    addCollider(x, z, 3.2 * (s || 1));
    return g;
  }
  function windmill(x, z) {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 7, 8), MAT.paper);
    tower.position.y = 3.5;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8), MAT.iron);
    hub.rotation.x = Math.PI / 2; hub.position.set(0, 6.6, 1.0);
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.06), MAT.wood);
      b.position.y = 1.3;
      const pivot = new THREE.Group();
      pivot.add(b);
      pivot.rotation.z = i * Math.PI / 2;
      blades.add(pivot);
    }
    blades.position.set(0, 6.6, 1.3);
    g.add(tower, hub, blades);
    g.position.set(x, height(x, z), z);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    addCollider(x, z, 1.6);
    updateCbs.push((dt) => { blades.rotation.z += dt * (0.6 + weather.windPow * 2.2); });
    return g;
  }
  function fenceLine(pts) {
    pts.forEach((p, i) => {
      meshAt(new THREE.CylinderGeometry(0.07, 0.08, 1.1, 5), MAT.dark, p[0], p[1], 0.55);
      if (i > 0) {
        const [ax, az] = pts[i - 1], [bx, bz] = p;
        const len = Math.hypot(bx - ax, bz - az);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.06), MAT.dark);
        rail.position.set((ax + bx) / 2, height((ax + bx) / 2, (az + bz) / 2) + 0.8, (az + bz) / 2);
        rail.rotation.y = -Math.atan2(bz - az, bx - ax);
        scene.add(rail);
      }
    });
  }
  function bollard(x, z) {
    meshAt(new THREE.CylinderGeometry(0.28, 0.32, 0.9, 10), MAT.iron, x, z, 0.45);
    meshAt(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 10), MAT.iron, x, z, 0.9);
    addCollider(x, z, 0.5);
  }
  let townBell = null;
  function shipBell(x, z, y) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, y + 1.2, 8), MAT.dark);
    post.position.y = (y + 1.2) / 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.14), MAT.dark);
    beam.position.y = y + 1.2;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 14, 1, true),
      new THREE.MeshLambertMaterial({ color: C('#b8a878'), side: THREE.DoubleSide }));
    bell.position.y = y + 0.55;
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), MAT.iron);
    clapper.position.y = y + 0.15;
    g.add(post, beam, bell, clapper);
    g.position.set(x, height(x, z), z);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    addCollider(x, z, 0.7);
    townBell = { group: g, bell, x, z, y: height(x, z) + y + 0.55 };
    return townBell;
  }

  // ---------- 威利号明轮汽船（地标） ----------
  function steamboat(x, z) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(22, 4.2, 7), MAT.dark);
    hull.position.y = 2.1;
    const deck1 = new THREE.Mesh(new THREE.BoxGeometry(20, 2.4, 6.4), MAT.paper);
    deck1.position.y = 5.4;
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(14, 2.0, 5.4), MAT.paper);
    deck2.position.y = 7.4;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 4), MAT.paper);
    cabin.position.set(-4, 9.4, 0);
    const wheelhouse = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3), MAT.gray);
    wheelhouse.position.set(4.5, 9.2, 0);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 5.5, 12), MAT.dark);
    chimney.position.set(0.5, 10.4, 0);
    const chimneyTop = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.7, 12), MAT.iron);
    chimneyTop.position.set(0.5, 13.2, 0);
    g.add(hull, deck1, deck2, cabin, wheelhouse, chimney, chimneyTop);
    // 三声汽笛
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.6 + i * 0.3, 8), MAT.iron);
      w.position.set(-1.6 + i * 0.7, 12.4 + i * 0.15, 0.8);
      g.add(w);
    }
    // 侧明轮
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.2, 16, 1, true),
      new THREE.MeshLambertMaterial({ color: C('#3a342a'), side: THREE.DoubleSide }));
    rim.rotation.x = Math.PI / 2;
    wheel.add(rim);
    for (let i = 0; i < 8; i++) {
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6.2, 0.35), MAT.wood);
      paddle.rotation.z = i * Math.PI / 8;
      wheel.add(paddle);
    }
    wheel.position.set(2, 3.2, 4.2);
    g.add(wheel);
    g.position.set(x, height(x, z) - 0.5, z);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    addCollider(x - 6, z, 3.5); addCollider(x + 6, z, 3.5); addCollider(x, z + 3, 3);
    // 明轮转动（通关后加速由 story 控制）
    const state = { speed: 0.15, wheel };
    updateCbs.push((dt) => { wheel.rotation.z += dt * state.speed; });
    // 烟囱蒸汽
    const steamTex = new THREE.CanvasTexture(cloudCanvas());
    steamTex.encoding = THREE.sRGBEncoding;
    const puffs = [];
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0.5, depthWrite: false }));
      sp.scale.set(4, 4, 1);
      g.add(sp);
      puffs.push({ sp, t: i * 1.1 });
    }
    updateCbs.push((dt, t) => {
      puffs.forEach(p => {
        p.t += dt * 0.5;
        const ph = p.t % 3;
        p.sp.position.set(0.5, 13.6 + ph * 2.6, 0);
        const sc = 3 + ph * 2.2;
        p.sp.scale.set(sc, sc, 1);
        p.sp.material.opacity = 0.5 * (1 - ph / 3);
      });
    });
    return state;
  }

  // ---------- 出生城镇：威利河港 ----------
  function buildTown() {
    const S = LANDMARKS.SPAWN;
    // 中央木板码头广场
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(12, 40), MAT.wood);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(S.x, height(S.x, S.z) + 0.06, S.z);
    plaza.receiveShadow = true;
    scene.add(plaza);
    // 磨损圆环
    const ring = new THREE.Mesh(new THREE.RingGeometry(11.4, 12.2, 40), MAT.dark);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(plaza.position);
    scene.add(ring);
    // 黄铜船钟
    shipBell(S.x - 4, S.z - 3, 2.6);
    // 北侧威利号
    const boat = steamboat(S.x, S.z - 30);

    // 三环街区（留南码头街 + 东侧货运道豁口）
    const rnd = LCG(1928);
    const ringDefs = [{ r: 17, n: 7 }, { r: 27, n: 10 }, { r: 38, n: 14 }];
    ringDefs.forEach((rd, ri) => {
      for (let i = 0; i < rd.n; i++) {
        const a = (i / rd.n) * Math.PI * 2 + ri * 0.35;
        const deg = a * 180 / Math.PI % 360;
        // 南码头街豁口（+z 方向 60°..120°）与东侧货运道（330°..30°）
        if (deg > 55 && deg < 125) continue;
        if (deg > 325 || deg < 35) continue;
        const x = S.x + Math.cos(a) * rd.r;
        const z = S.z + Math.sin(a) * rd.r;
        const ry = -a + Math.PI / 2;   // 门朝广场
        if ((i + ri) % 2 === 0) domeHouse(x, z, ry, 0.9 + rnd() * 0.3, HOUSE_TINTS[(i + ri) % 5]);
        else boxHouse(x, z, ry, 0.85 + rnd() * 0.35, (i * 3 + ri) % 5);
      }
    });
    // 鱼货市集（广场西侧 4 摊位）
    for (let i = 0; i < 4; i++) marketStall(S.x - 13.5, S.z - 6 + i * 4, Math.PI / 2);
    // 锅炉铁匠铺（东侧）
    smithy(S.x + 13, S.z + 2, -Math.PI / 2);
    // 南码头门（系缆柱 + 篱笆翼墙）
    bollard(S.x - 3, S.z + 13.5); bollard(S.x + 3, S.z + 13.5);
    fenceLine([[S.x - 12, S.z + 12], [S.x - 8, S.z + 13], [S.x - 5, S.z + 13.5]]);
    fenceLine([[S.x + 5, S.z + 13.5], [S.x + 8, S.z + 13], [S.x + 12, S.z + 12]]);
    // 煤油灯环（4 真灯 + 4 假灯，南侧豁口留给码头街）
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const deg = a * 180 / Math.PI;
      if (deg > 60 && deg < 120) continue;
      lampPost(S.x + Math.cos(a) * 13.5, S.z + Math.sin(a) * 13.5, i % 2 === 0);
    }
    // 信号旗杆
    for (let i = 0; i < 5; i++) {
      const a = -0.5 + i * 0.42;
      flagPole(S.x + Math.cos(a) * 31, S.z + Math.sin(a) * 31, 6 + (i % 2));
    }
    // 雏菊花圃
    buildFlowerBed(S.x + 8, S.z - 8, 3, 14);
    buildFlowerBed(S.x - 9, S.z + 7, 2.5, 10);
    // 去农庄路上 3 栋谷仓小屋
    barn(168, 238, 0.6, 0.7); barn(178, 244, 0.3, 0.65); barn(186, 252, -0.2, 0.7);
    return boat;
  }

  // ---------- 牲畜农庄 ----------
  function buildVillage() {
    const V = LANDMARKS.VILLAGE;
    const spots = [[0, -10], [10, -4], [8, 9], [-6, 12], [-12, 0]];
    spots.forEach((p, i) => {
      const lp = landPlace(V.x + p[0], V.z + p[1], WATER_Y + 0.8);
      barn(lp.x, lp.z, i * 1.1, 0.85 + (i % 2) * 0.2);
    });
    const w1 = landPlace(V.x + 16, V.z - 12, WATER_Y + 0.8);
    const w2 = landPlace(V.x - 16, V.z + 8, WATER_Y + 0.8);
    windmill(w1.x, w1.z); windmill(w2.x, w2.z);
    // 弧形篱笆
    const arc = [];
    for (let i = 0; i <= 14; i++) {
      const a = -0.4 + i / 14 * 2.4;
      arc.push([V.x + Math.cos(a) * 26, V.z + Math.sin(a) * 26]);
    }
    fenceLine(arc);
  }

  // ---------- 植被 ----------
  let grassMat = null;
  function bentBladeGeo(h, w, bend) {
    const geo = new THREE.ConeGeometry(w, h, 4, 3);
    geo.translate(0, h / 2, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) + y * y * bend);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function windify(mat, amp) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uWind = { value: amp };
      mat.userData.sh = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ipos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float sw = sin(uTime * 1.7 + ipos.x * 0.31 + ipos.z * 0.23) * uWind * position.y;
            transformed.x += sw;
            transformed.z += sw * 0.4;
          #endif`);
    };
  }
  function buildGrass() {
    const rnd = LCG(555);
    // 2.6 万株弯曲锥形草簇
    const N = 26000;
    const geo = bentBladeGeo(0.55, 0.09, 0.42);
    grassMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    windify(grassMat, 0.16);
    const inst = new THREE.InstancedMesh(geo, grassMat, N);
    inst.frustumCulled = false;          // 防坑：包围球不含实例位移
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < N && tries < N * 6) {
      tries++;
      const x = (rnd() * 2 - 1) * 355;
      const z = (rnd() * 2 - 1) * 355;
      if (!okSpot(x, z)) continue;
      const y = height(x, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      const s = 0.7 + rnd() * 0.9;
      sc.set(s, s * (0.8 + rnd() * 0.6), s);
      v.set(x, y - 0.04, z);
      m.compose(v, q, sc);
      inst.setMatrixAt(placed, m);
      const g = 0.42 + rnd() * 0.28 - Math.min(0.18, height(x, z) * 0.01);
      col.setRGB(g * g, g * g * 0.99, g * g * 0.95);   // 平方抵消洗白
      inst.setColorAt(placed, col);
      placed++;
    }
    inst.count = placed;
    scene.add(inst);
    updateCbs.push((dt, t) => {
      if (grassMat.userData.sh) {
        grassMat.userData.sh.uniforms.uTime.value = t;
        grassMat.userData.sh.uniforms.uWind.value = 0.12 + weather.windPow * 0.22;
      }
    });
    // 400 丛"照扫级"密草（更大簇）
    const N2 = 400;
    const geo2 = bentBladeGeo(1.1, 0.24, 0.3);
    const mat2 = new THREE.MeshLambertMaterial({ color: C('#6f6a5c') });
    windify(mat2, 0.13);
    const inst2 = new THREE.InstancedMesh(geo2, mat2, N2);
    inst2.frustumCulled = false;
    let p2 = 0, t2 = 0;
    while (p2 < N2 && t2 < N2 * 8) {
      t2++;
      // 偏向音乐田/湖边/河岸
      let x, z;
      const zone = rnd();
      if (zone < 0.4) { x = LANDMARKS.FLOWER.x + (rnd() - 0.5) * 90; z = LANDMARKS.FLOWER.z + (rnd() - 0.5) * 90; }
      else if (zone < 0.7) { x = LANDMARKS.LAKE.x + (rnd() - 0.5) * 100; z = LANDMARKS.LAKE.z + (rnd() - 0.5) * 100; }
      else { x = (rnd() * 2 - 1) * 300; z = (rnd() * 2 - 1) * 300; }
      if (!okSpot(x, z)) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      const s = 0.8 + rnd() * 0.7;
      sc.set(s, s, s);
      v.set(x, height(x, z) - 0.05, z);
      m.compose(v, q, sc);
      inst2.setMatrixAt(p2++, m);
    }
    inst2.count = p2;
    scene.add(inst2);
    updateCbs.push((dt, t) => { if (mat2.userData.sh) mat2.userData.sh.uniforms.uTime.value = t; });
  }
  function buildFlowerBed(cx, cz, r, n) {
    const rnd = LCG(((cx * 13 + cz * 7) | 0) + 9);
    const geo = new THREE.CircleGeometry(0.14, 7);
    geo.rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: C('#e8e0cc'), side: THREE.DoubleSide }), n);
    inst.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * r;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 3);
      v.set(x, height(x, z) + 0.28, z);
      m.compose(v, q, sc);
      inst.setMatrixAt(i, m);
    }
    scene.add(inst);
  }
  function buildFlowers() {
    // 音乐田雏菊
    const rnd = LCG(808);
    const N = 500;
    const geo = new THREE.CircleGeometry(0.16, 7);
    geo.rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: C('#ded6c2'), side: THREE.DoubleSide }), N);
    inst.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    let placed = 0;
    while (placed < N) {
      const x = LANDMARKS.FLOWER.x + (rnd() - 0.5) * 95;
      const z = LANDMARKS.FLOWER.z + (rnd() - 0.5) * 95;
      if (height(x, z) < WATER_Y + 0.3) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 3);
      const s = 0.8 + rnd() * 0.6;
      sc.set(s, s, s);
      v.set(x, height(x, z) + 0.3, z);
      m.compose(v, q, sc);
      inst.setMatrixAt(placed++, m);
    }
    inst.count = placed;
    scene.add(inst);
  }
  function buildWillows() {
    const rnd = LCG(321);
    const spots = [];
    for (let i = 0; i < 10; i++) {
      const cx = i < 5 ? LANDMARKS.VILLAGE.x : LANDMARKS.LAKE.x;
      const cz = i < 5 ? LANDMARKS.VILLAGE.z : LANDMARKS.LAKE.z;
      const lp = landPlace(cx + (rnd() - 0.5) * 60, cz + (rnd() - 0.5) * 60, WATER_Y + 0.5);
      spots.push(lp);
    }
    spots.forEach(p => {
      if (!okSpot(p.x, p.z) && dist2(p.x, p.z, LANDMARKS.VILLAGE) > 34 && dist2(p.x, p.z, LANDMARKS.LAKE) > 40) return;
      const g = new THREE.Group();
      const y = height(p.x, p.z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 5.5, 8), MAT.dark);
      trunk.position.y = 2.75;
      trunk.rotation.z = (rnd() - 0.5) * 0.3;
      g.add(trunk);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.8, 10, 8),
        new THREE.MeshLambertMaterial({ color: C('#55503f') }));
      canopy.scale.set(1, 0.75, 1);
      canopy.position.y = 5.6;
      g.add(canopy);
      for (let i = 0; i < 7; i++) {   // 垂柳条
        const a = i / 7 * Math.PI * 2;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12),
          new THREE.MeshLambertMaterial({ color: C('#4a4636') }));
        strip.position.set(Math.cos(a) * 2.1, 3.8, Math.sin(a) * 2.1);
        g.add(strip);
      }
      g.position.set(p.x, y, p.z);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(g);
      addCollider(p.x, p.z, 0.9);
    });
  }
  function buildLakeProps() {
    // 睡莲
    const rnd = LCG(606);
    const geo = new THREE.CircleGeometry(0.5, 9, 0.5, Math.PI * 1.7);
    geo.rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: C('#cfc7b4'), side: THREE.DoubleSide }), 40);
    inst.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 26;
      const x = LANDMARKS.LAKE.x + Math.cos(a) * r, z = LANDMARKS.LAKE.z + Math.sin(a) * r;
      if (height(x, z) > WATER_Y - 0.3) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
      const s = 0.7 + rnd() * 0.8;
      sc.set(s, s, s);
      v.set(x, WATER_Y + 0.03, z);
      m.compose(v, q, sc);
      inst.setMatrixAt(i, m);
    }
    scene.add(inst);
    // 木桥（装饰，河道本身浅可涉水）
    const bx = 95, bz = 112;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 2.2), MAT.wood);
    deck.position.set(bx, WATER_Y + 0.9, bz);
    deck.rotation.y = 0.5;
    scene.add(deck);
    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        meshAt(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 6), MAT.dark, bx + i * 3.4, bz + j * 0.9, 0);
      }
    }
    // 泥滩芦苇码头
    const reedGeo = bentBladeGeo(2.2, 0.05, 0.16);
    const reedMat = new THREE.MeshLambertMaterial({ color: C('#7a7462') });
    windify(reedMat, 0.1);
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, 320);
    reeds.frustumCulled = false;
    let rp = 0;
    while (rp < 320) {
      const x = 140 + (rnd() - 0.5) * 60;
      const z = 268 + (rnd() - 0.5) * 50;
      const h = height(x, z);
      if (h > WATER_Y + 1.6 || h < WATER_Y - 0.9) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
      const s = 0.7 + rnd() * 0.8;
      sc.set(s, s, s);
      v.set(x, h, z);
      m.compose(v, q, sc);
      reeds.setMatrixAt(rp++, m);
    }
    reeds.count = rp;
    scene.add(reeds);
    updateCbs.push((dt, t) => { if (reedMat.userData.sh) reedMat.userData.sh.uniforms.uTime.value = t; });
  }
  function buildShrine() {
    const S = LANDMARKS.SHRINE;
    // 石柱群
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      const x = S.x + Math.cos(a) * 12, z = S.z + Math.sin(a) * 12;
      const h = 4.5 + (i % 3) * 1.2;
      const p = meshAt(new THREE.BoxGeometry(1.1, h, 0.9), MAT.gray, x, z, h / 2);
      p.rotation.y = a;
      addCollider(x, z, 0.9);
    }
    // 祭坛 + 老船钟
    meshAt(new THREE.BoxGeometry(2.6, 1.0, 2.6), MAT.iron, S.x, S.z, 0.5);
    shipBell(S.x, S.z + 4, 2.4);
    addCollider(S.x, S.z, 1.6);
  }
  function buildVolcanoProps() {
    const V = LANDMARKS.VOLCANO;
    const rnd = LCG(1313);
    // 鱼骨
    for (let i = 0; i < 6; i++) {
      const x = V.x + (rnd() - 0.5) * 70, z = V.z + (rnd() - 0.5) * 70;
      if (dist2(x, z, V) < 24) continue;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.22, 6, 12, Math.PI), MAT.paper);
      rib.position.set(x, height(x, z) + 0.2, z);
      rib.rotation.z = (rnd() - 0.5) * 0.6;
      rib.rotation.y = rnd() * 3;
      rib.castShadow = true;
      scene.add(rib);
    }
    // 煤晶
    for (let i = 0; i < 14; i++) {
      const x = V.x + (rnd() - 0.5) * 85, z = V.z + (rnd() - 0.5) * 85;
      if (dist2(x, z, V) < 22) continue;
      const g = new THREE.Group();
      const n = 3 + (rnd() * 4 | 0);
      for (let k = 0; k < n; k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.3 + rnd() * 0.3, 1.2 + rnd() * 1.6, 5), MAT.dark);
        c.position.set((rnd() - 0.5) * 1.2, 0.6, (rnd() - 0.5) * 1.2);
        c.rotation.z = (rnd() - 0.5) * 0.4;
        g.add(c);
      }
      g.position.set(x, height(x, z), z);
      scene.add(g);
      addCollider(x, z, 0.8);
    }
    // 锅炉篝火
    const bf = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 1.0, 10), MAT.iron);
    bf.position.set(V.x + 30, height(V.x + 30, V.z + 18) + 0.5, V.z + 18);
    scene.add(bf);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 8), MAT.glow);
    flame.position.set(V.x + 30, height(V.x + 30, V.z + 18) + 1.9, V.z + 18);
    scene.add(flame);
    pointLight(V.x + 30, height(V.x + 30, V.z + 18) + 2, V.z + 18, 1.1, 30);
    updateCbs.push((dt, t) => { flame.scale.y = 1 + Math.sin(t * 9) * 0.15; });
  }
  function buildRocksTrees() {
    const rnd = LCG(4321);
    // 巨石
    for (let i = 0; i < 44; i++) {
      const x = (rnd() * 2 - 1) * 340, z = (rnd() * 2 - 1) * 340;
      if (!okSpot(x, z)) continue;
      const s = 0.8 + rnd() * 2.2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0),
        new THREE.MeshLambertMaterial({ color: C('#6f6a5e'), flatShading: true }));
      rock.position.set(x, height(x, z) + s * 0.3, z);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.scale.y = 0.7 + rnd() * 0.5;
      rock.castShadow = true; rock.receiveShadow = true;
      scene.add(rock);
      addCollider(x, z, s * 0.75);
    }
    // 树木
    for (let i = 0; i < 36; i++) {
      const x = (rnd() * 2 - 1) * 340, z = (rnd() * 2 - 1) * 340;
      if (!okSpot(x, z)) continue;
      const g = new THREE.Group();
      const h = 3 + rnd() * 2.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, h, 6), MAT.dark);
      trunk.position.y = h / 2;
      g.add(trunk);
      const c1 = new THREE.Mesh(new THREE.SphereGeometry(1.5 + rnd(), 8, 6),
        new THREE.MeshLambertMaterial({ color: C('#4f4b3c') }));
      c1.position.y = h + 0.9;
      c1.scale.y = 0.85;
      g.add(c1);
      g.position.set(x, height(x, z), z);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(g);
      addCollider(x, z, 0.55);
    }
  }

  // ---------- 航标高台装饰 ----------
  function buildTower() {
    const T = LANDMARKS.TOWER;
    const y0 = height(T.x, T.z);
    // 环形航标石阶
    const ringSteps = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.5, 20), MAT.gray);
    ringSteps.position.set(T.x, y0 + 0.25, T.z);
    scene.add(ringSteps);
    // 中心航标灯
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 4.5, 8), MAT.iron);
    pole.position.set(T.x, y0 + 2.5, T.z);
    scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), MAT.glow);
    lamp.position.set(T.x, y0 + 4.9, T.z);
    scene.add(lamp);
    // 系缆柱 + 信号旗
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + 0.4;
      bollard(T.x + Math.cos(a) * 5.6, T.z + Math.sin(a) * 5.6);
    }
    flagPole(T.x + 2, T.z - 3, 8);
    updateCbs.push((dt, t) => { lamp.material.color.setRGB(0.9, 0.88 + Math.sin(t * 3) * 0.1, 0.7); });
  }

  // ---------- 史诗远景：白山环带 + 河港水塔 + 明轮船剪影 ----------
  function buildMountains() {
    const STEPS = 220;
    const pos = [], col = [], idx = [];
    const gapAz = Math.atan2(LANDMARKS.VOLCANO.z, LANDMARKS.VOLCANO.x); // 豁口朝向锅炉岛外侧
    for (let i = 0; i <= STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2;
      // 脊状噪声，平滑避尖峰
      let H = 78 + 34 * Math.sin(i * 0.11) + 22 * Math.sin(i * 0.29 + 1.1) + 12 * Math.sin(i * 0.53 + 2.2);
      H = Math.max(52, H);
      // 豁口
      let d = Math.abs(((a - gapAz + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      H *= 0.35 + 0.65 * sstep(0, 0.22, d);
      const rF = 405, rP = 445, rB = 495;
      const x = Math.cos(a), z = Math.sin(a);
      pos.push(x * rF, -5, z * rF);      // 前脚
      pos.push(x * rP, H, z * rP);       // 脊
      pos.push(x * rB, -5, z * rB);      // 后脚
      const snow = sstep(135, 155, H);
      const g = 0.52 + (H - 52) / 130 * 0.2;
      for (let k = 0; k < 3; k++) {
        const c = k === 1 ? (g + snow * 0.42) : g * 0.92;
        col.push(c, c, c * 0.98);
      }
      if (i < STEPS) {
        const b = i * 3;
        idx.push(b, b + 1, b + 3, b + 1, b + 4, b + 3);
        idx.push(b + 1, b + 2, b + 4, b + 2, b + 5, b + 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.baseCol = new THREE.Color(1, 1, 1);
    scene.add(mesh);
    mountains.push(mesh);

    // 巨大河港水塔（豁口后 560m）
    const tx = Math.cos(gapAz) * 560, tz = Math.sin(gapAz) * 560;
    const g = new THREE.Group();
    const tankMat = new THREE.MeshLambertMaterial({ map: canvasTex(plankCanvas(), 2), fog: true });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 20, 16), tankMat);
    tank.position.y = 78;
    g.add(tank);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(15.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.iron);
    dome.position.y = 88;
    g.add(dome);
    // 螺旋扭曲支架 8 根板状基脚
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 70, 0.7), MAT.dark);
      leg.position.set(Math.cos(a) * 12, 35, Math.sin(a) * 12);
      leg.rotation.y = -a + 0.35;
      leg.rotation.z = Math.cos(a) * 0.16;
      leg.rotation.x = -Math.sin(a) * 0.16;
      g.add(leg);
    }
    // 6 条高架水管
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 34, 8), MAT.iron);
      pipe.position.set(Math.cos(a) * 24, 60, Math.sin(a) * 24);
      pipe.rotation.z = Math.PI / 2;
      pipe.rotation.y = -a;
      g.add(pipe);
    }
    // 15 团蒸汽云
    const steamTex = new THREE.CanvasTexture(cloudCanvas());
    steamTex.encoding = THREE.sRGBEncoding;
    const rnd = LCG(71);
    for (let i = 0; i < 15; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0.45, depthWrite: false }));
      const a = rnd() * Math.PI * 2;
      sp.position.set(Math.cos(a) * (16 + rnd() * 14), 92 + rnd() * 26, Math.sin(a) * (16 + rnd() * 14));
      const s = 14 + rnd() * 16;
      sp.scale.set(s, s * 0.7, 1);
      g.add(sp);
    }
    // 环绕煤火光点
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 5), MAT.glow);
      f.position.set(Math.cos(a) * 20, 42 + (i % 3) * 6, Math.sin(a) * 20);
      g.add(f);
    }
    g.position.set(tx, 0, tz);
    g.traverse(o => { if (o.isMesh) o.material = o.material; });
    scene.add(g);
    towerGroup = g;

    // 远水 4 艘明轮船剪影
    for (let i = 0; i < 4; i++) {
      const ship = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(26, 4, 8),
        new THREE.MeshBasicMaterial({ color: 0x2c2822 }));
      hull.position.y = 2;
      ship.add(hull);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 6), hull.material);
      cab.position.y = 6;
      ship.add(cab);
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 1, 12), hull.material);
      wh.rotation.x = Math.PI / 2;
      wh.position.set(4, 3, 4.6);
      ship.add(wh);
      const a = -0.8 + i * 0.5;
      ship.position.set(Math.cos(a) * 520, WATER_Y, Math.sin(a) * 520);
      ship.rotation.y = -a + Math.PI / 2;
      ship.userData.drift = (i % 2 ? 1 : -1) * (1.5 + i * 0.4);
      scene.add(ship);
      farShips.push(ship);
    }
  }

  // ---------- 音乐货箱 ----------
  function buildCrates() {
    const tex = canvasTex(crateCanvas(), 1);
    const spots = [
      [142, 232], [196, 252], [205, -116], [138, -44],
      [-82, -116], [-188, -178], [72, 64], [-30, 30], [170, 90],
    ];
    spots.forEach(([x, z], i) => {
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      const y = height(x, z) + 2.7;
      m.position.set(x, y, z);
      m.castShadow = true;
      scene.add(m);
      crates.push({ mesh: m, hit: false, x, z, y, bounce: 0, pitch: [60, 62, 64, 67, 69, 72][i % 6] });
    });
  }
  function crateHit(crate) {
    if (crate.hit) return false;
    crate.hit = true;
    crate.bounce = 0.35;
    crate.mesh.material.color.setRGB(0.42, 0.42, 0.42);
    if (typeof Sound !== 'undefined') Sound.sfx('crateNote', crate.pitch + ((Math.random() * 3) | 0) * 2);
    return true;
  }

  // ---------- 云/远船更新 ----------
  function updateClouds(dt) {
    clouds.forEach(c => {
      c.position.x += weather.windX * dt * 3 + dt * 1.5;
      c.position.z += weather.windZ * dt * 3;
      if (c.position.x > 620) c.position.x = -620;
      c.material.opacity = (0.5 + weather.dark * 0.35) * (1 - weather.rain * 0.4);
    });
    farShips.forEach(s => {
      s.position.x += s.userData.drift * dt;
      if (s.position.x > 560) s.position.x = -560;
      if (s.position.x < -560) s.position.x = 560;
    });
  }

  // ---------- 初始化 / 主更新 ----------
  let boatState = null;
  function init(sc, cam) {
    scene = sc; camera = cam;
    scene.fog = new THREE.Fog(0x9a9484, 90, 560);
    scene.background = new THREE.Color(0x9a9484);
    buildMaterials();
    buildLights();
    const textures = {
      grass: canvasTex(noiseCanvas(256, 146, 64, 900), 1),
      rock: canvasTex(noiseCanvas(256, 112, 92, 500), 1),
      sand: canvasTex(noiseCanvas(256, 182, 34, 400), 1),
      forest: canvasTex(noiseCanvas(256, 96, 58, 700), 1),
    };
    buildTerrain(textures);
    buildWater();
    buildSky();
    buildRain();
    boatState = buildTown();
    buildVillage();
    buildTower();
    buildShrine();
    buildVolcanoProps();
    buildLakeProps();
    buildWillows();
    buildRocksTrees();
    buildFlowers();
    buildGrass();
    buildMountains();
    buildCrates();
    return World;
  }
  function update(dt, t) {
    updateDayNight(dt, t);
    updateWeather(dt, t);
    updateClouds(dt);
    for (let i = 0; i < updateCbs.length; i++) updateCbs[i](dt, t);
    crates.forEach(c => {
      if (c.bounce > 0) {
        c.bounce -= dt;
        c.mesh.position.y = c.y + Math.sin(Math.max(0, c.bounce) / 0.35 * Math.PI) * 0.35;
      }
      if (!c.hit) c.mesh.rotation.y += dt * 0.5;
    });
  }

  return {
    init, update, height, normal, landPlace, okSpot, riverDist,
    colliders, crates, addCollider, crateHit,
    LANDMARKS, WATER_Y, LAVA_Y, BORDER, weather, setWeather,
    get timeOfDay() { return timeOfDay; },
    setTimeOfDay(h) { timeOfDay = h; },
    get townBell() { return townBell; },
    ringBell() {
      if (townBell && typeof Sound !== 'undefined') {
        Sound.sfx('bell');
        const b = townBell.bell;
        b.userData.swing = 1;
      }
    },
    get boat() { return boatState; },
    LCG, sstep,
  };
})();
window.World = World;
