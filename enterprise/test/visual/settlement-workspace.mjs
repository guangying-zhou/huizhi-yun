import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'
import { settlementResponse, receipt } from '../fixtures/settlement-workspace.mjs'

const { chromium } = await import(process.env.S1_PLAYWRIGHT_MODULE || 'playwright-chromium')
const origin = process.env.S1_ORIGIN || 'http://127.0.0.1:3451'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('Synthetic test requires loopback origin')
const output = process.env.S1_EVIDENCE_DIR || '/tmp/astra-s1-visual'
await mkdir(output, { recursive: true })
const source = await readFile(new URL('../../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const ids = [...source.matchAll(/"id": "([^"]+)"/g)].map(m => m[1])
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const state = { actor: 'reviewer', receipt: { ...receipt }, failRead: 0, failWrite: 0, failInvoice: false, writes: [] }
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((k, i) => ({ name: 'hzy_enterprise_' + k, value: [state.actor, 'FIXTURE', state.actor, 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.includes('/api/') || url.pathname.includes('_nuxt_icon')) return route.continue()
      let status = 200
      const body = req.postData() ? JSON.parse(req.postData()) : undefined
      if (req.method() !== 'GET') state.writes.push({ path: url.pathname, body, key: req.headers()['idempotency-key'] })
      if (state.failRead && /\/receipts\/[^/]+$/.test(url.pathname)) status = state.failRead
      if (state.failWrite && url.pathname.endsWith('/allocate') && req.method() === 'POST') status = state.failWrite
      if (state.failInvoice && url.pathname === '/finance/api/v1/invoice-requests' && req.method() === 'POST') status = 503
      let data = status !== 200 ? { statusCode: status, code: status === 409 ? 'finance_version_conflict' : 'fixture_error' } : settlementResponse(url, req.method(), body, state)
      if (data === undefined) {
        try {
          data = visualResponse(url, req.method(), body, {}, ids)
        } catch {
          data = { code: 0, data: { items: [], total: 0, tree: [] } }
        }
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(origin + '/finance/receipts')
    await page.getByRole('heading', { name: '收款与结算', exact: true }).waitFor({ timeout: 60000 })
    await page.getByRole('link', { name: receipt.code, exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('complementary', { name: '当前结算事项' }).getByText('办理核销', { exact: true }).click()
    await page.getByText('确认全部分配', { exact: true }).waitFor()
    await page.screenshot({ path: `${output}/allocation-${width}.png`, fullPage: true })
    await writeFile(`${output}/page-${width}.txt`, await page.locator('body').innerText())
    const measure = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    assert.equal(measure.document, width, 'no page horizontal overflow')
    assert.deepEqual(errors, [])
    const panel = page.getByRole('complementary', { name: '当前结算事项' })
    const amounts = panel.getByRole('textbox', { name: '本次分配金额', exact: true }).filter({ visible: true })
    await amounts.nth(0).fill('60000.00')
    await amounts.nth(1).fill('40000.00')
    state.failWrite = 409
    await panel.getByRole('button', { name: '确认全部分配', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
    await page.getByText('内容或版本已变化，请刷新比较；草稿与选择已保留', { exact: true }).waitFor()
    assert.equal(await amounts.nth(0).inputValue(), '60000.00')
    await page.screenshot({ path: `${output}/conflict-${width}.png`, fullPage: true })
    state.failWrite = 0
    await panel.getByRole('button', { name: '确认全部分配', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
    await panel.getByText(/可分配 0.00/).waitFor()
    const allocations = state.writes.filter(write => write.path.endsWith('/allocate'))
    assert.equal(allocations.length, 2)
    assert.ok(allocations[0].key)
    assert.equal(allocations[0].key, allocations[1].key)
    assert.deepEqual(allocations[0].body, allocations[1].body)
    assert.equal(new URL(page.url()).pathname, '/finance/receipts')

    // Same stored object, another authenticated fixture identity; no role simulation.
    state.receipt = { ...receipt }
    state.actor = 'cashier'
    await context.addCookies(['uid', 'subject_code'].map(k => ({ name: 'hzy_enterprise_' + k, value: state.actor, url: origin })))
    await page.goto(origin + '/finance/receipts?settlement=' + encodeURIComponent('/finance/receipts/' + receipt.code))
    await panel.getByText('到账已由你确认，请交另一位财务分配。复制本页交接链接，由对方登录后办理。', { exact: true }).waitFor()
    assert.equal(await panel.getByRole('link', { name: '办理核销', exact: true }).getAttribute('aria-disabled'), 'true')
    await page.screenshot({ path: `${output}/handoff-${width}.png`, fullPage: true })
    for (const status of [403, 503]) {
      state.failRead = status
      await page.reload()
      await panel.getByText(status === 403 ? '您没有查看此单据的权限' : '单据暂不可用，请重试', { exact: true }).waitFor()
      await page.screenshot({ path: `${output}/read-${status}-${width}.png`, fullPage: true })
      assert.equal(await panel.getByText('办理核销', { exact: true }).count(), 0)
    }
    state.failRead = 0
    await page.goto(origin + '/altoc/payments?settlement=' + encodeURIComponent('/altoc/payments/1'))
    await panel.getByText('合成客户甲 · CT-SYNTHETIC · CNY', { exact: true }).waitFor()
    await page.getByRole('button', { name: '登记到账', exact: true }).click()
    await panel.getByRole('textbox', { name: '客户名称', exact: true }).waitFor()
    assert.equal(await panel.getByRole('textbox', { name: '客户名称', exact: true }).inputValue(), receipt.customer_name)
    assert.equal(await panel.getByRole('textbox', { name: /^币种/ }).inputValue(), 'CNY')
    await panel.getByRole('textbox', { name: '说明', exact: true }).fill('保留的草稿')
    await panel.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await panel.getByRole('textbox', { name: '说明', exact: true }).inputValue(), '保留的草稿')
    await page.screenshot({ path: `${output}/prefill-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    // Baseline is the preserved standalone form with the same fixture: no carried customer/contract/plan.
    await page.goto(origin + '/finance/receipts/new')
    await page.getByRole('textbox', { name: '客户名称', exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '客户名称', exact: true }).inputValue(), '')
    await page.screenshot({ path: `${output}/baseline-empty-receipt-${width}.png`, fullPage: true })
    await page.goto(origin + '/altoc/payments?settlement=' + encodeURIComponent('/altoc/payments/1'))
    await panel.getByText('合成客户甲 · CT-SYNTHETIC · CNY', { exact: true }).waitFor()
    await page.getByRole('button', { name: '申请开票', exact: true }).click()
    await panel.getByRole('textbox', { name: /^开票内容/ }).fill('合成服务费')
    await panel.getByRole('textbox', { name: /^申请金额/ }).fill('60000.00')
    state.failInvoice = true
    await panel.getByRole('button', { name: '保存', exact: true }).click()
    await panel.getByText('提交结果待确认，请重试原请求', { exact: true }).waitFor()
    assert.equal(await panel.getByRole('textbox', { name: /^申请金额/ }).isDisabled(), true)
    state.failInvoice = false
    await panel.getByRole('button', { name: '保存', exact: true }).click()
    await panel.getByText('开票申请已保存；审批与正式开票分别办理。', { exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/altoc/payments')
    const invoiceWrites = state.writes.filter(write => write.path === '/finance/api/v1/invoice-requests')
    assert.equal(invoiceWrites.length, 2)
    assert.equal(invoiceWrites[0].key, invoiceWrites[1].key)
    assert.deepEqual(invoiceWrites[0].body, invoiceWrites[1].body)
    const invoiceWrite = invoiceWrites[1]
    assert.equal(invoiceWrite.body.customerCode, receipt.customer_code)
    assert.equal(invoiceWrite.body.contractCode, receipt.contract_code)
    assert.equal(invoiceWrite.body.billingScheduleCode, receipt.billing_schedule_code)
    assert.ok(invoiceWrite.key)
    assert.equal(state.invoice.status, 'draft', 'saving does not fabricate Workflow approval or issuance')
    await page.screenshot({ path: `${output}/invoice-saved-${width}.png`, fullPage: true })
    await panel.getByRole('button', { name: '复制交接链接', exact: true }).click()
    const handoff = await page.evaluate(() => navigator.clipboard.readText())
    const handoffUrl = new URL(handoff)
    assert.equal(handoffUrl.pathname, '/finance/receipts')
    assert.equal(handoffUrl.searchParams.get('settlement'), '/finance/invoices/requests/IR-SYNTHETIC-NEW')
    assert.deepEqual([...handoffUrl.searchParams.keys()], ['settlement'])
    assert.deepEqual(errors, [])
    results.push({ width, measure, errors, cases: ['allocation', '409-preserves-draft-and-key', 'same-person-disabled', '403', '503', 'context-prefill', 'draft-cancel', 'baseline-empty-form', 'invoice-save-in-place', '503-write-freezes-intent', 'handoff-canonical-finance-entry'] })
    await context.close()
  }
} finally { await browser.close() }
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
