import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

test('Workflow callback delivery uses the tenant gateway route and event-bound service identity', () => {
  const source = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
  const sender = source.slice(source.indexOf('async function sendRuntimeCallbacks'))

  assert.match(sender, /resolveServiceAppBaseUrl\(event, appCode\)/)
  assert.match(sender, /!url\.startsWith\('\/'\)/)
  assert.match(sender, /url\.startsWith\('\/\/'\)/)
  assert.match(sender, /baseUrl\.replace\(\/\\\/\+\$\/, ''\)/)
  assert.match(sender, /url\.replace\(\/\^\\\/\+\/, ''\)/)
  assert.match(sender, /requestServiceAccessToken\(\{[\s\S]*audience: appCode,[\s\S]*scope: 'workflow:callback',[\s\S]*event[\s\S]*\}\)/)
  assert.match(sender, /tenantGatewayServiceBinding\(event\)/)
  assert.match(sender, /gatewayBinding\.fetch\(callbackUrl/)
  assert.match(sender, /body: JSON\.stringify\(payload\)/)
  assert.match(sender, /\$fetch\(callbackUrl/)
  assert.doesNotMatch(sender, /\$fetch\(url/)
  assert.doesNotMatch(sender, /new URL\(url/)
  assert.doesNotMatch(sender, /directTarget: true/)
  assert.doesNotMatch(sender, /trustedServiceRequestHeaders/)
})

test('Workflow Cloudflare deployment binds the tenant gateway for background callbacks', () => {
  const renderer = readFileSync(new URL('../scripts/render-cloudflare-config.mjs', import.meta.url), 'utf8')
  assert.match(renderer, /binding: 'HZY_TENANT_GATEWAY_SERVICE'/)
  assert.match(renderer, /'hzy-tenant-gateway'/)
})
