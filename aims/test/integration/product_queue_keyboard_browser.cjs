// Actual queue move page; API responses are mocked, keyboard input is real.
const { chromium } = require(process.env.HZY_PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.HZY_PRODUCT_UI_PREVIEW_URL || 'http://127.0.0.1:3317');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw Error('Isolated preview required');
async function tabTo(page, locator) {
  await locator.waitFor();
  for (let i = 0; i < 60; i++) {
    if (await locator.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw Error('Keyboard cannot reach ' + await locator.innerText());
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [], attempts = [], listPages = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', r => r.abort());
      await page.route('**/api/v1/products/P1/**', async r => {
        const path = new URL(r.request().url()).pathname;
        let data;
        if (path.endsWith('/permissions')) data = { product_code: 'P1', status: 'active', prioritize: true };
        else if (path.endsWith('/assessments')) data = { cycle_biz_id: 'C1', item_biz_id: 'I1', cycle_revision: 4, workspace_revision: 8, item_revision: 2 };
        else if (path.endsWith('/planning-items/I1')) data = { biz_id: 'I1', product_code: 'P1', title: '移动事项', scope_summary: '验证键盘调序', revision: 2, scope_revision: 1, evidence_revision: 1, workspace_revision: 8 };
        else if (path.endsWith('/planning-cycles/C1')) data = { biz_id: 'C1', product_code: 'P1', status: 'open', revision: 4, queue_revision: 2, workspace_revision: 8 };
        else if (path.endsWith('/move-preview')) data = { cycle_biz_id: 'C1', workspace_revision: 8, cycle_revision: 4, queue_revision: 2, total: 11, affected: Array.from({ length: 10 }, (_, i) => ({ item_biz_id: `I${i + 1}`, title: i === 0 ? '移动事项' : `事项${i + 1}`, selection_status: 'candidate', before_position: i + 1, after_position: i === 0 ? 10 : i })) };
        else if (path.endsWith('/move')) {
          attempts.push({ body: r.request().postDataJSON(), key: r.request().headers()['idempotency-key'] });
          if (attempts.length === 1) return r.fulfill({ status: 503, json: { message: '模拟服务暂不可用' } });
          data = { receipt_id: 1, replayed: false, value: { cycle_biz_id: 'C1', changed: true, workspace_revision: 9, cycle_revision: 5, queue_revision: 3 } };
        } else if (path.endsWith('/items')) {
          const listPage = Number(new URL(r.request().url()).searchParams.get('page') || 1);
          listPages.push(listPage);
          data = { cycle_biz_id: 'C1', queue_revision: 2, total: 11, items: listPage === 2
            ? [{ biz_id: 'I11', product_code: 'P1', title: '第二页目标事项', scope_summary: '目标范围' }]
            : Array.from({ length: 10 }, (_, i) => ({ biz_id: `I${i + 1}`, product_code: 'P1', title: `第一页事项${i + 1}`, scope_summary: '范围' })) };
        }
        else return r.abort();
        await r.fulfill({ json: { code: 0, data } });
      });
      await page.goto(new URL('/products/P1/cycles/C1/items/I1/move', base).href);
      await page.getByText('第一页事项1', { exact: true }).waitFor();
      await tabTo(page, page.getByRole('button', { name: 'Next Page', exact: true }));
      await page.keyboard.press('Enter');
      await page.getByText('第二页目标事项', { exact: true }).waitFor();
      await tabTo(page, page.getByRole('button', { name: '选为目标', exact: true }));
      await page.keyboard.press('Enter');
      await tabTo(page, page.getByRole('button', { name: 'Previous Page', exact: true }));
      await page.keyboard.press('Enter');
      await page.getByText('第一页事项1', { exact: true }).waitFor();
      await page.getByText('目标：第二页目标事项', { exact: true }).waitFor();
      await tabTo(page, page.locator('textarea'));
      await page.keyboard.type('优先验证客户需求');
      await tabTo(page, page.getByRole('button', { name: '预览调序影响', exact: true }));
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: /调序影响/ }).waitFor();
      for (let attempt = 0; attempt < 2; attempt++) {
        await tabTo(page, page.getByRole('button', { name: '确认并调整顺序', exact: true }));
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await tabTo(page, dialog.getByRole('button', { name: '确认调序', exact: true }));
        if (attempt === 0) await page.screenshot({ path: `/tmp/hzy-product-browser-qa/queue-keyboard-${width}.png`, fullPage: true, animations: 'disabled' });
        await page.keyboard.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        if (attempt === 0) {
          await page.getByText('选择与理由已保留。版本冲突时请返回核对最新队列，依赖冲突时请先处理前置关系。').waitFor();
          if (await page.locator('textarea').inputValue() !== '优先验证客户需求') throw Error('Lost retry reason');
        }
      }
      await page.waitForURL('**/products/P1/cycles/C1/items');
      if (attempts.length !== 2 || !attempts[0].key || attempts[0].key !== attempts[1].key || JSON.stringify(attempts[0].body) !== JSON.stringify(attempts[1].body) || attempts[0].body.beforeId !== 'I11' || !listPages.includes(2) || errors.length) throw Error(JSON.stringify({ attempts, errors }));
      console.log('PASS keyboard queue move', width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
