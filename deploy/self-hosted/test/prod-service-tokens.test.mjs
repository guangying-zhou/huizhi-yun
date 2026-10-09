import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertServiceTokenClaims, collabNegativeProbeMatrix, negativeProbeMatrix, prodProbeMatrix, runProdProbe } from '../probe-prod-service-tokens.mjs'

const bindings = { tenant: 'C000001', deployments: {
  enterprise: 'C000001-prod-enterprise', workflow: 'C000001-workflow',
  aims: 'C000001-aims', codocs: 'C000001-codocs', console: 'C000001-console' } }
const token = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`

test('G-7 production probe includes both company-summary delivery hops', () => {
  const matrix = prodProbeMatrix(bindings)
  assert.equal(matrix.filter(row => row.expected === 200).length, 21)
  assert.ok(matrix.some(row => row.client === 'aims.runtime' && row.audience === 'codocs' && row.scope === 'codocs:company-weekly-summary:publish'))
  assert.ok(matrix.some(row => row.client === 'codocs.runtime' && row.audience === 'data-runtime' && row.scope === 'codocs.write'))
  for (const scope of ['integration_config:view', 'credential_vault:resolve']) {
    assert.ok(matrix.some(row => row.client === 'codocs.runtime' && row.audience === 'data-runtime' && row.scope === scope))
    assert.equal(negativeProbeMatrix(bindings).filter(row => row.scope === scope && row.case.startsWith('codocs-oss-')).length, 3)
  }
  assert.ok(matrix.some(row => row.client === 'enterprise.runtime' && row.audience === 'console' && row.scope === 'console:authorization-role-holders:read' && row.expected === 200))
  assert.equal(matrix.filter(row => row.expected === 403).length, 1)
  assert.deepEqual(new Set(matrix.filter(row => row.client === 'workflow.runtime').map(row => row.audience)), new Set(['data-runtime', 'tenant-runtime']))
  assert.deepEqual(new Set(matrix.filter(row => row.client === 'aims.runtime' && row.expected === 200).map(row => row.audience)), new Set(['data-runtime', 'tenant-runtime', 'codocs']))
  assert.equal(negativeProbeMatrix(bindings).filter(row => row.case === 'v2.28-revoked').length, 344)
  assert.equal(negativeProbeMatrix(bindings).filter(row => row.case.startsWith('summary-')).length, 4)
})

test('claims must bind audience, scope, source, tenant, deployment and expiry', () => {
  const item = prodProbeMatrix(bindings)[0]
  const claims = { token_use: 'service', aud: item.audience, scope: item.scope, source_app: item.app, tenant: bindings.tenant,
    deployment: item.deployment, exp: 2_000_000_000 }
  assert.equal(assertServiceTokenClaims(token(claims), item, bindings.tenant), true)
  for (const [field, value] of Object.entries({ token_use: 'user', aud: 'wrong', scope: 'wrong', source_app: 'wrong', tenant: 'C999999', deployment: 'wrong', exp: 1 }))
    assert.throws(() => assertServiceTokenClaims(token({ ...claims, [field]: value }), item, bindings.tenant))
})

test('negative issuance and every revoked legacy scope must fail without returning a token', async () => {
  let count = 0
  const logged = []
  const result = await runProdProbe(async item => {
    count++
    if (item.expected === 403) return { status: 403, json: async () => { throw Error('denied body must not be read') } }
    return { status: 200, json: async () => ({ access_token: token({ token_use: 'service', aud: item.audience, scope: item.scope,
      source_app: item.app, tenant: bindings.tenant, deployment: item.deployment, exp: 2_000_000_000 }) }) }
  }, bindings, line => logged.push(JSON.parse(line)), async () => ({ status: 401 }))
  assert.deepEqual(result, { positives: 21, denied: 360, expired: 1 })
  assert.equal(count, 381)
  assert.equal(logged.length, count + 1)
  assert.ok(logged.every(row => !('access_token' in row)))
})

test('expired service token accepted by the target fails the probe', async () => {
  await assert.rejects(runProdProbe(async item => item.expected === 403 ? { status: 403 }
    : { status: 200, json: async () => ({ access_token: token({ token_use: 'service', aud: item.audience,
        scope: item.scope, source_app: item.app, tenant: bindings.tenant, deployment: item.deployment, exp: 2_000_000_000 }) }) },
  bindings, () => {}, async () => ({ status: 200 })), /PROBE_EXPIRED_TOKEN_ACCEPTED/)
})

const collabBindings = { ...bindings, deployments: { ...bindings.deployments, collab: 'C000001-collab' } }

test('collab.runtime adds exactly its two grants as positives and a bounded negative matrix', () => {
  const matrix = prodProbeMatrix(collabBindings)
  const positives = matrix.filter(row => row.client === 'collab.runtime')
  assert.deepEqual(positives.map(row => [row.app, row.audience, row.scope, row.deployment, row.expected]), [
    ['collab', 'data-runtime', 'codocs:collaboration-snapshots:read', 'C000001-collab', 200],
    ['collab', 'data-runtime', 'codocs:collaboration-snapshots:publish', 'C000001-collab', 200]
  ])
  assert.equal(matrix.filter(row => row.expected === 200).length, 23)
  const negatives = collabNegativeProbeMatrix(collabBindings)
  assert.equal(negatives.length, 15)
  assert.ok(negatives.every(row => row.expected === 403))
  for (const kind of ['wrong-audience-console', 'wrong-audience-tenant-runtime', 'wrong-source-app', 'wrong-deployment', 'wrong-tenant']) {
    assert.equal(negatives.filter(row => row.case === `collab-${kind}`).length, 2, kind)
  }
  assert.equal(negatives.filter(row => row.case === 'enterprise-cannot-hold-collab-scope').length, 2)
  assert.ok(negatives.some(row => row.case === 'collab-host-delegation-denied' && row.scope === 'codocs:enterprise-host:execute'))
  assert.deepEqual(collabNegativeProbeMatrix(bindings), [], 'no collab cases without a collab binding')
  assert.equal(matrix.filter(row => row.client === 'collab.runtime').length, 2)
})

test('full collab probe: 23 positives, every negative denied without a token, expired token rejected', async () => {
  const seen = []
  const result = await runProdProbe(async item => {
    seen.push(item)
    if (item.expected === 403) return { status: 403, json: async () => { throw Error('denied body must not be read') } }
    return { status: 200, json: async () => ({ access_token: token({ token_use: 'service', aud: item.audience, scope: item.scope,
      source_app: item.app, tenant: bindings.tenant, deployment: item.deployment, exp: 2_000_000_000 }) }) }
  }, collabBindings, () => {}, async () => ({ status: 401 }))
  assert.deepEqual(result, { positives: 23, denied: 375, expired: 1 })
  assert.equal(seen.length, 398)
  // A collab token whose deployment or audience deviates must fail the claim check.
  await assert.rejects(runProdProbe(async item => item.expected === 403 ? { status: 403 }
    : { status: 200, json: async () => ({ access_token: token({ token_use: 'service', aud: item.audience, scope: item.scope,
        source_app: item.app, tenant: bindings.tenant, deployment: item.client === 'collab.runtime' ? 'C000001-test-collab' : item.deployment, exp: 2_000_000_000 }) }) },
  collabBindings, () => {}, async () => ({ status: 401 })))
  // A Collab scope that unexpectedly issues fails closed.
  await assert.rejects(runProdProbe(async item => ({ status: 200, json: async () => ({ access_token: token({ token_use: 'service', aud: item.audience,
    scope: item.scope, source_app: item.app, tenant: bindings.tenant, deployment: item.deployment, exp: 2_000_000_000 }) }) }),
  collabBindings, () => {}, async () => ({ status: 401 })), /PROBE_STATUS_MISMATCH/)
})

 test('P1 typed document calls do not restore the retired Aims HTTP grant family', () => {
  const scopes = prodProbeMatrix(bindings).filter(row => row.client === 'enterprise.runtime').map(row => row.scope)
  assert.deepEqual(scopes.filter(scope => scope.endsWith(':enterprise-host:execute')),
    ['aims', 'assets', 'codocs', 'altoc', 'console'].map(domain => `${domain}:enterprise-host:execute`))
  assert.ok(!scopes.some(scope => scope.startsWith('aims:project-document')))
})
