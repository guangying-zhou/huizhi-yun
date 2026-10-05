import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))

function source(path: string) {
  return readFileSync(new URL(path, `file://${root}/`), 'utf8')
}

describe('integration secret resolve authorization', () => {
  test('binds a service caller to a granted integration and its active credential', () => {
    const runtime = readFileSync(
      new URL('../../data-runtime/internal/apps/console/integrations.go', import.meta.url),
      'utf8'
    )
    const resolver = runtime.slice(runtime.indexOf('func (a *Adapter) ResolveServiceIntegrationCredential'))

    assert.match(runtime, /SELECT CAST\(scg\.scope_json AS CHAR\)/)
    assert.match(runtime, /\(sc\.client_code=\? OR scc\.client_id=\?\)/)
    assert.match(runtime, /AND sc\.app_code=\?/)
    assert.match(runtime, /integrationCodes/)
    assert.match(resolver, /"credential_vault", "resolve"/)
    assert.match(resolver, /ic\.id=i\.current_credential_id/)
    assert.match(resolver, /bound_v\.id=ic\.secret_version_id/)
    assert.match(resolver, /usageType != "integration"/)
    assert.match(resolver, /ownerKey\.String != code/)
    assert.match(resolver, /Reason:\s+"integration_resolve:" \+ code/)
  })

  test('resolve API never accepts a caller-chosen secret, version, or purpose', () => {
    const foundation = readFileSync(
      new URL('../../foundation/server/utils/integrationConfig.ts', import.meta.url),
      'utf8'
    )
    const runtimeRoute = readFileSync(
      new URL('../../data-runtime/internal/server/server.go', import.meta.url),
      'utf8'
    )
    const legacyRoute = source('server/api/v1/console/vault/resolve.post.ts')

    assert.match(foundation, /\/v1\/console\/service\/integrations\/\$\{encodeURIComponent\(input\.integrationCode\)\}\/resolve/)
    assert.match(foundation, /serviceTokenSourceBinding: 'service-client-policy'/)
    assert.match(runtimeRoute, /scope = "credential_vault:resolve"/)
    assert.match(legacyRoute, /statusCode: 410/)
    assert.doesNotMatch(legacyRoute, /readBody|resolveIntegrationSecretForService/)
  })

  test('service integration reads are filtered by the same executable grant allowlist', () => {
    const foundation = readFileSync(
      new URL('../../foundation/server/utils/integrationConfig.ts', import.meta.url),
      'utf8'
    )
    const runtime = readFileSync(
      new URL('../../data-runtime/internal/apps/console/integrations.go', import.meta.url),
      'utf8'
    )
    const listRoute = source('server/api/v1/console/integrations/index.get.ts')
    const detailRoute = source('server/api/v1/console/integrations/[integrationCode].get.ts')

    assert.match(foundation, /\/v1\/console\/service\/integrations\/\$\{encodeURIComponent\(code\)\}/)
    assert.match(runtime, /func \(a \*Adapter\) GetServiceIntegration/)
    assert.match(runtime, /"integration_config", "view"/)
    assert.match(listRoute, /actor\.actorType === 'service'[\s\S]*statusCode: 410/)
    assert.match(detailRoute, /actor\.actorType === 'service'[\s\S]*statusCode: 410/)
  })

  test('service integration grants accept stable clientCode and legacy credential client_id identities', () => {
    const runtime = readFileSync(
      new URL('../../data-runtime/internal/apps/console/integrations.go', import.meta.url),
      'utf8'
    )

    assert.match(
      runtime,
      /WHERE \(sc\.client_code=\? OR scc\.client_id=\?\)[\s\S]*AND sc\.app_code=\?/
    )
    assert.match(
      runtime,
      /actorID, actorID, appCode, resourceCode, action/
    )
  })
})

test('Codocs OSS grants bind both integration config and vault access to oss.default', () => {
  const seed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-v1.55-codocs-oss-integration-grants.sql', import.meta.url), 'utf8')

  assert.match(seed, /sc\.`app_code` = 'codocs'/)
  assert.match(seed, /'integration_config',[\s\S]*?'view'/)
  assert.match(seed, /'credential_vault',[\s\S]*?'resolve'/)
  assert.match(seed, /'usageTypes', JSON_ARRAY\('integration'\)/)
  assert.equal((seed.match(/'integrationCodes', JSON_ARRAY\('oss\.default'\)/g) || []).length, 4)
})
