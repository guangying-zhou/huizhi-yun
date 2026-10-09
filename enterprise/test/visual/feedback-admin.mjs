import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'

const { chromium } = await import(process.env.FEEDBACK_PLAYWRIGHT_MODULE || 'playwright-chromium')
const origin = process.env.FEEDBACK_ORIGIN || 'http://127.0.0.1:3451'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('Loopback required')
const path = new URL('../../app/pages/enterprise/feedback/index.vue', import.meta.url)
const original = await readFile(path, 'utf8')
const output = '/tmp/astra-feedback-visual'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  await writeFile(path, `<script setup lang="ts">\nimport FeedbackAdmin from '../../../../../console/app/pages/admin/feedback.vue'\ndefinePageMeta({ navigationOwner: 'console', name: 'console-host-feedback-list' })\n</script>\n<template><FeedbackAdmin /></template>\n`)
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((k, i) => ({ name: 'hzy_enterprise_' + k, value: ['fixture', 'FIXTURE', 'fixture', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const settings = { enabled: false, integrationCode: 'gitlab.default', project: 'huizhi-yun/huizhiyun', publicUrl: 'https://aidcp.wiztek.cn', wecomIntegrationCode: 'wecom.default', recipientUids: [], recipientRoleCodes: ['system_admin'], labels: {}, revision: 1 }
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.includes('/api/') || url.pathname.includes('_nuxt_icon')) return route.continue()
      let data
      if (url.pathname === '/api/v1/console/feedback-settings') data = { data: settings }
      else if (url.pathname === '/api/v1/console/feedback') data = { data: { items: [], total: 0 } }
      else {
        try {
          data = visualResponse(url, req.method(), undefined, { 'feedback': ['view', 'admin', 'retry'], 'feedback-settings': ['view', 'edit'] }, [])
        } catch {
          data = { code: 0, data: { items: [], total: 0 } }
        }
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(origin + '/enterprise/feedback', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByRole('button', { name: '反馈配置', exact: true }).click({ timeout: 60000 })
    await page.getByRole('textbox', { name: 'GitLab 集成代码', exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '目标项目', exact: true }).inputValue(), 'huizhi-yun/huizhiyun')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${output}/admin-${width}.png`, fullPage: true, animations: 'disabled' })
    await context.close()
  }
} finally {
  await writeFile(path, original)
  await browser.close()
}
console.log('Console actual SFC: 1440/390 passed with synthetic API responses')
