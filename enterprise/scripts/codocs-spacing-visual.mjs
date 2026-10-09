// Credential-free local Enterprise fixture only;
// All API requests are intercepted.
// Start an isolated dev process on 127.0.0.1:3469;
// Never point this at a tenant.
import { visualResponse } from '../test/fixtures/w3-visual-data.mjs'
import codocs from '../../codocs/layer/entry.mjs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const origin = 'http://127.0.0.1:3469', output = process.env.CODOCS_SPACING_OUTPUT || '/tmp/codocs-spacing-visual'
await mkdir(output, { recursive: true, mode: 0o700 })
const nav = await readFile(new URL('../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const ids = [...nav.matchAll(/"id": "([^"]+)"/g)].map(m => m[1])
const departments = [{ id: 1, deptCode: 'D1', name: '合成研发部门' }, { id: 2, deptCode: 'D2', name: '合成设计部门' }]
const browser = await chromium.launch({ headless: true }), results = []
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((k, i) => ({ name: 'hzy_enterprise_' + k, value: ['fixture-user', 'FIXTURE', 'fixture-user', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][i], url: origin })))
    const page = await context.newPage(), errors = [], warnings = [], requests = [], vueUrls = new Set()
    page.setDefaultTimeout(15000)
    page.setDefaultNavigationTimeout(60000)
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
      if (m.type() === 'warning' && /injection|definePageMeta|onScopeDispose/i.test(m.text())) warnings.push(m.text())
    })
    await page.route('**/*', async (r) => {
      const req = r.request(), url = new URL(req.url())
      if (url.origin !== origin) return r.abort()
      if (url.pathname.endsWith('/vue.runtime.esm-bundler.js'))vueUrls.add(url.href)
      if (!/^\/(?:enterprise\/api|codocs\/api|altoc\/api|api|aims\/api)(?:\/|$)/.test(url.pathname) || url.pathname.includes('_nuxt_icon')) return r.continue()
      let result
      const p = url.pathname
      if (p.endsWith('/directory/departments'))result = { code: 0, data: { tree: departments, flat: departments } }
      else if (p.endsWith('/collab-docs')) {
        requests.push(url.searchParams.get('sharedTab'))
        const sent = url.searchParams.get('sharedTab') === 'sent'
        result = { code: 0, data: { items: [{ uuid: '11111111-1111-4111-8111-111111111111', title: sent ? '合成我共享的文档' : '合成共享给我的文档', docType: 'private', ownerUid: 'fixture-user', deptCode: 'D1', readonly: false, docStatus: 0, published: false, ossPath: 'fixture', updatedAt: '2026-10-07', relationTypes: [], relationLabels: [], locationLabel: '合成部门' }], total: 1, page: Number(url.searchParams.get('page') || 1), pageSize: 20, ownerUids: ['fixture-user'], deptCodes: ['D1'] } }
      } else if (p.endsWith('/open-department-docs'))result = { success: true, data: { departments: [{ deptCode: 'D1', deptName: '合成研发部门', documentCount: 0, folders: [] }] } }
      else if (p.endsWith('/company-assets/list') || p.endsWith('/dept-assets/list'))result = { code: 0, data: { items: [], total: 0, page: 1, pageSize: 20 } }
      else if (p.endsWith('/folders'))result = { code: 0, data: { items: [], parentChain: [], total: 0, page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 20) } }
      else if (p.endsWith('/documents') || p.endsWith('/trash'))result = { code: 0, data: { items: [], total: 0, page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 20) } }
      else if (p.endsWith('/user-departments'))result = { code: 0, data: { departments, primaryDeptCode: 'D1' } }
      else if (/\/documents\/[a-f0-9-]+$/.test(p))result = { success: true, data: { content: '合成文档正文', readonly_flag: 0 } }
      else {
        try {
          result = visualResponse(url, req.method(), req.postData() ? JSON.parse(req.postData()) : undefined, { contract: ['view'], documents: ['view', 'edit'], company: ['view'], departments: ['view'] }, ids)
        } catch {
          requests.push(url.pathname)
          result = { code: 0, data: { items: [], total: 0, tree: [], flat: [], surfaces: [], entries: [] } }
        }
      }
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    })
    const paths = ['/altoc/contracts', ...codocs.pages.filter(p => !['document-editor', 'company-document', 'department-document', 'published-asset-short-link'].includes(p.name)).map(p => '/codocs' + p.path)]
    for (const path of paths) {
      errors.length = 0
      warnings.length = 0
      console.log('checking', width, path)
      await page.goto(origin + path)
      await page.locator('[data-host-page-title]').first().waitFor({ timeout: 90000 }).catch(async (error) => {
        console.log({ errors, body: await page.locator('body').innerText() })
        throw error
      })
      await page.waitForTimeout(500)
      const geometry = () => page.locator('[data-host-page-title]').first().evaluate((el) => {
        const host = el.closest('.host-page-container'), r = el.getBoundingClientRect(), h = host.getBoundingClientRect()
        return { inset: r.left - h.left, top: r.top - h.top, hostClasses: host.className, hostPadding: getComputedStyle(host).paddingLeft, overflow: document.documentElement.scrollWidth > innerWidth }
      })
      const after = await geometry()
      const name = path.split('/').filter(Boolean).join('-')
      await page.screenshot({ path: `${output}/${name}-${width}-after.png`, fullPage: true })
      const oldHostInset = after.hostClasses.split(' ').includes('p-0') ? 0 : width >= 640 ? 24 : 16
      const baseline = path.startsWith('/codocs') ? await page.addStyleTag({ content: `.host-page-container[data-page-app="codocs"] {padding:${oldHostInset}px!important} .host-page-container[data-page-app="codocs"] > [data-slot="root"] > header {padding:12px 16px!important} .host-page-container[data-page-app="codocs"] > [data-slot="root"] > .p-4:not([class*="sm:p-6"]) {padding:16px!important}` }) : null
      const before = await geometry()
      await page.screenshot({ path: `${output}/${name}-${width}-before.png`, fullPage: true })
      if (baseline) await baseline.evaluate(el => el.remove())
      results.push({ path, width, before, after, errors: [...errors], warnings: [...warnings] })
      assert.deepEqual(errors, [])
      assert.deepEqual(warnings, [])
      assert.equal(after.overflow, false)
      assert.equal(after.inset, width >= 640 ? 24 : 16, path)
    }
    await context.close()
  }
} finally {
  await browser.close()
  await writeFile(output + '/results.json', JSON.stringify(results, null, 2))
}
console.log(JSON.stringify(results))
