// Runs the real Console page in a temporary, local-only Host harness. Restores it on exit.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'

const { chromium } = await import(process.env.ANNOUNCEMENT_PLAYWRIGHT_MODULE || 'playwright-chromium')
const origin = process.env.ANNOUNCEMENT_ORIGIN || 'http://127.0.0.1:3451'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('Loopback synthetic origin required')
const help = new URL('../../app/pages/enterprise/help.vue', import.meta.url)
const original = await readFile(help, 'utf8')
const output = '/tmp/astra-announcements-visual'
await mkdir(output, { recursive: true })
const navigation = await readFile(new URL('../../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const ids = [...navigation.matchAll(/"id": "([^"]+)"/g)].map(m => m[1])
const browser = await chromium.launch({ headless: true })
const results = []
try {
  await writeFile(help, `<script setup lang="ts">\nimport Admin from '../../../../console/app/pages/announcements.vue'\ndefinePageMeta({ name: 'console-host-help', navigationOwner: 'console' })\n</script>\n<template><Admin /></template>\n`)
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((k, i) => ({ name: 'hzy_enterprise_' + k, value: ['fixture-user', 'FIXTURE', 'fixture-user', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    const page = await context.newPage(), errors = [], writes = []
    page.on('pageerror', e => errors.push(e.message))
    const row = { id: '00000000-0000-4000-8000-000000000001', title: '文档与项目开放（合成测试）', body: '# 使用说明\n\n[完整说明](/enterprise/help)', level: 'info', startsAt: '2026-10-07T00:00:00Z', endsAt: '', audience: 'all', departments: [], popup: true, banner: true, bell: false, wecom: false, status: 'published', revision: 1, read: false, delivery: { prepared: true, pending: 2, delivered: 8, retrying: 1 } }
    let fail = 409, readFailure = 0
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.includes('/api/') || url.pathname.includes('_nuxt_icon')) return route.continue()
      let status = 200, data
      if (url.pathname.startsWith('/api/v1/console/announcements')) {
        if (req.method() === 'POST') {
          const body = req.postDataJSON()
          assert.ok(req.headers()['idempotency-key'])
          assert.ok(!('delivery' in body) && !('read' in body) && !('status' in body))
          writes.push({ body, key: req.headers()['idempotency-key'] })
          status = fail || 200
          data = { code: 0, data: { id: row.id } }
        } else if (url.pathname.endsWith('/departments')) data = { code: 0, data: [{ value: 'D1', label: '研发部 (D1)' }] }
        else {
          status = readFailure || 200
          data = { code: 0, data: { items: [row], hasMore: false } }
        }
      } else if (url.pathname.startsWith('/enterprise/api/announcements')) data = { code: 0, data: { items: [], hasMore: false } }
      else {
        try {
          data = visualResponse(url, req.method(), undefined, { announcements: ['view', 'admin'], console_overview: ['view'] }, ids)
        } catch {
          data = { code: 0, data: { items: [], total: 0, tree: [] } }
        }
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(origin + '/enterprise/help', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByRole('button', { name: '发布公告', exact: true }).waitFor({ timeout: 60000 })
    await page.screenshot({ path: `${output}/admin-list-${width}.png`, fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: '发布系统公告' }).waitFor()
    await page.screenshot({ path: `${output}/admin-editor-${width}.png`, fullPage: true, animations: 'disabled' })
    await dialog.getByRole('button', { name: '发布', exact: true }).click()
    await dialog.getByText('公告已被修改，请重新加载后编辑').waitFor()
    assert.equal(await dialog.locator('input').first().inputValue(), row.title)
    await page.screenshot({ path: `${output}/admin-conflict-${width}.png`, fullPage: true, animations: 'disabled' })
    fail = 0
    await dialog.getByRole('button', { name: '发布', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(writes.length, 2)
    assert.equal(writes[0].key, writes[1].key)
    await page.getByRole('button', { name: '发布公告', exact: true }).click()
    await dialog.getByRole('heading', { name: '发布系统公告' }).waitFor()
    assert.equal(await dialog.locator('input').first().inputValue(), '')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    for (const code of [403, 503]) {
      readFailure = code
      await page.reload()
      await page.getByText(code === 403 ? '无公告管理权限' : '公告服务暂不可用', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '发布公告', exact: true }).isDisabled(), true)
      await page.screenshot({ path: `${output}/admin-${code}-${width}.png`, fullPage: true, animations: 'disabled' })
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    assert.deepEqual(errors, [])
    results.push({ width, errors, cases: ['admin-list', 'editor', '409-retains-content', 'retry-key', 'save', 'new-empty-form', '403', '503', 'no-overflow'] })
    await context.close()
  }
} finally {
  await writeFile(help, original)
  await browser.close()
}
await writeFile(`${output}/admin-results.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
