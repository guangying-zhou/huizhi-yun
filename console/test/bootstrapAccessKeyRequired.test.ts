import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const serviceClients = readFileSync(new URL('../server/utils/serviceClients.ts', import.meta.url), 'utf8')
const bootstrapRoute = readFileSync(new URL('../server/api/v1/console/bootstrap/token.post.ts', import.meta.url), 'utf8')
const runtimeBootstrap = readFileSync(new URL('../../data-runtime/internal/apps/console/auth_service_tokens.go', import.meta.url), 'utf8')

function bootstrapFunction() {
  const start = serviceClients.indexOf('export async function consumeBootstrapAccessKey')
  const end = serviceClients.indexOf('\nexport ', start + 1)
  assert.ok(start >= 0, 'bootstrap access-key consumer is required')
  return serviceClients.slice(start, end >= 0 ? end : undefined)
}

describe('legacy bootstrap token exchange', () => {
  test('rejects a missing access key before crossing the Tenant Runtime boundary', () => {
    const source = bootstrapFunction()

    assert.match(source, /if \(!accessKey\) \{[\s\S]*invalid_bootstrap: accessKey is required/)
    assert.ok(source.indexOf('!accessKey') < source.indexOf('consumeConsoleBootstrapAccessKey(input.event'))
  })

  test('Tenant Runtime validates the key against the exact deployment Vault secret', () => {
    assert.match(runtimeBootstrap, /"bootstrap\."\+deploymentCode\+"\.access_key"/)
    assert.match(runtimeBootstrap, /hmac\.Equal\(\[\]byte\(resolved\), \[\]byte\(accessKey\)\)/)
    assert.match(runtimeBootstrap, /if !valid \{[\s\S]*invalid_bootstrap/)
    assert.doesNotMatch(serviceClients, /queryVaultSecret|resolveVaultMaterial|vault_secret_versions/)
  })

  test('only a Runtime-verified key can reach service-client lookup and token issuance', () => {
    assert.ok(runtimeBootstrap.indexOf('if !valid {') < runtimeBootstrap.indexOf('loadActiveServiceClientForApp(ctx, appCode)'))
    assert.ok(bootstrapRoute.indexOf('await consumeBootstrapAccessKey({') < bootstrapRoute.indexOf('await issueServiceAccessToken({'))
  })

  test('does not return or audit the bootstrap access-key plaintext', () => {
    const successStart = bootstrapRoute.indexOf('setHeader(event, \'Cache-Control\', \'no-store\')')
    const successEnd = bootstrapRoute.indexOf('\n  } catch', successStart)
    assert.ok(successStart >= 0 && successEnd > successStart, 'bootstrap success response is required')
    assert.doesNotMatch(bootstrapRoute.slice(successStart, successEnd), /accessKey|secret(?:\.value)?/i)
    assert.match(bootstrapRoute, /tokenHash: body\?\.accessKey \? hashOpaqueValue\(stringValue\(body\.accessKey\)\) : null/)
    assert.doesNotMatch(bootstrapRoute, /console\.(?:log|info|warn|error)\([^\n]*accessKey/i)
  })
})
