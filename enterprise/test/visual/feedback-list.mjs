// Local synthetic acceptance: all business APIs mocked; block external egress.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'

const { chromium } = await import(process.env.FEEDBACK_PLAYWRIGHT_MODULE || 'playwright-chromium')
const origin = process.env.FEEDBACK_ORIGIN || 'http://127.0.0.1:3451'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error('Loopback required')
const output = '/tmp/astra-feedback-list-visual'
await mkdir(output, { recursive: true })
const source = await readFile(new URL('../../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const ids = [...source.matchAll(/(?:\bid|"id"):\s*['"]([^'"]+)['"]/g)].map(m => m[1])
assert.ok(ids.length > 0, 'navigation fixture IDs must be present')
const browser = await chromium.launch({ headless: true })

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Shanghai' })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((k, i) => ({ name: 'hzy_enterprise_' + k, value: ['fixture-user', 'FIXTURE', 'fixture-user', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    const page = await context.newPage()
    const errors = []
    const queries = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin)
        return route.abort()
      if (!url.pathname.includes('/api/') || url.pathname.includes('_nuxt_icon'))
        return route.continue()
      let data, status = 200
      if (url.pathname === '/enterprise/api/feedback') {
        queries.push(Object.fromEntries(url.searchParams))
        const statusFilter = url.searchParams.get('status'), kind = url.searchParams.get('kind')
        const number = Number(url.searchParams.get('page') || 1)
        const item = { id: 'F1', reporterUid: 'fixture', reporterName: '测试员工', text: { title: number > 1 ? '第二页反馈' : '筛选与本地时间验收', kind: 'bug', priority: 'mid', description: '合成反馈', pageUrl: '/enterprise' }, status: statusFilter || 'submitted', issueIid: 123, issueUrl: '/example-issue/123', createdAt: '2026-10-08T20:41:24.649Z', notificationPending: 0 }
        data = { data: { items: kind === 'suggestion' ? [] : [item], total: kind === 'suggestion' ? 0 : statusFilter ? 1 : 21 } }
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
    await page.getByText('筛选与本地时间验收', { exact: true }).waitFor({ timeout: 60000 })
    assert.match(await page.locator('body').innerText(), /2026.*10.*09.*04:41.*优先级：中/)
    await page.getByRole('link', { name: '已建单 #123' }).waitFor()
    await page.getByRole('button', { name: /next page|下一页/i }).click()
    await page.getByText('第二页反馈', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: '筛选状态', exact: true }).click()
    await page.getByRole('option', { name: '创建失败，等待管理员处理', exact: true }).click()
    await page.getByText('筛选与本地时间验收', { exact: true }).waitFor()
    assert.equal(queries.at(-1).page, '1')
    assert.equal(queries.at(-1).pageSize, '20')
    await page.getByRole('combobox', { name: '筛选类型', exact: true }).click()
    await page.getByRole('option', { name: '建议', exact: true }).click()
    await page.getByText('暂无符合条件的反馈', { exact: true }).waitFor()
    await page.screenshot({ path: `${output}/empty-${width}.png` })
    await page.getByRole('button', { name: '清除筛选', exact: true }).click()
    await page.getByText('共 21 条', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${output}/list-${width}.png` })
    await context.close()
    console.log(`${width}: local date, labels, filters, pagination, empty state PASS`)
  }
} finally { await browser.close() }
