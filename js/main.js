/* main.js — 启动与主循环
 * 调试参数：?debug=1 &at=shrine|volcano|boss|tower &q=<quest> &t=<时刻> &w=<天气>
 *           &nodraw=1（软件渲染 CI 联机测试必需）&mp=host|join&room=XXXX
 */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const G = {
    params: {
      debug: params.get('debug') === '1',
      at: params.get('at'),
      q: params.get('q'),
      t: params.get('t'),
      w: params.get('w'),
      nodraw: params.get('nodraw') === '1',
      mp: params.get('mp'),
      room: params.get('room'),
    },
    started: false,
    scene: null, camera: null, renderer: null,
    models: {},
    player: null,
    keys: null,
  };
  window.G = G;

  // ---------- 渲染器 ----------
  function createRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game').appendChild(renderer.domElement);
    return renderer;
  }

  // ---------- 模型加载 ----------
  function loadModels(cb) {
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(new THREE.DRACOLoader());
    const files = {
      mickey: 'assets/models/willie_mickey.glb',
      minnie: 'assets/models/minnie1928.glb',
      cat: 'assets/models/blackcat_mate.glb',
      parrot: 'assets/models/steam_parrot.glb',
    };
    const keys = Object.keys(files);
    let done = 0;
    keys.forEach(k => {
      loader.load(files[k], (gltf) => {
        G.models[k] = gltf;
        done++;
        if (done === keys.length) cb();
      }, undefined, (e) => {
        UI.toast('模型加载失败：' + files[k]);
        console.error(e);
      });
    });
  }

  // ---------- 游戏启动 ----------
  let mode = 'single';
  function startGame(m) {
    mode = m;
    UI.showCard('加载中…');
    loadModels(() => {
      UI.hideCard();
      initWorld();
      applyDebug();
      G.started = true;
      if (!G.params.debug) Story.startIntro();
      else {
        // debug：跳过标题/开场，给全装备
        Player.giveAll();
        if (G.params.at) teleportAt(G.params.at);
      }
    });
  }
  function initWorld() {
    World.init(G.scene, G.camera);
    UI.init();
    Player.init(G.scene, G.camera, G.models.mickey);
    G.player = Player.state;
    G.keys = Player.keys;
    Combat.init(G.scene, G.camera);
    Enemies.init(G.scene, { cat: G.models.cat, parrot: G.models.parrot });
    Npc.init(G.scene, { minnie: G.models.minnie });
    Story.init();
    Net.init();
  }
  function applyDebug() {
    const P = G.params;
    if (!P.debug) return;
    document.getElementById('fps').style.display = 'block';
    if (P.t) World.setTimeOfDay(parseFloat(P.t));
    if (P.w) World.setWeather(P.w);
    if (P.q) Story.setQuest(P.q);
    // 联机自动流程
    if (P.mp === 'host') {
      Net.hostGame(P.room || null, () => UI.toast('玩家 2 已加入'));
    } else if (P.mp === 'join' && P.room) {
      Net.joinGame(P.room, () => UI.toast('已加入房间'));
    }
  }
  function teleportAt(at) {
    const LM = World.LANDMARKS;
    const map = {
      shrine: [LM.SHRINE.x, LM.SHRINE.z + 8],
      volcano: [LM.VOLCANO.x + 55, LM.VOLCANO.z + 42],
      boss: [LM.VOLCANO.x + 58, LM.VOLCANO.z + 40],
      tower: [LM.TOWER.x, LM.TOWER.z + 6],
    };
    const p = map[at];
    if (p) Player.teleport(p[0], p[1]);
    if (at === 'boss') Story.setQuest('q5_boss');
  }

  // ---------- 主循环 ----------
  let lastT = performance.now();
  let fpsT = 0, fpsN = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;      // 卡顿保护
    if (dt <= 0) dt = 0.001;
    const t = now / 1000;

    try {
      if (G.started) {
        World.update(dt, t);
        if (!Story.state.cutscene) {
          Player.update(dt);
          Combat.update(dt);
          Enemies.update(dt, t);
          Npc.update(dt, t);
        }
        Story.update(dt, t);
        Net.update(dt, t);
      }
      UI.update(dt, t);
    } catch (e) {
      console.error(e && e.stack || e);
    }

    if (!G.params.nodraw) G.renderer.render(G.scene, G.camera);

    if (G.params.debug) {
      fpsN++; fpsT += dt;
      if (fpsT >= 0.5) {
        document.getElementById('fps').textContent =
          'FPS ' + Math.round(fpsN / fpsT) + ' | mobs ' + Enemies.mobs.length +
          (Net.connected ? ' | NET ' + Net.role : '');
        fpsN = 0; fpsT = 0;
      }
    }
  }

  // ---------- 引导 ----------
  function boot() {
    G.renderer = createRenderer();
    G.scene = new THREE.Scene();
    G.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1600);
    G.camera.position.set(150, 12, 250);
    addEventListener('resize', () => {
      G.camera.aspect = innerWidth / innerHeight;
      G.camera.updateProjectionMatrix();
      G.renderer.setSize(innerWidth, innerHeight);
    });
    // 开场跳过键
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && Story.state.cutscene) Story.skipIntro();
    });

    if (G.params.debug) {
      // debug 模式跳过标题
      Sound.init();
      document.getElementById('title').style.display = 'none';
      document.getElementById('hud').style.display = 'block';
      startGame('single');
    } else {
      UI.bindTitle({
        onSingle() {
          Sound.init();
          UI.hideTitle();
          startGame('single');
        },
        onHost() {
          Sound.init();
          Net.hostGame(null, () => {
            UI.hideTitle();
            startGame('host');
          });
        },
        onJoin(code) {
          Sound.init();
          Net.joinGame(code, () => {
            UI.hideTitle();
            startGame('client');
          });
        },
      });
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
