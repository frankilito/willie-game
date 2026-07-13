/* enemies.js — 黑白河港系敌人：5 种小怪（35 只）+ 巨型蒸汽鹦鹉号 BOSS
 * 主机权威：主机模拟全部 AI；客机由快照驱动。
 * 内部保留 dragon 命名以兼容联机协议。
 */
const Enemies = (function () {
  'use strict';
  let scene;
  const mobs = [];
  let nextId = 1;
  const tmpV = new THREE.Vector3();
  const LCG = World.LCG;

  const TYPES = {
    rat: { hp: 14, speed: 4.6, aggro: 15, atkRange: 1.6, dmg: 1, cd: 1.1, r: 0.5 },
    bomb: { hp: 25, speed: 2.3, aggro: 16, atkRange: 1.9, dmg: 4, cd: 2.5, r: 0.6 },
    turtle: { hp: 35, speed: 1.7, aggro: 13, atkRange: 1.8, dmg: 2, cd: 1.6, r: 0.9 },
    ghost: { hp: 20, speed: 3.3, aggro: 18, atkRange: 1.7, dmg: 1, cd: 1.2, r: 0.6 },
    cat: { hp: 120, speed: 3.1, aggro: 22, atkRange: 2.6, dmg: 3, cd: 2.0, r: 1.0 },
  };
  const STATE_ENUM = { idle: 0, patrol: 1, chase: 2, attack: 3, dead: 4 };

  let catGltf = null, parrotGltf = null;
  let catFixY = 0;   // 黑猫模型轴向修正（材质特征 bbox 判定）

  // ---------- 小怪建模（程序化精确建模 + 独立材质） ----------
  function matC(hex, opts) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(hex).convertSRGBToLinear() }, opts || {}));
  }
  function buildRat() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 1.0), matC('#5e584b'));
    body.position.y = 0.35;
    g.add(body);
    for (let i = -1; i <= 1; i += 2) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8), matC('#45403a'));
      ear.position.set(i * 0.18, 0.62, 0.32);
      g.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), matC('#1c1812'));
    nose.position.set(0, 0.35, 0.55);
    g.add(nose);
    const key = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 10), matC('#8b8577'));
    key.position.set(0, 0.42, -0.55);
    g.add(key);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.7, 5), matC('#45403a'));
    tail.position.set(0, 0.3, -0.75); tail.rotation.x = 0.9;
    g.add(tail);
    return g;
  }
  function buildBomb() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 9), matC('#1c1812'));
    body.position.y = 0.5;
    g.add(body);
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), matC('#6a5f4c'));
    fuse.position.set(0.12, 1.0, 0); fuse.rotation.z = 0.4;
    g.add(fuse);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    spark.position.set(0.22, 1.14, 0);
    g.add(spark);
    g.userData.body = body;
    g.userData.spark = spark;
    return g;
  }
  function buildTurtle() {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62), matC('#2a2620', { flatShading: true }));
    shell.position.y = 0.35;
    g.add(shell);
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.4, 10), matC('#45403a'));
    belly.position.y = 0.25;
    g.add(belly);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.5), matC('#3a342a'));
    head.position.set(0, 0.35, 0.85);
    g.add(head);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), matC('#3a342a'));
      leg.position.set(i < 2 ? -0.55 : 0.55, 0.12, i % 2 ? -0.45 : 0.45);
      g.add(leg);
    }
    return g;
  }
  function buildGhost() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#2a2620').convertSRGBToLinear(), transparent: true, opacity: 0.42, depthWrite: false });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat);
    body.position.y = 1.2;
    g.add(body);
    for (let i = 0; i < 3; i++) {
      const wisp = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 6), mat);
      const a = i / 3 * Math.PI * 2;
      wisp.position.set(Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3);
      wisp.rotation.x = Math.PI;
      g.add(wisp);
    }
    for (let i = -1; i <= 1; i += 2) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshBasicMaterial({ color: 0xf2ead6 }));
      eye.position.set(i * 0.18, 1.32, 0.45);
      g.add(eye);
    }
    return g;
  }
  /** 判断模型朝向：用白色材质（口鼻/纽扣）顶点 bbox 中心 vs 全体中心，不靠截图猜 */
  function detectFacing(root) {
    let allZ = 0, allN = 0, whiteZ = 0, whiteN = 0;
    const v = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isSkinnedMesh && !o.isMesh) return;
      const geo = o.geometry;
      if (!geo || !geo.attributes.position) return;
      const col = o.material && o.material.color;
      const isWhite = col && col.r > 0.55 && col.g > 0.55;
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i += 7) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        allZ += v.z; allN++;
        if (isWhite) { whiteZ += v.z; whiteN++; }
      }
    });
    if (!whiteN || !allN) return 0;
    const dz = whiteZ / whiteN - allZ / allN;
    return dz < 0 ? Math.PI : 0;
  }

  // ---------- 生成 ----------
  function spawn(type, x, z, tag) {
    const def = TYPES[type];
    const obj = new THREE.Group();        // AI 朝向
    const inner = new THREE.Group();      // 程序化动画
    const fix = new THREE.Group();        // 轴向修正
    let mixer = null, actions = null;
    if (type === 'cat') {
      const model = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(catGltf.scene) : catGltf.scene.clone();
      model.traverse(o => { if (o.isSkinnedMesh || o.isMesh) o.castShadow = true; });
      fix.rotation.y = catFixY;
      fix.add(model);
      mixer = new THREE.AnimationMixer(model);
      actions = {};
      catGltf.animations.forEach(a => { actions[a.name] = mixer.clipAction(a); });
      if (actions.idle) actions.idle.play();
    } else {
      fix.add({ rat: buildRat, bomb: buildBomb, turtle: buildTurtle, ghost: buildGhost }[type]());
    }
    inner.add(fix);
    obj.add(inner);
    obj.position.set(x, World.height(x, z), z);
    scene.add(obj);
    const mob = {
      id: nextId++, type, def, tag: tag || 'wild',
      hp: def.hp, maxHp: def.hp,
      x, z, y: obj.position.y, ry: Math.random() * 6.28,
      state: 'idle', vx: 0, vz: 0,
      spawnX: x, spawnZ: z,
      obj, inner, fix, mixer, actions,
      attackCd: 0, stateT: Math.random() * 3, hurtT: 0, dieT: 0,
      fuseT: -1, wanderX: x, wanderZ: z,
      animT: Math.random() * 10,
      dead: false,
      // 客户端插值缓冲
      tx: x, tz: z, try_: 0,
    };
    mobs.push(mob);
    return mob;
  }
  function spawnAll() {
    const LM = World.LANDMARKS;
    // 旧汽笛站任务组 4 只（3 煤球炸弹 + 1 黑猫大副）
    spawn('bomb', LM.SHRINE.x - 6, LM.SHRINE.z + 5, 'shrine');
    spawn('bomb', LM.SHRINE.x + 7, LM.SHRINE.z - 4, 'shrine');
    spawn('bomb', LM.SHRINE.x + 2, LM.SHRINE.z + 9, 'shrine');
    spawn('cat', LM.SHRINE.x - 3, LM.SHRINE.z - 8, 'shrine');
    // 野外 24 只：固定种子 LCG（联机双端序列一致）
    const rnd = LCG(987654321);
    const wildTypes = ['rat', 'rat', 'rat', 'rat', 'rat', 'rat', 'rat', 'rat', 'rat',
      'bomb', 'bomb', 'bomb', 'bomb',
      'turtle', 'turtle', 'turtle', 'turtle', 'turtle',
      'ghost', 'ghost', 'ghost', 'ghost',
      'cat', 'cat'];
    let placed = 0, tries = 0;
    while (placed < 24 && tries < 400) {
      tries++;
      const x = (rnd() * 2 - 1) * 330;
      const z = (rnd() * 2 - 1) * 330;
      const h = World.height(x, z);
      if (h <= 2 || World.normal(x, z).y <= 0.75) continue;
      if (Math.hypot(x - LM.SPAWN.x, z - LM.SPAWN.z) < 60) continue;
      if (Math.hypot(x - LM.VILLAGE.x, z - LM.VILLAGE.z) < 36) continue;
      if (Math.hypot(x - LM.SHRINE.x, z - LM.SHRINE.z) < 40) continue;
      if (Math.hypot(x - LM.VOLCANO.x, z - LM.VOLCANO.z) < 95) continue;
      spawn(wildTypes[placed % wildTypes.length], x, z, 'wild');
      placed++;
    }
    // 锅炉岛守军 7 只
    const garrison = ['cat', 'turtle', 'turtle', 'bomb', 'bomb', 'ghost', 'ghost'];
    garrison.forEach((tp, i) => {
      const a = i / 7 * Math.PI * 2;
      const r = 36 + (i % 3) * 8;
      spawn(tp, LM.VOLCANO.x + Math.cos(a) * r, LM.VOLCANO.z + Math.sin(a) * r, 'volcano');
    });
  }

  // ---------- 仇恨目标：双玩家就近 ----------
  function pickTarget(mob) {
    let best = null, bestD = mob.def.aggro;
    const P = Player.state;
    if (!P.dead) {
      const d = Math.hypot(P.pos.x - mob.x, P.pos.z - mob.z);
      if (d < bestD) { bestD = d; best = { x: P.pos.x, z: P.pos.z, local: true }; }
    }
    if (window.Net && Net.remotePos) {
      const rp = Net.remotePos;
      const d = Math.hypot(rp.x - mob.x, rp.z - mob.z);
      if (d < bestD) { bestD = d; best = { x: rp.x, z: rp.z, local: false }; }
    }
    return best;
  }
  function hitPlayer(dmg, x, z, targetLocal) {
    if (window.Net && Net.connected && Net.role === 'host' && targetLocal === false) {
      Net.send('dmg', { dmg, x, z });
      return;
    }
    if (targetLocal !== false) Player.damage(dmg, x, z);
  }

  // ---------- AI 更新 ----------
  function updateMob(mob, dt, t) {
    if (mob.dead) { updateDead(mob, dt); return; }
    mob.animT += dt;
    mob.stateT += dt;
    if (mob.attackCd > 0) mob.attackCd -= dt;
    if (mob.hurtT > 0) {
      mob.hurtT -= dt;
      // 受击压扁泛白
      const k = Math.max(0, mob.hurtT / 0.25);
      mob.inner.scale.set(1 + k * 0.25, 1 - k * 0.3, 1 + k * 0.25);
      setEmissive(mob, k);
    } else {
      mob.inner.scale.lerp(tmpV.set(1, 1, 1), 1 - Math.exp(-10 * dt));
    }
    // 击退速度衰减
    mob.x += mob.vx * dt;
    mob.z += mob.vz * dt;
    mob.vx *= 1 - Math.min(1, dt * 4);
    mob.vz *= 1 - Math.min(1, dt * 4);

    const target = pickTarget(mob);
    const def = mob.def;

    if (mob.state === 'idle' || mob.state === 'patrol') {
      if (target) { mob.state = 'chase'; mob.stateT = 0; }
      else {
        // 巡游
        if (mob.state === 'idle' && mob.stateT > 2.5) {
          mob.state = 'patrol'; mob.stateT = 0;
          const a = Math.random() * 6.28, r = 4 + Math.random() * 8;
          mob.wanderX = mob.spawnX + Math.cos(a) * r;
          mob.wanderZ = mob.spawnZ + Math.sin(a) * r;
        }
        if (mob.state === 'patrol') {
          moveToward(mob, mob.wanderX, mob.wanderZ, def.speed * 0.4, dt);
          if (Math.hypot(mob.wanderX - mob.x, mob.wanderZ - mob.z) < 0.6 || mob.stateT > 5) {
            mob.state = 'idle'; mob.stateT = 0;
          }
        }
      }
    } else if (mob.state === 'chase') {
      if (!target) { mob.state = 'idle'; mob.stateT = 0; }
      else {
        const d = Math.hypot(target.x - mob.x, target.z - mob.z);
        if (d < def.atkRange && mob.attackCd <= 0) {
          mob.state = 'attack'; mob.stateT = 0; mob.attackCd = def.cd;
          if (mob.type === 'bomb') { mob.fuseT = 0.9; if (window.Sound) Sound.sfx('steam'); }
          if (mob.type === 'cat' && mob.actions) playCat(mob, 'attack');
        } else {
          moveToward(mob, target.x, target.z, def.speed, dt);
        }
      }
    } else if (mob.state === 'attack') {
      if (mob.type === 'bomb') {
        // 引信颤抖 + 由灰变白
        mob.fuseT -= dt;
        const k = 1 - Math.max(0, mob.fuseT) / 0.9;
        mob.inner.position.x = (Math.random() - 0.5) * 0.12 * k;
        mob.inner.position.z = (Math.random() - 0.5) * 0.12 * k;
        const body = mob.fix.children[0].userData.body;
        if (body) body.material.color.setRGB(0.11 + k * 0.85, 0.09 + k * 0.85, 0.07 + k * 0.78);
        if (mob.fuseT <= 0) { explodeMob(mob, false); return; }
      } else {
        // 攻击前扑
        const windup = mob.type === 'cat' ? 0.55 : 0.3;
        if (mob.stateT > windup && !mob.didHit) {
          mob.didHit = true;
          if (target) {
            const d = Math.hypot(target.x - mob.x, target.z - mob.z);
            if (d < def.atkRange + 0.8) hitPlayer(def.dmg, mob.x, mob.z, target.local);
            lunge(mob, target);
          }
        }
        if (mob.stateT > windup + 0.5) { mob.state = 'chase'; mob.didHit = false; mob.stateT = 0; }
      }
    }

    // 地形贴合
    mob.y = World.height(mob.x, mob.z);
    mob.obj.position.set(mob.x, mob.y, mob.z);
    mob.obj.rotation.y = mob.ry;
    // 程序化动画：走路摇摆蹦跳 / 待机呼吸
    if (mob.type !== 'cat') {
      const moving = mob.state === 'chase' || mob.state === 'patrol';
      if (moving && mob.fuseT < 0) {
        const sp = def.speed;
        mob.inner.position.y = Math.abs(Math.sin(mob.animT * sp * 1.6)) * 0.16;
        mob.inner.rotation.z = Math.sin(mob.animT * sp * 1.6) * 0.09;
      } else if (mob.fuseT < 0) {
        mob.inner.position.y = Math.sin(mob.animT * 2) * 0.04;
        mob.inner.rotation.z = 0;
        const b = 1 + Math.sin(mob.animT * 2.4) * 0.03;
        if (mob.hurtT <= 0) mob.inner.scale.set(1, b, 1);
      }
      // 煤烟幽灵悬浮
      if (mob.type === 'ghost') {
        mob.obj.position.y = mob.y + 0.3 + Math.sin(mob.animT * 1.8) * 0.25;
      }
    } else if (mob.mixer) {
      mob.mixer.update(dt);
      const moving = mob.state === 'chase' || mob.state === 'patrol';
      if (mob.state === 'attack') { /* attack clip 已播 */ }
      else playCat(mob, moving ? (def.speed > 3 ? 'run' : 'walk') : 'idle');
    }
  }
  function lunge(mob, target) {
    const dx = target.x - mob.x, dz = target.z - mob.z;
    const d = Math.hypot(dx, dz) || 1;
    mob.vx += dx / d * 3;
    mob.vz += dz / d * 3;
  }
  function moveToward(mob, tx, tz, speed, dt) {
    const dx = tx - mob.x, dz = tz - mob.z;
    const d = Math.hypot(dx, dz) || 1;
    mob.x += dx / d * speed * dt;
    mob.z += dz / d * speed * dt;
    const targetRy = Math.atan2(dx, dz);
    let df = targetRy - mob.ry;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    mob.ry += df * (1 - Math.exp(-10 * dt));
  }
  function playCat(mob, name) {
    if (!mob.actions || !mob.actions[name] || mob.curAnim === name) return;
    const prev = mob.actions[mob.curAnim];
    const next = mob.actions[name];
    next.reset();
    next.setLoop(name === 'die' ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = true;
    next.play();
    if (prev) prev.crossFadeTo(next, 0.15, false);
    mob.curAnim = name;
  }
  function setEmissive(mob, k) {
    mob.fix.traverse(o => {
      if (o.material && o.material.emissive) o.material.emissive.setRGB(k, k, k);
    });
  }
  function updateDead(mob, dt) {
    mob.dieT -= dt;
    const k = Math.max(0, 1 - mob.dieT / 0.9);
    mob.inner.rotation.x = -k * Math.PI / 2;
    mob.obj.position.y = mob.y - k * 0.5;
    if (mob.mixer) mob.mixer.update(dt);
    if (mob.dieT <= 0) {
      scene.remove(mob.obj);
      const i = mobs.indexOf(mob);
      if (i >= 0) mobs.splice(i, 1);
    }
  }
  function explodeMob(mob, killed) {
    // 自爆/殉爆：AOE + 余烬地面
    const pos = new THREE.Vector3(mob.x, mob.y + 0.5, mob.z);
    if (window.Combat) { Combat.shockwave(pos, 5, 0.5); Combat.hitSpark(pos, 12); }
    if (window.Sound) Sound.sfx('explosion');
    if (window.UI) UI.shake(0.5);
    // 对玩家伤害（主机权威）
    const P = Player.state;
    if (!P.dead && Math.hypot(P.pos.x - mob.x, P.pos.z - mob.z) < 4.5) {
      hitPlayer(4, mob.x, mob.z, true);
    }
    if (window.Net && Net.remotePos && Net.role === 'host' && Math.hypot(Net.remotePos.x - mob.x, Net.remotePos.z - mob.z) < 4.5) {
      hitPlayer(4, mob.x, mob.z, false);
    }
    emberGround(mob.x, mob.z, 3.2, 5);
    // 殉爆连锁
    if (window.Net && Net.connected) Net.send('vfx', { name: 'bombBoom', x: mob.x, y: mob.y, z: mob.z });
    killMob(mob, killed);
  }
  function killMob(mob, countKill) {
    if (mob.dead) return;
    mob.dead = true;
    mob.state = 'dead';
    mob.dieT = 0.9;
    if (mob.type === 'cat' && mob.actions) playCat(mob, 'die');
    if (countKill !== false) {
      Player.state.kills++;
      // 掉落：金币 + 概率热牛奶
      if (window.Combat) {
        Combat.spawnCoins(new THREE.Vector3(mob.x, mob.y + 0.6, mob.z), mob.type === 'cat' ? 6 : 2 + ((Math.random() * 3) | 0));
        if (Math.random() < 0.12) Combat.spawnMilk(new THREE.Vector3(mob.x, mob.y + 0.4, mob.z));
      }
      if (mob.tag === 'shrine') {
        if (window.Story) Story.onShrineKill();
        if (window.Net && Net.connected && Net.role === 'host') Net.send('event', { name: 'shrineKill' });
      }
    }
  }

  // ---------- 受击（主机权威） ----------
  function damageMob(mob, dmg, kx, kz) {
    if (mob.dead) return;
    // 客机拦截转发主机
    if (window.Net && Net.connected && Net.role === 'client') {
      Net.send('dmgMob', { i: mob.id, dmg });
      cosmeticHit(mob, dmg);
      return;
    }
    mob.hp -= dmg;
    mob.hurtT = 0.25;
    mob.vx += kx || 0;
    mob.vz += kz || 0;
    if (window.UI) UI.dmgNumber(new THREE.Vector3(mob.x, mob.y + 1.4, mob.z), '' + dmg);
    if (window.Sound) Sound.sfx(mob.type === 'turtle' || mob.type === 'cat' ? 'bossHit' : 'hit');
    if (mob.hp <= 0) {
      if (mob.type === 'bomb' && mob.fuseT < 0) { explodeMob(mob, true); return; }   // 被击杀殉爆
      killMob(mob, true);
    }
  }
  /** 客机：只做压扁/数字/音效反馈，血量以快照为准 */
  function cosmeticHit(mob, dmg) {
    mob.hurtT = 0.25;
    if (window.UI) UI.dmgNumber(new THREE.Vector3(mob.x, mob.y + 1.4, mob.z), '' + dmg);
    if (window.Sound) Sound.sfx('hit');
  }
  function queryMobs(pos, range) {
    const out = [];
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i];
      if (m.dead) continue;
      if (Math.hypot(m.x - pos.x, m.z - pos.z) < range) out.push(m);
    }
    return out;
  }

  // ---------- 余烬地面 ----------
  const embers = [];
  function emberGround(x, z, r, dur) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 18),
      new THREE.MeshBasicMaterial({ color: 0x2a2420, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, World.height(x, z) + 0.06, z);
    scene.add(mesh);
    embers.push({ mesh, x, z, r, t: dur, tickDmg: 0 });
  }
  function updateEmbers(dt) {
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.t -= dt;
      e.tickDmg -= dt;
      e.mesh.material.opacity = 0.75 * Math.min(1, e.t / 1.5) * (0.8 + Math.sin(e.t * 14) * 0.2);
      if (e.tickDmg <= 0) {
        e.tickDmg = 0.7;
        const P = Player.state;
        if (!P.dead && Math.hypot(P.pos.x - e.x, P.pos.z - e.z) < e.r && P.pos.y < World.height(e.x, e.z) + 2.2) {
          Player.damage(1, e.x, e.z);
        }
      }
      if (e.t <= 0) { scene.remove(e.mesh); embers.splice(i, 1); }
    }
  }

  // ---------- 巨型蒸汽鹦鹉号 BOSS（dragon 兼容命名） ----------
  const dragon = {
    active: false, dead: false, dying: false,
    hp: 500, maxHp: 500,
    state: 'sleep', phase: 1,
    pos: { x: 0, y: 40, z: 0 }, ry: 0,
    meleeWindow: false, hitPoint: null,
    obj: null, mixer: null, actions: null,
    stateT: 0, atkT: 2, dockT: 0, introT: 0,
    targetX: 0, targetZ: 0,
  };
  const DRG_STATE_ENUM = { sleep: 0, intro: 1, orbit: 2, taunt: 3, dive: 4, dock: 5, takeoff: 6, dying: 7, dead: 8 };
  const DRG_STATE_REV = ['sleep', 'intro', 'orbit', 'taunt', 'dive', 'dock', 'takeoff', 'dying', 'dead'];
  const fireballs = [];

  function activateDragon() {
    if (dragon.active) return;
    dragon.active = true;
    dragon.state = 'intro';
    dragon.introT = 4.5;
    const V = World.LANDMARKS.VOLCANO;
    dragon.pos = { x: V.x + 40, y: 42, z: V.z + 40 };
    dragon.obj = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(parrotGltf.scene) : parrotGltf.scene.clone();
    dragon.obj.traverse(o => { if (o.isSkinnedMesh || o.isMesh) o.castShadow = true; });
    dragon.obj.position.set(dragon.pos.x, dragon.pos.y, dragon.pos.z);
    scene.add(dragon.obj);
    dragon.mixer = new THREE.AnimationMixer(dragon.obj);
    dragon.actions = {};
    parrotGltf.animations.forEach(a => { dragon.actions[a.name] = dragon.mixer.clipAction(a); });
    playDrg('fly');
    // 默片字幕式出场标题
    if (window.UI) {
      UI.letterbox(true);
      UI.showCard('巨型蒸汽鹦鹉号', '皮特船长的黑铁飞行机器 · 500 HP');
      UI.bossBar(dragon.hp, dragon.maxHp, '锅炉压力：正常');
    }
    if (window.Sound) { Sound.playTrack('boss'); Sound.sfx('bossRoar'); }
    setTimeout(() => { if (window.UI) { UI.hideCard(); UI.letterbox(false); } }, 4200);
  }
  function playDrg(name) {
    if (!dragon.actions || !dragon.actions[name] || dragon.curAnim === name) return;
    const prev = dragon.actions[dragon.curAnim];
    const next = dragon.actions[name];
    next.reset();
    next.setLoop(name === 'death' ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = true;
    next.play();
    if (prev) prev.crossFadeTo(next, 0.3, false);
    dragon.curAnim = name;
  }
  function drgTarget() {
    // 就近双玩家
    const P = Player.state;
    let tx = P.pos.x, tz = P.pos.z;
    if (window.Net && Net.remotePos && !P.dead) {
      if (Math.hypot(Net.remotePos.x - dragon.pos.x, Net.remotePos.z - dragon.pos.z) <
        Math.hypot(P.pos.x - dragon.pos.x, P.pos.z - dragon.pos.z)) {
        tx = Net.remotePos.x; tz = Net.remotePos.z;
      }
    }
    return { x: tx, z: tz };
  }
  function updateDragon(dt, t) {
    if (!dragon.active) return;
    const V = World.LANDMARKS.VOLCANO;
    const T = World.LANDMARKS.TOWER;
    dragon.stateT += dt;
    if (dragon.mixer) dragon.mixer.update(dt);

    if (dragon.state === 'intro') {
      dragon.introT -= dt;
      // 盘旋入场
      const a = t * 0.4;
      dragon.pos.x = V.x + Math.cos(a) * 45;
      dragon.pos.z = V.z + Math.sin(a) * 45;
      dragon.pos.y = 42 + Math.sin(t * 1.2) * 3;
      if (dragon.introT <= 0) setDrgState('orbit');
    } else if (dragon.state === 'orbit') {
      const sp = dragon.phase === 2 ? 0.62 : 0.42;
      const a = t * sp;
      dragon.pos.x = V.x + Math.cos(a) * 48;
      dragon.pos.z = V.z + Math.sin(a) * 48;
      dragon.pos.y = 40 + Math.sin(t * 1.5) * 3.5;
      dragon.atkT -= dt;
      if (dragon.atkT <= 0) {
        dragon.atkT = dragon.phase === 2 ? 1.8 : 2.8;
        // 喷吐燃煤（追踪火球）；半血三连喷
        const shots = dragon.phase === 2 ? 3 : 1;
        for (let i = 0; i < shots; i++) setTimeout(() => spitCoal(), i * 280);
        if (window.Sound) Sound.sfx('parrotWhistle');
      }
      if (dragon.stateT > (dragon.phase === 2 ? 9 : 12)) setDrgState('taunt');
    } else if (dragon.state === 'taunt') {
      // 鹦鹉式嘲笑 + 皮特拉响汽笛
      if (dragon.stateT < 0.1) {
        playDrg('taunt');
        if (window.Sound) { Sound.sfx('taunt'); setTimeout(() => Sound.sfx('parrotWhistle'), 700); }
      }
      dragon.pos.y = 40 + Math.sin(t * 4) * 1.2;
      if (dragon.stateT > 3.2) {
        const tg = drgTarget();
        dragon.targetX = tg.x; dragon.targetZ = tg.z;
        setDrgState('dive');
      }
    } else if (dragon.state === 'dive') {
      if (dragon.stateT < 0.1) playDrg('fast');
      const k = Math.min(1, dragon.stateT / 1.1);
      const sx = dragon.pos.x, sz = dragon.pos.z;
      dragon.pos.x += (dragon.targetX - sx) * (1 - Math.exp(-4 * dt));
      dragon.pos.z += (dragon.targetZ - sz) * (1 - Math.exp(-4 * dt));
      dragon.pos.y = 40 - 36 * k;
      if (k >= 1 || dragon.pos.y <= World.height(dragon.pos.x, dragon.pos.z) + 3) {
        // 着地锅炉爆炸 + 冲击
        const p = new THREE.Vector3(dragon.pos.x, World.height(dragon.pos.x, dragon.pos.z) + 1, dragon.pos.z);
        if (window.Combat) { Combat.shockwave(p, 12, 0.7); Combat.hitSpark(p, 20); }
        if (window.Sound) Sound.sfx('explosion');
        if (window.UI) UI.shake(1.1);
        const P = Player.state;
        if (!P.dead && Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 10) hitPlayer(3, p.x, p.z, true);
        if (window.Net && Net.remotePos && Net.role === 'host' && Math.hypot(Net.remotePos.x - p.x, Net.remotePos.z - p.z) < 10) hitPlayer(3, p.x, p.z, false);
        if (dragon.phase === 2) { emberGround(p.x, p.z, 6, 6); emberGround(p.x + 5, p.z + 3, 4, 5); }
        if (window.Net && Net.connected) Net.send('vfx', { name: 'drgSlam', x: p.x, y: p.y, z: p.z, ph: dragon.phase });
        setDrgState('dock');
      }
    } else if (dragon.state === 'dock') {
      // 停靠航标 6-9s 近战窗口
      if (dragon.stateT < 0.1) {
        playDrg('fly');
        dragon.meleeWindow = true;
        dragon.dockT = 6 + Math.random() * 3;
      }
      const tx = T.x, tz = T.z, ty = World.height(T.x, T.z) + 14;
      dragon.pos.x += (tx - dragon.pos.x) * (1 - Math.exp(-2.5 * dt));
      dragon.pos.z += (tz - dragon.pos.z) * (1 - Math.exp(-2.5 * dt));
      dragon.pos.y += (ty - dragon.pos.y) * (1 - Math.exp(-2.5 * dt));
      dragon.hitPoint = { x: dragon.pos.x, y: dragon.pos.y, z: dragon.pos.z };
      // 近战攻击：头槌/挥翼
      dragon.atkT -= dt;
      if (dragon.atkT <= 0) {
        dragon.atkT = 2.2;
        const P = Player.state;
        const d = Math.hypot(P.pos.x - dragon.pos.x, P.pos.z - dragon.pos.z);
        if (d < 16 && !P.dead) {
          playDrg(Math.random() < 0.5 ? 'headbutt' : 'punch');
          setTimeout(() => {
            if (!Player.state.dead && Math.hypot(Player.state.pos.x - dragon.pos.x, Player.state.pos.z - dragon.pos.z) < 14) {
              hitPlayer(2, dragon.pos.x, dragon.pos.z, true);
            }
          }, 450);
        }
      }
      if (dragon.stateT > dragon.dockT) {
        dragon.meleeWindow = false;
        dragon.hitPoint = null;
        setDrgState('takeoff');
      }
    } else if (dragon.state === 'takeoff') {
      if (dragon.stateT < 0.1) playDrg('fast');
      dragon.pos.y += dt * 12;
      if (dragon.pos.y >= 40) { dragon.pos.y = 40; setDrgState('orbit'); }
    } else if (dragon.state === 'dying') {
      // 螺旋桨失速坠进煤浆湖（stateT 已在函数顶部累加）
      const k = Math.min(1, dragon.stateT / 4);
      dragon.pos.x += (V.x - dragon.pos.x) * (1 - Math.exp(-1.5 * dt));
      dragon.pos.z += (V.z - dragon.pos.z) * (1 - Math.exp(-1.5 * dt));
      dragon.pos.y = 40 - (40 - (World.LAVA_Y + 2)) * k * k;
      dragon.obj.rotation.z = k * 0.8;
      dragon.obj.rotation.x = -k * 0.6;
      if (k >= 1) {
        dragon.dead = true;
        dragon.state = 'dead';
        dragon.obj.visible = false;
        if (window.Sound) { Sound.sfx('explosion'); Sound.playTrack('port'); }
        if (window.Combat) {
          const p = new THREE.Vector3(V.x, World.LAVA_Y, V.z);
          Combat.shockwave(p, 14, 0.8); Combat.hitSpark(p, 26);
          // 掉落黄金汽笛（放在煤浆湖边可拾取点）
          Combat.spawnGoldenWhistle(new THREE.Vector3(V.x + 24, World.height(V.x + 24, V.z + 6) + 1.2, V.z + 6));
        }
        if (window.UI) { UI.hideBossBar(); UI.shake(1.3); }
        if (window.Story) Story.onBossDead();
        if (window.Net && Net.connected && Net.role === 'host') Net.send('event', { name: 'drgDead' });
      }
    }

    // 朝向：沿运动方向
    if (dragon.obj && dragon.state !== 'dying' && dragon.state !== 'dead') {
      dragon.obj.position.set(dragon.pos.x, dragon.pos.y, dragon.pos.z);
      const tg = drgTarget();
      const want = Math.atan2(tg.x - dragon.pos.x, tg.z - dragon.pos.z);
      let df = want - dragon.ry;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      dragon.ry += df * (1 - Math.exp(-3 * dt));
      dragon.obj.rotation.y = dragon.ry;
      // 飞行中动画切换
      if (dragon.state === 'orbit' && dragon.curAnim !== 'fly') playDrg('fly');
    }
    // 半血锅炉超压
    if (dragon.phase === 1 && dragon.hp <= dragon.maxHp / 2 && dragon.active && !dragon.dead) {
      dragon.phase = 2;
      if (window.UI) { UI.toast('锅炉超压！'); UI.bossBar(dragon.hp, dragon.maxHp, '锅炉压力：超压 ⚠'); }
      if (window.Sound) Sound.sfx('bossRoar');
    }
    // 血条
    if (window.UI && dragon.active && !dragon.dead && dragon.state !== 'intro') {
      UI.bossBar(dragon.hp, dragon.maxHp, dragon.phase === 2 ? '锅炉压力：超压 ⚠' : '锅炉压力：正常');
    }
  }
  function setDrgState(s) { dragon.state = s; dragon.stateT = 0; }
  function spitCoal() {
    if (!dragon.active || dragon.dead) return;
    const tg = drgTarget();
    const origin = new THREE.Vector3(dragon.pos.x, dragon.pos.y - 2, dragon.pos.z);
    const dir = new THREE.Vector3(tg.x - origin.x, World.height(tg.x, tg.z) + 1 - origin.y, tg.z - origin.z).normalize();
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), matC('#1c1812'));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(ball, glow);
    g.position.copy(origin);
    scene.add(g);
    fireballs.push({
      obj: g, pos: origin.clone(), vel: dir.multiplyScalar(16), life: 6, target: tg, local: true,
    });
    if (window.Sound) Sound.sfx('fireball');
    // 广播给客机实体化（各自烧各自）
    if (window.Net && Net.connected && Net.role === 'host') {
      Net.send('vfx', { name: 'fireball', x: origin.x, y: origin.y, z: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });
    }
  }
  function updateFireballs(dt) {
    for (let i = fireballs.length - 1; i >= 0; i--) {
      const f = fireballs[i];
      // 轻微追踪
      const P = Player.state;
      if (!P.dead) {
        const want = new THREE.Vector3(P.pos.x - f.pos.x, P.pos.y + 1 - f.pos.y, P.pos.z - f.pos.z).normalize().multiplyScalar(16);
        f.vel.lerp(want, 1 - Math.exp(-0.8 * dt));
      }
      f.pos.addScaledVector(f.vel, dt);
      f.obj.position.copy(f.pos);
      if (window.Combat && Math.random() < 0.5) Combat.steamPuff(f.pos, 0.5);
      f.life -= dt;
      const h = World.height(f.pos.x, f.pos.z);
      let boom = f.life <= 0 || f.pos.y < h + 0.6;
      if (!boom && !P.dead && f.pos.distanceTo(tmpV.set(P.pos.x, P.pos.y + 1, P.pos.z)) < 2.0) {
        boom = true;
        hitPlayer(2, f.pos.x, f.pos.z, true);
      }
      if (boom) {
        if (window.Combat) { Combat.shockwave(f.pos, 4, 0.45); Combat.hitSpark(f.pos, 8); }
        if (window.Sound) Sound.sfx('explosion');
        emberGround(f.pos.x, f.pos.z, 2.6, 4);
        scene.remove(f.obj);
        fireballs.splice(i, 1);
      }
    }
  }
  function damageDragon(dmg) {
    if (!dragon.active || dragon.dead || dragon.dying) return;
    if (window.Net && Net.connected && Net.role === 'client') {
      Net.send('dmgDragon', { dmg });
      cosmeticHitDragon(dmg);
      return;
    }
    // 飞行中近战免疫由调用方用 meleeWindow 判定；鱼叉远程例外
    dragon.hp -= dmg;
    playDrg('hit');
    dragon.curAnim = null;   // 允许反复触发
    setTimeout(() => { dragon.curAnim = null; }, 200);
    if (window.UI) UI.dmgNumber(new THREE.Vector3(dragon.pos.x, dragon.pos.y + 4, dragon.pos.z), '' + dmg, true);
    if (window.Sound) Sound.sfx('bossHit');
    if (dragon.hp <= 0) {
      dragon.hp = 0;
      dragon.dying = true;
      dragon.meleeWindow = false;
      setDrgState('dying');
      dragon.stateT = 0;
      playDrg('death');
      if (window.Sound) Sound.sfx('bossRoar');
    }
  }
  function cosmeticHitDragon(dmg) {
    if (window.UI) UI.dmgNumber(new THREE.Vector3(dragon.pos.x, dragon.pos.y + 4, dragon.pos.z), '' + dmg, true);
    if (window.Sound) Sound.sfx('bossHit');
  }

  // ---------- 联机快照 ----------
  function snapshot() {
    const out = [];
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i];
      out.push([m.id, Math.round(m.x * 10) / 10, Math.round(m.z * 10) / 10,
        Math.round(m.ry * 100) / 100, m.hp, STATE_ENUM[m.state] || 0]);
    }
    return out;
  }
  function applySnapshot(arr) {
    const byId = {};
    mobs.forEach(m => { byId[m.id] = m; });
    arr.forEach(row => {
      const [id, x, z, ry, hp, st] = row;
      const m = byId[id];
      if (!m) return;
      m.tx = x; m.tz = z; m.try_ = ry;
      if (hp < m.hp && !m.dead) { m.hurtT = 0.2; }   // 快照回流掉血→压扁反馈
      m.hp = hp;
      const ns = DRG_STATE_REV ? null : null;
      const stateName = Object.keys(STATE_ENUM).find(k => STATE_ENUM[k] === st) || 'idle';
      if (st === STATE_ENUM.dead && !m.dead) {
        // 主机判定死亡：客机播死亡动画（不掉落，主机已广播掉落视觉？各自掉落金币视觉即可）
        if (m.type === 'bomb' && m.hp <= 0) { /* 殉爆视觉由 vfx 消息覆盖 */ }
        killMobLocal(m);
      } else if (!m.dead) {
        m.state = stateName === 'dead' ? 'idle' : stateName;
      }
    });
  }
  function killMobLocal(m) {
    if (m.dead) return;
    m.dead = true;
    m.dieT = 0.9;
    if (m.type === 'cat' && m.actions) playCat(m, 'die');
    // 客机本地也爆金币（各自的拾取）
    if (window.Combat) Combat.spawnCoins(new THREE.Vector3(m.x, m.y + 0.6, m.z), 2);
  }
  function applyDragonSnapshot(d) {
    const [x, y, z, ry, hp, st, phase, active, dead] = d;
    if (active && !dragon.active) {
      // 客机被动激活
      activateDragon();
    }
    if (!dragon.obj) return;
    dragon.pos.x += (x - dragon.pos.x) * 0.3;
    dragon.pos.y += (y - dragon.pos.y) * 0.3;
    dragon.pos.z += (z - dragon.pos.z) * 0.3;
    dragon.ry = ry;
    dragon.hp = hp;
    dragon.phase = phase;
    dragon.obj.position.set(dragon.pos.x, dragon.pos.y, dragon.pos.z);
    dragon.obj.rotation.y = ry;
    const stateName = DRG_STATE_REV[st] || 'orbit';
    if (stateName === 'dock') { dragon.meleeWindow = true; dragon.hitPoint = { x, y, z }; }
    else { dragon.meleeWindow = false; dragon.hitPoint = null; }
    if (dead && !dragon.dead) {
      dragon.dead = true;
      dragon.obj.visible = false;
      if (window.UI) UI.hideBossBar();
      if (window.Story) Story.onBossDead();
    } else if (window.UI && dragon.active && !dragon.dead) {
      UI.bossBar(hp, dragon.maxHp, phase === 2 ? '锅炉压力：超压 ⚠' : '锅炉压力：正常');
    }
    if (dragon.mixer) {
      const clipFor = { orbit: 'fly', takeoff: 'fast', dive: 'fast', dock: 'fly', taunt: 'taunt', intro: 'fly', dying: 'death' };
      if (clipFor[stateName]) playDrg(clipFor[stateName]);
      dragon.mixer.update(0.05);
    }
  }

  // ---------- 客户端插值 ----------
  function clientUpdate(dt) {
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i];
      if (m.dead) { updateDead(m, dt); continue; }
      m.x += (m.tx - m.x) * (1 - Math.exp(-12 * dt));
      m.z += (m.tz - m.z) * (1 - Math.exp(-12 * dt));
      let df = m.try_ - m.ry;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      m.ry += df * (1 - Math.exp(-12 * dt));
      m.y = World.height(m.x, m.z);
      m.obj.position.set(m.x, m.y, m.z);
      m.obj.rotation.y = m.ry;
      m.animT += dt;
      // 受击压扁
      if (m.hurtT > 0) {
        m.hurtT -= dt;
        const k = Math.max(0, m.hurtT / 0.25);
        m.inner.scale.set(1 + k * 0.25, 1 - k * 0.3, 1 + k * 0.25);
        setEmissive(m, k);
      } else {
        m.inner.scale.lerp(tmpV.set(1, 1, 1), 1 - Math.exp(-10 * dt));
      }
      const moving = m.state === 'chase' || m.state === 'patrol';
      if (m.type !== 'cat') {
        if (moving) {
          m.inner.position.y = Math.abs(Math.sin(m.animT * m.def.speed * 1.6)) * 0.16;
        } else {
          m.inner.position.y = Math.sin(m.animT * 2) * 0.04;
        }
        if (m.type === 'ghost') m.obj.position.y = m.y + 0.3 + Math.sin(m.animT * 1.8) * 0.25;
      } else if (m.mixer) {
        m.mixer.update(dt);
        playCat(m, moving ? 'walk' : 'idle');
      }
    }
  }

  // ---------- 初始化 / 主更新 ----------
  function init(sc, models) {
    scene = sc;
    catGltf = models.cat;
    parrotGltf = models.parrot;
    catFixY = detectFacing(catGltf.scene);
    spawnAll();
    return Enemies;
  }
  function update(dt, t) {
    const isClient = window.Net && Net.connected && Net.role === 'client';
    if (isClient) clientUpdate(dt);
    else {
      for (let i = 0; i < mobs.length; i++) updateMob(mobs[i], dt, t);
      updateDragon(dt, t);
    }
    updateFireballs(dt);
    updateEmbers(dt);
  }

  return {
    init, update,
    get mobs() { return mobs; },
    get dragon() { return dragon; },
    spawn, damageMob, cosmeticHit, queryMobs, pickTarget,
    activateDragon, damageDragon, cosmeticHitDragon,
    snapshot, applySnapshot, applyDragonSnapshot,
    emberGround,
    get fireballs() { return fireballs; },
    STATE_ENUM, DRG_STATE_ENUM,
  };
})();
window.Enemies = Enemies;
