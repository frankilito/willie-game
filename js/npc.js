/* npc.js — 7 位取材于《Steamboat Willie》河港/农庄语境的 NPC
 * 规则：道具在对话【开始时】立即发放（对话可能被顶掉，放结束回调会永久丢失）。
 */
const Npc = (function () {
  'use strict';
  let scene;
  const list = [];
  let nearest = null;
  let shopOpen = false, shopBoughtContainer = false;
  const tmpV = new THREE.Vector3();

  function matC(hex, opts) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(hex).convertSRGBToLinear() }, opts || {}));
  }
  function nameSprite(text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 30px Georgia';
    g.textAlign = 'center';
    g.lineWidth = 5; g.strokeStyle = '#17130d';
    g.strokeText(text, 128, 42);
    g.fillStyle = '#f2ead6';
    g.fillText(text, 128, 42);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(2.6, 0.65, 1);
    sp.position.y = 2.6;
    return sp;
  }

  // ---------- 程序化建模（1928 黑白橡皮管） ----------
  function buildGoat() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), matC('#b3ab96'));
    body.position.y = 1.0; body.scale.set(1, 1.25, 0.85);
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), matC('#cfc7b4'));
    head.position.set(0, 1.75, 0.12);
    g.add(head);
    // 长胡子
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 7), matC('#e8e0cc'));
    beard.position.set(0, 1.42, 0.28); beard.rotation.x = Math.PI;
    g.add(beard);
    // 会抖动的橡皮管下巴
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), matC('#cfc7b4'));
    jaw.position.set(0, 1.58, 0.3);
    g.add(jaw);
    g.userData.jaw = jaw;
    // 角
    for (let i = -1; i <= 1; i += 2) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 6), matC('#45403a'));
      horn.position.set(i * 0.14, 2.0, 0.02);
      horn.rotation.z = i * -0.3;
      g.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), matC('#17130d'));
      eye.position.set(i * 0.12, 1.82, 0.38);
      g.add(eye);
    }
    // 吊带裤
    for (let i = -1; i <= 1; i += 2) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, 0.05), matC('#45403a'));
      strap.position.set(i * 0.16, 1.1, 0.36);
      g.add(strap);
    }
    const pants = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 0.5, 10), matC('#3a342a'));
    pants.position.y = 0.5;
    g.add(pants);
    // 橡皮管四肢
    for (let i = -1; i <= 1; i += 2) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.75, 6), matC('#b3ab96'));
      arm.position.set(i * 0.5, 1.05, 0); arm.rotation.z = i * 0.35;
      g.add(arm);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.6, 6), matC('#3a342a'));
      leg.position.set(i * 0.18, 0.15, 0);
      g.add(leg);
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), matC('#2a2620'));
      shoe.scale.set(1, 0.7, 1.5);
      shoe.position.set(i * 0.18, -0.13, 0.08);
      g.add(shoe);
    }
    return g;
  }
  function buildCow() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), matC('#e8e0cc'));
    body.position.y = 1.05; body.scale.set(1.05, 1.2, 0.9);
    g.add(body);
    // 黑白花斑
    for (let i = 0; i < 3; i++) {
      const patch = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), matC('#1c1812'));
      patch.position.set((i - 1) * 0.25, 1.1 + (i % 2) * 0.3, 0.42);
      patch.scale.set(1, 1.3, 0.4);
      g.add(patch);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), matC('#e8e0cc'));
    head.position.set(0, 1.85, 0.1);
    g.add(head);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), matC('#cfc7b4'));
    muzzle.scale.set(1.2, 0.8, 0.9);
    muzzle.position.set(0, 1.72, 0.36);
    g.add(muzzle);
    for (let i = -1; i <= 1; i += 2) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 6), matC('#8b8577'));
      horn.position.set(i * 0.18, 2.12, 0.05); horn.rotation.z = i * -0.5;
      g.add(horn);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), matC('#e8e0cc'));
      ear.scale.set(1.4, 0.6, 0.5);
      ear.position.set(i * 0.34, 1.95, 0.05);
      g.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), matC('#17130d'));
      eye.position.set(i * 0.13, 1.92, 0.38);
      g.add(eye);
    }
    // 皮围裙
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.06), matC('#5a4a38'));
    apron.position.set(0, 0.95, 0.46);
    g.add(apron);
    // 小锤
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), matC('#6a5f4c'));
    handle.position.set(0.55, 1.2, 0.2); handle.rotation.z = -0.5;
    const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.16), matC('#45403a'));
    hammerHead.position.set(0.68, 1.45, 0.2);
    g.add(handle, hammerHead);
    for (let i = -1; i <= 1; i += 2) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.7, 6), matC('#45403a'));
      leg.position.set(i * 0.22, 0.2, 0);
      g.add(leg);
    }
    return g;
  }
  function buildDuck() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), matC('#d8d2c2'));
    body.position.y = 0.95; body.scale.set(0.9, 1.2, 0.85);
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), matC('#d8d2c2'));
    head.position.set(0, 1.6, 0.1);
    g.add(head);
    // 扁嘴
    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.3), matC('#b8a878'));
    beak.position.set(0, 1.52, 0.4);
    g.add(beak);
    for (let i = -1; i <= 1; i += 2) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), matC('#17130d'));
      eye.position.set(i * 0.11, 1.68, 0.32);
      g.add(eye);
    }
    // 水手领
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.4), matC('#2a2620'));
    collar.position.set(0, 1.25, 0.1);
    g.add(collar);
    // 长柄鱼叉
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), matC('#6a5f4c'));
    shaft.position.set(0.5, 1.2, 0); shaft.rotation.z = 0.15;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 6), matC('#45403a'));
    tip.position.set(0.68, 2.4, 0);
    g.add(shaft, tip);
    for (let i = -1; i <= 1; i += 2) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), matC('#b8a878'));
      foot.scale.set(1, 0.4, 1.5);
      foot.position.set(i * 0.16, -0.02, 0.08);
      g.add(foot);
    }
    return g;
  }
  function buildPig() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 8), matC('#c8bca8'));
    body.position.y = 1.0; body.scale.set(1.15, 1.1, 0.95);
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), matC('#c8bca8'));
    head.position.set(0, 1.8, 0.12);
    g.add(head);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.18, 10), matC('#a89888'));
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 1.72, 0.45);
    g.add(snout);
    for (let i = -1; i <= 1; i += 2) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 5), matC('#a89888'));
      ear.position.set(i * 0.22, 2.08, 0.05); ear.rotation.z = i * -0.6;
      g.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), matC('#17130d'));
      eye.position.set(i * 0.13, 1.88, 0.42);
      g.add(eye);
    }
    // 围裙
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.06), matC('#e8e0cc'));
    apron.position.set(0, 0.95, 0.48);
    g.add(apron);
    for (let i = -1; i <= 1; i += 2) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.55, 6), matC('#a89888'));
      leg.position.set(i * 0.24, 0.15, 0);
      g.add(leg);
    }
    return g;
  }
  function buildParrot() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), matC('#45403a'));
    body.position.y = 1.05; body.scale.set(0.85, 1.25, 0.8);
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), matC('#5e584b'));
    head.position.set(0, 1.62, 0.08);
    g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), matC('#8b8577'));
    beak.rotation.x = Math.PI / 2 + 0.4;
    beak.position.set(0, 1.56, 0.34);
    g.add(beak);
    for (let i = -1; i <= 1; i += 2) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), matC('#f2ead6'));
      eye.position.set(i * 0.1, 1.68, 0.28);
      g.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), matC('#17130d'));
      pupil.position.set(i * 0.1, 1.68, 0.32);
      g.add(pupil);
      // 翅膀
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), matC('#2a2620'));
      wing.scale.set(0.5, 1.2, 0.8);
      wing.position.set(i * 0.32, 1.05, -0.02);
      g.add(wing);
    }
    // 单筒望远镜
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), matC('#8b8577'));
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0.3, 1.5, 0.3);
    g.add(scope);
    // 背上的鱼叉弓
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 12, Math.PI * 1.4), matC('#5a5040'));
    bow.position.set(-0.15, 1.15, -0.3);
    bow.rotation.z = 0.8;
    g.add(bow);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), matC('#2a2620'));
    tail.position.set(0, 0.75, -0.35); tail.rotation.x = -0.8;
    g.add(tail);
    for (let i = -1; i <= 1; i += 2) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 5), matC('#8b8577'));
      leg.position.set(i * 0.1, 0.35, 0);
      g.add(leg);
    }
    return g;
  }
  function buildTurkey() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), matC('#2a2620'));
    body.position.y = 0.85; body.scale.set(1, 1.15, 0.9);
    g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 6), matC('#45403a'));
    neck.position.set(0, 1.4, 0.1);
    g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), matC('#5e584b'));
    head.position.set(0, 1.68, 0.12);
    g.add(head);
    const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), matC('#8b8577'));
    wattle.position.set(0, 1.58, 0.24);
    g.add(wattle);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 5), matC('#b8a878'));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 1.68, 0.28);
    g.add(beak);
    for (let i = -1; i <= 1; i += 2) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), matC('#f2ead6'));
      eye.position.set(i * 0.07, 1.74, 0.22);
      g.add(eye);
    }
    // 手风琴尾羽
    const tailGroup = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const a = -0.75 + i * 0.25;
      const feather = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.04),
        matC(i % 2 ? '#45403a' : '#5e584b'));
      feather.position.set(Math.sin(a) * 0.5, 1.1, -0.35 - Math.cos(a) * 0.25);
      feather.rotation.y = a;
      feather.rotation.x = -0.35;
      tailGroup.add(feather);
    }
    g.add(tailGroup);
    g.userData.tail = tailGroup;
    for (let i = -1; i <= 1; i += 2) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.5, 5), matC('#8b8577'));
      leg.position.set(i * 0.14, 0.25, 0);
      g.add(leg);
    }
    return g;
  }

  // ---------- NPC 定义 ----------
  function make(key, name, x, z, group, hooks) {
    const y = World.height(x, z);
    group.position.set(x, y, z);
    group.add(nameSprite(name));
    scene.add(group);
    const npc = {
      key, name, x, z, y, group, talked: false, animT: Math.random() * 10,
      talking: false,
      firstGive: hooks.firstGive || null,
      lines: hooks.lines,
      onDone: hooks.onDone || null,
      update: hooks.update || null,
    };
    list.push(npc);
    return npc;
  }

  function init(sc, models) {
    scene = sc;
    const LM = World.LANDMARKS;
    // 老山羊比尔 —— 黄铜船钟旁
    make('bill', '老山羊比尔', LM.SPAWN.x - 6.5, LM.SPAWN.z - 2, buildGoat(), {
      firstGive() {
        Player.addContainer();
        if (window.UI) UI.toast('心之容器 +1 ♥');
        if (window.Sound) Sound.sfx('itemget');
      },
      lines() {
        const n = list.find(x => x.key === 'bill');
        if (!n.talked) return [
          '哟，小水手！我是比尔，这港口最老的山羊。',
          '皮特船长抢走了唤醒威利号的黄金汽笛，还用黑烟封了河道。',
          '拿着这颗心之容器——路上可不太平。',
          '先去找铁匠莫莉领件称手的家伙吧。',
        ];
        return [window.Story ? Story.hint() : '河道会重新开放的，我相信你。'];
      },
      update(npc, dt, t) {
        const jaw = npc.group.userData.jaw;
        if (jaw) jaw.rotation.x = npc.talking ? Math.sin(t * 18) * 0.5 : 0;
      },
    });
    // 铁匠老牛莫莉 —— 锅炉铁匠铺
    make('molly', '铁匠老牛莫莉', LM.SPAWN.x + 10, LM.SPAWN.z + 6, buildCow(), {
      firstGive() { Player.giveItem('mop'); },
      lines() {
        const n = list.find(x => x.key === 'molly');
        if (!n.talked) return [
          '哞——你就是那个要出航的小水手？',
          '这根甲板拖把送你。别小看它，满血的时候还能甩出音乐波呢。',
          '武器用坏了随时回来，莫莉给你免费修满。',
        ];
        Player.repairAll();
        if (window.UI) UI.toast('武器已修满');
        if (window.Sound) Sound.sfx('shop');
        return ['都修好啦！干活的家伙就得亮堂堂的。'];
      },
    });
    // 水手鸭达克 —— 南码头门
    make('duck', '水手鸭达克', LM.SPAWN.x + 3, LM.SPAWN.z + 15.5, buildDuck(), {
      firstGive() { Player.giveItem('shield'); },
      lines() {
        const n = list.find(x => x.key === 'duck');
        if (!n.talked) return [
          '嘎！出航不带盾，等于裸奔。',
          '这面小号舵轮盾归你了——按住右键举盾。',
          '面向攻击能减伤七成五，格挡瞬间舵轮还会响一声船钟。',
        ];
        return ['记住：举盾要面向攻击方向，背后可防不住。'];
      },
    });
    // 米妮（1928）—— 西北圆顶水手屋前
    make('minnie', '米妮', LM.SPAWN.x - 16, LM.SPAWN.z - 13, (function () {
      const g = new THREE.Group();
      const model = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(models.minnie.scene) : models.minnie.scene.clone();
      model.traverse(o => { if (o.isSkinnedMesh || o.isMesh) o.castShadow = true; });
      g.add(model);
      const mixer = new THREE.AnimationMixer(model);
      const acts = {};
      models.minnie.animations.forEach(a => { acts[a.name] = mixer.clipAction(a); });
      if (acts.idle) acts.idle.play();
      g.userData.mixer = mixer;
      g.userData.acts = acts;
      g.userData.cur = 'idle';
      return g;
    })(), {
      firstGive() { Player.giveItem('lifebuoy'); },
      lines() {
        const n = list.find(x => x.key === 'minnie');
        if (!n.talked) return [
          '米奇！听说你要去锅炉岛？',
          '拿着我的救生圈——按 F 扔出去，它自己会飞回来。',
          '回程还能把金币吸过来，可机灵了。',
          '把黄金汽笛带回来，我在这儿等你吹三声！',
        ];
        return ['别担心我，照顾好你自己。救生圈扔准点！'];
      },
      update(npc, dt) {
        const u = npc.group.userData;
        if (u.mixer) {
          u.mixer.update(dt);
          const want = npc.talking && u.acts.talk ? 'talk' : 'idle';
          if (want !== u.cur && u.acts[want]) {
            u.acts[u.cur].crossFadeTo(u.acts[want], 0.2, false);
            u.acts[want].reset().play();
            u.cur = want;
          }
        }
      },
    });
    // 猪妈妈珀尔 —— 鱼货市集（金币商店）
    make('pearl', '猪妈妈珀尔', LM.SPAWN.x - 17, LM.SPAWN.z - 1, buildPig(), {
      lines() {
        return [
          '哼哼，来看看珀尔的货——',
          '【按 1】热牛奶 10 金币（回两颗心）',
          '【按 2】心之容器 50 金币（每人限购一颗）',
        ];
      },
      onDone() { shopOpen = false; },
      isShop: true,
    });
    // 鹦鹉瞭望员波利 —— 航标高台顶
    make('polly', '鹦鹉瞭望员波利', LM.TOWER.x + 2.5, LM.TOWER.z + 2, buildParrot(), {
      firstGive() { Player.giveItem('bow'); },
      lines() {
        const n = list.find(x => x.key === 'polly');
        if (!n.talked) return [
          '嘎——我在高台上盯了那铁鹦鹉好几天了。',
          '这把鱼叉弓给你：按住左键拉弦，满了变成汽笛环。',
          '飞行中的铁鹦鹉刀枪不入，只有鱼叉扎得着！',
          '等它靠岸歇脚，再冲上去用拖把招呼。',
        ];
        return ['满弦的鱼叉飞得又平又远，风大的时候会偏，记着提前量。'];
      },
    });
    // 火鸡提姆 —— 芦苇音乐田
    make('tim', '火鸡提姆', LM.FLOWER.x + 6, LM.FLOWER.z + 4, buildTurkey(), {
      firstGive() {
        Player.giveItem('whistle');
        Player.setCheckpoint(LM.FLOWER.x + 6, LM.FLOWER.z + 4);
      },
      lines() {
        const n = list.find(x => x.key === 'tim');
        if (!n.talked) return [
          '咕哒咕哒！音乐家提姆在此。',
          '这口锅炉汽笛送你，吹出去的煤球会蹦两下。',
          '我也给你记了个检查点——倒下就从这儿重来。',
        ];
        return ['咕哒！跟着节拍走，锅炉岛也没那么可怕。'];
      },
      update(npc, dt, t) {
        const tail = npc.group.userData.tail;
        if (tail) tail.children.forEach((f, i) => {
          f.rotation.x = -0.35 + Math.sin(t * 1.6 + i * 0.5) * 0.22;   // 手风琴开合
        });
      },
    });

    // 商店按键（对话打开时 Digit 不会被武器栏拦截——Player 已 return）
    document.addEventListener('keydown', (e) => {
      if (!shopOpen || !UI.isDialogueOpen()) return;
      if (e.code === 'Digit1') buyMilk();
      if (e.code === 'Digit2') buyContainer();
    });
    return Npc;
  }
  function buyMilk() {
    const P = Player.state;
    if (P.hp >= P.maxHp) { UI.toast('血已满，珀尔不卖！'); if (window.Sound) Sound.sfx('ui'); return; }
    if (!Player.spendCoins(10)) { UI.toast('金币不够——去顶货箱、打怪物攒钱吧'); return; }
    Player.heal(4);
    UI.toast('热牛奶 ♥♥');
    if (window.Sound) Sound.sfx('shop');
  }
  function buyContainer() {
    if (shopBoughtContainer) { UI.toast('每人限购一颗，珀尔不讲价'); return; }
    if (!Player.spendCoins(50)) { UI.toast('金币不够——心之容器要 50 枚'); return; }
    shopBoughtContainer = true;
    Player.addContainer();
    UI.toast('心之容器 +1 ♥');
    if (window.Sound) Sound.sfx('itemget');
  }

  // ---------- 对话 ----------
  function tryTalk() {
    if (!nearest || UI.isDialogueOpen()) return;
    const npc = nearest;
    if (!npc.talked) {
      npc.talked = true;
      if (npc.firstGive) npc.firstGive();   // 对话开始即发放，防顶掉
    }
    npc.talking = true;
    if (npc.key === 'pearl') shopOpen = true;
    UI.openDialogue(npc.name, npc.lines(), () => {
      npc.talking = false;
      if (npc.onDone) npc.onDone();
    });
  }

  // ---------- 主更新 ----------
  function update(dt, t) {
    const P = Player.state;
    nearest = null;
    let nearD = 2.7;
    for (let i = 0; i < list.length; i++) {
      const npc = list[i];
      npc.animT += dt;
      // 待机弹跳
      npc.group.position.y = npc.y + Math.abs(Math.sin(npc.animT * 2.2)) * 0.12;
      // 8m 内转身面向玩家
      const dx = P.pos.x - npc.x, dz = P.pos.z - npc.z;
      const d = Math.hypot(dx, dz);
      if (d < 8) {
        const want = Math.atan2(dx, dz);
        let df = want - npc.group.rotation.y;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        npc.group.rotation.y += df * (1 - Math.exp(-8 * dt));
      }
      if (npc.update) npc.update(npc, dt, t);
      if (d < nearD && !UI.isDialogueOpen()) { nearD = d; nearest = npc; }
    }
    // E 提示（投影到屏幕）
    if (nearest && window.G && G.camera) {
      tmpV.set(nearest.x, nearest.y + 2.8, nearest.z).project(G.camera);
      if (tmpV.z < 1) {
        UI.ePrompt(true, (tmpV.x * 0.5 + 0.5) * innerWidth, (-tmpV.y * 0.5 + 0.5) * innerHeight,
          nearest.key === 'pearl' ? 'E 商店' : 'E 对话');
      } else UI.ePrompt(false);
    } else UI.ePrompt(false);
  }

  return {
    init, update, tryTalk,
    get list() { return list; },
    isTalking: () => UI.isDialogueOpen(),
    shopBought: () => shopBoughtContainer,
  };
})();
window.Npc = Npc;
