import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import logoutLanding from '../server/middleware/00-logout-landing.ts'

test('Enterprise post-logout landing goes directly to the fixed Console signed-out page', async () => {
  const prior = globalThis.useRuntimeConfig
  const priorFacade = process.env.HZY0_LOCAL_CONSOLE_FACADE
  process.env.HZY0_LOCAL_CONSOLE_FACADE = 'true'
  globalThis.useRuntimeConfig = () => ({ hzy: { consoleOidc: { logoutRedirectUri: 'https://hzy0.isme.dev/enterprise/login' }, consoleRuntime: { consoleApiUrl: 'https://hzy-test.huizhi.yun' } } })
  const app = createApp()
  app.use(logoutLanding)
  app.use(() => 'Enterprise login remains available')
  const server = createServer(toNodeListener(app))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const signedOut = await fetch(`${base}/enterprise/login?state=logged_out&redirect=https://attacker.example`, { redirect: 'manual' })
    assert.equal(signedOut.status, 302)
    assert.equal(signedOut.headers.get('location'), 'https://hzy0.isme.dev/console/login?logged_out=1&redirect=https%3A%2F%2Fhzy0.isme.dev%2Fenterprise')
    assert.equal(signedOut.headers.get('cache-control'), 'private, no-store')

    for (const path of ['/enterprise/login', '/enterprise/login?state=other', '/aims/login?state=logged_out']) {
      const response = await fetch(base + path, { redirect: 'manual' })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'Enterprise login remains available')
    }
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    if (prior === undefined) delete globalThis.useRuntimeConfig
    else globalThis.useRuntimeConfig = prior
    if (priorFacade === undefined) delete process.env.HZY0_LOCAL_CONSOLE_FACADE
    else process.env.HZY0_LOCAL_CONSOLE_FACADE = priorFacade
  }
})
