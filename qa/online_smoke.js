// qa/online_smoke.js — 线上冒烟：GitHub Pages 加载、模型全载、无 404、无报错、可游玩。
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://frankilito.github.io/willie-game/?debug=1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], failed404 = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', r => { if (r.status() === 404) failed404.push(r.url().split('/').slice(-2).join('/')); });

  console.log('loading', URL);
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.G && G.started, null, { timeout: 90000 });
  console.log('started online');
  await sleep(3000);
  // 走两步 + 攻击一次
  await page.keyboard.down('w');
  await sleep(1200);
  await page.keyboard.up('w');
  await page.evaluate(() => Combat.onLeftDown());
  await sleep(800);
  await page.screenshot({ path: 'qa/shot_online.png' });

  const r = await page.evaluate(() => ({
    err: window.__errCount(),
    models: Object.keys(G.models).length,
    mobs: Enemies.mobs.length,
    colliders: World.colliders.length,
    npcs: Npc.list.length,
    fps: document.getElementById('fps').textContent,
  }));
  console.log('state:', JSON.stringify(r));
  console.log('404s:', failed404.length ? failed404.slice(0, 10) : 'NONE');
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'NONE');
  await browser.close();
  const pass = r.err === 0 && errors.length === 0 && failed404.length === 0 &&
    r.models === 4 && r.mobs === 35 && r.colliders >= 40 && r.npcs === 7;
  console.log(pass ? 'ONLINE SMOKE PASS' : 'ONLINE SMOKE FAIL');
  process.exit(pass ? 0 : 1);
}
run().catch(e => { console.error('RUN ERROR:', e.message); process.exit(1); });
