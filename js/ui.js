/* ui.js — HUD / 对话框 / 小地图 / 胶片叠层 / 标题菜单 / 默片字幕卡
 * 统一黑白默片字幕体、圆角黑框、旧纸白底。
 */
const UI = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let el = new Proxy({}, {
    get(t, k) {
      if (t[k]) return t[k];
      const kebab = String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      return (t[k] = document.getElementById(k) || document.getElementById(kebab));
    },
  });
  let dmgNums = [];
  let toasts = [];
  let minimapBaked = null;
  let frame = 0;
  let dlg = { open: false, name: '', full: '', shown: 0, onDone: null, speaker: null };
  let shakeT = 0, shakeAmp = 0;
  let flashT = 0;
  let grainURL = null;
  const WORLD_HALF = 385;

  function init() {
    Object.assign(el, {
      hud: $('hud'), hearts: $('hearts'), stamina: $('stamina'), coins: $('coins'),
      weapons: $('weapons'), minimap: $('minimap'), quest: $('quest'), fps: $('fps'),
      eprompt: $('eprompt'), dialog: $('dialog'), dlgName: $('dlg-name'), dlgText: $('dlg-text'),
      toast: $('toast'), bossbar: $('bossbar'), bossHp: $('boss-hp-fill'), bossPhase: $('boss-phase'),
      crosshair: $('crosshair'), help: $('help'), grain: $('grain'), scratches: $('scratches'),
      vignette: $('vignette'), flash: $('flash'), game: $('game'),
      letterbox: $('letterbox'), card: $('card'), cardInner: $('card-inner'),
      title: $('title'),
    });
    buildWeaponSlots();
    makeGrain();
    bakeMinimap();
    el.help.innerHTML = HELP_HTML;
  }

  // ---------- 胶片颗粒/划痕/暗角/曝光呼吸/画框抖动 ----------
  function makeGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainURL = c.toDataURL();
    el.grain.style.backgroundImage = 'url(' + grainURL + ')';
  }
  function updateFilm(dt, t) {
    frame++;
    // 颗粒：每帧随机偏移
    el.grain.style.backgroundPosition = ((Math.random() * 128) | 0) + 'px ' + ((Math.random() * 128) | 0) + 'px';
    // 划痕：偶发竖线
    if (frame % 5 === 0) {
      if (Math.random() < 0.55) {
        const x = (Math.random() * 100).toFixed(1);
        const w = Math.random() < 0.3 ? 2 : 1;
        el.scratches.style.background =
          'linear-gradient(90deg, transparent ' + x + '%, rgba(255,255,255,0.5) ' + x + '%, ' +
          'rgba(255,255,255,0.5) calc(' + x + '% + ' + w + 'px), transparent calc(' + x + '% + ' + w + 'px))';
      } else el.scratches.style.background = 'none';
    }
    // 曝光呼吸
    el.vignette.style.opacity = (0.92 + Math.sin(t * 1.7) * 0.08).toFixed(3);
    // 画框抖动（极弱）
    const jx = (Math.random() - 0.5) * 1.2, jy = (Math.random() - 0.5) * 1.2;
    // 屏幕震动（命中/爆炸）
    let sx = 0, sy = 0;
    if (shakeT > 0) {
      shakeT -= dt;
      const a = shakeAmp * Math.max(0, shakeT);
      sx = (Math.random() - 0.5) * a * 26;
      sy = (Math.random() - 0.5) * a * 26;
    }
    el.game.style.transform = 'translate(' + (jx + sx).toFixed(1) + 'px,' + (jy + sy).toFixed(1) + 'px)';
    // 白屏闪
    if (flashT > 0) {
      flashT -= dt;
      el.flash.style.opacity = Math.max(0, flashT * 2.2).toFixed(2);
    } else el.flash.style.opacity = 0;
  }
  function shake(amp) { shakeAmp = Math.min(1.4, amp); shakeT = 0.35; }
  function flash(dur) { flashT = dur || 0.25; }

  // ---------- 武器栏 ----------
  const SLOT_DEF = [
    { id: 'w0', key: '1' }, { id: 'w1', key: '2' }, { id: 'w2', key: '3' }, { id: 'w3', key: '4' },
    { id: 'shield', key: '右' }, { id: 'lifebuoy', key: 'F' },
  ];
  function buildWeaponSlots() {
    el.weapons.innerHTML = '';
    SLOT_DEF.forEach((d, i) => {
      const s = document.createElement('div');
      s.className = 'wslot' + (i >= 4 ? ' util' : '');
      s.id = 'slot-' + d.id;
      s.innerHTML = '<span class="wkey">' + d.key + '</span><span class="wname">—</span>' +
        '<div class="wdur"><i style="width:0%"></i></div>';
      el.weapons.appendChild(s);
    });
  }
  function refreshWeapons(inv) {
    if (!inv) return;
    const map = {
      w0: inv.weapons[0], w1: inv.weapons[1], w2: inv.weapons[2], w3: inv.weapons[3],
      shield: inv.shield, lifebuoy: inv.lifebuoy,
    };
    SLOT_DEF.forEach(d => {
      const s = $('slot-' + d.id);
      const w = map[d.id];
      const nameEl = s.querySelector('.wname');
      const durEl = s.querySelector('.wdur > i');
      if (!w) { nameEl.textContent = '—'; durEl.style.width = '0%'; s.classList.remove('active', 'broken'); return; }
      nameEl.textContent = w.name;
      durEl.style.width = Math.max(0, (w.dur / w.maxDur) * 100) + '%';
      s.classList.toggle('broken', w.dur <= 0);
      s.classList.toggle('active', w === inv.weapons[inv.active]);
    });
  }

  // ---------- 心/体力/金币 ----------
  function refreshVitals(p) {
    if (!p) return;
    let s = '';
    const full = Math.floor(p.hp / 2), half = p.hp % 2, max = p.maxHp / 2;
    for (let i = 0; i < max; i++) {
      if (i < full) s += '♥';
      else if (i === full && half) s += '◐';
      else s += '♡';
    }
    el.hearts.textContent = s;
    el.coins.textContent = '◎ ' + p.coins;
    // 体力环
    const c = el.stamina, g = c.getContext('2d');
    g.clearRect(0, 0, 84, 84);
    const frac = p.stamina / p.maxStamina;
    const show = frac < 0.999 || p.staminaFlash > 0;
    c.style.opacity = show ? '1' : '0';
    if (show) {
      g.lineWidth = 7;
      g.strokeStyle = 'rgba(23,19,13,0.55)';
      g.beginPath(); g.arc(42, 42, 32, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#f2ead6';
      g.beginPath();
      g.arc(42, 42, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      g.stroke();
      g.lineWidth = 2; g.strokeStyle = '#17130d';
      g.beginPath(); g.arc(42, 42, 36, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(42, 42, 28, 0, Math.PI * 2); g.stroke();
    }
  }

  // ---------- 小地图（烘焙地形 + 动态标记） ----------
  function bakeMinimap() {
    if (typeof World === 'undefined' || !World.height) return;
    const c = document.createElement('canvas');
    c.width = c.height = 168;
    const g = c.getContext('2d');
    const img = g.createImageData(168, 168);
    for (let py = 0; py < 168; py++) {
      for (let px = 0; px < 168; px++) {
        const wx = (px / 168 * 2 - 1) * WORLD_HALF;
        const wz = (py / 168 * 2 - 1) * WORLD_HALF;
        const h = World.height(wx, wz);
        const r = Math.sqrt(wx * wx + wz * wz);
        let v;
        if (r > WORLD_HALF) v = 26;
        else if (h < World.WATER_Y + 0.4) v = 96;               // 水面
        else if (h > 22 && wx < -150 && wz < -150) v = 40;      // 锅炉岛黑岩
        else v = Math.min(225, 150 + h * 2.2);
        const i = (py * 168 + px) * 4;
        img.data[i] = v * 1.02; img.data[i + 1] = v * 0.98; img.data[i + 2] = v * 0.88;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // 地标字
    g.fillStyle = '#17130d'; g.font = 'bold 10px Georgia'; g.textAlign = 'center';
    const LM = World.LANDMARKS;
    [['港', LM.SPAWN], ['庄', LM.VILLAGE], ['笛', LM.SHRINE], ['台', LM.TOWER],
     ['苇', LM.FLOWER], ['岛', LM.VOLCANO]].forEach(([ch, p]) => {
      const [mx, my] = w2m(p.x, p.z);
      g.fillText(ch, mx, my + 3);
    });
    minimapBaked = c;
  }
  function w2m(wx, wz) {
    return [(wx / WORLD_HALF * 0.5 + 0.5) * 168, (wz / WORLD_HALF * 0.5 + 0.5) * 168];
  }
  function refreshMinimap(p, marks) {
    if (!minimapBaked) return;
    const g = el.minimap.getContext('2d');
    g.clearRect(0, 0, 168, 168);
    g.drawImage(minimapBaked, 0, 0);
    // 圆裁剪边界
    g.save();
    g.beginPath(); g.arc(84, 84, 82, 0, Math.PI * 2); g.clip();
    if (marks) {
      marks.forEach(m => {
        const [mx, my] = w2m(m.x, m.z);
        if (m.type === 'quest') {
          g.strokeStyle = '#17130d'; g.lineWidth = 2;
          g.beginPath(); g.arc(mx, my, 5 + Math.sin(frame * 0.1) * 2, 0, Math.PI * 2); g.stroke();
        } else if (m.type === 'boss') {
          g.fillStyle = '#17130d'; g.font = 'bold 13px Georgia';
          g.fillText('✖', mx, my + 4);
        } else if (m.type === 'remote') {
          g.fillStyle = '#8b8577';
          g.beginPath(); g.arc(mx, my, 3.5, 0, Math.PI * 2); g.fill();
        }
      });
    }
    // 玩家朝向三角
    if (p) {
      const [mx, my] = w2m(p.x, p.z);
      g.translate(mx, my); g.rotate(p.facing);
      g.fillStyle = '#17130d';
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(-4, 4); g.closePath(); g.fill();
    }
    g.restore();
  }

  // ---------- 任务面板 ----------
  function refreshQuest(q) {
    if (!q) { el.quest.style.display = 'none'; return; }
    el.quest.style.display = 'block';
    el.quest.innerHTML = '<div class="q-title">' + q.title + '</div><div>' + q.body + '</div>';
  }

  // ---------- 对话 ----------
  function openDialogue(name, lines, onDone) {
    dlg = { open: true, name, lines: lines.slice(), idx: 0, full: lines[0], shown: 0, onDone: onDone || null };
    el.dlgName.textContent = name;
    el.dialog.style.display = 'block';
    el.dlgText.textContent = '';
  }
  function advanceDialogue() {
    if (!dlg.open) return false;
    if (dlg.shown < dlg.full.length) { dlg.shown = dlg.full.length; return true; } // 先补全打字
    dlg.idx++;
    if (dlg.idx >= dlg.lines.length) {
      closeDialogue();
      const cb = dlg.onDone; dlg.onDone = null;
      if (cb) cb();
      return true;
    }
    dlg.full = dlg.lines[dlg.idx];
    dlg.shown = 0;
    return true;
  }
  function closeDialogue() { dlg.open = false; el.dialog.style.display = 'none'; }
  function updateDialogue(dt) {
    if (!dlg.open) return;
    if (dlg.shown < dlg.full.length) {
      dlg.shown = Math.min(dlg.full.length, dlg.shown + dt * 42);
      el.dlgText.textContent = dlg.full.slice(0, Math.floor(dlg.shown));
    }
  }

  // ---------- E 提示 ----------
  function ePrompt(visible, sx, sy, text) {
    el.eprompt.style.display = visible ? 'block' : 'none';
    if (visible) {
      el.eprompt.style.left = sx + 'px';
      el.eprompt.style.top = sy + 'px';
      el.eprompt.textContent = text || 'E 对话';
    }
  }

  // ---------- toast ----------
  function toast(msg, dur) {
    const d = document.createElement('div');
    d.className = 'toast-item';
    d.textContent = msg;
    el.toast.appendChild(d);
    toasts.push({ el: d, t: dur || 2.6 });
    while (toasts.length > 4) { const old = toasts.shift(); old.el.remove(); }
  }
  function updateToasts(dt) {
    for (let i = toasts.length - 1; i >= 0; i--) {
      toasts[i].t -= dt;
      if (toasts[i].t <= 0) { toasts[i].el.remove(); toasts.splice(i, 1); }
      else if (toasts[i].t < 0.5) toasts[i].el.style.opacity = toasts[i].t * 2;
    }
  }

  // ---------- BOSS 条 ----------
  function bossBar(hp, maxHp, phaseText) {
    el.bossbar.style.display = 'block';
    el.bossHp.style.width = Math.max(0, hp / maxHp * 100) + '%';
    el.bossPhase.textContent = phaseText;
  }
  function hideBossBar() { el.bossbar.style.display = 'none'; }

  // ---------- 准星 ----------
  function crosshair(visible, charge) {
    el.crosshair.style.display = visible ? 'block' : 'none';
    if (visible) {
      document.documentElement.style.setProperty('--charge', charge.toFixed(3));
      el.crosshair.classList.toggle('full', charge >= 1);
    }
  }

  // ---------- 伤害数字 ----------
  function dmgNumber(worldPos, text, crit) {
    const d = document.createElement('div');
    d.className = 'dmgnum' + (crit ? ' crit' : '');
    d.textContent = text;
    document.body.appendChild(d);
    dmgNums.push({ el: d, pos: worldPos.clone(), vy: 2.2, life: 0.9, max: 0.9 });
  }
  function updateDmgNums(dt, camera) {
    const v = new THREE.Vector3();
    for (let i = dmgNums.length - 1; i >= 0; i--) {
      const n = dmgNums[i];
      n.life -= dt;
      n.pos.y += n.vy * dt;
      v.copy(n.pos).project(camera);
      if (v.z < 1) {
        n.el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
        n.el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
        n.el.style.opacity = Math.max(0, n.life / n.max);
      } else n.el.style.opacity = 0;
      if (n.life <= 0) { n.el.remove(); dmgNums.splice(i, 1); }
    }
  }

  // ---------- 过场 ----------
  function letterbox(on) { el.letterbox.style.display = on ? 'block' : 'none'; }
  function showCard(html, small) {
    el.card.style.display = 'flex';
    el.cardInner.innerHTML = html + (small ? '<small>' + small + '</small>' : '');
  }
  function hideCard() { el.card.style.display = 'none'; }

  // ---------- 标题菜单 ----------
  function bindTitle(handlers) {
    $('btn-single').onclick = handlers.onSingle;
    $('btn-host').onclick = handlers.onHost;
    $('btn-join').onclick = () => {
      const code = $('room-input').value.trim().toUpperCase();
      if (code.length === 4) handlers.onJoin(code);
      else toast('请输入 4 位房间码');
    };
    $('room-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('btn-join').click();
    });
  }
  function hideTitle() { el.title.style.display = 'none'; el.hud.style.display = 'block'; }
  function showRoomCode(code) {
    $('room-code').style.display = 'block';
    $('room-code-text').textContent = code;
    $('btn-host').style.display = 'none';
    $('btn-single').style.display = 'none';
    $('join-row').style.display = 'none';
  }

  // ---------- 帮助 ----------
  const HELP_HTML = '<h3>操作表</h3>' +
    '<div><b>WASD</b>移动（Shift 奔跑，耗体力）</div>' +
    '<div><b>鼠标</b>视角（点击画面锁定）· 滚轮缩放</div>' +
    '<div><b>空格</b>跳跃 / 二段跳 · 空中按住=滑翔</div>' +
    '<div><b>左键</b>攻击 · 空中左键=落锚下砸 · 鱼叉弓按住蓄力</div>' +
    '<div><b>右键</b>舵轮盾格挡</div>' +
    '<div><b>1/2/3/4</b>切换武器 · <b>F</b>投掷救生圈</div>' +
    '<div><b>C</b>翻滚闪避（无敌帧）· <b>E</b>对话/互动</div>' +
    '<div><b>H</b>帮助 · <b>M</b>静音 · <b>Esc</b>释放鼠标</div>';
  function toggleHelp() {
    el.help.style.display = el.help.style.display === 'none' ? 'block' : 'none';
    if (typeof Sound !== 'undefined') Sound.sfx('ui');
  }

  // ---------- 结算 ----------
  function showEnding(stats) {
    letterbox(true);
    showCard(
      '河道重新开放了！<br><br>' +
      '用时 ' + stats.time + ' · 击杀 ' + stats.kills + '<br>' +
      '金币 ' + stats.coins + ' · 倒下 ' + stats.deaths + ' 次<br><br>' +
      '—— 完 ——',
      '独立再创作 · 基于 1928 年公共领域作品《Steamboat Willie》<br>Three.js + WebAudio 全合成 · 刷新页面可再玩一次'
    );
  }

  // ---------- 主刷新 ----------
  function update(dt, t) {
    updateFilm(dt, t);
    updateDialogue(dt);
    updateToasts(dt);
    if (window.G && G.player) {
      refreshVitals(G.player);
      refreshWeapons(G.player.inv);
    }
    if (window.G && G.camera) updateDmgNums(dt, G.camera);
  }

  return {
    init, update, toast, shake, flash,
    refreshMinimap, refreshQuest,
    openDialogue, advanceDialogue, closeDialogue,
    isDialogueOpen: () => dlg.open,
    ePrompt, bossBar, hideBossBar, crosshair,
    dmgNumber, letterbox, showCard, hideCard,
    bindTitle, hideTitle, showRoomCode, toggleHelp, showEnding,
    bakeMinimap,
  };
})();
window.UI = UI;
