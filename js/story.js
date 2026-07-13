/* story.js — 任务链与过场
 * 铁律：say() 绝不允许在 update 里无守卫重复调用（每帧重置对话队列=剧情卡死）。
 * 所有剧情触发都用一次性标志守护。
 */
const Story = (function () {
  'use strict';
  const S = {
    quest: 'q0_intro',
    shrineKills: 0,
    flags: {},
    cutscene: null,        // {steps, i, t, cam}
    camOverride: null,
    bossStarted: false,
    bossDead: false,
    ended: false,
    startTime: 0,
    ritualDone: false,
    volcanoCheckpoint: false,
  };

  const QUESTS = {
    q1_mop: { title: '第一幕 · 领件家伙', body: '去广场东侧的锅炉铁匠铺，<br>找铁匠老牛莫莉领甲板拖把。', target: () => ({ x: 160, z: 236 }) },
    q2_shrine: { title: '第二幕 · 旧汽笛站', body: () => '向北前往旧汽笛站，<br>清剿盘踞的怪物（' + S.shrineKills + '/4）。', target: () => World.LANDMARKS.SHRINE },
    q3_bell: { title: '第三幕 · 船钟共鸣', body: '汽笛站已清空！到中央祭坛<br>按 E 敲响老船钟。', target: () => World.LANDMARKS.SHRINE },
    q4_volcano: { title: '第四幕 · 黑烟锅炉岛', body: '向西南远航，登陆黑烟锅炉岛。<br>（芦苇音乐田的提姆能记检查点）', target: () => World.LANDMARKS.VOLCANO },
    q5_boss: { title: '第五幕 · 蒸汽鹦鹉号', body: '击坠巨型蒸汽鹦鹉号！<br>飞行时用鱼叉弓，靠岸时近战。', target: () => World.LANDMARKS.VOLCANO },
    q6_whistle: { title: '终幕 · 黄金汽笛', body: '鹦鹉号坠毁了！<br>到煤浆湖边拾取黄金汽笛。', target: () => ({ x: World.LANDMARKS.VOLCANO.x + 24, z: World.LANDMARKS.VOLCANO.z + 6 }) },
  };

  // ---------- 对话守卫 ----------
  let sayLock = false;
  function say(name, lines, onDone) {
    if (sayLock || UI.isDialogueOpen()) return false;
    sayLock = true;
    UI.openDialogue(name, lines, () => {
      sayLock = false;
      if (onDone) onDone();
    });
    return true;
  }

  // ---------- 开场过场（4:3 黑边 + 手摇摄影机 + 默片字幕卡） ----------
  function startIntro() {
    S.startTime = performance.now();
    const LM = World.LANDMARKS;
    S.cutscene = {
      i: 0, t: 0,
      steps: [
        { dur: 4.0, card: '1928 年，威利河港。', sub: '一部黑白卡通', cam: { from: [120, 30, 280], to: [150, 18, 262], look: [150, 4, 230] } },
        { dur: 4.2, card: '皮特船长夺走了黄金汽笛——', sub: '那是唯一能唤醒威利号的钥匙', cam: { from: [150, 10, 212], to: [150, 8, 206], look: [150, 6, 200] } },
        { dur: 4.2, card: '——并用黑烟封锁了整条河道。', sub: '锅炉岛上升起滚滚浓烟', cam: { from: [-120, 40, -120], to: [-190, 55, -190], look: [-210, 20, -215] } },
        { dur: 4.6, card: '米妮把帆布滑翔翼塞给米奇：<br>「把它带回来！」', sub: '空格键可跳过过场', cam: { from: [140, 6, 224], to: [136, 4, 220], look: [134, 2, 217] } },
      ],
    };
    UI.letterbox(true);
    showStep();
    if (window.Sound) Sound.playTrack('intro');
  }
  function showStep() {
    const cs = S.cutscene;
    if (!cs) return;
    const st = cs.steps[cs.i];
    if (!st) { endIntro(); return; }
    cs.t = 0;
    UI.showCard(st.card, st.sub || '');
  }
  function skipIntro() {
    if (!S.cutscene) return;
    S.cutscene.i++;
    if (S.cutscene.i >= S.cutscene.steps.length) endIntro();
    else showStep();
  }
  function endIntro() {
    S.cutscene = null;
    S.camOverride = null;
    UI.hideCard();
    UI.letterbox(false);
    S.quest = 'q1_mop';
    if (window.Sound) { Sound.playTrack('port'); Sound.sfx('whistleSfx'); }
    UI.toast('空中按住空格展开滑翔翼');
  }

  // ---------- 任务推进 ----------
  function setQuest(q) {
    S.quest = q;
    if (q === 'q5_boss' && !S.bossStarted) startBoss();
  }
  function onShrineKill() {
    if (S.quest !== 'q2_shrine') return;
    S.shrineKills++;
    if (window.Sound) Sound.sfx('ui');
    if (S.shrineKills >= 4 && !S.flags.shrineCleared) {
      S.flags.shrineCleared = true;
      S.pendingBell = true;   // 由 update 驱动，避免 setTimeout 节流卡死剧情
    }
  }
  function tryRitual() {
    if (S.quest !== 'q3_bell' || S.ritualDone) return;
    S.ritualDone = true;
    const LM = World.LANDMARKS;
    // 共鸣仪式
    World.ringBell();
    if (window.Sound) { Sound.sfx('bell'); setTimeout(() => Sound.sfx('bell'), 500); setTimeout(() => Sound.sfx('bell'), 1000); }
    UI.letterbox(true);
    UI.showCard('船钟共鸣！', '体力上限 +45 · 获得锅炉煤铲 · 心之容器 +1');
    Player.addStaminaCap(45);
    Player.giveItem('shovel');
    Player.addContainer();
    Player.setCheckpoint(LM.SHRINE.x, LM.SHRINE.z + 6);
    S.quest = 'q4_volcano';   // 任务立即推进，卡片到点自消
    setTimeout(() => {
      UI.hideCard(); UI.letterbox(false);
      UI.toast('前往黑烟锅炉岛');
    }, 3200);
  }
  function startBoss() {
    S.bossStarted = true;
    Enemies.activateDragon();
    if (window.Net && Net.connected) Net.send('event', { name: 'drgOn' });
  }
  function onBossDead() {
    if (S.bossDead) return;
    S.bossDead = true;
    S.quest = 'q6_whistle';
    UI.letterbox(true);
    UI.showCard('鹦鹉号坠进了煤浆湖！', '黑烟开始散去……去拾取黄金汽笛');
    setTimeout(() => { UI.hideCard(); UI.letterbox(false); }, 3000);
  }
  function onGoldenWhistle() {
    if (S.ended) return;
    S.ended = true;
    if (window.Sound) Sound.sfx('itemget');
    // 回响三声、明轮转动、河道开放
    UI.letterbox(true);
    UI.showCard('黄金汽笛，失而复得。', '对着河道，吹响三声——');
    let n = 0;
    const blow = () => {
      n++;
      if (window.Sound) Sound.sfx('whistleSfx');
      UI.flash(0.2);
      if (n < 3) setTimeout(blow, 900);
      else {
        setTimeout(() => {
          World.ringBell();
          if (World.boat) World.boat.speed = 2.6;   // 威利号明轮转动
          if (window.Sound) { Sound.sfx('victory'); Sound.playTrack('port'); }
          const secs = Math.floor((performance.now() - S.startTime) / 1000);
          const mm = Math.floor(secs / 60), ss = secs % 60;
          UI.showEnding({
            time: mm + '分' + (ss < 10 ? '0' : '') + ss + '秒',
            kills: Player.state.kills,
            coins: Player.state.coins,
            deaths: Player.state.deaths,
          });
        }, 1000);
      }
    };
    setTimeout(blow, 1400);
  }

  // ---------- 老山羊指路 ----------
  function hint() {
    switch (S.quest) {
      case 'q1_mop': return '莫莉的铁匠铺在广场东边，门口有煤炉的就是。';
      case 'q2_shrine': return '旧汽笛站在北边山岗上，小心煤球炸弹——它们会自爆。';
      case 'q3_bell': return '汽笛站中央祭坛有口老船钟，走近按 E 敲响它。';
      case 'q4_volcano': return '锅炉岛在西南方，路过芦苇音乐田记得找提姆记检查点。';
      case 'q5_boss': return '铁鹦鹉飞着的时候刀枪不入——用鱼叉射它！靠岸再近战。';
      case 'q6_whistle': return '黄金汽笛就掉在煤浆湖边，亮闪闪的那个。';
      default: return '河道会重新开放的，我相信你。';
    }
  }

  // ---------- 联机事件 ----------
  function onNetEvent(name) {
    if (name === 'shrineKill') onShrineKill();
    else if (name === 'drgOn') { if (!S.bossStarted) { S.bossStarted = true; S.quest = 'q5_boss'; } }
    else if (name === 'drgDead') onBossDead();
  }

  // ---------- 主更新 ----------
  let bossCheckT = 0;
  function update(dt, t) {
    // 过场
    if (S.cutscene) {
      const cs = S.cutscene;
      cs.t += dt;
      const st = cs.steps[cs.i];
      if (st) {
        const k = Math.min(1, cs.t / st.dur);
        // 手摇摄影机：lerp + 抖动
        const p = st.cam;
        const jx = (Math.random() - 0.5) * 0.35, jy = (Math.random() - 0.5) * 0.25;
        G.camera.position.set(
          p.from[0] + (p.to[0] - p.from[0]) * k + jx,
          p.from[1] + (p.to[1] - p.from[1]) * k + jy,
          p.from[2] + (p.to[2] - p.from[2]) * k);
        G.camera.lookAt(p.look[0], p.look[1], p.look[2]);
        if (cs.t >= st.dur) skipIntro();
      }
      return;
    }
    if (S.ended) return;

    // 任务状态机（全部一次性标志守护）
    const P = Player.state;
    if (S.pendingBell && !UI.isDialogueOpen()) {
      S.pendingBell = false;
      say('老船钟', ['石柱间的煤烟散去了……', '祭坛上的老船钟在等你。']);
      S.quest = 'q3_bell';
    }
    if (S.quest === 'q1_mop' && Player.hasItem('mop')) {
      S.quest = 'q2_shrine';
      UI.toast('前往旧汽笛站（小地图 ○ 标记）');
    }
    if (S.quest === 'q3_bell' && !S.ritualDone) {
      const d = Math.hypot(P.pos.x - World.LANDMARKS.SHRINE.x, P.pos.z - World.LANDMARKS.SHRINE.z);
      if (d < 4 && G.interactE) tryRitual();
    }
    G.interactE = false;
    if (S.quest === 'q4_volcano') {
      const d = Math.hypot(P.pos.x - World.LANDMARKS.VOLCANO.x, P.pos.z - World.LANDMARKS.VOLCANO.z);
      if (!S.volcanoCheckpoint && d < 95) {
        S.volcanoCheckpoint = true;
        Player.setCheckpoint(World.LANDMARKS.VOLCANO.x + 60, World.LANDMARKS.VOLCANO.z + 45);
      }
      if (d < 62 && !S.bossStarted) {
        S.quest = 'q5_boss';
        startBoss();
      }
    }
    // 小地图与任务面板
    refreshQuestUI();
  }
  function refreshQuestUI() {
    const q = QUESTS[S.quest];
    if (!q) { UI.refreshQuest(null); return; }
    const body = typeof q.body === 'function' ? q.body() : q.body;
    UI.refreshQuest({ title: q.title, body });
    const tg = q.target();
    const marks = [{ type: 'quest', x: tg.x, z: tg.z }];
    if (window.Enemies && Enemies.dragon.active && !Enemies.dragon.dead) {
      marks.push({ type: 'boss', x: Enemies.dragon.pos.x, z: Enemies.dragon.pos.z });
    }
    if (window.Net && Net.remotePos) {
      marks.push({ type: 'remote', x: Net.remotePos.x, z: Net.remotePos.z });
    }
    UI.refreshMinimap(Player.state.pos, marks);
  }

  return {
    init() { S.startTime = performance.now(); },
    update, startIntro, skipIntro, say, hint,
    onShrineKill, onBossDead, onGoldenWhistle, onNetEvent, tryRitual,
    setQuest,
    get state() { return S; },
    get questTarget() {
      const q = QUESTS[S.quest];
      return q ? q.target() : null;
    },
  };
})();
window.Story = Story;
