// Actual exploration window page, keyboard-only interaction, mocked API.
const { chromium } = require(process.env.HZY_PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.HZY_PRODUCT_UI_PREVIEW_URL || 'http://127.0.0.1:3317');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw Error('Isolated preview required');
async function tabTo(page, target) {
  await target.waitFor();
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw Error('Keyboard target unreachable');
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [], attempts = [];
      let saved = false;
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', r => r.abort());
      await page.route('**/api/v1/products/P1/roadmaps/**', async r => {
        const path = new URL(r.request().url()).pathname;
        let data;
        if (path.endsWith('/permissions')) data = { product_code: 'P1', status: 'active', revision: saved ? 9 : 8, edit: true };
        else if (path.endsWith('/windows/I1')) {
          if (r.request().method() === 'PATCH') {
            attempts.push({ body: r.request().postDataJSON(), key: r.request().headers()['idempotency-key'] });
            if (attempts.length === 1) return r.fulfill({ status: 503, json: { message: '模拟服务暂不可用' } });
            saved = true;
          }
          const window = { biz_id: 'I1', product_code: 'P1', title: '路线测试事项', lifecycle: 'proposed', starts_on: saved ? null : '2026-09-01', ends_on: saved ? null : '2026-09-30', revision: saved ? 3 : 2, workspace_revision: saved ? 9 : 8 };
          data = r.request().method() === 'PATCH' ? { value: window } : window;
        } else return r.abort();
        await r.fulfill({ json: { code: 0, data } });
      });
      await page.goto(new URL('/products/P1/planning-items/I1/roadmap', base).href);
      await tabTo(page, page.getByRole('button', { name: '清空日期', exact: true }));
      await page.keyboard.press('Enter');
      await tabTo(page, page.locator('textarea'));
      await page.keyboard.type('等待依赖交付后重新安排');
      for (let attempt = 0; attempt < 2; attempt++) {
        await tabTo(page, page.getByRole('button', { name: '保存探索窗口', exact: true }));
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: '清空探索时间窗口', exact: true });
        await tabTo(page, dialog.getByRole('button', { name: '保存窗口', exact: true }));
        if (attempt === 0) await page.screenshot({ path: `/tmp/hzy-product-browser-qa/roadmap-keyboard-${width}.png`, fullPage: true, animations: 'disabled' });
        await page.keyboard.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        if (attempt === 0) {
          await page.getByRole('alert').waitFor();
          if (await page.locator('textarea').inputValue() !== '等待依赖交付后重新安排') throw Error('Lost retry reason');
        }
      }
      await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
      const dates = await page.locator('input[type=date]').evaluateAll(es => es.map(e => e.value));
      if (!saved || attempts.length !== 2 || !attempts[0].key || attempts[0].key !== attempts[1].key || JSON.stringify(attempts[0].body) !== JSON.stringify(attempts[1].body) || attempts[0].body.startsOn !== null || attempts[0].body.endsOn !== null || dates.some(Boolean) || errors.length) throw Error(JSON.stringify({ attempts, dates, errors }));
      console.log('PASS keyboard roadmap window', width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
