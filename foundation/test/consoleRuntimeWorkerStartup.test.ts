import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const source = stripTypeScriptTypes(readFileSync(new URL('../server/plugins/console-runtime.ts', import.meta.url), 'utf8'))
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+'/, '')
  .replace('export default', 'globalThis.plugin =')

test('Worker startup performs no runtime discovery, fetch or timer; Node retains prefetch', async () => {
  for (const env of [{ HZY_CLOUDFLARE_BUILD: 'true' }, { HZY_CLOUDFLARE_RUNTIME: 'true' }, {}]) {
    let reads = 0
    let fetches = 0
    const context = {
      process: { env }, console: { info() {}, warn() {} }, defineNitroPlugin: (fn: unknown) => fn,
      resolveConsoleRuntimeSeedConfig() {
        reads++
        return { enabled: true, appCode: 'people', consoleApiUrl: 'https://console.test' }
      },
      async getConsoleRuntimeConfig() {
        fetches++
        return { app: { appCode: 'people' }, console: { baseUrl: 'https://console.test' } }
      },
      plugin: undefined as (() => Promise<void>) | undefined
    }
    runInNewContext(source, context)
    await context.plugin!()
    assert.equal(reads, Object.keys(env).length ? 0 : 1)
    assert.equal(fetches, Object.keys(env).length ? 0 : 1)
  }
})
