// qa/visual_test.js — 特效与造型目检截图：月牙墨线 / 汽笛准星 / 救生圈 / 黑猫朝向 / 城镇街景 / BOSS
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8961';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.G && G.started, null, { timeout: 45000 });
  await sleep(1500);

  // 1) 月牙墨线挥击（汽笛站，敌人在旁）
  await page.evaluate(() => { Player.teleport(196, -110); Player.equipSlot(0); });
  await sleep(400);
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(640, 420);
    await sleep(110);
    if (i === 1) await page.screenshot({ path: 'qa/shot_vfx_slash.png' });
    await sleep(420);
  }
  console.log('slash shot done');

  // 2) 鱼叉弓满弦准星（安全空地；等攻击 CD 归零再触发——headless 慢帧）
  await page.evaluate(() => { Player.teleport(150, 100); Player.equipSlot(3); });
  await page.waitForFunction(() => Combat._dbg().attackCd <= 0, null, { timeout: 10000 });
  await page.evaluate(() => Combat.onLeftDown());
  await sleep(2600);
  await page.screenshot({ path: 'qa/shot_vfx_bow.png' });
  const crosshair = await page.evaluate(() => ({
    shown: document.getElementById('crosshair').style.display !== 'none',
    full: document.getElementById('crosshair').classList.contains('full'),
    fov: Math.round(G.camera.fov),
    dbg: Combat._dbg(),
    dead: Player.state.dead,
    onGround: Player.state.onGround,
    pstate: Player.state.state,
    weapon: Player.activeWeapon() && Player.activeWeapon().key,
    hp: Player.state.hp,
  }));
  await page.evaluate(() => Combat.onLeftUp());
  console.log('bow crosshair:', JSON.stringify(crosshair));

  // 3) 救生圈投掷（手臂动作 + 辉光盘）
  await page.evaluate(() => { Player.equipSlot(0); Player.teleport(150, 100); });
  await sleep(400);
  await page.evaluate(() => Combat.throwLifebuoy());
  await sleep(300);
  await page.screenshot({ path: 'qa/shot_vfx_buoy.png' });
  const buoyOk = await page.evaluate(() => !!document.querySelector('#game canvas'));
  console.log('buoy shot done');
  await sleep(1200);

  // 4) 黑猫大副站立朝向（面向玩家）
  await page.evaluate(() => {
    const cat = Enemies.mobs.find(m => m.type === 'cat' && !m.dead);
    Player.teleport(cat.x + 4, cat.z + 4);
    Player.state.camYaw = Math.atan2(4, 4) + Math.PI;
  });
  await sleep(900);
  await page.screenshot({ path: 'qa/shot_cat_facing.png' });
  const catInfo = await page.evaluate(() => {
    const cat = Enemies.mobs.find(m => m.type === 'cat' && !m.dead);
    // 猫 obj.rotation.y 应朝向玩家（atan2(dx,dz)）
    const dx = Player.state.pos.x - cat.x, dz = Player.state.pos.z - cat.z;
    const want = Math.atan2(dx, dz);
    let df = Math.abs(want - cat.ry) % (Math.PI * 2);
    if (df > Math.PI) df = Math.PI * 2 - df;
    return { ry: +cat.ry.toFixed(2), want: +want.toFixed(2), err: +df.toFixed(2), fixY: +cat.fix.rotation.y.toFixed(2) };
  });
  console.log('cat facing:', JSON.stringify(catInfo));

  // 5) 城镇街景
  await page.evaluate(() => { Player.teleport(138, 244); Player.state.camYaw = Math.PI * 1.25; Player.state.camPitch = 0.15; });
  await sleep(700);
  await page.screenshot({ path: 'qa/shot_street.png' });

  // 6) 橡皮管四肢检查：跑步中
  await page.evaluate(() => Player.teleport(100, 100));
  await sleep(200);
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  await sleep(500);
  await page.screenshot({ path: 'qa/shot_run.png' });
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');

  // 7) 锅炉岛 + BOSS 飞行
  await page.evaluate(() => { Player.teleport(-168, -180); Story.setQuest('q5_boss'); });
  await sleep(4500);
  await page.screenshot({ path: 'qa/shot_boss_fly.png' });

  const errCount = await page.evaluate(() => window.__errCount());
  console.log('errors:', errCount, errors.slice(0, 5));
  await browser.close();
  process.exit(errCount === 0 && errors.length === 0 ? 0 : 1);
}
run().catch(e => { console.error('RUN ERROR:', e.message); process.exit(1); });
