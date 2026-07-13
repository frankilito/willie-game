// qa/story_test.js — 完整剧情链：标题→开场→拖把→汽笛站→船钟仪式→锅炉岛→BOSS→黄金汽笛→结算
const { chromium } = require('playwright-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8961';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('close', () => console.log('!! page closed unexpectedly'));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text().slice(0, 300)); });

  await page.goto(BASE + '/?nodraw=1', { waitUntil: 'load' });
  await page.click('#btn-single');
  await page.waitForFunction(() => window.G && G.started, null, { timeout: 45000 });
  console.log('game started');
  await sleep(1000);
  // 跳过开场过场
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await sleep(400); }
  await page.waitForFunction(() => !Story.state.cutscene, null, { timeout: 8000 });
  const q1 = await page.evaluate(() => Story.state.quest);
  console.log('after intro:', q1);

  // 第一幕：找莫莉领拖把
  await page.evaluate(() => Player.teleport(159, 237));
  await sleep(700);
  await page.keyboard.press('e');
  await sleep(400);
  const hasMop = await page.evaluate(() => Player.hasItem('mop'));
  console.log('1) mop granted at dialogue START:', hasMop);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await sleep(200); }
  await sleep(500);
  const q2 = await page.evaluate(() => Story.state.quest);
  console.log('   quest now:', q2);

  // 第二幕：清剿汽笛站
  await page.evaluate(() => {
    Player.teleport(200, -112);
    Enemies.mobs.filter(m => m.tag === 'shrine').forEach(m => Combat.hitMob(m, 999, 0, 0));
  });
  await sleep(2500);
  const shrine = await page.evaluate(() => ({ kills: Story.state.shrineKills, quest: Story.state.quest }));
  console.log('2) shrine cleared:', JSON.stringify(shrine));
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Space'); await sleep(350); }   // 关掉船钟对话

  // 第三幕：船钟仪式
  await page.evaluate(() => Player.teleport(200, -120));
  await sleep(600);
  await page.keyboard.press('e');
  await sleep(900);
  await page.keyboard.press('e');
  await sleep(3800);
  const ritual = await page.evaluate(() => ({
    quest: Story.state.quest, maxStamina: Player.state.maxStamina,
    shovel: Player.hasItem('shovel'), maxHp: Player.state.maxHp,
  }));
  console.log('3) ritual:', JSON.stringify(ritual));
  await page.screenshot({ path: 'qa/shot_ritual.png' });

  // 第四幕：前往锅炉岛 → BOSS
  await page.evaluate(() => Player.teleport(-165, -185));
  await sleep(6000);
  const boss = await page.evaluate(() => ({ active: Enemies.dragon.active, quest: Story.state.quest, cp: Player.state.checkpoint }));
  console.log('4) boss activated:', JSON.stringify(boss));

  // BOSS 近战窗口（直接泵模拟步进，绕开 headless 慢帧）
  await page.evaluate(() => {
    for (let i = 0; i < 700 && Enemies.dragon.state !== 'dock'; i++) Enemies.update(0.05, i * 0.05);
  });
  const dockState = await page.evaluate(() => Enemies.dragon.state);
  console.log('   boss reached state:', dockState);
  await page.evaluate(() => Player.teleport(140, -44));
  await sleep(500);

  // 击坠 BOSS
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) Combat.damageDragon(50);
    for (let i = 0; i < 140 && !Enemies.dragon.dead; i++) Enemies.update(0.05, 100 + i * 0.05);
  });
  await sleep(800);
  const dead = await page.evaluate(() => ({ dead: Enemies.dragon.dead, quest: Story.state.quest }));
  console.log('5) boss dead:', JSON.stringify(dead));

  // 拾取黄金汽笛
  await page.evaluate(() => {
    const V = World.LANDMARKS.VOLCANO;
    Player.teleport(V.x + 24, V.z + 6);
  });
  await sleep(1500);
  const got = await page.evaluate(() => Player.state.inv.goldenWhistle);
  console.log('6) golden whistle picked up:', got);
  await sleep(6500);
  await page.screenshot({ path: 'qa/shot_ending.png' });
  const ending = await page.evaluate(() => ({
    ended: Story.state.ended,
    cardShown: document.getElementById('card').style.display !== 'none',
    cardText: document.getElementById('card-inner').textContent.slice(0, 60),
  }));
  console.log('7) ending:', JSON.stringify(ending));

  const errCount = await page.evaluate(() => window.__errCount());
  console.log('errors:', errCount, errors.slice(0, 6));

  await browser.close();
  const pass = hasMop && q2 === 'q2_shrine' && shrine.kills >= 4 &&
    ritual.maxStamina === 145 && ritual.shovel && ritual.maxHp === 8 &&
    boss.active && dockState === 'dock' && dead.dead && got && ending.ended && ending.cardShown &&
    errCount === 0 && errors.length === 0;
  console.log(pass ? 'STORY PASS' : 'STORY FAIL');
  process.exit(pass ? 0 : 1);
}
run().catch(e => { console.error('RUN ERROR:', e.message); process.exit(1); });
