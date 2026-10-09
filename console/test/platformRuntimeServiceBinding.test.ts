import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('managed Console refreshes live Platform policy through a Worker Service Binding', () => {
  const render = read('scripts/render-cloudflare-config.mjs')
  const runtime = read('server/utils/platformRuntime.ts')
  const lifecycle = read('server/utils/platformLifecycleOperation.ts')

  assert.match(render, /binding: 'HZY_PLATFORM_SERVICE'/)
  assert.match(render, /service: value\('HZY_PLATFORM_WORKER_NAME', 'hzy-platform'\)/)
  assert.match(runtime, /getCloudflareEnv\(\)\.HZY_PLATFORM_SERVICE/)
  assert.match(runtime, /binding\.fetch\(target/)
  assert.match(runtime, /AbortSignal\.timeout/)
  assert.match(runtime, /return rawPlatformRuntimeFetch/)
  assert.match(lifecycle, /platformRuntimeFetch/)
  assert.doesNotMatch(lifecycle, /fetchExternal/)
})
