import assert from 'node:assert/strict'
import test from 'node:test'
import { createStandaloneServiceTokenClient } from '../server/utils/standaloneServiceToken'
import type { ServiceTokenError } from '../server/utils/standaloneServiceToken'

function fakeFetch(responses: Array<{ status: number, body: unknown }>) {
  const calls: Array<Record<string, unknown>> = []
  const impl = (async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body))
    const next = responses.shift() || { status: 500, body: {} }
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { impl, calls }
}

test('requests an exact scope with service-client-policy binding and caches per audience/scope', async () => {
  let clock = 1_000_000
  const { impl, calls } = fakeFetch([{ status: 200, body: { access_token: 'token-a', expires_in: 300 } }, { status: 200, body: { access_token: 'token-b', expires_in: 300 } }])
  const client = createStandaloneServiceTokenClient({ tokenUrl: 'https://console.test/oauth/token', clientId: 'collab.runtime', clientSecret: 'secret', fetchImpl: impl, now: () => clock })
  assert.equal(await client.getToken('data-runtime', 'codocs:collaboration-snapshots:read'), 'token-a')
  assert.equal(await client.getToken('data-runtime', 'codocs:collaboration-snapshots:read'), 'token-a', 'cached')
  assert.deepEqual(calls[0], { grant_type: 'client_credentials', client_id: 'collab.runtime', client_secret: 'secret', audience: 'data-runtime', scope: 'codocs:collaboration-snapshots:read', source_binding: 'service-client-policy' })
  clock += 280_000
  assert.equal(await client.getToken('data-runtime', 'codocs:collaboration-snapshots:read'), 'token-b', 'refreshed inside the margin')
  assert.equal(calls.length, 2)
})

test('concurrent callers share one request; force refresh bypasses the cache', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { access_token: 'one', expires_in: 900 } }, { status: 200, body: { access_token: 'two', expires_in: 900 } }])
  const client = createStandaloneServiceTokenClient({ tokenUrl: 'https://console.test/oauth/token', clientId: 'collab.runtime', clientSecret: 'secret', fetchImpl: impl })
  const [a, b] = await Promise.all([client.getToken('data-runtime', 's:r:read'), client.getToken('data-runtime', 's:r:read')])
  assert.equal(a, 'one')
  assert.equal(b, 'one')
  assert.equal(await client.getToken('data-runtime', 's:r:read', { forceRefresh: true }), 'two')
  assert.equal(calls.length, 2)
})

test('failures keep the status and never leak the secret or response body', async () => {
  const { impl } = fakeFetch([{ status: 403, body: { error: 'insufficient_scope', secret: 'leak' } }, { status: 200, body: { expires_in: 60 } }])
  const client = createStandaloneServiceTokenClient({ tokenUrl: 'https://console.test/oauth/token', clientId: 'collab.runtime', clientSecret: 'top-secret', fetchImpl: impl })
  await assert.rejects(client.getToken('data-runtime', 's:r:read'), (error: ServiceTokenError) => error.statusCode === 403 && !/top-secret|leak|insufficient/.test(error.message))
  await assert.rejects(client.getToken('data-runtime', 's:r:read'), (error: ServiceTokenError) => error.statusCode === 502)
  await assert.rejects(client.getToken('data-runtime', 'two scopes'), (error: ServiceTokenError) => error.statusCode === 400)
  const refused = async () => {
    throw new Error('ECONNREFUSED secret-host')
  }
  const unreachable = createStandaloneServiceTokenClient({ tokenUrl: 'https://console.test/oauth/token', clientId: 'c', clientSecret: 's', fetchImpl: refused as unknown as typeof fetch })
  await assert.rejects(unreachable.getToken('data-runtime', 's:r:read'), (error: ServiceTokenError) => error.statusCode === 503 && !/secret-host/.test(error.message))
  assert.throws(() => createStandaloneServiceTokenClient({ tokenUrl: '', clientId: 'c', clientSecret: 's' }), (error: ServiceTokenError) => error.statusCode === 503)
})
