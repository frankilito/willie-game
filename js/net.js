/* net.js — 双人在线联机（PeerJS，主机权威）
 * 注意：const Net 顶层声明不挂 window —— 末尾必须显式 window.Net = Net。
 * ICE：国内优先小米/腾讯 STUN + Cloudflare/Google 备选 + openrelay 免费 TURN 兜底。
 */
const Net = (function () {
  'use strict';
  const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // 去除易混淆字符
  const PEER_PREFIX = 'willie-hz-';
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.miwifi.com:3478' },          // 小米（国内优先）
      { urls: 'stun:stun.qq.com:3478' },              // 腾讯（国内优先）
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    iceCandidatePoolSize: 4,
  };

  let peer = null, conn = null;
  let role = null;             // 'host' | 'client'
  let connected = false;
  let startCb = null;
  let roomCode = null;
  let watchdog = null, reconnectTimer = null;
  let retried = false, iceProgress = false;
  const handlers = {};
  // 远程玩家
  let remote = null;           // {obj, mixer, actions, pos, facing, anim, glider, nameSprite, weaponNode}
  const stateBuf = [];
  let stateT = 0, mobsT = 0, weatherT = 0;

  const Net = {
    role: null,
    connected: false,
    remotePos: null,

    init() {},

    genCode() {
      let s = '';
      const rnd = World.LCG((Date.now() & 0xffffff) ^ 0x5bd1);
      for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[(rnd() * ROOM_ALPHABET.length) | 0];
      return s;
    },

    // ---------- 房主 ----------
    hostGame(code, onStart) {
      role = 'host';
      Net.role = 'host';
      startCb = onStart;
      roomCode = code || Net.genCode();
      cleanupPeer();
      peer = new Peer(PEER_PREFIX + roomCode, { config: ICE_CONFIG, debug: 1 });
      peer.on('open', () => {
        clearWatchdog();
        if (window.UI) UI.showRoomCode(roomCode);
      });
      peer.on('connection', (c) => {
        if (conn) return;
        conn = c;
        wireConn();
      });
      peer.on('error', onPeerError);
      peer.on('disconnected', () => {
        // 信令断开可重连
        try { peer.reconnect(); } catch (e) {}
      });
      setWatchdog('信令服务器连不上（20 秒无响应）——检查网络，或换个时间再试');
      return roomCode;
    },

    // ---------- 客机 ----------
    joinGame(code, onStart) {
      role = 'client';
      Net.role = 'client';
      startCb = onStart;
      roomCode = code.toUpperCase();
      retried = false;
      iceProgress = false;
      doJoin();
    },

    send(type, data) {
      if (!conn || !conn.open) return;
      try { conn.send(Object.assign({ t: type }, data || {})); } catch (e) {}
    },
    on(type, cb) { (handlers[type] = handlers[type] || []).push(cb); },

    update(dt, t) {
      if (!connected || !conn || !conn.open) return;
      // 玩家状态 15Hz
      stateT += dt;
      if (stateT >= 1 / 15) {
        stateT = 0;
        const P = Player.state;
        Net.send('state', {
          p: [r1(P.pos.x), r1(P.pos.y), r1(P.pos.z)],
          f: r2(P.facing),
          a: P.currentAnim,
          g: P.state === 'glide' ? 1 : 0,
          w: Player.activeWeapon() ? Player.activeWeapon().key : '',
          d: P.dead ? 1 : 0,
          h: P.hp,
        });
      }
      if (role === 'host') {
        // 怪物快照 8Hz
        mobsT += dt;
        if (mobsT >= 1 / 8) {
          mobsT = 0;
          Net.send('mobs', { m: Enemies.snapshot() });
          const d = Enemies.dragon;
          Net.send('dragon', {
            d: [r1(d.pos.x), r1(d.pos.y), r1(d.pos.z), r2(d.ry), d.hp,
              Enemies.DRG_STATE_ENUM[d.state] || 0, d.phase, d.active ? 1 : 0, d.dead ? 1 : 0],
          });
        }
        // 天气昼夜 4s
        weatherT += dt;
        if (weatherT >= 4) {
          weatherT = 0;
          Net.send('weather', { w: World.weather.name, tod: World.timeOfDay });
        }
      }
      // 远程玩家插值
      updateRemote(dt, t);
    },
  };

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }

  // ---------- 客机连接逻辑 ----------
  function doJoin() {
    cleanupPeer();
    peer = new Peer({ config: ICE_CONFIG, debug: 1 });
    peer.on('open', () => {
      clearWatchdog();
      conn = peer.connect(PEER_PREFIX + roomCode, { reliable: true });
      wireConn();
      // 14 秒时：仅在 ICE 毫无进展时静默重连一次（打洞进行中禁止打断）
      reconnectTimer = setTimeout(() => {
        if (!connected && !retried && !iceProgress) {
          retried = true;
          if (window.UI) UI.toast('连接没有进展，静默重试一次…');
          doJoin();   // 内部先销毁旧 Peer
        }
      }, 14000);
    });
    peer.on('error', onPeerError);
    setWatchdog('信令服务器连不上——检查网络，或让房主确认房间码');
  }

  function wireConn() {
    conn.on('open', () => {
      connected = true;
      Net.connected = true;
      clearTimeout(reconnectTimer);
      Net.send('hello', { v: 1, role });
      if (window.UI) UI.toast(role === 'host' ? '玩家 2 已加入！你是玩家 1' : '已连上！你是玩家 2');
      if (window.Sound) Sound.sfx('checkpoint');
      if (startCb) { const cb = startCb; startCb = null; cb(); }
    });
    conn.on('data', onData);
    conn.on('close', () => {
      connected = false;
      Net.connected = false;
      if (window.UI) UI.toast('对方断线了，继续单人冒险');
      removeRemote();
    });
    conn.on('error', (e) => {
      if (window.UI) UI.toast('连接出错：' + (e && e.type || e) + '——同 WiFi 或手机热点更稳');
    });
    // ICE 进展跟踪（用于 14s 静默重连判定）
    if (conn.peerConnection) {
      conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
        const s = conn.peerConnection.iceConnectionState;
        if (s !== 'new' && s !== 'checking') iceProgress = true;
        if (s === 'failed' && window.UI) UI.toast('ICE 打洞失败——试试同一 WiFi 或手机热点');
      });
    } else {
      // peerConnection 稍后才有
      setTimeout(() => {
        if (conn.peerConnection) {
          conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
            const s = conn.peerConnection.iceConnectionState;
            if (s !== 'new' && s !== 'checking') iceProgress = true;
          });
        }
      }, 500);
    }
  }

  // ---------- 分阶段错误提示 ----------
  function onPeerError(e) {
    const type = e && e.type || '';
    if (type === 'peer-not-found') {
      if (window.UI) UI.toast('找不到房间——确认房间码，或让房主重新创建');
    } else if (type === 'unavailable-id') {
      if (window.UI) UI.toast('房间码被占用，重新创建一个');
      if (role === 'host' && startCb) { /* 允许 main 重试 */ }
    } else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
      if (window.UI) UI.toast('信令网络异常——稍后重试，或换网络环境');
    } else if (type === 'webrtc') {
      if (window.UI) UI.toast('WebRTC 出错——换浏览器或网络试试');
    } else {
      if (window.UI) UI.toast('联机出错：' + (type || e));
    }
  }
  function setWatchdog(msg) {
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (!connected && window.UI) UI.toast(msg, 5);
    }, 20000);
  }
  function clearWatchdog() { if (watchdog) { clearTimeout(watchdog); watchdog = null; } }
  function cleanupPeer() {
    clearWatchdog();
    clearTimeout(reconnectTimer);
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    connected = false;
    Net.connected = false;
  }

  // ---------- 消息分发 ----------
  function emit(type, data) {
    (handlers[type] || []).forEach(cb => { try { cb(data); } catch (e) {} });
  }
  function onData(msg) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case 'hello': break;
      case 'state': onRemoteState(msg); break;
      case 'mobs': if (role === 'client') Enemies.applySnapshot(msg.m); break;
      case 'dragon': if (role === 'client') Enemies.applyDragonSnapshot(msg.d); break;
      case 'weather':
        if (role === 'client') {
          if (World.weather.name !== msg.w) World.setWeather(msg.w);
          World.setTimeOfDay(msg.tod);
        }
        break;
      case 'dmgMob':   // 客机→主机：结算
        if (role === 'host') {
          const m = Enemies.mobs.find(x => x.id === msg.i);
          if (m) Enemies.damageMob(m, msg.dmg, 0, 0);
        }
        break;
      case 'dmgDragon':
        if (role === 'host') Enemies.damageDragon(msg.dmg);
        break;
      case 'dmg':      // 主机→客机：怪打客机，客机自扣血
        if (role === 'client') Player.damage(msg.dmg, msg.x, msg.z);
        break;
      case 'vfx': onVfx(msg); break;
      case 'event': onEvent(msg.name); break;
    }
    emit(msg.t, msg);
  }
  function onVfx(msg) {
    if (msg.name === 'fireball') {
      // 客机实体化燃煤弹（各自烧各自）
      clientFireball(msg);
    } else if (msg.name === 'drgSlam') {
      const p = new THREE.Vector3(msg.x, msg.y, msg.z);
      if (window.Combat) { Combat.shockwave(p, 12, 0.7); Combat.hitSpark(p, 20); }
      if (window.Sound) Sound.sfx('explosion');
      if (window.UI) UI.shake(1.0);
      const P = Player.state;
      if (!P.dead && Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 10) Player.damage(3, p.x, p.z);
      if (msg.ph === 2) { Enemies.emberGround(p.x, p.z, 6, 6); Enemies.emberGround(p.x + 5, p.z + 3, 4, 5); }
    } else if (msg.name === 'bombBoom') {
      const p = new THREE.Vector3(msg.x, msg.y + 0.5, msg.z);
      if (window.Combat) { Combat.shockwave(p, 5, 0.5); Combat.hitSpark(p, 12); }
      if (window.Sound) Sound.sfx('explosion');
      Enemies.emberGround(msg.x, msg.z, 3.2, 5);
      const P = Player.state;
      if (!P.dead && Math.hypot(P.pos.x - msg.x, P.pos.z - msg.z) < 4.5) Player.damage(4, msg.x, msg.z);
    } else if (window.Combat) {
      Combat.vfxReplay(msg.name, msg);
    }
  }
  function clientFireball(msg) {
    const origin = new THREE.Vector3(msg.x, msg.y, msg.z);
    const dir = new THREE.Vector3(msg.dx, msg.dy, msg.dz).normalize();
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#1c1812').convertSRGBToLinear() }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(ball, glow);
    g.position.copy(origin);
    G.scene.add(g);
    const vel = dir.multiplyScalar(16);
    const pos = origin.clone();
    let life = 6;
    const id = setInterval(() => {
      const dt = 0.05;
      life -= dt;
      const P = Player.state;
      if (!P.dead) {
        const want = new THREE.Vector3(P.pos.x - pos.x, P.pos.y + 1 - pos.y, P.pos.z - pos.z).normalize().multiplyScalar(16);
        vel.lerp(want, 0.04);
      }
      pos.addScaledVector(vel, dt);
      g.position.copy(pos);
      let boom = life <= 0 || pos.y < World.height(pos.x, pos.z) + 0.6;
      if (!boom && !P.dead && pos.distanceTo(new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z)) < 2.0) {
        boom = true;
        Player.damage(2, pos.x, pos.z);
      }
      if (boom) {
        clearInterval(id);
        G.scene.remove(g);
        if (window.Combat) { Combat.shockwave(pos, 4, 0.45); Combat.hitSpark(pos, 8); }
        if (window.Sound) Sound.sfx('explosion');
        Enemies.emberGround(pos.x, pos.z, 2.6, 4);
      }
    }, 50);
  }
  function onEvent(name) {
    if (name === 'drgOn') {
      if (role === 'client' && !Enemies.dragon.active) Enemies.activateDragon();
      if (window.Story) Story.onNetEvent('drgOn');
    } else if (name === 'drgDead') {
      if (window.Story) Story.onNetEvent('drgDead');
    } else if (name === 'shrineKill') {
      if (window.Story) Story.onNetEvent('shrineKill');
    } else if (name === 'playerDied') {
      if (remote) playRemoteAnim('die');
    }
  }

  // ---------- 远程汽船水手 ----------
  function buildRemote() {
    const model = THREE.SkeletonUtils.clone(G.models.mickey.scene);
    model.traverse(o => {
      if (o.isSkinnedMesh || o.isMesh) o.castShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
    });
    // 区分标记：胸前方形纽扣（不用现代配色区分）
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#2a2620').convertSRGBToLinear() }));
    badge.position.set(0, 0.92, 0.24);
    model.add(badge);
    const obj = new THREE.Group();
    obj.add(model);
    // 名牌
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 30px Georgia'; g.textAlign = 'center';
    g.lineWidth = 5; g.strokeStyle = '#17130d'; g.strokeText(role === 'host' ? '玩家 2' : '玩家 1', 128, 42);
    g.fillStyle = '#f2ead6'; g.fillText(role === 'host' ? '玩家 2' : '玩家 1', 128, 42);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    name.scale.set(2.6, 0.65, 1);
    name.position.y = 2.4;
    obj.add(name);
    // 滑翔翼
    const glider = new THREE.Group();
    const cvs = document.createElement('canvas');
    cvs.width = 128; cvs.height = 64;
    const gg = cvs.getContext('2d');
    for (let i = 0; i < 8; i++) { gg.fillStyle = i % 2 ? '#e8dcc0' : '#2c2820'; gg.fillRect(i * 16, 0, 16, 64); }
    const gtex = new THREE.CanvasTexture(cvs);
    gtex.encoding = THREE.sRGBEncoding;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6),
      new THREE.MeshLambertMaterial({ map: gtex, side: THREE.DoubleSide }));
    sail.rotation.x = -0.5;
    glider.add(sail);
    glider.position.set(0, 2.35, -0.2);
    glider.visible = false;
    model.add(glider);
    G.scene.add(obj);
    remote = {
      obj, model, glider,
      mixer: new THREE.AnimationMixer(model),
      actions: {},
      x: 0, y: 0, z: 0, facing: 0,
      curAnim: '', weaponKey: '', weaponNode: null,
      bones: {},
    };
    G.models.mickey.animations.forEach(a => { remote.actions[a.name] = remote.mixer.clipAction(a); });
    ['HandR', 'HandL'].forEach(n => { const b = model.getObjectByName(n); if (b) remote.bones[n] = b; });
    const P = Player.state;
    remote.x = P.pos.x; remote.z = P.pos.z; remote.y = P.pos.y;
  }
  function playRemoteAnim(name) {
    if (!remote || !remote.actions[name] || remote.curAnim === name) return;
    const prev = remote.actions[remote.curAnim];
    const next = remote.actions[name];
    next.reset();
    next.setLoop(name === 'die' ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = true;
    next.play();
    if (prev) prev.crossFadeTo(next, 0.15, false);
    remote.curAnim = name;
  }
  function onRemoteState(msg) {
    if (!remote) buildRemote();
    stateBuf.push({ t: performance.now(), p: msg.p, f: msg.f, a: msg.a, g: msg.g, w: msg.w, d: msg.d });
    while (stateBuf.length > 12) stateBuf.shift();
    Net.remotePos = { x: msg.p[0], z: msg.p[2] };
    if (msg.a) playRemoteAnim(msg.a);
    if (remote) {
      remote.glider.visible = !!msg.g;
      // 武器按 GRIP 挂手
      if (msg.w !== remote.weaponKey) {
        remote.weaponKey = msg.w;
        if (remote.weaponNode && remote.weaponNode.parent) remote.weaponNode.parent.remove(remote.weaponNode);
        remote.weaponNode = null;
        if (msg.w && window.Combat && Combat.buildWeaponMesh) {
          const boneName = Combat.GRIP[msg.w] || 'HandR';
          const bone = remote.bones[boneName];
          if (bone) {
            const wm = Combat.buildWeaponMesh(msg.w);
            wm.position.set(0, 0, 0.05);
            bone.add(wm);
            remote.weaponNode = wm;
          }
        }
      }
      if (msg.d) playRemoteAnim('die');
    }
  }
  function updateRemote(dt) {
    if (!remote) return;
    // 插值位移
    if (stateBuf.length >= 2) {
      const a = stateBuf[stateBuf.length - 2], b = stateBuf[stateBuf.length - 1];
      remote.x += (b.p[0] - remote.x) * (1 - Math.exp(-15 * dt));
      remote.y += (b.p[1] - remote.y) * (1 - Math.exp(-15 * dt));
      remote.z += (b.p[2] - remote.z) * (1 - Math.exp(-15 * dt));
      let df = b.f - remote.facing;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      remote.facing += df * (1 - Math.exp(-15 * dt));
    }
    remote.obj.position.set(remote.x, remote.y, remote.z);
    remote.obj.rotation.y = remote.facing;
    remote.mixer.update(dt);
  }
  function removeRemote() {
    if (remote) { G.scene.remove(remote.obj); remote = null; }
    Net.remotePos = null;
  }

  return Net;
})();
window.Net = Net;   // 必须显式挂 window（其他模块用 window.Net && 守卫）
