import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeDialEndpoint, verifyRuntimeTransport, PINNED_RUNTIME_CANONICAL, PINNED_RUNTIME_DIAL } from '../runtime-transport.mjs'

const profile = () => ({ environment: 'test', runtime: {
  canonicalEndpoint: PINNED_RUNTIME_CANONICAL, transportMode: 'loopback', dialEndpoint: PINNED_RUNTIME_DIAL,
  expectedTenant: 'C000001', expectedRuntimeCode: 'c000001-test-tenant-runtime',
  expectedRuntimeDeployment: 'c000001-test-tenant-runtime', lifecycleManagedByThisStack: false,
  automaticFallback: false
} })
const health = () => ({ status: 'ok', runtimeProduct: 'hzy-data-runtime', tenant: 'C000001',
  deployment: 'c000001-test-tenant-runtime', version: 'test', commit: 'commit', builtAt: 'date' })

test('only the pinned loopback or canonical transport can be selected', () => {
  assert.equal(runtimeDialEndpoint(profile().runtime), PINNED_RUNTIME_DIAL)
  assert.equal(runtimeDialEndpoint({ ...profile().runtime, transportMode: 'public-https', dialEndpoint: null }), PINNED_RUNTIME_CANONICAL)
  for (const change of [{ dialEndpoint: 'http://localhost:18084' }, { automaticFallback: true },
    { canonicalEndpoint: 'https://other.test' }]) assert.throws(() => runtimeDialEndpoint({ ...profile().runtime, ...change }))
})

test('loopback startup proves matching canonical and local Runtime health or fails closed', async () => {
  const calls = []
  const request = async url => { calls.push(url); return Response.json(health()) }
  assert.deepEqual(await verifyRuntimeTransport(profile(), request), { mode: 'loopback', version: 'test', commit: 'commit' })
  assert.deepEqual(calls, [`${PINNED_RUNTIME_DIAL}/runtime/healthz`, `${PINNED_RUNTIME_CANONICAL}/runtime/healthz`])
  await assert.rejects(verifyRuntimeTransport(profile(), async url => Response.json({ ...health(),
    ...(url.startsWith(PINNED_RUNTIME_DIAL) ? { commit: 'other' } : {}) })))
  await assert.rejects(verifyRuntimeTransport(profile(), async () => Response.json({ ...health(), tenant: 'other' })))
  await assert.rejects(verifyRuntimeTransport(profile(), async () => Response.json(health(), { status: 503 })))
  await assert.rejects(verifyRuntimeTransport(profile(), async () => new Response(new Uint8Array(16_385), {
    headers: { 'content-type': 'application/json' }
  })))
  assert.deepEqual(await verifyRuntimeTransport({ ...profile(), runtime: { ...profile().runtime,
    transportMode: 'public-https', dialEndpoint: null } }, () => { throw Error('no probe expected') }), { mode: 'public-https' })
})
