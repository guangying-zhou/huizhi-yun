// Actual VersionPublisher + Foundation confirmation, mocked API only.
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
      const attempts = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', r => r.abort());
      await page.route('**/api/v1/products/P1/versions/**', async r => {
        const path = new URL(r.request().url()).pathname;
        let data;
        if (path.endsWith('/permissions')) data = { product_code: 'P1', actor_uid: 'publisher', publish: true };
        else if (path.endsWith('/acceptance-preview')) data = { workspace_revision: 8, product_status: 'active', version: { id: 9, product_code: 'P1', version_code: 'v1.0', status: 'developing', business_owner_uid: 'owner', revision: 4, scope_revision: 3 }, execution: { targets: [], open_defects: [], restricted_item_count: 0, no_execution_plan: true }, scope_count: 1, unresolved_scope_count: 0, review_hash: 'frozen-review' };
        else if (path.endsWith('/publish')) {
          attempts.push({ body: r.request().postDataJSON(), key: r.request().headers()['idempotency-key'] });
          if (attempts.length === 1) return r.fulfill({ status: 503, json: { message: '模拟服务暂不可用' } });
          data = { value: { release_record_id: 12, version_id: 9, product_code: 'P1', status: 'released' } };
        } else return r.abort();
        await r.fulfill({ json: { code: 0, data } });
      });
      await page.goto(new URL('/qa-publisher', base).href);
      await tabTo(page, page.getByRole('button', { name: '依据此验收记录发布', exact: true }));
      await page.keyboard.press('Enter');
      const form = page.getByRole('dialog', { name: '正式发布版本', exact: true });
      await tabTo(page, form.locator('textarea'));
      await page.keyboard.type('已核验发布范围');
      await tabTo(page, form.getByRole('checkbox'));
      await page.keyboard.press('Space');
      for (let attempt = 0; attempt < 2; attempt++) {
        await tabTo(page, form.getByRole('button', { name: '确认发布', exact: true }));
        await page.keyboard.press('Enter');
        const confirm = page.getByRole('dialog', { name: '确认正式发布', exact: true });
        await tabTo(page, confirm.getByRole('button', { name: '正式发布', exact: true }));
        if (attempt === 0) await page.screenshot({ path: `/tmp/hzy-product-browser-qa/publish-keyboard-${width}.png`, fullPage: true, animations: 'disabled' });
        await page.keyboard.press('Enter');
        await confirm.waitFor({ state: 'hidden' });
        if (attempt === 0) {
          await form.getByText('发布原因已保留。刷新后需重新确认；验收失效时请先完成新的验收。').waitFor();
          if (await form.locator('textarea').inputValue() !== '已核验发布范围') throw Error('Lost reason');
        }
      }
      await page.getByText('版本已正式发布', { exact: true }).waitFor();
      if (attempts.length !== 2 || !attempts[0].key || attempts[0].key !== attempts[1].key || JSON.stringify(attempts[0].body) !== JSON.stringify(attempts[1].body) || attempts[0].body.acceptanceId !== 7 || errors.length) throw Error(JSON.stringify({ attempts, errors }));
      console.log('PASS keyboard publication', width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
