// Local synthetic acceptance: all business APIs mocked;
// block external egress.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { visualResponse } from '../fixtures/w3-visual-data.mjs'

const { chromium } = await import(process.env.FEEDBACK_PLAYWRIGHT_MODULE || 'playwright-chromium')
const origin = process.env.FEEDBACK_ORIGIN || 'http://127.0.0.1:3451'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error('Loopback required')
const output = '/tmp/astra-feedback-media-visual'
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
          writes.push({ path: url.pathname, key: req.headers()['idempotency-key'], body: req.headers()['content-type'] === 'image/png' ? { binary: true } : req.postDataJSON() })
        if (url.pathname.endsWith('/options')) {
          status = failOptions || 200
          data = { data: { enabled: true, mediaEnabled: true } }
        } else if (url.pathname.includes('/attachments/')) {
          data = { data: { id: 'image', status: 'staged' } }
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
    await button.waitFor({ timeout: 60000 }).catch(async (error) => {
      await page.screenshot({ path: `${output}/unavailable-${width}.png` })
      throw new Error(`${error.message}; page errors: ${errors.join('; ')}`)
    })
    for (const status of [403, 503]) {
      failOptions = status
      await button.click()
      const dialog = page.getByRole('dialog')
      await dialog.getByText(status === 403 ? '当前账号没有反馈权限，请联系系统管理员。' : '反馈服务暂不可用，内容已保留，请稍后重试。', { exact: true }).waitFor()
      await page.screenshot({ animations: 'disabled', path: `${output}/options-${status}-${width}.png` })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
    }
    failOptions = 0
    await button.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: /^标题/ }).fill('项目文档保存失败（合成测试）')
    await dialog.getByRole('textbox', { name: /^描述/ }).fill('点击保存后显示失败，希望能看到重试入口。')
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 240
      c.height = 160
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 240, 160)
      ctx.fillStyle = '#f00'
      ctx.fillRect(40, 40, 100, 70)
      return c.toDataURL().split(',')[1]
    })
    await dialog.getByLabel('上传反馈图片').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    const canvas = dialog.locator('canvas')
    await canvas.waitFor()
    await page.waitForFunction(() => document.querySelector('canvas[aria-label]')?.width === 240)
    const box = await canvas.boundingBox()
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8)
    await page.mouse.up()
    const pixel = await canvas.evaluate(c => [...c.getContext('2d').getImageData(60, 60, 1, 1).data])
    assert.deepEqual(pixel, [0, 0, 0, 255])
    assert.equal(writes.length, 0, 'preview has no upload')
    await page.screenshot({ animations: 'disabled', path: `${output}/editor-${width}.png` })
    await dialog.getByRole('button', { name: '确认附带', exact: true }).click()
    assert.equal(writes.length, 0, 'confirm is still local')
    await page.evaluate(() => {
      const secret = document.createElement('div')
      secret.dataset.feedbackPrivate = ''
      secret.style.cssText = 'position:fixed;left:20px;top:110px;width:120px;height:40px;background:#f00;z-index:1000'
      secret.textContent = 'PRIVATE_FIXTURE'
      document.body.append(secret)
      const longPage = document.createElement('div')
      longPage.style.height = '4000px'
      longPage.dataset.feedbackLongFixture = ''
      document.body.append(longPage)
    })
    await dialog.getByRole('button', { name: '自动截图当前页', exact: true }).click()
    await page.getByRole('button', { name: '开始截图', exact: true }).click()
    await canvas.waitFor({ timeout: 30000 })
    await page.waitForFunction(() => document.querySelector('canvas[aria-label]')?.width > 0)
    const dimensions = await canvas.evaluate(c => [c.width, c.height])
    assert.deepEqual(dimensions, [width, 900], 'viewport only')
    assert.equal(writes.length, 0, 'capture has no upload')
    assert.deepEqual(await canvas.evaluate(c => [...c.getContext('2d').getImageData(40, 120, 1, 1).data]), [0, 0, 0, 255], 'private region is opaque')
    await page.evaluate(() => document.querySelector('[data-feedback-private][style]')?.remove())
    await page.screenshot({ animations: 'disabled', path: `${output}/capture-${width}.png` })
    await dialog.getByRole('button', { name: '取消这张图片', exact: true }).click()
    await page.evaluate(() => {
      document.querySelector('[data-feedback-private][style]')?.remove()
      document.querySelector('[data-feedback-long-fixture]')?.remove()
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async (options) => {
        if (options.audio !== false) throw Error('audio enabled')
        const c = document.createElement('canvas')
        c.width = 320
        c.height = 200
        c.getContext('2d').fillRect(0, 0, 320, 200)
        const stream = c.captureStream(1)
        window.__feedbackTracks = stream.getTracks()
        return stream
      } })
    })
    await dialog.getByRole('button', { name: '选择标签页截图', exact: true }).click()
    await canvas.waitFor({ timeout: 15000 })
    await page.waitForFunction(() => document.querySelector('canvas[aria-label]')?.width === 320)
    assert.equal(await page.evaluate(() => window.__feedbackTracks.every(t => t.readyState === 'ended')), true)
    await dialog.getByRole('button', { name: '取消这张图片', exact: true }).click()
    await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      throw Error('合成取消：未采集画面')
    } }))
    await dialog.getByRole('button', { name: '选择标签页截图', exact: true }).click()
    await dialog.getByText('合成取消：未采集画面', { exact: true }).waitFor()
    await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: undefined }))
    await dialog.getByRole('button', { name: '选择标签页截图', exact: true }).click()
    await dialog.getByText('当前浏览器不支持标签页截图，请粘贴或上传。', { exact: true }).waitFor()
    await page.evaluate((png) => {
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'paste.png', { type: 'image/png' }))
      document.querySelector('[data-feedback-ui]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, png)
    await canvas.waitFor()
    await page.waitForFunction(() => document.querySelector('canvas[aria-label]')?.width === 240)
    assert.equal(writes.length, 0, 'paste is local')
    await dialog.getByRole('button', { name: '取消这张图片', exact: true }).click()
    assert.equal(await dialog.getByRole('checkbox', { name: '附带浏览器信息' }).isChecked(), false)
    await page.screenshot({ animations: 'disabled', path: `${output}/form-${width}.png` })
    await dialog.getByRole('button', { name: '提交反馈', exact: true }).click()
    await dialog.getByText('反馈服务暂不可用，内容已保留，请稍后重试。').waitFor()
    failSubmit = 409
    await dialog.getByRole('button', { name: '重试提交', exact: true }).click()
    await dialog.getByText('这次提交状态已变化。请查看“我的反馈”，避免重复提交。').waitFor()
    await page.screenshot({ animations: 'disabled', path: `${output}/conflict-${width}.png` })
    failSubmit = 0
    await dialog.getByRole('button', { name: '重试提交', exact: true }).click()
    await dialog.getByText('反馈已受理', { exact: true }).waitFor()
    const submits = writes.filter(w => w.path.endsWith('/submit'))
    assert.equal(new Set(submits.map(w => w.key)).size, 1)
    assert.equal(writes.filter(w => w.path.endsWith('/drafts')).length, 1)
    assert.ok(!JSON.stringify(writes[0].body).includes('browser'))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    assert.deepEqual(errors, [])
    await page.screenshot({ animations: 'disabled', path: `${output}/accepted-${width}.png` })
    results.push({ width, flattenedMask: true, localPreview: true, viewportCapture: true, privateMask: true, nativeTracksStopped: true, stableIntent: true, noOverflow: true, noPageErrors: true })
    await context.close()
  }
} finally {
  await browser.close()
}
await writeFile(`${output}/result.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
