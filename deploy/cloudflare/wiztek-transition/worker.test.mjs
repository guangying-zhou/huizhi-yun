import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const index = await readFile(new URL('./index.html', import.meta.url), 'utf8')
const guide = await readFile(new URL('./employee-guide.html', import.meta.url), 'utf8')
const source = (await readFile(new URL('./worker.mjs', import.meta.url), 'utf8'))
  .replace("import index from './index.html'", `const index = ${JSON.stringify(index)}`)
  .replace("import guide from './employee-guide.html'", `const guide = ${JSON.stringify(guide)}`)
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default

test('transition preserves deep links and serves its packaged employee guide', async () => {
  for (const url of ['http://wiztek.huizhi.yun/', 'https://wiztek.huizhi.yun/aims/old-page']) {
    const response = await worker.fetch(new Request(url))
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.equal(html, index)
    assert.match(html, /href="https:\/\/aidcp\.wiztek\.cn"/)
    assert.match(html, /name="viewport"/)
  }
  assert.equal(await (await worker.fetch(new Request('https://wiztek.huizhi.yun/employee-guide.html'))).text(), guide)
  assert.equal(await (await worker.fetch(new Request('https://wiztek.huizhi.yun/', { method: 'HEAD' }))).text(), '')
  assert.equal((await worker.fetch(new Request('https://wiztek.huizhi.yun/', { method: 'POST' }))).status, 405)
})

test('deployment registers only the exact transition domain without old gateway bindings or cron', async () => {
  const config = JSON.parse(await readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'))
  assert.deepEqual(config.routes, [{ pattern: 'wiztek.huizhi.yun/*', zone_name: 'huizhi.yun' }])
  assert.equal(config.workers_dev, false)
  assert.equal(config.triggers, undefined)
  assert.equal(config.services, undefined)
})
