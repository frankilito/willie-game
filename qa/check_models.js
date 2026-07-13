// qa/check_models.js — 用系统 Chrome headless 验证 GLB 能被 three.js 加载并渲染，截图目检。
const { chromium } = require('playwright-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8961';

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

  await page.goto(`${BASE}/qa/model_test.html`, { waitUntil: 'load' });

  const shots = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForFunction(() => window.RESULT && window.RESULT.ready, null, { timeout: 20000 });
    const ready = await page.evaluate(() => window.RESULT.ready);
    if (ready === 'ERR') break;
    await page.waitForTimeout(900); // let animation advance a few poses
    const f = `qa/shot_model_${i}.png`;
    await page.screenshot({ path: f });
    shots.push(f);
    await page.evaluate(() => window.NEXT && window.NEXT());
  }
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => window.RESULT);
  console.log(JSON.stringify({ result, pageErrors }, null, 1));
  await browser.close();
  if ((result.errors && result.errors.length) || pageErrors.length) process.exit(1);
})();
