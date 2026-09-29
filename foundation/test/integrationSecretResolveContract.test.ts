import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

test('Foundation resolves integration secrets by integration code, not a browser-visible secret reference', () => {
  const path = fileURLToPath(new URL('../server/utils/integrationConfig.ts', import.meta.url))
  const source = readFileSync(path, 'utf8')
  const resolver = source.slice(source.indexOf('export async function resolveIntegrationSecret'))
  const nextExport = resolver.indexOf('export async function getIntegrationRuntimeConfig')
  const body = resolver.slice(0, nextExport)

  assert.match(body, /service\/integrations\/\$\{encodeURIComponent\(input\.integrationCode\)\}\/resolve/)
  assert.match(source, /serviceTokenSourceBinding: 'service-client-policy'/)
  assert.match(source, /capabilityFormat: 'console-integration'/)
  assert.doesNotMatch(body, /secretRef: credential\.secretRef/)
  assert.doesNotMatch(body, /purpose: input\.purpose/)
  assert.doesNotMatch(body, /\/api\/v1\/console\/vault\/resolve/)
})
