import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { policyServiceKeyId } from '../../platform/packages/authz-core/src/policy-envelope.ts'
import {
  CONSOLE_ASSERTION_TYPE, importConsoleServiceKey, loadConsoleServiceKey, resetConsoleServiceKeyCache, signConsoleServiceAssertion
} from '../server/utils/consoleServiceKey.ts'
import { maybeCallTenantRuntime } from '../server/utils/tenantRuntimeClient.ts'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc.ts'

const keys = generateKeyPairSync('ed25519')
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const rawPublic = (keys.publicKey.export({ format: 'jwk' }) as { x: string }).x
const decode = (segment: string) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))

afterEach(() => {
  delete process.env.HZY_CONSOLE_SERVICE_KEY
  resetConsoleServiceKeyCache()
})

test('the key id and public key match the Platform/Runtime derivation; assertions verify with the key', async () => {
  const key = await importConsoleServiceKey(pem.replace(/\n/g, '\\n'))
  assert.equal(key.publicKey, rawPublic)
  assert.equal(key.kid, policyServiceKeyId(rawPublic))
  const token = await signConsoleServiceAssertion(key, { tenant: 'tenant-a', deployment: 'tenant-a-console' }, 1_700_000_000_000)
  const [header, claims, signature] = token.split('.') as [string, string, string]
  assert.deepEqual(decode(header), { alg: 'EdDSA', typ: CONSOLE_ASSERTION_TYPE, kid: key.kid })
  const body = decode(claims)
  assert.deepEqual({ ...body, jti: undefined }, {
    iss: 'console:tenant-a-console', sub: 'console:tenant-a-console', aud: 'hzy-runtime-service-token-issue',
    token_use: 'console_service_assertion', tenant: 'tenant-a', deployment: 'tenant-a-console',
    scope: 'console:service-token:issue', iat: 1_700_000_000, exp: 1_700_000_060, jti: undefined
  })
  assert.match(body.jti, /^[a-f0-9]{32}$/)
  assert.ok(verify(null, Buffer.from(`${header}.${claims}`), createPublicKey(keys.publicKey.export({ type: 'spki', format: 'pem' })),
    Buffer.from(signature, 'base64url')))
  const second = await signConsoleServiceAssertion(key, { tenant: 'tenant-a', deployment: 'tenant-a-console' }, 1_700_000_000_000)
  assert.notEqual(decode(second.split('.')[1]!).jti, body.jti, 'every assertion is single-use')
  await assert.rejects(importConsoleServiceKey('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'))
  assert.equal(await loadConsoleServiceKey({}), null, 'no key configured means no steady identity')
})

