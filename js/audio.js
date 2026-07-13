/* audio.js — WebAudio 全合成音效与 BGM（零音频文件）
 * 模块名 Sound（避免覆盖浏览器内置 Audio 构造器）。
 * BGM：128 步 8 小节步进音序器，河港版 = 公共领域旋律
 * 《Turkey in the Straw》+《Steamboat Bill》的重新编配（非原声采样）。
 */
const Sound = (function () {
  'use strict';
  let ctx = null, master = null, musicGain = null, sfxGain = null, rainGain = null;
  let muted = false, started = false;
  let track = 'none';          // none|intro|port|volcano|boss
  let step = 0;                // 0..127
  let nextNoteTime = 0;
  let timer = null;
  const BPM = 112;
  const STEP_DUR = 60 / BPM / 4;        // 16 分音符时长
  const BAR_STEPS = 16;
  const STEPS = 128;
  const beatCbs = [];
  let lastBeatStep = -1;

  // ---------- 工具 ----------
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  function noiseBuf(dur) {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;     // 偏棕噪声
      d[i] = last * 3.2;
    }
    return buf;
  }
  function env(node, t, a, d, peak, sustain) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }
  function out(node, bus) { node.connect(bus || sfxGain); }

  // ---------- 乐器 ----------
  function piano(freq, t, dur, vel) {
    vel = vel == null ? 0.5 : vel;
    const g = ctx.createGain(); env(g, t, 0.008, dur, 0.35 * vel, 0.0001);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    [1, 1.006].forEach((det, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'sawtooth' : 'triangle';
      o.frequency.value = freq * det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    });
    lp.connect(g); out(g, musicGain);
  }
  function whistle(freq, t, dur, vel) {
    vel = vel == null ? 0.4 : vel;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 1.5; bp.Q.value = 2;
    const g = ctx.createGain(); env(g, t, 0.02, dur, 0.18 * vel, 0.0001);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vg = ctx.createGain(); vg.gain.value = freq * 0.004;
    vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(t + dur + 0.1);
    o.connect(bp); bp.connect(g); out(g, musicGain); o.start(t); o.stop(t + dur + 0.1);
  }
  function bass(freq, t, dur, vel) {
    vel = vel == null ? 0.6 : vel;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); env(g, t, 0.01, dur, 0.5 * vel, 0.0001);
    o.connect(lp); lp.connect(g); out(g, musicGain); o.start(t); o.stop(t + dur + 0.05);
  }
  function woodblock(t, vel, low) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.06);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = low ? 420 : 1300; bp.Q.value = 3;
    const g = ctx.createGain(); env(g, t, 0.002, low ? 0.09 : 0.04, (vel || 0.4), 0.0001);
    src.connect(bp); bp.connect(g); out(g, musicGain); src.start(t); src.stop(t + 0.12);
  }
  function kick(t, vel) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
    const g = ctx.createGain(); env(g, t, 0.004, 0.14, vel || 0.7, 0.0001);
    o.connect(g); out(g, musicGain); o.start(t); o.stop(t + 0.18);
  }

  // ---------- 旋律数据（公共领域旋律的重新编配，非原声采样） ----------
  // [midi|null(休止), 步长(16分音符)]
  const TURKEY = [ // Turkey in the Straw A 段（G 大调编配）
    [67, 2], [67, 2], [69, 2], [71, 2], [72, 2], [71, 2], [69, 2], [67, 2],
    [69, 2], [71, 2], [72, 2], [74, 2], [76, 2], [74, 2], [72, 2], [71, 2],
    [69, 2], [71, 2], [72, 2], [69, 2], [67, 2], [64, 2], [67, 2], [69, 2],
    [71, 2], [72, 2], [71, 2], [69, 2], [67, 4], [67, 2], [null, 2],
  ];
  const STEAMBOAT = [ // Steamboat Bill 副歌（C 大调编配）
    [72, 2], [72, 1], [72, 1], [71, 2], [72, 2], [74, 2], [76, 4], [null, 2],
    [76, 2], [74, 2], [72, 2], [71, 2], [72, 2], [74, 2], [72, 4],
    [69, 2], [72, 2], [76, 2], [72, 2], [69, 2], [67, 2], [69, 2], [72, 2],
    [67, 2], [64, 2], [67, 2], [72, 3], [72, 1], [null, 2], [72, 2], [null, 2],
  ];
  // 每小节根音（低音）
  const BASS_PORT = [55, 60, 55, 62, 55, 60, 62, 55];       // G C G D G C D G
  const BASS_MIN = [55, 58, 55, 53, 55, 58, 53, 55];        // Gm Bb Gm F7 ...

  // 把旋律铺到 128 步网格
  function layMelody(seq, offsetSteps) {
    const grid = [];
    let s = offsetSteps;
    seq.forEach(([n, len]) => {
      if (n) grid.push({ step: s, note: n, len: len * 0.92 });
      s += len;
    });
    return grid;
  }
  const GRID_PORT = layMelody(TURKEY, 0).concat(layMelody(STEAMBOAT, 64));

  function minorize(n) { // 大调旋律 -> 平行小调近似（降 3、6、7 级）
    const d = n % 12;
    if (d === 4 || d === 9 || d === 11) return n - 1;
    if (d === 7) return n - 1;
    return n;
  }

  // ---------- 音序器 ----------
  function scheduler() {
    if (!ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.12) {
      playStep(step, nextNoteTime);
      nextNoteTime += STEP_DUR;
      step = (step + 1) % STEPS;
    }
  }
  function playStep(s, t) {
    if (track === 'none' || track === 'intro') return;
    const bar = Math.floor(s / BAR_STEPS) % 8;
    const inBar = s % BAR_STEPS;
    const minor = (track === 'volcano');
    const bassRoots = minor ? BASS_MIN : BASS_PORT;

    // 旋律
    GRID_PORT.forEach(g => {
      if (g.step % STEPS === s) {
        let n = g.note;
        if (minor) n = minorize(n) - (bar >= 4 ? 0 : 0);
        if (track === 'boss') whistle(midi(n + 12), t, g.len * STEP_DUR, 0.5);
        piano(midi(n), t, g.len * STEP_DUR * (minor ? 1.6 : 1), minor ? 0.35 : 0.5);
        if (minor) whistle(midi(n - 12), t, g.len * STEP_DUR * 1.5, 0.25);
      }
    });
    // 低音：每小节两个
    if (inBar % 8 === 0) {
      bass(midi(bassRoots[bar] - 12), t, STEP_DUR * (minor ? 14 : 7), minor ? 0.8 : 0.6);
    }
    // 打击
    if (track === 'boss') {
      woodblock(t, 0.3, false);                       // 明轮机械 16 分
      if (inBar % 4 === 0) kick(t, 0.85);
      if (inBar % 8 === 4) woodblock(t, 0.55, true);  // 锅碗
    } else {
      if (inBar % 4 === 0) woodblock(t, minor ? 0.25 : 0.4, true);
      if (inBar % 4 === 2) woodblock(t, 0.25, false);
      if (minor && inBar === 0) kick(t, 0.5);
    }
    // 拍点回调（攻击/机械卡拍）
    if (inBar % 4 === 0 && lastBeatStep !== s) {
      lastBeatStep = s;
      beatCbs.forEach(cb => { try { cb(t, bar, inBar); } catch (e) {} });
    }
  }

  // ---------- 雨声循环 ----------
  let rainSrc = null;
  function startRainLoop() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(2.0); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    src.connect(bp); bp.connect(rainGain); rainGain.connect(master);
    src.start();
    rainSrc = src;
  }

  // ---------- SFX ----------
  const SFX = {
    jump() { blip(320, 640, 0.12, 'sine', 0.3); },
    doublejump() { blip(420, 920, 0.16, 'sine', 0.3); whoosh(0.18, 0.25); },
    land() { thud(90, 0.12, 0.5); noiseHit(0.06, 700, 0.3); },
    bigland() { thud(70, 0.3, 0.9); noiseHit(0.25, 500, 0.7); },
    footstep() { noiseHit(0.035, 520, 0.18); },
    roll() { whoosh(0.3, 0.4); },
    hit() { blip(240, 90, 0.09, 'square', 0.4); noiseHit(0.05, 1800, 0.5); },
    hitheavy() { blip(180, 60, 0.16, 'square', 0.55); noiseHit(0.12, 900, 0.6); },
    hurt() { blip(220, 95, 0.28, 'sawtooth', 0.5); },
    coin() { blip(880, 880, 0.07, 'sine', 0.3); setTimeout(() => blip(1320, 1320, 0.1, 'sine', 0.3), 70); },
    itemget() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, f, 0.14, 'triangle', 0.35), i * 90)); },
    whistleSfx() { slideWhistle(700, 1500, 950, 0.55); },
    splash() { noiseHit(0.3, 1100, 0.5); blip(180, 90, 0.2, 'sine', 0.25); },
    swim() { noiseHit(0.12, 700, 0.22); },
    thunder() {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(1.1);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + 1.0);
      const g = ctx.createGain(); env(g, t, 0.02, 1.0, 0.9, 0.0001);
      src.connect(lp); lp.connect(g); out(g); src.start(t); src.stop(t + 1.2);
      thud(45, 0.8, 0.9);
    },
    fireball() { blip(300, 120, 0.35, 'sawtooth', 0.35); noiseHit(0.3, 1600, 0.3); },
    explosion() {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(100, t + 0.55);
      const g = ctx.createGain(); env(g, t, 0.005, 0.55, 0.95, 0.0001);
      src.connect(lp); lp.connect(g); out(g); src.start(t); src.stop(t + 0.65);
      thud(55, 0.4, 1.0);
    },
    shield() { bellTone(660, 0.5); setTimeout(() => bellTone(990, 0.35), 40); },
    bell() { bellTone(523, 1.6); bellTone(784, 1.2); },
    shop() { [0, 60, 120].forEach(d => setTimeout(() => SFX.coin(), d)); },
    checkpoint() { [392, 523, 659, 880].forEach((f, i) => setTimeout(() => blip(f, f, 0.18, 'sine', 0.3), i * 80)); },
    bossRoar() {
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(62, t + 1.1);
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 65;
      const g = ctx.createGain(); env(g, t, 0.08, 1.1, 0.6, 0.0001);
      o.connect(g); o2.connect(g); out(g); o.start(t); o2.start(t); o.stop(t + 1.2); o2.stop(t + 1.2);
      noiseHit(1.0, 400, 0.4);
    },
    bossHit() { blip(320, 160, 0.1, 'square', 0.4); noiseHit(0.08, 2600, 0.5); },
    crateNote(pitch) { piano(midi(pitch || 72), ctx.currentTime, 0.5, 0.6); },
    steam() { noiseHit(0.35, 3200, 0.3); },
    taunt() { // 鹦鹉式嘲笑：下行方波短促连音
      [620, 560, 620, 500, 440].forEach((f, i) =>
        setTimeout(() => blip(f, f * 0.92, 0.11, 'square', 0.3), i * 110));
    },
    anchorSlam() { SFX.explosion(); setTimeout(() => bellTone(180, 0.4), 30); },
    parrotWhistle() { slideWhistle(400, 1800, 500, 0.9, 0.5); },
    bowDraw() { blip(140, 170, 0.3, 'sine', 0.12); },
    bowRelease() { whoosh(0.22, 0.45); blip(900, 500, 0.1, 'sine', 0.2); },
    lifebuoy() { slideWhistle(500, 900, 600, 0.3, 0.25); },
    lifebuoyHit() { bellTone(740, 0.35); noiseHit(0.1, 1500, 0.5); },
    cheat() { [660, 880, 1320].forEach((f, i) => setTimeout(() => blip(f, f, 0.12, 'square', 0.25), i * 70)); },
    death() { [440, 392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, f * 0.98, 0.35, 'triangle', 0.4), i * 160)); },
    victory() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => bellTone(f, 0.8), i * 140)); },
    ui() { blip(660, 660, 0.05, 'square', 0.18); },
  };

  function blip(f0, f1, dur, type, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, dur, vol == null ? 0.3 : vol, 0.0001);
    o.connect(g); out(g); o.start(t); o.stop(t + dur + 0.05);
  }
  function thud(freq, dur, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), t + dur);
    const g = ctx.createGain(); env(g, t, 0.004, dur, vol || 0.6, 0.0001);
    o.connect(g); out(g); o.start(t); o.stop(t + dur + 0.05);
  }
  function noiseHit(dur, cutoff, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const g = ctx.createGain(); env(g, t, 0.003, dur, vol || 0.4, 0.0001);
    src.connect(lp); lp.connect(g); out(g); src.start(t); src.stop(t + dur + 0.02);
  }
  function whoosh(dur, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + dur);
    const g = ctx.createGain(); env(g, t, 0.01, dur, vol || 0.3, 0.0001);
    src.connect(bp); bp.connect(g); out(g); src.start(t); src.stop(t + dur + 0.02);
  }
  function bellTone(freq, dur) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [1, 2.01, 3.02].forEach((h, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * h;
      const g = ctx.createGain(); env(g, t, 0.005, dur, 0.22 / (i + 1), 0.0001);
      o.connect(g); out(g); o.start(t); o.stop(t + dur + 0.1);
    });
  }
  function slideWhistle(f0, f1, f2, dur, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); env(g, t, 0.02, dur, vol || 0.35, 0.0001);
    o.connect(g); out(g); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- 公开接口 ----------
  return {
    STEP_DUR, BPM,
    init() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.55; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.8; sfxGain.connect(master);
      startRainLoop();
      nextNoteTime = ctx.currentTime + 0.1;
      timer = setInterval(scheduler, 25);
      started = true;
      // 自动播放策略：首次交互时 resume
      const kick = () => { if (ctx.state === 'suspended') ctx.resume(); };
      window.addEventListener('pointerdown', kick);
      window.addEventListener('keydown', kick);
    },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    sfx(name, arg) { if (SFX[name]) SFX[name](arg); },
    playTrack(name) {
      if (track === name) return;
      track = name;
      if (name === 'intro') { /* 开场只用稀疏钢琴，由 story 触发单音 */ }
    },
    /** 下一个 16 分音符的 ctx 时间（攻击卡拍用） */
    next16th() { return nextNoteTime; },
    /** 在最近的拍点上播放（延迟 <= maxMs 才卡拍，否则立即） */
    onNext16th(fn, maxMs) {
      if (!ctx) { fn(0); return; }
      const delay = (nextNoteTime - ctx.currentTime) * 1000;
      if (delay >= 0 && delay <= (maxMs || 90)) setTimeout(fn, delay);
      else fn();
    },
    onBeat(cb) { beatCbs.push(cb); },
    setRain(level) { if (rainGain) rainGain.gain.linearRampToValueAtTime(level * 0.5, ctx.currentTime + 1.2); },
    setMusicVol(v) { if (musicGain) musicGain.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.8); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, ctx.currentTime + 0.15);
      return muted;
    },
    isMuted() { return muted; },
    get ready() { return !!ctx; },
  };
})();
window.Sound = Sound;
