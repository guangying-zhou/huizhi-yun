// Synthetic local UI acceptance. All API requests are fulfilled locally
// No tenant writes.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'

const { chromium } = await import(process.env.ANNOUNCEMENT_PLAYWRIGHT_MODULE || 'playwright-chromium')
const origin = process.env.ANNOUNCEMENT_ORIGIN || 'http://127.0.0.1:3451'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('Loopback synthetic origin required')
const output = '/tmp/astra-announcements-visual'
await mkdir(output, { recursive: true })
const source = await readFile(new URL('../../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const ids = [...source.matchAll(/"id": "([^"]+)"/g)].map(m => m[1])
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of (process.env.ANNOUNCEMENT_WIDTH ? [Number(process.env.ANNOUNCEMENT_WIDTH)] : [1440, 390])) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((k, i) => ({ name: 'hzy_enterprise_' + k, value: ['fixture-user', 'FIXTURE', 'fixture-user', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const row = { id: '00000000-0000-4000-8000-000000000001', title: '10 月 8 日文档与项目开放通知（合成测试）', body: '# 日常工作入口\n\n请从工作台进入文档与项目。\n\n- 个人与部门文档支持实时协作\n- 离开前核对保存状态\n\n[完整使用说明](/enterprise/help)', level: 'warning', startsAt: '2026-10-07T00:00:00Z', endsAt: '', audience: 'all', departments: [], popup: true, banner: true, bell: false, wecom: false, status: 'published', revision: 1, read: false }
    let failRead = 0
    let failClose = true
    let closeAttempts = 0
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.includes('/api/') || url.pathname.includes('_nuxt_icon')) return route.continue()
      let data, status = 200
      if (url.pathname.startsWith('/enterprise/api/announcements')) {
        if (url.pathname.endsWith('/read')) {
          closeAttempts++
          assert.ok(req.headers()['idempotency-key'])
          if (failClose) status = 503
          else row.read = true
          data = { code: 0, data: { id: row.id } }
        } else if (failRead) {
          status = failRead
          data = { statusCode: status }
        } else data = { code: 0, data: { items: [row], hasMore: false } }
      } else {
        try {
          data = visualResponse(url, req.method(), undefined, { announcements: ['view'], console_overview: ['view'] }, ids)
        } catch {
          data = { code: 0, data: { items: [], total: 0, tree: [] } }
        }
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(origin + '/enterprise/announcements', { waitUntil: 'domcontentloaded', timeout: 120000 })
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: row.title }).waitFor({ timeout: 30000 }).catch(async (error) => {
      await writeFile(`${output}/debug.txt`, JSON.stringify({ url: page.url(), errors, body: await page.locator('body').innerText() }, null, 2))
      await page.screenshot({ path: `${output}/debug.png` })
      throw error
    })
    await page.screenshot({ path: `${output}/popup-${width}.png`, fullPage: true, animations: 'disabled' })
    await dialog.getByRole('button', { name: '我已阅读，关闭' }).click()
    await dialog.getByText('已读记录未保存，请重试关闭').waitFor()
    failClose = false
    await dialog.getByRole('button', { name: '我已阅读，关闭' }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(closeAttempts, 2)
    await page.reload()
    await page.getByRole('heading', { name: '系统公告', exact: true }).waitFor()
    await page.getByText('已读', { exact: true }).waitFor()
    assert.equal(await dialog.count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.screenshot({ path: `${output}/list-${width}.png`, fullPage: true, animations: 'disabled' })
    await page.goto(origin + '/enterprise/announcements/' + row.id)
    await page.getByRole('heading', { name: '日常工作入口' }).waitFor()
    await page.screenshot({ path: `${output}/detail-${width}.png`, fullPage: true, animations: 'disabled' })
    await page.goto(origin + '/enterprise/help')
    await page.getByRole('heading', { name: '汇智云使用说明（文档与项目）', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.screenshot({ path: `${output}/help-${width}.png`, fullPage: true, animations: 'disabled' })
    for (const failure of [403, 503]) {
      failRead = failure
      await page.goto(origin + '/enterprise/announcements', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.getByText(failure === 403 ? '无权查看系统公告' : '系统公告暂不可用', { exact: true }).waitFor()
      await page.screenshot({ path: `${output}/error-${failure}-${width}.png`, fullPage: true, animations: 'disabled' })
    }
    assert.deepEqual(errors, [])
    results.push({ width, errors, cases: ['popup', 'failed-close-retained', 'successful-close', 'read-persists-reload', 'list', 'detail', 'help', '403', '503', 'no-horizontal-overflow'] })
    await context.close()
  }
} finally {
  await browser.close()
}
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
