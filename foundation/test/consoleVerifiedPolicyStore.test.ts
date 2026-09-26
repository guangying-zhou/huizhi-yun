import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { consoleVerifiedPolicyStore } from '../server/utils/consoleVerifiedPolicyStore.ts'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc.ts'

test('Console verified store uses exact scopes and distinguishes missing row from unavailable storage over HTTP', async () => {
  const globals = globalThis as { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  let status = 404
  let response: unknown = { code: 'policy_snapshot_missing', message: 'Missing' }
  let requestBody = ''
  const methods: string[] = []
  const scopes: string[] = []
  const token = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ tenant: 'tenant', deployment: 'console-test' })).toString('base64url'), 'fixture-signature'].join('.')
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/console/verified-policy')
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    assert.equal(req.headers['x-hzy-deployment'], 'console-test')
    methods.push(req.method!)
    requestBody = ''
    for await (const chunk of req) requestBody += chunk
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(status >= 400 ? { error: response } : response))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    globals.useRuntimeConfig = () => ({ public: { appCode: 'console' }, hzy: { tenantRuntime: { endpoint: `http://127.0.0.1:${address.port}`, dataAccessMode: 'tenant-runtime' } } })
    setLocalServiceTokenIssuer(async (input) => {
      assert.equal(input.sourceBinding, 'service-client-policy')
      scopes.push(input.scope)
      return token
    })
    const event = { context: {}, node: { req: { headers: {}, url: '/api/internal/policy-bundle/sync' } } } as never
    const store = consoleVerifiedPolicyStore(event)
    assert.equal(await store.get(), null)
    for (const failure of [
      { status: 404, code: 'route_not_found' }, { status: 503, code: 'policy_snapshot_unavailable' },
      { status: 403, code: 'policy_credential_inactive' }
    ]) {
      status = failure.status
      response = { code: failure.code, message: 'Fixture error' }
      await assert.rejects(store.get(), { statusCode: failure.status })
    }
    status = 200
    response = { code: 0, data: { etag: 'receipt' } }
    const envelope = { schema: 'hzy-policy-envelope.v1', alg: 'Ed25519', kid: 'fixture', body: 'opaque fixture', signature: 'fixture' } as const
    await store.put(envelope, 'expected-etag')
    assert.deepEqual(JSON.parse(requestBody), { envelope, expectedEtag: 'expected-etag' })
    assert.equal(methods.at(-1), 'PUT')
    assert.ok(methods.slice(0, -1).every(method => method === 'GET'))
    assert.ok(scopes.includes('console:policy-bundle:read'))
    assert.ok(scopes.includes('console:policy-bundle:write'))
    status = 409
    response = { code: 'policy_snapshot_conflict', message: 'Changed' }
    await assert.rejects(store.put(envelope, 'expected-etag'), { statusCode: 409, data: { code: 'policy_snapshot_conflict', message: 'Changed', upstreamStatus: 409 } })
  } finally {
    globals.useRuntimeConfig = previous
    setLocalServiceTokenIssuer(null)
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
