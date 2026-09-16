// Actual Finance form and page config in an isolated preview with stubbed submit.
const { chromium } = require(process.env.HZY_PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.HZY_PRODUCT_UI_PREVIEW_URL || 'http://127.0.0.1:3317');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw Error('Isolated preview required');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => route.abort());
      await page.goto(new URL('/qa-finance-allocation', base).href);
      await page.getByRole('button', { name: '新建分摊' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const currency = dialog.getByPlaceholder('如 CNY、USD；未知留空');
      if (await currency.inputValue() !== '') throw Error('Currency acquired a default');
      await dialog.getByPlaceholder('项目编码').fill('PRJ-1');
      await dialog.getByPlaceholder('YYYY-MM').fill('2026-09');
      await dialog.getByPlaceholder('分摊金额').fill('45.67');
      await currency.fill('usd');
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.getByText('币种必须为三位大写代码', { exact: true }).waitFor();
      if (await currency.inputValue() !== 'usd') throw Error('Failed submission discarded currency');
      await currency.fill('USD');
      await page.screenshot({ path: `/tmp/hzy-product-browser-qa/finance-allocation-${width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const saved = JSON.parse(await page.getByTestId('saved').innerText());
      if (saved.currencyCode !== 'USD' || saved.amount !== 45.67 || errors.length) throw Error(JSON.stringify({ saved, errors }));
      console.log('PASS Finance allocation form', width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
