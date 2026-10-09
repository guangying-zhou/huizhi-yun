// Local synthetic acceptance: all business APIs mocked; block external egress.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'

const { chromium } = await import(process.env.FEEDBACK_PLAYWRIGHT_MODULE || 'playwright-chromium')
const origin = process.env.FEEDBACK_ORIGIN || 'http://127.0.0.1:3451'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error('Loopback required')
const output = '/tmp/astra-feedback-visual'
await mkdir(output, { recursive: true })
const source = await readFile(new URL('../../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const ids = [...source.matchAll(/(?:\bid|"id"):\s*['"]([^'"]+)['"]/g)].map(m => m[1])
assert.ok(ids.length > 0, 'navigation fixture IDs must be present')
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((k, i) => ({ name: 'hzy_enterprise_' + k, value: ['fixture', 'FIXTURE', 'fixture', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    const page = await context.newPage()
    const errors = []
    const writes = []
    let failOptions = 0, failSubmit = 503
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin)
        return route.abort()
      if (!url.pathname.includes('/api/') || url.pathname.includes('_nuxt_icon'))
        return route.continue()
      let data, status = 200
      if (url.pathname.startsWith('/enterprise/api/feedback')) {
        if (req.method() !== 'GET')
          writes.push({ path: url.pathname, key: req.headers()['idempotency-key'], body: req.postDataJSON() })
        if (url.pathname.endsWith('/options')) {
          status = failOptions || 200
          data = { data: { enabled: true } }
        } else if (url.pathname.endsWith('/drafts'))
          data = { data: { id: 'F1', status: 'draft' } }
        else if (url.pathname.endsWith('/submit')) {
          status = failSubmit || 202
          data = { data: { id: 'F1', status: 'pending' } }
        } else
          data = { data: { items: [], total: 0 } }
      } else {
        try {
          data = visualResponse(url, req.method(), undefined, { feedback: ['view', 'submit'], console_overview: ['view'] }, ids)
        } catch {
          data = { code: 0, data: { items: [], total: 0, tree: [] } }
        }
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(origin + '/enterprise/feedback', { waitUntil: 'domcontentloaded', timeout: 120000 })
    const button = page.getByRole('button', { name: '反馈问题/需求', exact: true })
    await button.waitFor({ timeout: 60000 })
    for (const status of [403, 503]) {
      failOptions = status
      await button.click()
      const dialog = page.getByRole('dialog')
      await dialog.getByText(status === 403 ? '当前账号没有反馈权限，请联系系统管理员。' : '反馈服务暂不可用，内容已保留，请稍后重试。', { exact: true }).waitFor()
      await page.screenshot({ path: `${output}/options-${status}-${width}.png`, animations: 'disabled' })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
    }
    failOptions = 0
    await button.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: /^标题/ }).fill('项目文档保存失败（合成测试）')
    await dialog.getByRole('textbox', { name: /^描述/ }).fill('点击保存后显示失败，希望能看到重试入口。')
    assert.equal(await dialog.getByRole('checkbox', { name: '附带浏览器信息' }).isChecked(), false)
    await page.screenshot({ path: `${output}/form-${width}.png`, animations: 'disabled' })
    await dialog.getByRole('button', { name: '提交反馈', exact: true }).click()
    await dialog.getByText('反馈服务暂不可用，内容已保留，请稍后重试。').waitFor()
    failSubmit = 409
    await dialog.getByRole('button', { name: '重试提交', exact: true }).click()
    await dialog.getByText('这次提交状态已变化。请查看“我的反馈”，避免重复提交。').waitFor()
    await page.screenshot({ path: `${output}/conflict-${width}.png`, animations: 'disabled' })
    failSubmit = 0
    await dialog.getByRole('button', { name: '重试提交', exact: true }).click()
    await dialog.getByText('反馈已受理', { exact: true }).waitFor()
    const submits = writes.filter(w => w.path.endsWith('/submit'))
    assert.equal(new Set(submits.map(w => w.key)).size, 1)
    assert.equal(writes.filter(w => w.path.endsWith('/drafts')).length, 1)
    assert.ok(!JSON.stringify(writes[0].body).includes('browser'))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${output}/accepted-${width}.png`, animations: 'disabled' })
    results.push({ width, stableIntent: true, noOverflow: true, noPageErrors: true })
    await context.close()
  }
} finally {
  await browser.close()
}
await writeFile(`${output}/result.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
