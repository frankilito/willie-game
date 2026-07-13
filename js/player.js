/* player.js — 第三人称汽船水手：移动 / 体力 / 攀爬 / 滑翔 / 翻滚 / 落锚 / 相机
 * 物理常量：重力 32、行走 5.6、奔跑 10.2、跳跃 12.8、世界边界 r=385。
 */
const Player = (function () {
  'use strict';
  const GRAVITY = 32;
  const WALK = 5.6, RUN = 10.2, JUMP = 12.8;
  const BORDER = 385;
  const WATER_Y = 0.15;

  const p = {
    pos: new THREE.Vector3(150, 4, 236),
    vel: new THREE.Vector3(),
    facing: Math.PI,           // 模型朝向（绕 y）
    camYaw: Math.PI, camPitch: 0.28, camDist: 8,
    state: 'air',              // ground/air/swim/climb/glide/roll/pound/dead
    onGround: false,
    hp: 6, maxHp: 6,           // 半心为单位
    stamina: 100, maxStamina: 100, staminaFlash: 0,
    coins: 0, kills: 0, deaths: 0,
    iframes: 0, dead: false,
    jumps: 0,
    rollT: 0, rollDX: 0, rollDZ: 0,
    poundT: 0,
    climbT: 0,
    flipT: 0,                  // 二段跳后空翻计时
    cheat: false,
    tPress: [],
    currentAnim: '',
    invulnBlink: 0,
    checkpoint: { x: 150, z: 236 },
    inv: {
      weapons: [null, null, null, null],
      active: 0,
      shield: null,
      lifebuoy: null,
      glider: true,
      goldenWhistle: false,
      items: {},
    },
  };

  let scene, camera, model, mixer, bones = {}, actions = {}, gliderMesh, anchorMesh, barMesh;
  let domEl;
  const mouse = { dx: 0, dy: 0 };
  const keys = {};
  let locked = false;
  let footT = 0;
  let landAnimT = 0;
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

  // ---------- 初始化 ----------
  function init(sc, cam, gltf) {
    scene = sc; camera = cam;
    p.pos.set(150, World.height(150, 236), 236);

    // 模型
    model = gltf.scene;
    model.traverse(o => {
      if (o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        // 外轮廓加粗：反向 hull
        const olMat = new THREE.MeshBasicMaterial({ color: 0x0a0907, side: THREE.BackSide });
        olMat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\ntransformed += normal * 0.022;');
        };
        const ol = new THREE.SkinnedMesh(o.geometry, olMat);
        ol.bind(o.skeleton);
        ol.frustumCulled = false;
        o.parent.add(ol);
      }
    });
    ['HandR', 'ArmR1', 'ArmR2', 'ShoulderR', 'HandL', 'ArmL1', 'ArmL2', 'ShoulderL', 'Head', 'Spine2',
      'HipL', 'HipR', 'KneeL', 'KneeR', 'FootL', 'FootR', 'Root'].forEach(n => {
      const b = model.getObjectByName(n);
      if (b) bones[n] = b;
    });
    mixer = new THREE.AnimationMixer(model);
    gltf.animations.forEach(a => { actions[a.name] = mixer.clipAction(a); });
    scene.add(model);

    buildGlider();
    buildAnchor();
    setupInput();

    p.pos.y = World.height(p.pos.x, p.pos.z);
    playAnim('idle', 0);
    return p;
  }

  // ---------- 帆布滑翔翼（黑白条纹船帆 + 木横杆弯曲） ----------
  function buildGlider() {
    gliderMesh = new THREE.Group();
    const cvs = document.createElement('canvas');
    cvs.width = 128; cvs.height = 64;
    const g = cvs.getContext('2d');
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#e8dcc0' : '#2c2820';
      g.fillRect(i * 16, 0, 16, 64);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.encoding = THREE.sRGBEncoding;
    const sailGeo = new THREE.PlaneGeometry(3.4, 1.6, 6, 2);
    const sailMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.rotation.x = -0.5;
    gliderMesh.add(sail);
    barMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.8, 6),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#5a5040').convertSRGBToLinear() }));
    barMesh.rotation.z = Math.PI / 2;
    barMesh.position.set(0, -0.55, 0.3);
    gliderMesh.add(barMesh);
    gliderMesh.position.set(0, 2.35, -0.2);
    gliderMesh.visible = false;
    model.add(gliderMesh);
  }
  function buildAnchor() {
    anchorMesh = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#2a2620').convertSRGBToLinear() });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 8), mat);
    shaft.position.y = 0.55;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 12), mat);
    ring.position.y = 1.35;
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), mat);
    stock.rotation.z = Math.PI / 2; stock.position.y = 1.05;
    const fluke = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.1, 6, 14, Math.PI), mat);
    fluke.position.y = -0.15; fluke.rotation.z = Math.PI;
    anchorMesh.add(shaft, ring, stock, fluke);
    anchorMesh.position.set(0, 1.5, 0.5);
    anchorMesh.visible = false;
    model.add(anchorMesh);
  }

  // ---------- 输入 ----------
  function setupInput() {
    domEl = renderer().domElement;
    domEl.addEventListener('click', () => {
      if (!G.started || p.dead) return;
      if (UI.isDialogueOpen()) return;
      if (!locked && domEl.requestPointerLock) {
        try { const pr = domEl.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {}
      }
    });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === domEl;
    });
    document.addEventListener('mousemove', (e) => {
      if (!locked) return;
      mouse.dx += e.movementX || 0;
      mouse.dy += e.movementY || 0;
    });
    domEl.addEventListener('wheel', (e) => {
      p.camDist = Math.max(3.5, Math.min(16, p.camDist + e.deltaY * 0.008));
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      // 金手指：2.5 秒内连按三次 T（兼容输入法）
      if (e.code === 'KeyT' && e.key === 't') {
        const now = performance.now();
        p.tPress = p.tPress.filter(t => now - t < 2500);
        p.tPress.push(now);
        if (p.tPress.length >= 3) {
          p.tPress = [];
          p.cheat = !p.cheat;
          if (window.UI) UI.toast(p.cheat ? '5 倍移速 ON' : '5 倍移速 OFF');
          if (window.Sound) Sound.sfx('cheat');
        }
      }
      if (e.code === 'KeyH' && G.started && !UI.isDialogueOpen()) UI.toggleHelp();
      if (e.code === 'KeyM') { if (window.Sound) UI.toast(Sound.toggleMute() ? '已静音' : '声音开'); }
      // 对话推进 / 攻击拦截
      if (UI.isDialogueOpen()) {
        if (e.code === 'Space' || e.code === 'KeyE') { UI.advanceDialogue(); e.preventDefault(); }
        return;
      }
      if (!G.started || p.dead) return;
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyE') { if (window.Npc) Npc.tryTalk(); G.interactE = true; }
      if (e.code === 'KeyC') startRoll();
      if (e.code === 'KeyF') { if (window.Combat) Combat.throwLifebuoy(); }
      if (e.code === 'Digit1') equipSlot(0);
      if (e.code === 'Digit2') equipSlot(1);
      if (e.code === 'Digit3') equipSlot(2);
      if (e.code === 'Digit4') equipSlot(3);
    });
    document.addEventListener('keyup', (e) => { keys[e.code] = false; });
    domEl.addEventListener('mousedown', (e) => {
      if (!G.started || p.dead || UI.isDialogueOpen()) return;
      if (e.button === 0) { if (window.Combat) Combat.onLeftDown(); }
      if (e.button === 2) { if (window.Combat) Combat.onRightDown(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0 && window.Combat) Combat.onLeftUp();
      if (e.button === 2 && window.Combat) Combat.onRightUp();
    });
    domEl.addEventListener('contextmenu', e => e.preventDefault());
  }
  function renderer() { return G.renderer; }

  // ---------- 动画 ----------
  function playAnim(name, fade) {
    if (!actions[name] || p.currentAnim === name) return;
    const prev = actions[p.currentAnim];
    const next = actions[name];
    next.reset();
    next.setLoop(name === 'die' || name === 'land' ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = true;
    next.play();
    if (prev && fade !== 0) prev.crossFadeTo(next, fade == null ? 0.12 : fade, false);
    else if (prev) prev.stop();
    p.currentAnim = name;
  }

  // ---------- 翻滚 ----------
  function startRoll() {
    if (p.rollT > 0 || p.state === 'dead' || p.state === 'swim' || p.stamina < 12) return;
    p.stamina -= 12;
    p.rollT = 0.42;
    p.iframes = Math.max(p.iframes, 0.42);
    const mv = moveInputDir();
    if (mv.lengthSq() > 0.01) { p.rollDX = mv.x; p.rollDZ = mv.z; }
    else { p.rollDX = Math.sin(p.facing); p.rollDZ = Math.cos(p.facing); }
    p.flipT = 0.42;
    if (window.Sound) Sound.sfx('roll');
    playAnim('squash', 0.06);
  }

  // ---------- 移动输入方向（相机相对） ----------
  function moveInputDir() {
    let x = 0, z = 0;
    if (keys['KeyW']) z -= 1;
    if (keys['KeyS']) z += 1;
    if (keys['KeyA']) x -= 1;
    if (keys['KeyD']) x += 1;
    tmpV.set(0, 0, 0);
    if (x === 0 && z === 0) return tmpV;
    const yaw = p.camYaw;
    const fwd = tmpV2.set(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    tmpV.copy(fwd).multiplyScalar(-z).add(right.multiplyScalar(x)).normalize();
    // z=-1 (W) 应朝相机前方：fwd 是相机朝向的水平分量
    tmpV.copy(fwd).multiplyScalar(-z).add(new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(x)).normalize();
    return tmpV;
  }

  // ---------- 主更新 ----------
  function update(dt) {
    if (!G.started) return;
    // 相机输入
    p.camYaw -= mouse.dx * 0.0024;
    p.camPitch = Math.max(-0.85, Math.min(0.95, p.camPitch - mouse.dy * 0.0024));
    mouse.dx = mouse.dy = 0;

    if (p.dead) { updateDead(dt); updateCamera(dt); mixer.update(dt); return; }

    const inWater = p.pos.y < WATER_Y - 0.35;
    const h = World.height(p.pos.x, p.pos.z);
    const nrm = World.normal(p.pos.x, p.pos.z);
    const onGround = p.pos.y <= h + 0.02 && p.vel.y <= 0.01;
    p.onGround = onGround && !inWater;

    // 状态判定
    if (p.rollT > 0) p.state = 'roll';
    else if (inWater && h < WATER_Y - 0.6) p.state = 'swim';
    else if (p.state === 'pound') {}
    else if (!onGround) p.state = (keys['Space'] && p.inv.glider && p.stamina > 0 && p.vel.y < 2) ? 'glide' : 'air';
    else p.state = 'ground';

    const mv = moveInputDir();
    const hasMove = mv.lengthSq() > 0.01;
    let speed = 0;

    if (p.state === 'swim') updateSwim(dt, mv, hasMove);
    else if (p.state === 'roll') updateRoll(dt);
    else {
      // 攀爬判定：陡坡 + 按住前进 + 有体力
      const steep = nrm.y < 0.55;
      if (steep && hasMove && p.stamina > 0 && p.state !== 'pound') {
        updateClimb(dt, mv, nrm);
      } else {
        // 常规移动
        let target = 0;
        if (hasMove) {
          target = WALK;
          if (keys['ShiftLeft'] || keys['ShiftRight']) {
            if (p.stamina > 0) { target = RUN; p.stamina -= 7 * dt; p.staminaFlash = 1; }
          }
          if (p.state === 'glide') target = 7.5;
          if (p.cheat) target *= 5;
          speed = target;
        }
        // 翻滚期间跳过速度 lerp（防坑）
        const k = 1 - Math.exp(-13 * dt);
        const tvx = mv.x * speed, tvz = mv.z * speed;
        p.vel.x += (tvx - p.vel.x) * k;
        p.vel.z += (tvz - p.vel.z) * k;

        // 重力 / 滑翔
        if (p.state === 'glide') {
          p.vel.y = Math.max(p.vel.y - GRAVITY * 0.25 * dt, -3.5);
          p.stamina -= 5 * dt;
          if (p.stamina <= 0) p.stamina = 0;
        } else if (!onGround) {
          p.vel.y -= GRAVITY * dt;
        } else {
          p.vel.y = 0;
        }
        // 陡坡滑落
        if (onGround && steep) {
          p.vel.x += -nrm.x * 14 * dt;
          p.vel.z += -nrm.z * 14 * dt;
        }
        // 跳跃 / 二段跳
        if (jumpPressed) {
          if (onGround) {
            p.vel.y = JUMP;
            p.jumps = 1;
            playAnim('jump', 0.08);
            if (window.Sound) Sound.onNext16th(() => Sound.sfx('jump'));
          } else if (p.jumps < 2 && p.state !== 'pound' && p.stamina > 6) {
            p.vel.y = 10.5;
            p.jumps = 2;
            p.flipT = 0.5;
            p.stamina -= 6;
            if (window.Sound) Sound.sfx('doublejump');
          }
        }
        jumpPressed = false;
        // 体力恢复
        if (onGround && !(keys['ShiftLeft'] || keys['ShiftRight'])) {
          p.stamina = Math.min(p.maxStamina, p.stamina + 14 * dt);
        }
      }
    }

    // 积分位移
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;

    // 落地
    const h2 = World.height(p.pos.x, p.pos.z);
    if (p.pos.y <= h2 && p.vel.y <= 0) {
      const impact = p.vel.y;
      p.pos.y = h2;
      p.vel.y = 0;
      if (!p.onGround && p.state !== 'swim') {
        if (impact < -22) {
          const dmg = Math.min(4, Math.floor((-impact - 20) / 4));
          damage(dmg, p.pos.x, p.pos.z - 1, true);
          if (window.Sound) Sound.sfx('bigland');
          if (window.UI) UI.shake(0.6);
        } else if (impact < -6) {
          if (window.Sound) Sound.sfx('land');
          landAnimT = 0.3;
          playAnim('land', 0.05);
        }
      }
      if (p.state === 'pound') endPound();
      p.jumps = 0;
    }
    p.onGround = p.pos.y <= World.height(p.pos.x, p.pos.z) + 0.02;

    // 圆柱碰撞体
    collideCylinders();
    // 世界边界
    const r = Math.hypot(p.pos.x, p.pos.z);
    if (r > BORDER) {
      p.pos.x *= BORDER / r;
      p.pos.z *= BORDER / r;
    }
    // 白热煤浆
    checkLava(dt);
    // 音乐货箱（跳起顶箱）
    checkCrates();
    // 金币磁吸
    if (window.Combat) Combat.updatePickups(dt, p.pos);

    // 计时器
    if (p.iframes > 0) p.iframes -= dt;
    if (p.rollT > 0) p.rollT -= dt;
    if (p.staminaFlash > 0) p.staminaFlash -= dt * 2;
    if (landAnimT > 0) landAnimT -= dt;
    if (p.flipT > 0) p.flipT -= dt;

    // 朝向
    const hv = Math.hypot(p.vel.x, p.vel.z);
    if (hv > 0.6 && p.state !== 'pound') {
      const target = Math.atan2(p.vel.x, p.vel.z);
      let df = target - p.facing;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      p.facing += df * (1 - Math.exp(-14 * dt));
    }

    // 动画状态机
    updateAnim(hv);
    // 模型变换
    model.position.copy(p.pos);
    model.rotation.y = p.facing;
    // 后空翻 / 翻滚旋转
    if (p.flipT > 0) {
      const ph = 1 - p.flipT / (p.rollT > 0 ? 0.42 : 0.5);
      model.rotation.x = ph * Math.PI * 2;
    } else model.rotation.x = 0;
    // 受伤闪烁
    if (p.iframes > 0 && !p.dead) {
      p.invulnBlink += dt * 20;
      model.visible = Math.sin(p.invulnBlink) > -0.3;
    } else model.visible = true;
    // 滑翔翼 / 船锚显隐 + 木杆弯曲
    gliderMesh.visible = p.state === 'glide';
    if (gliderMesh.visible) barMesh.rotation.z = Math.PI / 2 + Math.sin(performance.now() * 0.006) * 0.08;
    anchorMesh.visible = p.state === 'pound';

    mixer.update(dt);
    updateCamera(dt);

    // 脚步声
    if (p.onGround && hv > 1.5 && p.state !== 'swim') {
      footT -= dt;
      if (footT <= 0) {
        footT = hv > 7 ? 0.24 : 0.38;
        if (window.Sound) Sound.onNext16th(() => Sound.sfx('footstep'), 60);
      }
    }
  }

  let jumpPressed = false;
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) jumpPressed = true;
  });

  function updateSwim(dt, mv, hasMove) {
    const k = 1 - Math.exp(-8 * dt);
    const sp = 3.2 * (p.cheat ? 5 : 1);
    p.vel.x += (mv.x * sp - p.vel.x) * k;
    p.vel.z += (mv.z * sp - p.vel.z) * k;
    let vy = 0.4;   // 缓慢上浮
    if (keys['Space']) vy = 2.2;
    if (keys['ShiftLeft']) vy = -1.8;
    p.vel.y += (vy - p.vel.y) * k;
    p.stamina = Math.min(p.maxStamina, p.stamina + 6 * dt);
    if (Math.hypot(p.vel.x, p.vel.z) > 0.5) {
      footT -= dt;
      if (footT <= 0) { footT = 0.6; if (window.Sound) Sound.sfx('swim'); }
    }
  }
  function updateRoll(dt) {
    const sp = 13 * (p.cheat ? 2 : 1);
    p.vel.x = p.rollDX * sp;
    p.vel.z = p.rollDZ * sp;
    p.vel.y -= GRAVITY * dt * 0.5;
    if (p.onGround) p.vel.y = 0;
  }
  function updateClimb(dt, mv, nrm) {
    p.state = 'climb';
    // 贴面吸附 + W 向上
    const up = tmpV2.set(0, 1, 0);
    const slopeUp = new THREE.Vector3(nrm.x, 0, nrm.z).normalize().multiplyScalar(-1); // 上坡水平方向
    const rainMul = World.weather.rain > 0.3 ? 1.6 : 1;
    p.stamina -= 9 * rainMul * dt;
    if (p.stamina <= 0) { p.stamina = 0; p.vel.y = -2; return; }
    const climbSpeed = 3.0;
    if (keys['KeyW']) {
      p.vel.x = slopeUp.x * climbSpeed * 0.6;
      p.vel.z = slopeUp.z * climbSpeed * 0.6;
      p.vel.y = climbSpeed;
    } else {
      p.vel.set(-nrm.x * 1.5, 0, -nrm.z * 1.5);   // 吸附
    }
    // 顶部翻越：前方高处可站
    const ax = p.pos.x + slopeUp.x * 1.2, az = p.pos.z + slopeUp.z * 1.2;
    const aheadH = World.height(ax, az);
    if (aheadH > p.pos.y + 0.4 && aheadH < p.pos.y + 1.6 && World.normal(ax, az).y > 0.6) {
      p.pos.x = ax; p.pos.z = az; p.pos.y = aheadH;
      p.vel.set(0, 0, 0);
      if (window.Sound) Sound.sfx('land');
    }
    if (jumpPressed) { p.vel.y = 9; p.vel.x = nrm.x * 5; p.vel.z = nrm.z * 5; jumpPressed = false; p.jumps = 1; }
    p.climbT += dt;
  }

  // ---------- 落锚下砸 ----------
  function startPound() {
    if (p.onGround || p.state === 'pound' || p.state === 'swim') return false;
    p.state = 'pound';
    p.vel.set(0, -34, 0);
    if (window.Sound) Sound.sfx('whistleSfx');
    return true;
  }
  function endPound() {
    p.state = 'ground';
    p.poundT = 0.3;
    if (window.Combat) Combat.groundPound(p.pos.clone());
    if (window.Sound) Sound.sfx('anchorSlam');
    if (window.UI) UI.shake(0.9);
    playAnim('land', 0.04);
  }

  // ---------- 碰撞 ----------
  function collideCylinders() {
    const R = 0.5;
    const cols = World.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + R;
      if (d < min && d > 0.0001) {
        const push = (min - d);
        p.pos.x += dx / d * push;
        p.pos.z += dz / d * push;
        // 切向滑动
        const nx = dx / d, nz = dz / d;
        const into = p.vel.x * nx + p.vel.z * nz;
        if (into < 0) { p.vel.x -= into * nx; p.vel.z -= into * nz; }
      }
    }
  }
  function checkLava(dt) {
    const V = World.LANDMARKS.VOLCANO;
    const d = Math.hypot(p.pos.x - V.x, p.pos.z - V.z);
    if (d < 26 && p.pos.y < World.LAVA_Y + 0.3) {
      damage(2, V.x, V.z, true);
      p.vel.y = 15;
      p.vel.x += (p.pos.x - V.x) / (d || 1) * 8;
      p.vel.z += (p.pos.z - V.z) / (d || 1) * 8;
      if (window.Sound) Sound.sfx('explosion');
    }
  }
  function checkCrates() {
    if (p.vel.y <= 0) return;
    const headY = p.pos.y + 1.95;
    World.crates.forEach(c => {
      if (c.hit) return;
      if (Math.abs(p.pos.x - c.x) < 0.9 && Math.abs(p.pos.z - c.z) < 0.9) {
        if (headY > c.y - 0.6 && p.pos.y < c.y) {
          if (World.crateHit(c)) {
            p.vel.y = -2;
            if (window.Combat) Combat.spawnCoins(new THREE.Vector3(c.x, c.y, c.z), 5);
          }
        }
      }
    });
  }

  // ---------- 动画映射 ----------
  function updateAnim(hv) {
    if (landAnimT > 0) return;
    if (p.state === 'roll') return;
    if (p.state === 'dead') return;
    if (p.state === 'swim') { playAnim('steer'); return; }
    if (p.state === 'climb') { playAnim('walk', 0.08); return; }
    if (p.state === 'glide') { playAnim('fall', 0.15); return; }
    if (p.state === 'pound') { playAnim('stretch', 0.1); return; }
    if (!p.onGround) { playAnim(p.vel.y > 0 ? 'jump' : 'fall', 0.1); return; }
    if (hv > 7) playAnim('run', 0.1);
    else if (hv > 0.6) playAnim('walk', 0.1);
    else playAnim('idle', 0.15);
  }

  // ---------- 相机 ----------
  function updateCamera(dt) {
    const cy = p.camYaw, cp = p.camPitch, cd = p.camDist;
    const ox = Math.sin(cy) * Math.cos(cp) * cd;
    const oz = Math.cos(cy) * Math.cos(cp) * cd;
    const oy = Math.sin(cp) * cd + 1.4;
    let tx = p.pos.x - ox, tz = p.pos.z - oz;
    let ty = p.pos.y + oy;
    ty = Math.max(ty, World.height(tx, tz) + 0.8);    // 地形防穿
    // 建筑碰撞：相机也避让圆柱碰撞体
    const cols = World.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const dx = tx - c.x, dz = tz - c.z;
      const d = Math.hypot(dx, dz);
      if (d < c.r + 0.6 && d > 0.001) {
        tx = c.x + dx / d * (c.r + 0.6);
        tz = c.z + dz / d * (c.r + 0.6);
      }
    }
    const k = 1 - Math.exp(-10 * dt);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    camera.lookAt(p.pos.x, p.pos.y + 1.15, p.pos.z);
  }

  // ---------- 死亡 ----------
  function updateDead(dt) {
    p.vel.y -= GRAVITY * dt;
    p.pos.addScaledVector(p.vel, dt);
    const h = World.height(p.pos.x, p.pos.z);
    if (p.pos.y < h) { p.pos.y = h; p.vel.set(0, 0, 0); }
    model.position.copy(p.pos);
    model.rotation.y = p.facing;
    p.deadT -= dt;
    if (p.deadT <= 0) respawn();
  }
  function respawn() {
    p.dead = false;
    p.hp = p.maxHp;
    p.pos.set(p.checkpoint.x, World.height(p.checkpoint.x, p.checkpoint.z), p.checkpoint.z);
    p.vel.set(0, 0, 0);
    p.iframes = 2;
    model.visible = true;
    model.rotation.x = 0;
    playAnim('idle', 0);
    if (window.UI) UI.toast('从检查点重来');
  }

  // ---------- 伤害/治疗/道具 ----------
  function damage(amount, srcX, srcZ, ignoreIframes) {
    if (p.dead || (!ignoreIframes && p.iframes > 0)) return 0;
    // 盾牌格挡由 Combat 裁决
    if (window.Combat && !ignoreIframes) {
      amount = Combat.mitigate(amount, srcX, srcZ);
      if (amount <= 0) return 0;
    }
    p.hp -= amount;
    p.iframes = 1.0;
    const dx = p.pos.x - srcX, dz = p.pos.z - srcZ;
    const d = Math.hypot(dx, dz) || 1;
    p.vel.x += dx / d * 6;
    p.vel.z += dz / d * 6;
    p.vel.y = Math.max(p.vel.y, 4);
    if (window.Sound) Sound.sfx('hurt');
    if (window.UI) { UI.shake(0.4); UI.flash(0.12); }
    if (p.hp <= 0) {
      p.hp = 0;
      die();
    }
    return amount;
  }
  function die() {
    if (p.dead) return;
    p.dead = true;
    p.deaths++;
    p.deadT = 2.6;
    p.vel.set(0, 3, 0);
    playAnim('die', 0.15);
    if (window.Sound) { Sound.sfx('death'); }
    if (window.Net && Net.connected) Net.send('event', { name: 'playerDied' });
  }
  function heal(n) { p.hp = Math.min(p.maxHp, p.hp + n); }
  function addContainer() { p.maxHp += 2; p.hp = p.maxHp; }
  function addCoins(n) { p.coins += n; }
  function spendCoins(n) {
    if (p.coins < n) return false;
    p.coins -= n;
    return true;
  }
  function addStaminaCap(n) { p.maxStamina += n; p.stamina = p.maxStamina; }

  function giveItem(key) {
    if (p.inv.items[key]) return false;
    p.inv.items[key] = true;
    const W = {
      mop: { key: 'mop', name: '甲板拖把', dmg: 10, dur: 40, maxDur: 40 },
      shovel: { key: 'shovel', name: '锅炉煤铲', dmg: 20, dur: 26, maxDur: 26 },
      whistle: { key: 'whistle', name: '锅炉汽笛', dmg: 8, dur: 34, maxDur: 34 },
      bow: { key: 'bow', name: '鱼叉弓', dmg: 8, dur: 30, maxDur: 30 },
    };
    if (key === 'shield') { p.inv.shield = { key: 'shield', name: '舵轮盾', dur: 30, maxDur: 30 }; }
    else if (key === 'lifebuoy') { p.inv.lifebuoy = { key: 'lifebuoy', name: '救生圈', dur: 1, maxDur: 1 }; }
    else if (W[key]) {
      // 放入第一个空槽，满了就替换当前槽
      let slot = p.inv.weapons.findIndex(w => !w);
      if (slot < 0) slot = p.inv.active;
      p.inv.weapons[slot] = Object.assign({}, W[key]);
      p.inv.active = slot;
      if (window.Combat) Combat.mountWeapon();
    }
    if (window.UI) UI.toast('获得：' + (W[key] ? W[key].name : key === 'shield' ? '舵轮盾' : '救生圈'));
    if (window.Sound) Sound.sfx('itemget');
    return true;
  }
  function hasItem(key) { return !!p.inv.items[key]; }
  function equipSlot(i) {
    if (p.inv.weapons[i]) {
      p.inv.active = i;
      if (window.Combat) Combat.mountWeapon();
      if (window.Sound) Sound.sfx('ui');
    }
  }
  function activeWeapon() { return p.inv.weapons[p.inv.active]; }
  function repairAll() {
    p.inv.weapons.forEach(w => { if (w) w.dur = w.maxDur; });
    if (p.inv.shield) p.inv.shield.dur = p.inv.shield.maxDur;
    if (window.Combat) Combat.mountWeapon();
  }
  function setCheckpoint(x, z, silent) {
    p.checkpoint = { x, z };
    if (!silent) {
      if (window.Sound) Sound.sfx('checkpoint');
      if (window.UI) UI.toast('检查点已记录');
    }
  }
  function teleport(x, z) {
    p.pos.set(x, World.height(x, z), z);
    p.vel.set(0, 0, 0);
  }

  // ---------- 调试用全装备 ----------
  function giveAll() {
    ['mop', 'shovel', 'whistle', 'bow', 'shield', 'lifebuoy'].forEach(k => giveItem(k));
    addContainer(); addContainer();
    addStaminaCap(45);
    p.coins = 100;
  }

  return {
    init, update, playAnim,
    get state() { return p; },
    get pos() { return p.pos; },
    get vel() { return p.vel; },
    get facing() { return p.facing; },
    get camYaw() { return p.camYaw; },
    get model() { return model; },
    get bones() { return bones; },
    get mixer() { return mixer; },
    damage, heal, addContainer, addCoins, spendCoins, addStaminaCap,
    giveItem, hasItem, equipSlot, activeWeapon, repairAll,
    setCheckpoint, teleport, giveAll, startPound,
    keys,
  };
})();
window.Player = Player;
