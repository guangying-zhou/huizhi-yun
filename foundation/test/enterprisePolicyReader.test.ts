import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readEnterprisePolicySnapshot } from '../server/utils/enterprisePolicyReader.ts'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc.ts'
import { issuePolicyEnvelope } from '../../platform/server/utils/policyEnvelope.ts'

const globals = globalThis as { useRuntimeConfig?: () => unknown }
const previous = globals.useRuntimeConfig
afterEach(() => {
  globals.useRuntimeConfig = previous
  setLocalServiceTokenIssuer(null)
})

test('Host reader uses its own identity/exact read scope and refuses bad or expired Runtime projections', async () => {
  const now = Date.now()
  const context = { issuer: 'https://platform.example', tenant: 'tenant-a', environment: 'test', deployment: 'enterprise-test', now }
  const keys = generateKeyPairSync('ed25519')
  const key = { kid: 'test', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
  const payload = JSON.stringify({ tenant: { tenantCode: context.tenant }, environment: 'test', policyRevision: 1,
    deployments: [{ deploymentCode: context.deployment, environment: 'test', status: 'active' }] })
  const envelope = await issuePolicyEnvelope({ issuer: context.issuer, tenant: context.tenant, environment: 'test', deployments: [context.deployment], bundleVersion: 'v1', policyRevision: 1,
    status: 'active', issuedAt: now, expiresAt: now + 300000, policyExpiresAt: null, payload }, context,
  async input => ({ kid: 'test', alg: 'Ed25519', signature: sign(null, Buffer.from(input), keys.privateKey).toString('base64url') }))
  const body = JSON.parse(envelope.body)
  const snapshot = { tenant: context.tenant, environment: 'test', deployment: context.deployment, envelope,
    etag: createHash('sha256').update(`test\n${envelope.body}\n${envelope.signature}`).digest('hex'), acceptedAt: now, issuedAt: now, policyRevision: 1, payloadHash: body.payloadHash }
  let responseData: unknown = snapshot
  let status = 200
  const token = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ tenant: context.tenant, deployment: context.deployment })).toString('base64url'), 'fixture-signature'].join('.')
  const server = createServer((req, res) => {
    assert.equal(req.url, '/v1/enterprise/console-policy')
    assert.equal(req.method, 'GET')
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    assert.equal(req.headers['x-hzy-deployment'], context.deployment)
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 0, data: responseData }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { tenantRuntime: { endpoint: `http://127.0.0.1:${address.port}`, dataAccessMode: 'tenant-runtime' } } })
    setLocalServiceTokenIssuer(async (input) => {
      assert.equal(input.scope, 'console:policy-bundle:read')
      assert.equal(input.sourceBinding, 'service-client-policy')
      return token
    })
    const event = { context: {}, node: { req: { headers: {}, url: '/enterprise/api/navigation' } } } as never
    assert.equal((await readEnterprisePolicySnapshot(event, key, context)).body.bundleVersion, 'v1')
    for (const value of [null, { ...snapshot, deployment: 'console-test' }, { ...snapshot, acceptedAt: now + 600000 }, { ...snapshot, envelope: { ...envelope, body: '{}' } }]) {
      responseData = value
      await assert.rejects(readEnterprisePolicySnapshot(event, key, context), { statusCode: 503 })
    }
    responseData = snapshot
    status = 403
    await assert.rejects(readEnterprisePolicySnapshot(event, key, context), { statusCode: 403 })
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
