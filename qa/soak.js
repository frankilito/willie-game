// qa/soak.js — 单人全流程 soak：debug 启动→游玩 20s，零 JS 报错，截图 + 断言。
const { chromium } = require('playwright-core');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8961';
const OUT = __dirname;

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 600)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 400)); });

  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  // 等待游戏启动
  await page.waitForFunction(() => window.G && G.started, null, { timeout: 45000 });
  console.log('started OK');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/shot_town_aerial.png` });

  // 模拟游玩：走动 + 跳跃 + 攻击
  const kbd = page.keyboard;
  await kbd.down('w');
  await page.waitForTimeout(2500);
  await kbd.press('Space');
  await page.waitForTimeout(800);
  await kbd.up('w');
  await kbd.down('d');
  await page.waitForTimeout(1500);
  await kbd.up('d');
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/shot_play1.png` });

  // 传送去汽笛站打怪
  await page.evaluate(() => Player.teleport(200, -112));
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(300);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(300);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/shot_combat.png` });

  // 与 NPC 对话（传送到莫莉旁按 E）
  await page.evaluate(() => Player.teleport(159, 237));
  await page.waitForTimeout(1000);
  await kbd.press('e');
  await page.waitForTimeout(600);
  const dlgOpen = await page.evaluate(() => UI.isDialogueOpen());
  console.log('dialogue opens with E:', dlgOpen);
  await kbd.press('Space');
  await page.waitForTimeout(300);
  await kbd.press('Space');
  await page.waitForTimeout(300);
  await kbd.press('Space');
  await page.waitForTimeout(300);
  await kbd.press('Space');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/shot_npc.png` });

  // BOSS 截图
  await page.evaluate(() => { Player.teleport(-152, -173); Story.setQuest('q5_boss'); });
  await page.waitForTimeout(5500);
  await page.screenshot({ path: `${OUT}/shot_boss.png` });

  // 断言
  const asserts = await page.evaluate(() => {
    const P = Player.state;
    return {
      colliders: World.colliders.length,
      npcs: Npc.list.length,
      mobs: Enemies.mobs.length,
      weapons: P.inv.weapons.filter(Boolean).map(w => w.key),
      shield: !!P.inv.shield,
      lifebuoy: !!P.inv.lifebuoy,
      maxHp: P.maxHp,
      maxStamina: P.maxStamina,
      errCount: window.__errCount(),
      bossActive: Enemies.dragon.active,
      bossHp: Enemies.dragon.hp,
    };
  });
  console.log('ASSERTS', JSON.stringify(asserts));

  // 灰阶检查：采样 canvas 像素确认无彩色
  const gray = await page.evaluate(() => {
    const c = document.querySelector('#game canvas');
    if (!c) return { ok: false, reason: 'no canvas' };
    const tmp = document.createElement('canvas');
    tmp.width = 80; tmp.height = 50;
    const g = tmp.getContext('2d');
    g.drawImage(c, 0, 0, 80, 50);
    const d = g.getImageData(0, 0, 80, 50).data;
    let maxSat = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx > 12) maxSat = Math.max(maxSat, (mx - mn) / mx);
    }
    return { maxSat };
  });
  console.log('GRAYSCALE maxSat', JSON.stringify(gray));

  await page.waitForTimeout(2000);
  const finalErrs = await page.evaluate(() => window.__errCount());
  console.log('final overlay errCount:', finalErrs);
  console.log('collected errors:', errors.length ? JSON.stringify(errors.slice(0, 10), null, 1) : 'NONE');

  await browser.close();
  const pass = errors.length === 0 && finalErrs === 0 &&
    asserts.colliders >= 40 && asserts.npcs === 7 && dlgOpen;
  console.log(pass ? 'SOAK PASS' : 'SOAK FAIL');
  process.exit(pass ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
