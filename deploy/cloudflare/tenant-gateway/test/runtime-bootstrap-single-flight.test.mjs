import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRuntimeBootstrapToken } from '../src/index.js'

let nextTenant = 0
function fixture(overrides = {}) {
  const tenantCode = `singleflight-${++nextTenant}`
  return {
    env: { HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve', HZY_CLOUDFLARE_INTERNAL_TOKEN: 'fixture-secret', ...overrides.env },
    tenant: { tenantCode, environment: 'test', dataRuntime: { endpoint: 'https://runtime.example.test', runtimeCode: 'runtime-one', audience: 'data-runtime' },
      apps: { console: { deploymentCode: `${tenantCode}-console` } }, ...overrides.tenant }
  }
}
function response(token, lifetimeMs = 90_000) {
  return Response.json({ data: { token, expiresAt: new Date(Date.now() + lifetimeMs).toISOString() } })
}

test('cold and near-expiry callers share one bound refresh, then use the cached token', async () => {
  const { env, tenant } = fixture()
  let calls = 0
  let release
  const fetchImpl = () => {
    calls++
    return new Promise(resolve => { release = () => resolve(response(`token-${calls}`)) })
  }
  const first = Array.from({ length: 6 }, () => resolveRuntimeBootstrapToken(env, tenant, fetchImpl, 45_000))
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await Promise.all(first), Array(6).fill('token-1'))
  assert.deepEqual(await Promise.all(Array.from({ length: 6 }, () => resolveRuntimeBootstrapToken(env, tenant, fetchImpl, 45_000))), Array(6).fill('token-1'))
  assert.equal(calls, 1)
  const second = Array.from({ length: 6 }, () => resolveRuntimeBootstrapToken(env, tenant, fetchImpl, 95_000))
  assert.equal(calls, 2)
  release()
  await assert.rejects(Promise.all(second), /too short-lived/)
  assert.equal(calls, 2)
})

test('callers independently enforce their minimum validity after a shared refresh', async () => {
  const { env, tenant } = fixture()
  let calls = 0
  let release
  const fetchImpl = () => {
    calls++
    return new Promise(resolve => { release = () => resolve(response('shared', 60_000)) })
  }
  const short = resolveRuntimeBootstrapToken(env, tenant, fetchImpl, 15_000)
  const long = resolveRuntimeBootstrapToken(env, tenant, fetchImpl, 75_000)
  assert.equal(calls, 1)
  release()
  assert.equal(await short, 'shared')
  await assert.rejects(long, /too short-lived/)
})

test('failed refresh is not cached and bindings do not share a pending token', async () => {
  const { env, tenant } = fixture()
  let calls = 0
  let release
  const fetchImpl = () => {
    calls++
    return new Promise(resolve => { release = () => resolve(Response.json({}, { status: 503 })) })
  }
  const failures = Array.from({ length: 3 }, () => resolveRuntimeBootstrapToken(env, tenant, fetchImpl))
  assert.equal(calls, 1)
  release()
  await Promise.all(failures.map(promise => assert.rejects(promise, /503/)))
  const recovered = await resolveRuntimeBootstrapToken(env, tenant, () => { calls++; return response('recovered') })
  assert.equal(recovered, 'recovered')
  assert.equal(calls, 2)
  const otherEnv = { ...env, HZY_CLOUDFLARE_INTERNAL_TOKEN: 'other-fixture-secret' }
  const other = await resolveRuntimeBootstrapToken(otherEnv, tenant, () => { calls++; return response('other') })
  assert.equal(other, 'other')
  assert.equal(calls, 3)
  const otherRuntime = { ...tenant, dataRuntime: { ...tenant.dataRuntime, runtimeCode: 'runtime-two' } }
  const runtimeToken = await resolveRuntimeBootstrapToken(env, otherRuntime, () => { calls++; return response('runtime-two') })
  assert.equal(runtimeToken, 'runtime-two')
  assert.equal(calls, 4)
})

test('aborting one caller does not cancel another caller sharing the bounded refresh', async () => {
  const { env, tenant } = fixture()
  const controller = new AbortController()
  let calls = 0
  let release
  const fetchImpl = () => {
    calls++
    return new Promise(resolve => { release = () => resolve(response('remaining-caller')) })
  }
  const abandoned = resolveRuntimeBootstrapToken(env, tenant, fetchImpl, 15_000, controller.signal)
  const remaining = resolveRuntimeBootstrapToken(env, tenant, fetchImpl, 15_000)
  controller.abort()
  await assert.rejects(abandoned, { name: 'AbortError' })
  assert.equal(calls, 1)
  release()
  assert.equal(await remaining, 'remaining-caller')
})

test('tenant, environment, deployment, endpoint, audience and registry source all partition the token', async () => {
  const { env, tenant } = fixture()
  let calls = 0
  const fetchImpl = () => response(`partition-${++calls}`)
  const variants = [
    [env, tenant],
    [env, { ...tenant, tenantCode: `${tenant.tenantCode}-other` }],
    [env, { ...tenant, environment: 'other' }],
    [env, { ...tenant, apps: { console: { deploymentCode: 'other-console' } } }],
    [env, { ...tenant, dataRuntime: { ...tenant.dataRuntime, endpoint: 'https://other-runtime.example.test' } }],
    [env, { ...tenant, dataRuntime: { ...tenant.dataRuntime, audience: 'other-audience' } }],
    [{ ...env, HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://other-platform.example.test/api/resolve' }, tenant]
  ]
  for (const [boundEnv, boundTenant] of variants) {
    const token = await resolveRuntimeBootstrapToken(boundEnv, boundTenant, fetchImpl)
    assert.equal(token, `partition-${calls}`)
  }
  assert.equal(calls, variants.length)
})
