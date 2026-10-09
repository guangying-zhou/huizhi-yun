// Local synthetic data only. No tenant sessions, credentials or business writes.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const origin = 'http://127.0.0.1:3469'
const output = process.env.CODOCS_SPACING_OUTPUT || '/tmp/codocs-spacing-visual'
await mkdir(output, { recursive: true, mode: 0o700 })
const nav = await readFile(new URL('../../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const ids = [...nav.matchAll(/"id": "([^"]+)"/g)].map(m => m[1])
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    let uid = 'fixture-user'
    const row = { id: '00000000-0000-4000-8000-000000000001', title: '合成系统公告摘要：文档与项目开放，长标题应该截断而不是挤压用户菜单', body: '合成正文', level: 'warning', startsAt: '2026-10-07', endsAt: '', audience: 'all', departments: [], popup: false, banner: true, bell: true, wecom: false, status: 'published', revision: 1, read: false }
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.includes('/api/') || url.pathname.includes('_nuxt_icon')) return route.continue()
      let data
      if (url.pathname.includes('/announcements')) data = { code: 0, data: { items: [row], hasMore: false } }
      else if (url.pathname.endsWith('/auth/me')) data = { authenticated: true, provider: 'console_oidc', tenant: 'FIXTURE', uid, subjectCode: uid, policyVersion: 'fixture-v1', deployment: 'fixture' }
      else {
        try {
          data = visualResponse(url, request.method(), undefined, { contract: ['view'] }, ids)
        } catch {
          data = { code: 0, data: { items: [], total: 0 } }
        }
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((key, i) => ({ name: 'hzy_enterprise_' + key, value: ['fixture-user', 'FIXTURE', 'fixture-user', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    console.log('announcement', width, 'initial')
    await page.goto(origin + '/altoc/contracts', { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log('announcement', width, 'dom-ready')
    const banner = page.locator('[data-host-announcement-summary]')
    await banner.waitFor({ timeout: 30000 }).catch(async (error) => {
      console.log({ errors, body: await page.locator('body').innerText() })
      throw error
    })
    assert.equal(await banner.locator('a').getAttribute('href'), `/enterprise/announcements/${row.id}`)
    const summary = banner.locator('span.truncate')
    assert.equal(await summary.isVisible(), width >= 640)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `${output}/announcement-${width}-top.png` })
    await page.locator('.host-page-container').evaluate((el) => {
      el.style.paddingBottom = '1500px'
    })
    await page.locator('main').evaluate((el) => {
      el.scrollTop = 500
    })
    await banner.waitFor({ state: 'hidden', timeout: 15000 })
    assert.equal(await page.locator('[data-host-pinned-title]').isVisible(), true)
    await page.screenshot({ path: `${output}/announcement-${width}-scrolled.png` })
    await page.locator('main').evaluate((el) => {
      el.scrollTop = 0
    })
    await banner.waitFor({ timeout: 15000 })
    await banner.getByRole('button', { name: `关闭公告：${row.title}`, exact: true }).click()
    await banner.waitFor({ state: 'hidden', timeout: 15000 })
    console.log('announcement', width, 'reload', row.revision, uid)
    await page.reload()
    await page.locator('[data-host-page-title]').waitFor()
    assert.equal(await banner.count(), 0, 'closed revision stays hidden after reload')
    row.revision = 2
    console.log('announcement', width, 'reload', row.revision, uid)
    await page.reload()
    await banner.waitFor({ timeout: 15000 })
    await banner.getByRole('button', { name: `关闭公告：${row.title}`, exact: true }).click()
    uid = 'fixture-second-user'
    await context.addCookies([{ name: 'hzy_enterprise_uid', value: uid, url: origin }, { name: 'hzy_enterprise_subject_code', value: uid, url: origin }])
    console.log('announcement', width, 'reload', row.revision, uid)
    await page.reload()
    await banner.waitFor({ timeout: 15000 })
    assert.deepEqual(errors, [])
    results.push({ width, closePersists: true, revisionReshows: true, otherUserReshows: true, titlePriority: true, errors })
    await context.close()
  }
} finally {
  await browser.close()
  await writeFile(output + '/announcements-results.json', JSON.stringify(results, null, 2))
}