test('service key cache follows the configured PEM bytes across same-length rotation', async () => {
  const replacement = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  assert.equal(replacement.length, pem.length)
  const directory = mkdtempSync(join(tmpdir(), 'console-service-key-'))
  const file = join(directory, 'key.pem')
  try {
    writeFileSync(file, pem, { mode: 0o600 })
    const first = await loadConsoleServiceKey({ HZY_CONSOLE_SERVICE_KEY_FILE: file, HZY_CONSOLE_SERVICE_KEY: '' })
    writeFileSync(file, replacement, { mode: 0o600 })
    const rotated = await loadConsoleServiceKey({ HZY_CONSOLE_SERVICE_KEY_FILE: file, HZY_CONSOLE_SERVICE_KEY: '' })
    assert.notEqual(rotated?.kid, first?.kid)
    assert.equal(await loadConsoleServiceKey({ HZY_CONSOLE_SERVICE_KEY_FILE: file, HZY_CONSOLE_SERVICE_KEY: '' }), rotated)
    const inline = await loadConsoleServiceKey({ HZY_CONSOLE_SERVICE_KEY_FILE: '', HZY_CONSOLE_SERVICE_KEY: pem })
    assert.equal(inline?.kid, first?.kid)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function harness(options: { bootstrapStatus: number, headers?: Record<string, string>, key?: boolean }) {
  if (options.key !== false) process.env.HZY_CONSOLE_SERVICE_KEY = pem
  const issued: string[] = []
  let platformCalls = 0
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/platform/internal/tenant-gateway/runtime-bootstrap-token') {
      platformCalls += 1
      response.statusCode = options.bootstrapStatus
      response.end(JSON.stringify({ message: 'bootstrap' }))
      return
    }
    if (request.url === '/v1/console/auth/service-tokens/issue') {
      issued.push(String(request.headers.authorization || '').replace(/^Bearer /, ''))
      response.end(JSON.stringify({ code: 0, data: { accessToken: 'issued-service-token', tokenType: 'Bearer', expiresIn: 90, scope: 'x' } }))
      return
    }
    assert.equal(request.headers.authorization, 'Bearer issued-service-token')
    response.end(JSON.stringify({ code: 0, data: null }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const original = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ hzy: { cloudflareInternalToken: 'internal-gateway-token', platform: { baseUrl },
    tenantRuntime: { dataAccessMode: 'tenant-runtime' } } })
  setLocalServiceTokenIssuer(async ({ audience, scope, event }) => {
    const result = await maybeCallTenantRuntime<{ data: { accessToken: string } }>(event!, '/v1/console/auth/service-tokens/issue', {
      appCode: 'console', scope: 'console:service-token:issue', method: 'POST', body: { audience, scope }, requireStaticRuntimeToken: true
    })
    return result.data.data.accessToken
  })
  const event = { context: {}, node: { req: { url: '/api/x', headers: {
    'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'internal-gateway-token',
    'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': 'tenant-a-console', 'x-hzy-environment': 'prod',
    'x-hzy-app-code': 'console', 'x-hzy-data-runtime-url': baseUrl, ...options.headers
  } } } } as never
  const call = () => maybeCallTenantRuntime(event, '/v1/console/platform-lifecycle/drain/claim', {
    appCode: 'console', scope: 'console:platform-lifecycle:execute', method: 'POST', body: {}
  })
  const close = async () => {
    setLocalServiceTokenIssuer(null)
    if (original) globals.useRuntimeConfig = original
    else delete globals.useRuntimeConfig
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
  return {
    call, close, issued,
    get platformCalls() {
      return platformCalls
    }
  }
}

test('a Platform outage for the bootstrap token falls back to a Console key assertion', async () => {
  for (const status of [503, 502, 429, 408]) {
    resetConsoleServiceKeyCache()
    const h = await harness({ bootstrapStatus: status })
    try {
      assert.equal((await h.call()).handled, true, `status ${status}`)
      assert.equal(h.issued.length, 1)
      const claims = decode(h.issued[0]!.split('.')[1]!)
      assert.equal(decode(h.issued[0]!.split('.')[0]!).typ, CONSOLE_ASSERTION_TYPE)
      assert.equal(claims.deployment, 'tenant-a-console')
      assert.equal(claims.tenant, 'tenant-a')
    } finally {
      await h.close()
    }
  }
})

test('an explicit Platform refusal never falls back to the key', async () => {
  for (const status of [401, 403, 409]) {
    const h = await harness({ bootstrapStatus: status })
    try {
      await assert.rejects(h.call())
      assert.equal(h.issued.length, 0, `status ${status}`)
    } finally {
      await h.close()
    }
  }
})

test('without a configured key an outage still fails closed', async () => {
  const h = await harness({ bootstrapStatus: 503, key: false })
  try {
    await assert.rejects(h.call(), (error: { statusCode?: number }) => error.statusCode === 503)
    assert.equal(h.issued.length, 0)
  } finally {
    await h.close()
  }
})

test('a trusted Gateway outage marker skips Platform and binds the Console deployment for other callers', async () => {
  const h = await harness({ bootstrapStatus: 200, headers: {
    'x-hzy-runtime-bootstrap-unavailable': 'platform', 'x-hzy-app-code': 'enterprise', 'x-hzy-deployment': 'tenant-a-enterprise',
    'x-hzy-service-routes': JSON.stringify({ console: { deploymentCode: 'tenant-a-console' } })
  } })
  try {
    assert.equal((await h.call()).handled, true)
    assert.equal(h.platformCalls, 0)
    assert.equal(decode(h.issued[0]!.split('.')[1]!).deployment, 'tenant-a-console')
  } finally {
    await h.close()
  }
  const untrusted = await harness({ bootstrapStatus: 409, headers: {
    'x-hzy-runtime-bootstrap-unavailable': 'platform', 'x-hzy-gateway-token': 'forged'
  } })
  try {
    const result = await untrusted.call().catch(() => null)
    assert.notEqual(result?.handled, true)
    assert.equal(untrusted.issued.length, 0, 'an untrusted marker is ignored')
  } finally {
    await untrusted.close()
  }
})
