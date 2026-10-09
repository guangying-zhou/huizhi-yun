import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PIN_PLAYWRIGHT_MODULE || '/tmp/w3-visual-tools/node_modules/playwright/index.mjs')
const root = new URL('../../', import.meta.url)
const target = new URL('app/pages/index.vue', root)
const original = await readFile(target, 'utf8')
const configuration = new URL('nuxt.config.ts', root)
const originalConfiguration = await readFile(configuration, 'utf8')
const out = '/tmp/astra-env-pins-visual'
await mkdir(out, { recursive: true })
await writeFile(`${out}/empty.env`, '')
let dev
let browser
try {
  await writeFile(configuration, originalConfiguration.replace('nitro: {', `nitro: { externals: { inline: [${JSON.stringify(new URL('../deploy/self-hosted/cutover/', root).pathname)}] },`))
  await writeFile(target, '<script setup lang="ts">definePageMeta({ layout: false })</script><template><main class="p-4"><EnvironmentAppReleases tenant-code="T" /></main></template>')
  const log = openSync(`${out}/dev.log`, 'w')
  dev = spawn(new URL('node_modules/.bin/nuxt', root).pathname, ['dev', '--host', '127.0.0.1', '--port', '3452', '--dotenv', `${out}/empty.env`], { cwd: root, env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'isolated_visual_no_database', NUXT_DB_HOST: '127.0.0.1', NUXT_DB_PORT: '1', NUXT_DB_NAME: 'isolated_visual_no_database', NUXT_DEVTOOLS: 'false', NUXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', log, log], detached: true })
  closeSync(log)
  let ready = false
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch('http://127.0.0.1:3452/', { signal: AbortSignal.timeout(2000) })
      if (response.ok) {
        ready = true
        break
      } else if (i % 20 === 0) console.log(response.status, (await response.text()).slice(0, 800))
    } catch { /* startup */ }
    await delay(500)
  }
  assert.ok(ready, 'local isolated UI harness starts')
  browser = await chromium.launch({ headless: true })
  const results = []
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let writes = 0
    let status = 200
    let revision = 1
    let pins = [{ appCode: 'console', releaseId: 1 }, { appCode: 'finance', releaseId: 2 }]
    const releases = [{ id: 1, appCode: 'console', sourceTag: 'console/v0.2.2' }, { id: 3, appCode: 'console', sourceTag: 'console/v0.2.3' }, { id: 2, appCode: 'finance', sourceTag: 'finance/v0.1.0' }]
    const selection = (chosen = pins) => ({ revision, sourceBundleId: 40, sourceBundleHash: 'sha256_fixture', sourcePolicyRevision: 39, pins: chosen, releases: chosen.map(pin => releases.find(r => r.id === pin.releaseId)) })
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.hostname !== '127.0.0.1') return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (!url.pathname.includes('/app-releases')) return route.fulfill({ json: { success: true, data: {} } })
      const method = route.request().method()
      if (method === 'PUT') {
        writes++
        if (status !== 200) return route.fulfill({ status, json: { message: status === 409 ? '选择版本冲突，请刷新预览' : '失败' } })
        pins = route.request().postDataJSON().pins
        assert.equal(pins.find(p => p.appCode === 'finance').releaseId, 2)
        assert.equal(pins.find(p => p.appCode === 'console').releaseId, 3)
        revision++
        return route.fulfill({ json: { success: true, data: { revision } } })
      }
      if (status !== 200) return route.fulfill({ status, json: { message: '服务不可用' } })
      if (url.pathname.endsWith('/preview')) return route.fulfill({ json: { success: true, data: { expectedRevision: revision, selection: selection(route.request().postDataJSON().pins), comparedBundleId: 40, reviewHash: 'abc', sensitiveConfigurationChanged: false, diff: [{ field: 'manifestActions', removed: [], added: [{ appCode: 'console', resourceCode: 'announcements', action: 'view' }] }] } } })
      return route.fulfill({ json: { success: true, data: { selection: selection(), releases, audits: [] } } })
    })
    await page.goto('http://127.0.0.1:3452/')
    await page.getByRole('heading', { name: '环境应用版本' }).waitFor()
    await page.getByRole('combobox', { name: 'console 版本' }).click()
    await page.getByRole('option', { name: 'console/v0.2.3', exact: true }).click()
    await page.getByRole('button', { name: '只读预览差异' }).click()
    await page.getByText('manifestActions', { exact: false }).first().waitFor()
    assert.equal(writes, 0)
    assert.ok(await page.getByRole('button', { name: '保存环境版本选择' }).isDisabled())
    await page.getByLabel('变更理由').fill('仅升级 Console 公告')
    await page.getByRole('checkbox').check()
    status = 409
    await page.getByRole('button', { name: '保存环境版本选择' }).click()
    await page.getByText('选择版本冲突，请刷新预览').waitFor()
    status = 200
    await page.getByRole('button', { name: '只读预览差异' }).click()
    await page.getByRole('checkbox').check()
    await page.screenshot({ path: `${out}/preview-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: '保存环境版本选择' }).click()
    await page.getByText('选择修订 2', { exact: false }).waitFor()
    assert.equal(writes, 2)
    for (const failure of [403, 503]) {
      status = failure
      await page.getByRole('button', { name: '只读预览差异' }).click()
      await page.getByText(failure === 403 ? '没有此操作的运维权限。' : '服务不可用', { exact: true }).waitFor()
      status = 200
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.deepEqual(errors, [])
    results.push({ width, previewWrites: 0, confirmedSave: true, conflict409: true, errors403and503: true, noOverflow: true })
    await page.close()
  }
  await writeFile(`${out}/result.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally {
  await browser?.close()
  if (dev?.pid) {
    try {
      process.kill(-dev.pid, 'SIGTERM')
    } catch { /* already stopped */ }
  }
  await writeFile(configuration, originalConfiguration.replace('nitro: {', `nitro: { externals: { inline: [${JSON.stringify(new URL('../deploy/self-hosted/cutover/', root).pathname)}] },`))
  await writeFile(target, original)
  await writeFile(configuration, originalConfiguration)
}
