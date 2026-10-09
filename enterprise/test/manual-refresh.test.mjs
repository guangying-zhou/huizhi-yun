import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { disableHmrTransport, MANUAL_HMR_MARKER } from '../composition/manual-refresh.mjs'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
test('manual HMR gate prevents transport connection while retaining CSS helpers', () => {
  const code = 'export function updateStyle() {}\ntransport.connect(createHMRHandler(handleMessage));'
  const output = disableHmrTransport(code, '/node_modules/vite/dist/client/client.mjs')
  assert.ok(output.includes(MANUAL_HMR_MARKER))
  assert.ok(output.includes('export function updateStyle'))
  assert.ok(!output.includes('transport.connect('))
  assert.equal(disableHmrTransport(code, '/some-app.ts'), null)
  assert.throws(() => disableHmrTransport('changed upstream', '/node_modules/vite/dist/client/client.mjs'), /manual refresh gate failed/)
})
test('hzy0 disables watchers, automatic chunk reload and business polling but retains session renewal', () => {
  const config = read('../nuxt.config.ts')
  assert.match(config, /hmr: false/)
  assert.match(config, /watch: null/)
  assert.match(config, /emitRouteChunkError: 'manual'/)
  assert.match(config, /checkOutdatedBuildInterval: false/)
  assert.match(config, /ignored: \(\) => true/)
  for (const file of ['../app/composables/useEnterpriseProjectObjectContext.ts', '../../foundation/app/components/NotificationBell.vue', '../../aims/app/pages/products/index.vue']) assert.match(read(file), /manualRefresh/)
  assert.doesNotMatch(read('../app/layouts/default.vue'), /refreshPage|刷新页面|window\.location\.reload/)
  assert.match(read('../app/plugins/manual-refresh.client.ts'), /onClick: \(\) => window.location.reload\(\)/)
  assert.match(read('../../foundation/app/plugins/console-oidc-renewal.client.ts'), /createOidcTokenRenewal/)
})
