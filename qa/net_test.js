// qa/net_test.js — 双端联机测试（?debug=1&nodraw=1&mp=host|join&room=）
// 验证：互见对方、移动跟随、35 怪位置一致、客机打怪血量回流、主机→客机掉血、BOSS 激活/掉血同步。
// 注意：nodraw 必须加，否则软件渲染 1 FPS 饿死信令握手。
const { chromium } = require('playwright-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8961';
const ROOM = 'QTS7';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(browser, url, tag) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', e => errors.push(tag + ' ' + String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(tag + ' console: ' + m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, tag };
}

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  });
  const host = await newPage(browser, `${BASE}/?debug=1&nodraw=1&mp=host&room=${ROOM}`, 'HOST');
  await sleep(1500);
  const client = await newPage(browser, `${BASE}/?debug=1&nodraw=1&mp=join&room=${ROOM}`, 'CLIENT');

  // 等待双方启动
  await host.page.waitForFunction(() => window.G && G.started, null, { timeout: 45000 });
  await client.page.waitForFunction(() => window.G && G.started, null, { timeout: 45000 });
  console.log('both started');

  // 等待 P2P 连接（信令 + 打洞，最多 90s）
  let connected = false;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const h = await host.page.evaluate(() => Net.connected);
    const c = await client.page.evaluate(() => Net.connected);
    if (h && c) { connected = true; console.log('P2P connected after', (i + 1) * 2, 's'); break; }
    if (i % 5 === 4) console.log('waiting for P2P...', (i + 1) * 2, 's');
  }
  if (!connected) {
    console.log('P2P CONNECT TIMEOUT');
    console.log('host errors:', host.errors.slice(0, 5));
    console.log('client errors:', client.errors.slice(0, 5));
    await browser.close();
    process.exit(1);
  }

  const results = {};

  // 1) 互见对方
  await sleep(1500);
  results.seeEachOther = await host.page.evaluate(() => !!Net.remotePos) &&
    await client.page.evaluate(() => !!Net.remotePos);
  console.log('1) see each other:', results.seeEachOther);

  // 2) 移动跟随：主机移动，客机 remotePos 跟随
  await host.page.evaluate(() => Player.teleport(123, 234));
  await sleep(1200);
  const rp = await client.page.evaluate(() => Net.remotePos);
  results.moveFollow = rp && Math.abs(rp.x - 123) < 6 && Math.abs(rp.z - 234) < 6;
  console.log('2) move follow:', results.moveFollow, JSON.stringify(rp));

  // 3) 35 只怪双端位置一致（快照收敛）
  await sleep(3000);
  results.mobsSync = await host.page.evaluate(() => {
    return Enemies.mobs.slice(0, 8).map(m => [m.id, Math.round(m.x * 10) / 10, Math.round(m.z * 10) / 10]);
  });
  const clientMobs = await client.page.evaluate(() => {
    return Enemies.mobs.slice(0, 8).map(m => [m.id, Math.round(m.x * 10) / 10, Math.round(m.z * 10) / 10]);
  });
  let mobMatch = 0;
  results.mobsSync.forEach((h, i) => {
    const c = clientMobs[i];
    if (c && c[0] === h[0] && Math.abs(c[1] - h[1]) < 2 && Math.abs(c[2] - h[2]) < 2) mobMatch++;
  });
  results.mobMatchCount = mobMatch;
  console.log('3) mob positions match:', mobMatch, '/ 8');

  // 4) 客机打怪：血量经主机回流一致
  const before = await client.page.evaluate(() => {
    const m = Enemies.mobs.find(x => !x.dead && x.type === 'rat');
    return m ? { id: m.id, hp: m.hp } : null;
  });
  if (before) {
    await client.page.evaluate((id) => {
      const m = Enemies.mobs.find(x => x.id === id);
      Combat.hitMob(m, 5, 0, 0);
    }, before.id);
    await sleep(1500);
    const hostHp = await host.page.evaluate((id) => {
      const m = Enemies.mobs.find(x => x.id === id);
      return m ? m.hp : -99;
    }, before.id);
    const clientHp = await client.page.evaluate((id) => {
      const m = Enemies.mobs.find(x => x.id === id);
      return m ? m.hp : -99;
    }, before.id);
    results.dmgRoute = hostHp === before.hp - 5 && clientHp === hostHp;
    console.log('4) client hit → host settles → snapshot back:', before.hp, '→', hostHp, '/', clientHp, results.dmgRoute);
  } else {
    results.dmgRoute = false;
    console.log('4) no rat found, skipped');
  }

  // 5) 主机侧怪打客机掉血（dmg 消息通道）
  const clientHpBefore = await client.page.evaluate(() => Player.state.hp);
  await host.page.evaluate(() => Net.send('dmg', { dmg: 1, x: 100, z: 100 }));
  await sleep(600);
  const clientHpAfter = await client.page.evaluate(() => Player.state.hp);
  results.hostDmgClient = clientHpAfter === clientHpBefore - 1;
  console.log('5) host dmg → client hp:', clientHpBefore, '→', clientHpAfter, results.hostDmgClient);

  // 6) BOSS 激活/掉血同步
  await host.page.evaluate(() => Enemies.activateDragon());
  await sleep(3500);
  const clientBossActive = await client.page.evaluate(() => Enemies.dragon.active);
  await host.page.evaluate(() => Enemies.damageDragon(50));
  await sleep(2500);
  const bossHps = await Promise.all([
    host.page.evaluate(() => Enemies.dragon.hp),
    client.page.evaluate(() => Enemies.dragon.hp),
  ]);
  results.bossSync = clientBossActive && bossHps[0] === 450 && bossHps[1] === 450;
  console.log('6) boss active on client:', clientBossActive, '| hp:', bossHps, results.bossSync);

  // 截图（临时开渲染看不必要——nodraw 下截 UI 即可）
  await client.page.screenshot({ path: 'qa/shot_net_client.png' });

  await sleep(1000);
  const errH = await host.page.evaluate(() => window.__errCount());
  const errC = await client.page.evaluate(() => window.__errCount());
  console.log('overlay errs:', errH, errC);
  console.log('page errors:', host.errors.concat(client.errors).slice(0, 8));

  await browser.close();
  const pass = connected && results.seeEachOther && results.moveFollow &&
    mobMatch >= 6 && results.dmgRoute && results.hostDmgClient && results.bossSync &&
    errH === 0 && errC === 0 && host.errors.length === 0 && client.errors.length === 0;
  console.log(pass ? 'NET PASS' : 'NET FAIL');
  process.exit(pass ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
