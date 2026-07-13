/* combat.js — 武器装备 / 格挡 / 救生圈 / 鱼叉弓 / VFX（月牙墨线等）/ 投射物 / 拾取物
 * 视觉准则：像高预算黑白动画——墨线、蒸汽、汽笛环，而非彩色魔法。
 */
const Combat = (function () {
  'use strict';
  let scene, camera, P;         // P = Player.state
  const GRIP = { mop: 'HandR', shovel: 'HandR', whistle: 'HandR', bow: 'HandL' };
  const meshes = {};            // 武器模型缓存
  let weaponNode = null;        // 当前挂在手骨的节点
  let shieldMesh = null, shieldSpin = 0, blocking = false;
  let buoy = null;              // 救生圈状态
  let bowCharge = 0, bowCharging = false;
  let attackCd = 0, swingSide = 1;
  const projectiles = [];
  const vfxList = [];
  const coins = [];
  const milks = [];
  let goldenWhistleMesh = null;
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

  function init(sc, cam) {
    scene = sc; camera = cam;
    P = Player.state;
    buildShieldMesh();
  }

  // ---------- 武器模型（船上日用品变夸张道具） ----------
  function matC(hex, opts) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(hex).convertSRGBToLinear() }, opts || {}));
  }
  function buildWeaponMesh(key) {
    if (meshes[key]) return meshes[key];
    const g = new THREE.Group();
    if (key === 'mop') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), matC('#6a5f4c'));
      handle.position.y = 0.75;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 8), matC('#cfc7b4'));
      head.position.y = 1.55; head.rotation.x = Math.PI;
      for (let i = 0; i < 6; i++) {   // 拖布条
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.05), matC('#b3ab96'));
        const a = i / 6 * Math.PI * 2;
        strip.position.set(Math.cos(a) * 0.13, 1.35, Math.sin(a) * 0.13);
        g.add(strip);
      }
      g.add(handle, head);
      g.rotation.x = -0.5;
    } else if (key === 'shovel') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.2, 6), matC('#6a5f4c'));
      handle.position.y = 0.6;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.12), matC('#3a342a'));
      blade.position.y = 1.35;
      const grip = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 10), matC('#6a5f4c'));
      grip.position.y = -0.02;
      g.add(handle, blade, grip);
      g.rotation.x = -0.35;
    } else if (key === 'whistle') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.55, 10), matC('#8b8577'));
      body.rotation.z = Math.PI / 2; body.position.set(0.25, 0.25, 0);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 10, 1, true), matC('#b8a878', { side: THREE.DoubleSide }));
      horn.rotation.z = -Math.PI / 2; horn.position.set(0.75, 0.25, 0);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), matC('#45403a'));
      top.position.set(0.1, 0.55, 0);
      g.add(body, horn, top);
    } else if (key === 'bow') {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 16, Math.PI * 1.35), matC('#5a5040'));
      arc.rotation.z = Math.PI * 0.83;
      const stringGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.42, 0.72, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.42, -0.72, 0)]);
      const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0x2a2620 }));
      g.add(arc, string);
      g.userData.string = string;
    }
    meshes[key] = g;
    return g;
  }
  function buildHarpoonMesh() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), matC('#6a5f4c'));
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), matC('#45403a'));
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.95;
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 5), matC('#45403a'));
    barb.rotation.x = -Math.PI / 2 - 0.5; barb.position.z = 0.7;
    g.add(shaft, tip, barb);
    return g;
  }
  function buildShieldMesh() {
    shieldMesh = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 18), matC('#5a5040'));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), matC('#3a342a'));
    hub.rotation.x = Math.PI / 2;
    shieldMesh.add(rim, hub);
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.84, 6), matC('#6a5f4c'));
      spoke.rotation.z = i * Math.PI / 6;
      shieldMesh.add(spoke);
      const peg = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), matC('#3a342a'));
      const a = i / 6 * Math.PI * 2;
      peg.position.set(Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0);
      shieldMesh.add(peg);
    }
    shieldMesh.visible = false;
  }
  function buildBuoyMesh() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.17, 8, 20), matC('#e8e0cc'));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), matC('#8b8577'));
      const a = i / 4 * Math.PI * 2;
      band.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
      band.rotation.y = -a;
      g.add(band);
    }
    // 白色辉光盘
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    glow.rotation.x = -Math.PI / 2;
    g.add(glow);
    g.userData.glow = glow;
    return g;
  }

  // ---------- 挂载武器到手骨 ----------
  function mountWeapon() {
    if (weaponNode && weaponNode.parent) weaponNode.parent.remove(weaponNode);
    weaponNode = null;
    const w = Player.activeWeapon();
    if (!w || w.dur <= 0) return;
    const bones = Player.bones;
    const boneName = GRIP[w.key];
    const bone = bones[boneName];
    if (!bone) return;
    const mesh = buildWeaponMesh(w.key);
    mesh.visible = true;
    mesh.position.set(0, 0, 0.05);
    mesh.rotation.set(0, 0, 0);
    bone.add(mesh);
    weaponNode = mesh;
  }

  // ---------- 输入入口（由 Player 转发） ----------
  function onLeftDown() {
    if (attackCd > 0) return;
    if (!P.onGround && P.state !== 'climb') {
      Player.startPound();
      return;
    }
    const w = Player.activeWeapon();
    if (!w || w.dur <= 0) { if (window.UI) UI.toast(w ? '武器已损坏，找莫莉修理' : '空手！先找铁匠莫莉'); return; }
    if (w.key === 'bow') {
      bowCharging = true;
      if (window.Sound) Sound.sfx('bowDraw');
      return;
    }
    meleeAttack(w);
  }
  function onLeftUp() {
    if (bowCharging) releaseBow();
  }
  function onRightDown() {
    if (!P.inv.shield || P.inv.shield.dur <= 0) {
      if (window.UI && P.inv.shield) UI.toast('舵轮盾已损坏，找莫莉修理');
      return;
    }
    blocking = true;
    const bones = Player.bones;
    if (bones.HandL && !shieldMesh.parent) {
      bones.HandL.add(shieldMesh);
      shieldMesh.position.set(0, 0, 0.35);
      shieldMesh.rotation.x = -0.3;
    }
    shieldMesh.visible = true;
  }
  function onRightUp() {
    blocking = false;
    shieldMesh.visible = false;
  }

  // ---------- 近战 ----------
  function meleeAttack(w) {
    attackCd = w.key === 'shovel' ? 0.55 : 0.38;
    w.dur--;
    if (w.dur <= 0) { if (window.UI) UI.toast(w.name + ' 碎掉了！找莫莉修理'); mountWeapon(); }
    const origin = P.pos.clone();
    origin.y += 1.0;
    const dir = new THREE.Vector3(Math.sin(P.facing), 0, Math.cos(P.facing));
    swingSide *= -1;

    if (w.key === 'mop') {
      crescent(origin, P.facing, swingSide, { thick: false });
      if (window.Sound) Sound.onNext16th(() => Sound.sfx('hit'));
      hitArc(P.pos, P.facing, 3.0, 1.15, w.dmg, 6);
      // 满血挥拖把射出音乐波（老动画彩蛋）
      if (P.hp >= P.maxHp) musicWave(origin, dir);
    } else if (w.key === 'shovel') {
      crescent(origin, P.facing, swingSide, { thick: true });
      shovelSlam(P.pos.clone());
      if (window.Sound) Sound.onNext16th(() => Sound.sfx('hitheavy'));
      hitArc(P.pos, P.facing, 3.6, Math.PI, w.dmg, 10);   // 360° AOE
    } else if (w.key === 'whistle') {
      coalShot(origin, dir, w.dmg);
      if (window.Sound) Sound.onNext16th(() => Sound.sfx('whistleSfx'));
    }
    // squash & stretch 动作反馈
    Player.playAnim(w.key === 'shovel' ? 'squash' : 'stretch', 0.05);
    // 联机广播
    if (window.Net && Net.connected) Net.send('vfx', { name: 'melee', key: w.key, x: P.pos.x, y: P.pos.y, z: P.pos.z, f: P.facing, side: swingSide });
  }
  function hitArc(pos, facing, range, halfAngle, dmg, knock) {
    if (!window.Enemies) return;
    const list = Enemies.queryMobs(pos, range + 1.5);
    const fx = Math.sin(facing), fz = Math.cos(facing);
    list.forEach(m => {
      const dx = m.x - pos.x, dz = m.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      if (halfAngle < Math.PI) {
        const dot = (dx / (d || 1)) * fx + (dz / (d || 1)) * fz;
        if (dot < Math.cos(halfAngle)) return;
      }
      hitMob(m, dmg, dx / (d || 1) * knock, dz / (d || 1) * knock);
    });
    // BOSS 近战窗口判定
    if (Enemies.dragon && Enemies.dragon.meleeWindow) {
      const hp = Enemies.dragon.hitPoint;
      if (hp && Math.hypot(hp.x - pos.x, hp.z - pos.z) < 7 && Math.abs(hp.y - pos.y) < 5) {
        damageDragon(dmg);
      }
    }
  }
  function hitMob(m, dmg, kx, kz) {
    if (window.Net && Net.connected && Net.role === 'client') {
      Net.send('dmgMob', { i: m.id, dmg: dmg });
      Enemies.cosmeticHit(m, dmg);
    } else {
      Enemies.damageMob(m, dmg, kx, kz);
    }
  }
  function damageDragon(dmg) {
    if (window.Net && Net.connected && Net.role === 'client') {
      Net.send('dmgDragon', { dmg: dmg });
      Enemies.cosmeticHitDragon(dmg);
    } else {
      Enemies.damageDragon(dmg);
    }
  }

  // ---------- 燃煤弹射（锅炉汽笛） ----------
  function coalShot(origin, dir, dmg) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), matC('#1c1812', { flatShading: true }));
    g.add(ball);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(glow);
    g.position.copy(origin);
    scene.add(g);
    projectiles.push({
      kind: 'coal', obj: g,
      pos: origin.clone(), vel: dir.clone().multiplyScalar(22).setY(6),
      dmg, bounces: 2, life: 4,
      tick(dt, pr) {
        pr.vel.y -= 18 * dt;
        pr.pos.addScaledVector(pr.vel, dt);
        pr.obj.position.copy(pr.pos);
        pr.obj.rotation.x += dt * 8;
        steamPuff(pr.pos, 0.25);
        const h = World.height(pr.pos.x, pr.pos.z);
        if (pr.pos.y < h + 0.2 && pr.vel.y < 0) {
          if (pr.bounces > 0) { pr.bounces--; pr.pos.y = h + 0.2; pr.vel.y = 7; pr.vel.x *= 0.7; pr.vel.z *= 0.7; if (window.Sound) Sound.sfx('steam'); }
          else { explodeAt(pr.pos, 1.6, pr.dmg); return false; }
        }
        if (hitMobsSphere(pr.pos, 1.0, pr.dmg, 4)) { explodeAt(pr.pos, 1.6, pr.dmg); return false; }
        pr.life -= dt;
        return pr.life > 0;
      },
    });
  }
  function explodeAt(pos, r, dmg) {
    shockwave(pos, r * 1.4, 0.5);
    hitSpark(pos, 10);
    hitMobsSphere(pos, r, dmg, 6);
    if (window.Sound) Sound.sfx('explosion');
  }
  function hitMobsSphere(pos, r, dmg, knock) {
    if (!window.Enemies) return false;
    const list = Enemies.queryMobs(pos, r + 1.5);
    let hit = false;
    list.forEach(m => {
      const d = Math.hypot(m.x - pos.x, m.z - pos.z);
      if (d < r + 0.6) {
        hit = true;
        hitMob(m, dmg, (m.x - pos.x) / (d || 1) * knock, (m.z - pos.z) / (d || 1) * knock);
      }
    });
    if (Enemies.dragon && Enemies.dragon.active && !Enemies.dragon.dead && Enemies.dragon.meleeWindow) {
      const hp = Enemies.dragon.hitPoint;
      if (hp && Math.hypot(hp.x - pos.x, hp.z - pos.z) < r + 3 && Math.abs(hp.y - pos.y) < 6) {
        damageDragon(dmg); hit = true;
      }
    }
    return hit;
  }

  // ---------- 鱼叉弓 ----------
  function releaseBow() {
    bowCharging = false;
    const w = Player.activeWeapon();
    if (!w || w.key !== 'bow' || w.dur <= 0) { bowCharge = 0; return; }
    w.dur--;
    if (w.dur <= 0) { if (window.UI) UI.toast('鱼叉弓弦断了！找莫莉修理'); mountWeapon(); }
    const charge = bowCharge;
    bowCharge = 0;
    UI.crosshair(false, 0);
    const speed = 34 + 44 * charge;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const origin = P.pos.clone(); origin.y += 1.35; origin.addScaledVector(camDir, 0.6);
    const mesh = buildHarpoonMesh();
    mesh.position.copy(origin);
    scene.add(mesh);
    if (window.Sound) Sound.sfx('bowRelease');
    const grav = 14 * (1 - 0.5 * charge);   // 满弦重力减半更平直
    projectiles.push({
      kind: 'harpoon', obj: mesh, pos: origin.clone(), vel: camDir.multiplyScalar(speed),
      dmg: w.dmg * (charge >= 1 ? 2 : 1), life: 6, grav,
      tick(dt, pr) {
        pr.vel.y -= pr.grav * dt;
        // 风力侧偏
        pr.vel.x += World.weather.windX * dt * 5;
        pr.vel.z += World.weather.windZ * dt * 5;
        pr.pos.addScaledVector(pr.vel, dt);
        pr.obj.position.copy(pr.pos);
        pr.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pr.vel.clone().normalize());
        steamPuff(pr.pos, 0.3);
        const h = World.height(pr.pos.x, pr.pos.z);
        if (pr.pos.y <= h + 0.05) {     // 插地留存
          pr.pos.y = h + 0.05;
          pr.obj.position.copy(pr.pos);
          pr.stuck = 8;
          pr.tick = (dt2, pr2) => {
            pr2.stuck -= dt2;
            if (pr2.stuck < 1) pr2.obj.material ? null : null;
            if (pr2.stuck < 1) pr2.obj.traverse(o => { if (o.material) o.material.transparent = true, o.material.opacity = Math.max(0, pr2.stuck); });
            return pr2.stuck > 0;
          };
          return true;
        }
        if (hitMobsSphere(pr.pos, 0.9, pr.dmg, 3)) {
          hitSpark(pr.pos, 6);
          return false;
        }
        // 飞行中 BOSS 也可被鱼叉命中（远程例外）
        if (window.Enemies && Enemies.dragon && Enemies.dragon.active && !Enemies.dragon.dead) {
          const dp = Enemies.dragon.pos;
          if (dp && Math.hypot(dp.x - pr.pos.x, dp.z - pr.pos.z) < 9 && Math.abs((dp.y || 0) - pr.pos.y) < 8) {
            damageDragon(pr.dmg);
            hitSpark(pr.pos, 8);
            return false;
          }
        }
        pr.life -= dt;
        return pr.life > 0;
      },
    });
    if (window.Net && Net.connected) Net.send('vfx', { name: 'harpoon', x: origin.x, y: origin.y, z: origin.z, dx: camDir.x, dy: camDir.y, dz: camDir.z, sp: speed, ch: charge, dmg: w.dmg });
    Player.playAnim('stretch', 0.05);
  }

  // ---------- 救生圈（F） ----------
  function throwLifebuoy() {
    if (buoy || !P.inv.lifebuoy) return;
    if (!P.onGround && P.state !== 'climb') return;
    const mesh = buildBuoyMesh();
    const origin = P.pos.clone(); origin.y += 1.3;
    mesh.position.copy(origin);
    scene.add(mesh);
    const dir = new THREE.Vector3(Math.sin(P.facing), 0.12, Math.cos(P.facing)).normalize();
    buoy = {
      obj: mesh, pos: origin.clone(), vel: dir.multiplyScalar(20),
      phase: 'out', t: 0, hitSet: [], glow: mesh.userData.glow,
      windup: 0.16,
    };
    if (window.Sound) Sound.sfx('lifebuoy');
    if (window.Net && Net.connected) Net.send('vfx', { name: 'lifebuoy', x: P.pos.x, y: P.pos.y, z: P.pos.z, f: P.facing });
  }
  function updateBuoy(dt) {
    if (!buoy) return;
    buoy.t += dt;
    // 手部动作覆盖（mixer 更新后）：后仰蓄力→甩出→回程接
    const bones = Player.bones;
    if (buoy.windup > 0) {
      buoy.windup -= dt;
      if (bones.ShoulderR) bones.ShoulderR.rotation.x = 0.6;   // 后仰蓄力
      if (buoy.windup > 0) return;
    } else if (buoy.t < 0.3) {
      if (bones.ShoulderR) bones.ShoulderR.rotation.x = -2.2;  // 猛力甩出
      if (bones.ArmR2) bones.ArmR2.scale.set(1, 2.0, 1);       // 橡皮管拉长
      if (bones.Spine2) bones.Spine2.rotation.y = 0.5;         // 转腰
    } else if (buoy.phase === 'return') {
      const d = buoy.pos.distanceTo(P.pos);
      if (d < 6) {   // 回程 <6m 手臂伸长接住
        if (bones.ArmR2) bones.ArmR2.scale.set(1, 1.8, 1);
        if (bones.ShoulderR) bones.ShoulderR.rotation.x = -1.6;
      }
    } else {
      resetArmBones();
    }

    if (buoy.phase === 'out') {
      buoy.pos.addScaledVector(buoy.vel, dt);
      buoy.vel.multiplyScalar(1 - dt * 1.1);
      if (buoy.t > 0.9 || buoy.vel.length() < 4) buoy.phase = 'return';
      // 命中
      if (window.Enemies) {
        Enemies.queryMobs(buoy.pos, 1.6).forEach(m => {
          if (buoy.hitSet.indexOf(m.id) < 0) {
            buoy.hitSet.push(m.id);
            hitMob(m, 14, 0, 0);
            hitSpark(buoy.pos, 8);
            if (window.UI) UI.shake(0.35);
            if (window.Sound) Sound.sfx('lifebuoyHit');
          }
        });
      }
    } else {
      // 回程磁吸金币
      coins.forEach(c => {
        if (c.pos.distanceTo(buoy.pos) < 4) {
          c.pos.lerp(buoy.pos, 1 - Math.exp(-8 * dt));
          c.obj.position.copy(c.pos);
        }
      });
      const target = P.pos.clone(); target.y += 1.3;
      buoy.pos.lerp(target, 1 - Math.exp(-9 * dt));
      if (buoy.pos.distanceTo(target) < 0.8) {
        scene.remove(buoy.obj);
        buoy = null;
        resetArmBones();
        if (window.Sound) Sound.sfx('coin');
        return;
      }
    }
    buoy.obj.position.copy(buoy.pos);
    buoy.obj.rotation.y += dt * 12;
    buoy.obj.userData.glow.material.opacity = 0.3 + Math.sin(buoy.t * 20) * 0.12;
    inkTrail(buoy.pos);
  }
  function resetArmBones() {
    const bones = Player.bones;
    if (bones.ArmR2) bones.ArmR2.scale.set(1, 1, 1);
    if (bones.Spine2) bones.Spine2.rotation.y = 0;
  }

  // ---------- 音乐波（满血拖把彩蛋） ----------
  function musicWave(origin, dir) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    g.position.copy(origin);
    scene.add(g);
    if (window.Sound) Sound.sfx('crateNote', 72);
    projectiles.push({
      kind: 'wave', obj: g, pos: origin.clone(), vel: dir.clone().multiplyScalar(13), life: 2.2,
      tick(dt, pr) {
        pr.pos.addScaledVector(pr.vel, dt);
        pr.pos.y = World.height(pr.pos.x, pr.pos.z) + 0.6;
        pr.obj.position.copy(pr.pos);
        const s = 1 + (2.2 - pr.life) * 1.6;
        ring.scale.set(s, s, s);
        ring.material.opacity = Math.max(0, pr.life / 2.2 * 0.8);
        hitMobsSphere(pr.pos, 1.4 * s, 8, 3);
        pr.life -= dt;
        return pr.life > 0;
      },
    });
    if (window.Net && Net.connected) Net.send('vfx', { name: 'wave', x: origin.x, y: origin.y, z: origin.z, dx: dir.x, dz: dir.z });
  }

  // ---------- 落锚下砸冲击 ----------
  function groundPound(pos) {
    const p = pos.clone(); p.y = World.height(p.x, p.z);
    shockwave(p, 6, 0.6);
    setTimeout(() => shockwave(p, 8.5, 0.45), 90);   // 双重冲击波
    hitSpark(p, 14);
    hitMobsSphere(p, 5.5, 15, 12);
    if (window.Net && Net.connected) Net.send('vfx', { name: 'pound', x: p.x, y: p.y, z: p.z });
  }

  // ---------- VFX 基元 ----------
  function addVfx(obj, dur, tick) {
    scene.add(obj);
    vfxList.push({ obj, t: 0, dur, tick });
  }
  /** 月牙墨线：径向 3 排顶点、白芯灰边、沿弧 pow(t,1.7) 渐暗（加法混合下黑=透明） */
  function crescent(origin, facing, side, opts) {
    opts = opts || {};
    const thick = opts.thick;
    const a0 = -1.25, a1 = 1.25, STEPS = 14;
    const pos = [], col = [], idx = [];
    const rIn = thick ? 0.4 : 0.7, rOut = thick ? 3.0 : 2.6;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const a = a0 + (a1 - a0) * t;
      const fade = 1 - Math.pow(t, 1.7);
      const rows = thick ? [rIn, (rIn + rOut) / 2, rOut] : [rIn, (rIn + rOut) / 2, rOut];
      const shades = thick ? [0.55, 1.0, 0.5] : [0.3, 1.0, 0.35];   // 白芯灰边
      for (let r = 0; r < 3; r++) {
        const rr = rows[r] * (0.75 + t * 0.35);
        pos.push(Math.sin(a) * rr, 0.15 + Math.sin(t * Math.PI) * 0.5, Math.cos(a) * rr);
        const c = shades[r] * fade;
        col.push(c, c, c);
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
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    mesh.rotation.y = facing + (side < 0 ? Math.PI : 0);
    mesh.scale.x = side;
    addVfx(mesh, 0.26, function (dt, v) {
      v.t += dt;
      const k = v.t / v.dur;
      v.obj.scale.y = 1 + k * 0.6;
      v.obj.material.opacity = 0.95 * (1 - k * k);
      v.obj.rotation.y += dt * 5 * side;
      return v.t < v.dur;
    });
  }
  function shockwave(pos, radius, dur) {
    const geo = new THREE.RingGeometry(0.3, 0.55, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, (pos.y || World.height(pos.x, pos.z)) + 0.15, pos.z);
    addVfx(mesh, dur, function (dt, v) {
      v.t += dt;
      const k = v.t / v.dur;
      const s = 0.3 + k * radius * 2.2;
      v.obj.scale.set(s, s, s);
      v.obj.material.opacity = 0.85 * (1 - k);
      return v.t < v.dur;
    });
  }
  function hitSpark(pos, n) {
    const geo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      pts.push(0, 0, 0, Math.cos(a) * (0.5 + Math.random()), (Math.random() - 0.3) * 1.2, Math.sin(a) * (0.5 + Math.random()));
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.position.copy(pos);
    addVfx(lines, 0.3, function (dt, v) {
      v.t += dt;
      const k = v.t / v.dur;
      v.obj.scale.setScalar(1 + k * 2.4);
      v.obj.material.opacity = 1 - k;
      return v.t < v.dur;
    });
    // 定向墨点
    for (let i = 0; i < 4; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.1, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0x17130d, transparent: true, opacity: 0.9, depthWrite: false }));
      dot.position.copy(pos);
      const vv = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 2, (Math.random() - 0.5) * 6);
      addVfx(dot, 0.5, function (dt, v) {
        v.t += dt;
        vv.y -= 14 * dt;
        v.obj.position.addScaledVector(vv, dt);
        v.obj.material.opacity = 0.9 * (1 - v.t / v.dur);
        return v.t < v.dur;
      });
    }
  }
  function steamPuff(pos, scale) {
    if (Math.random() > 0.55) return;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(scale * (0.5 + Math.random() * 0.5), 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xd8d2c2, transparent: true, opacity: 0.4, depthWrite: false }));
    puff.position.copy(pos);
    addVfx(puff, 0.6, function (dt, v) {
      v.t += dt;
      v.obj.position.y += dt * 0.8;
      v.obj.scale.setScalar(1 + v.t * 2);
      v.obj.material.opacity = 0.4 * (1 - v.t / v.dur);
      return v.t < v.dur;
    });
  }
  function inkTrail(pos) {
    if (Math.random() > 0.6) return;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.12, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x17130d, transparent: true, opacity: 0.6, depthWrite: false }));
    dot.position.copy(pos);
    addVfx(dot, 0.45, function (dt, v) {
      v.t += dt;
      v.obj.material.opacity = 0.6 * (1 - v.t / v.dur);
      return v.t < v.dur;
    });
  }
  function shovelSlam(pos) {
    const p = pos.clone();
    p.y = World.height(p.x, p.z) + 0.08;
    // 地裂冲击环
    const crackGeo = new THREE.RingGeometry(0.6, 1.0, 7);
    crackGeo.rotateX(-Math.PI / 2);
    const crack = new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ color: 0x17130d, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    crack.position.copy(p);
    addVfx(crack, 0.5, function (dt, v) {
      v.t += dt;
      const k = v.t / v.dur;
      v.obj.scale.setScalar(1 + k * 3.4);
      v.obj.material.opacity = 0.9 * (1 - k);
      return v.t < v.dur;
    });
    // 煤块飞溅
    for (let i = 0; i < 7; i++) {
      const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.14, 0), matC('#1c1812', { flatShading: true }));
      chunk.position.copy(p);
      const a = Math.random() * Math.PI * 2;
      const vv = new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 4), 5 + Math.random() * 5, Math.sin(a) * (3 + Math.random() * 4));
      addVfx(chunk, 0.8, function (dt, v) {
        v.t += dt;
        vv.y -= 22 * dt;
        v.obj.position.addScaledVector(vv, dt);
        const h = World.height(v.obj.position.x, v.obj.position.z);
        if (v.obj.position.y < h) { v.obj.position.y = h; vv.set(0, 0, 0); }
        v.obj.rotation.x += dt * 6;
        return v.t < v.dur;
      });
    }
    if (window.UI) UI.shake(0.5);
  }

  // ---------- 拾取物 ----------
  function spawnCoins(pos, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.07, 6, 12), matC('#d8cdb2'));
      m.position.copy(pos);
      scene.add(m);
      coins.push({
        obj: m, pos: pos.clone(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5),
        t: 0,
      });
    }
  }
  function spawnMilk(pos) {
    const g = new THREE.Group();
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.42, 8), matC('#e8e0cc'));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), matC('#8b8577'));
    cap.position.y = 0.26;
    g.add(bottle, cap);
    g.position.copy(pos);
    scene.add(g);
    milks.push({ obj: g, pos: pos.clone(), t: 0 });
  }
  function spawnGoldenWhistle(pos) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 10), matC('#d9c48f'));
    body.rotation.z = Math.PI / 2;
    const mouth = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.4, 10), matC('#d9c48f'));
    mouth.rotation.z = -Math.PI / 2; mouth.position.x = 0.5;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(body, mouth, glow);
    g.position.copy(pos);
    scene.add(g);
    goldenWhistleMesh = { obj: g, pos: pos.clone(), glow };
  }
  function updatePickups(dt, playerPos) {
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.t += dt;
      c.vel.y -= 14 * dt;
      c.pos.addScaledVector(c.vel, dt);
      const h = World.height(c.pos.x, c.pos.z) + 0.25;
      if (c.pos.y < h) { c.pos.y = h; c.vel.set(0, 0, 0); }
      const d = c.pos.distanceTo(playerPos);
      if (d < 5.5 && c.t > 0.4) c.pos.lerp(tmpV.copy(playerPos).setY(playerPos.y + 1), 1 - Math.exp(-7 * dt));
      if (d < 1.0) {
        scene.remove(c.obj);
        coins.splice(i, 1);
        Player.addCoins(1);
        if (window.Sound) Sound.sfx('coin');
        continue;
      }
      c.obj.position.copy(c.pos);
      c.obj.rotation.y += dt * 4;
    }
    for (let i = milks.length - 1; i >= 0; i--) {
      const m = milks[i];
      m.t += dt;
      m.obj.position.y = m.pos.y + Math.sin(m.t * 3) * 0.15 + 0.3;
      m.obj.rotation.y += dt * 1.5;
      if (m.pos.distanceTo(playerPos) < 1.4) {
        scene.remove(m.obj);
        milks.splice(i, 1);
        Player.heal(2);
        if (window.UI) UI.toast('热牛奶 ♥');
        if (window.Sound) Sound.sfx('itemget');
      } else if (m.t > 25) { scene.remove(m.obj); milks.splice(i, 1); }
    }
    if (goldenWhistleMesh) {
      const gw = goldenWhistleMesh;
      gw.obj.position.y = gw.pos.y + Math.sin(performance.now() * 0.003) * 0.3 + 0.5;
      gw.obj.rotation.y += dt;
      if (gw.pos.distanceTo(playerPos) < 2.2) {
        scene.remove(gw.obj);
        goldenWhistleMesh = null;
        P.inv.goldenWhistle = true;
        if (window.Story) Story.onGoldenWhistle();
      }
    }
  }

  // ---------- 格挡减伤（Player.damage 调用） ----------
  function mitigate(amount, srcX, srcZ) {
    if (!blocking || !P.inv.shield || P.inv.shield.dur <= 0) return amount;
    const dx = srcX - P.pos.x, dz = srcZ - P.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const dot = (dx / d) * Math.sin(P.facing) + (dz / d) * Math.cos(P.facing);
    if (dot > -0.3) {   // 面向攻击（约 110° 扇面）
      P.inv.shield.dur -= 1;
      shieldSpin = 0.5;
      if (window.Sound) Sound.sfx('shield');
      if (window.UI) UI.shake(0.2);
      if (P.inv.shield.dur <= 0 && window.UI) UI.toast('舵轮盾碎掉了！找莫莉修理');
      return Math.max(1, Math.round(amount * 0.25));   // 减伤 75%
    }
    return amount;
  }

  // ---------- 联机特效重放（cosmetic，不结算伤害） ----------
  function vfxReplay(name, d) {
    const origin = new THREE.Vector3(d.x, d.y + 1.0, d.z);
    if (name === 'melee') {
      const o = new THREE.Vector3(d.x, d.y + 1.0, d.z);
      crescent(o, d.f, d.side || 1, { thick: d.key === 'shovel' });
      if (d.key === 'shovel') shovelSlam(new THREE.Vector3(d.x, d.y, d.z));
      if (d.key === 'whistle') coalShotCosmetic(o, d.f);
    } else if (name === 'pound') {
      const p = new THREE.Vector3(d.x, d.y, d.z);
      shockwave(p, 6, 0.6); setTimeout(() => shockwave(p, 8.5, 0.45), 90); hitSpark(p, 14);
    } else if (name === 'wave') {
      musicWaveCosmetic(d);
    } else if (name === 'lifebuoy') {
      const o = new THREE.Vector3(d.x, d.y + 1.3, d.z);
      hitSpark(o, 6);
    } else if (name === 'harpoon') {
      cosmeticHarpoon(d);
    }
  }
  function coalShotCosmetic(origin, facing) {
    const dir = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const ball = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), matC('#1c1812', { flatShading: true }));
    ball.position.copy(origin);
    scene.add(ball);
    const vel = dir.multiplyScalar(22); vel.y = 6;
    const pos = origin.clone();
    addVfx(ball, 1.2, function (dt, v) {
      v.t += dt;
      vel.y -= 18 * dt;
      pos.addScaledVector(vel, dt);
      v.obj.position.copy(pos);
      steamPuff(pos, 0.25);
      return v.t < v.dur;
    });
  }
  function musicWaveCosmetic(d) {
    const origin = new THREE.Vector3(d.x, d.y, d.z);
    const dir = new THREE.Vector3(d.dx, 0, d.dz).normalize();
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    g.add(ring); g.position.copy(origin); scene.add(g);
    let life = 2.2;
    addVfx(g, 2.2, function (dt, v) {
      v.t += dt; life -= dt;
      origin.addScaledVector(dir, 13 * dt);
      origin.y = World.height(origin.x, origin.z) + 0.6;
      v.obj.position.copy(origin);
      const s = 1 + (2.2 - life) * 1.6;
      ring.scale.set(s, s, s);
      ring.material.opacity = Math.max(0, life / 2.2 * 0.8);
      return life > 0;
    });
  }
  function cosmeticHarpoon(d) {
    const mesh = buildHarpoonMesh();
    const pos = new THREE.Vector3(d.x, d.y, d.z);
    const vel = new THREE.Vector3(d.dx, d.dy, d.dz).normalize().multiplyScalar(d.sp || 50);
    mesh.position.copy(pos);
    scene.add(mesh);
    const grav = 14 * (1 - 0.5 * (d.ch || 0));
    let stuck = -1;
    addVfx(mesh, 8, function (dt, v) {
      v.t += dt;
      if (stuck < 0) {
        vel.y -= grav * dt;
        pos.addScaledVector(vel, dt);
        v.obj.position.copy(pos);
        v.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vel.clone().normalize());
        steamPuff(pos, 0.3);
        if (pos.y <= World.height(pos.x, pos.z)) stuck = 6;
      } else {
        stuck -= dt;
        if (stuck < 1) v.obj.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = Math.max(0, stuck); } });
        return stuck > 0;
      }
      return true;
    });
  }

  // ---------- 主更新 ----------
  function update(dt) {
    if (attackCd > 0) attackCd -= dt;
    // 鱼叉弓蓄力
    if (bowCharging) {
      const w = Player.activeWeapon();
      if (!w || w.key !== 'bow' || w.dur <= 0) { bowCharging = false; bowCharge = 0; UI.crosshair(false, 0); }
      else {
        bowCharge = Math.min(1, bowCharge + dt / 0.9);
        UI.crosshair(true, bowCharge);
        camera.fov += ((55 - 9 * bowCharge) - camera.fov) * (1 - Math.exp(-8 * dt));
        camera.updateProjectionMatrix();
        // 拉弦姿态（骨骼级）：左臂持弓前举、右手搭弦后拉
        const bones = Player.bones;
        if (bones.ShoulderL) bones.ShoulderL.rotation.x = -1.45;
        if (bones.ShoulderR) bones.ShoulderR.rotation.x = -1.35 * bowCharge - 0.2;
        if (bones.ArmR2) bones.ArmR2.rotation.z = -0.6 * bowCharge;
        // 蓄力发白 + 向心蒸汽 + 满弦汽笛环
        if (weaponNode) {
          weaponNode.traverse(o => {
            if (o.material && o.material.emissive) {
              const e = bowCharge * 0.8;
              o.material.emissive.setRGB(e, e, e);
            }
          });
          if (Math.random() < 0.4) {
            const wp = P.pos.clone(); wp.y += 1.4;
            wp.x += (Math.random() - 0.5) * 2; wp.z += (Math.random() - 0.5) * 2;
            steamPuff(wp, 0.3 * (1 - bowCharge * 0.5));
          }
        }
      }
    } else if (camera.fov !== 55) {
      camera.fov += (55 - camera.fov) * (1 - Math.exp(-8 * dt));
      camera.updateProjectionMatrix();
      if (weaponNode) weaponNode.traverse(o => { if (o.material && o.material.emissive) o.material.emissive.setRGB(0, 0, 0); });
    }
    // 盾牌旋转（格挡瞬间）
    if (shieldSpin > 0) {
      shieldSpin -= dt;
      shieldMesh.rotation.z += dt * 22;
    }
    // 救生圈
    updateBuoy(dt);
    // 投射物
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      let alive = true;
      try { alive = pr.tick(dt, pr); } catch (e) { alive = false; }
      if (!alive) {
        scene.remove(pr.obj);
        projectiles.splice(i, 1);
      }
    }
    // VFX
    for (let i = vfxList.length - 1; i >= 0; i--) {
      const v = vfxList[i];
      let alive = true;
      try { alive = v.tick(dt, v); } catch (e) { alive = false; }
      if (!alive) {
        scene.remove(v.obj);
        if (v.obj.geometry) v.obj.geometry.dispose();
        vfxList.splice(i, 1);
      }
    }
  }

  return {
    init, update, mountWeapon,
    onLeftDown, onLeftUp, onRightDown, onRightUp,
    throwLifebuoy, groundPound, mitigate,
    spawnCoins, spawnMilk, spawnGoldenWhistle, updatePickups,
    hitMob, damageDragon, hitMobsSphere,
    crescent, shockwave, hitSpark, steamPuff,
    vfxReplay, buildWeaponMesh, buildHarpoonMesh,
    _dbg: () => ({ bowCharging, bowCharge, attackCd }),
    get coins() { return coins; },
    get blocking() { return blocking; },
    GRIP,
  };
})();
window.Combat = Combat;
