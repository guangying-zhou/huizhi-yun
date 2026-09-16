import assert from 'node:assert/strict'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import {
  resolveServiceTokenIntrospectionFailure,
  verifyActiveServiceAccessTokenWithState,
  type ServiceTokenCredentialRecord,
  type ServiceTokenStatusLoader
} from '../server/utils/serviceTokenStatus.ts'

const issuer = 'https://tenant.example.test'
const audience = 'altoc'
const kid = 'service-contract-key'
const clientId = 'aims-runtime-client-id'
const credentialId = 7
const serviceClientId = 3
const scope = 'altoc:service_ticket:delivery-result:sync'

function errorStatus(error: unknown) {
  const candidate = error as { statusCode?: number, status?: number }
  return Number(candidate?.statusCode || candidate?.status || 0)
}

async function rejectedError(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    return error
  }
  assert.fail('expected operation to reject')
}

async function createSignedServiceTokenFixture() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
  const publicJwk: JWK = {
    ...await exportJWK(publicKey),
    kid,
    alg: 'EdDSA',
    use: 'sig'
  }

  async function signToken(tokenAudience = audience, options: { expirationTime?: number, keyId?: string } = {}) {
    const now = Math.floor(Date.now() / 1000)
    return await new SignJWT({
      client_id: clientId,
      scope,
      tenant: 'TENANT-A',
      deployment: 'AIMS-DEPLOYMENT',
      token_use: 'service',
      hzy: {
        subjectType: 'service',
        clientCode: 'aims.runtime',
        appCode: 'aims',
        credentialId
      }
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: options.keyId || kid, typ: 'JWT' })
      .setIssuer(issuer)
      .setSubject('client:aims.runtime')
      .setAudience(tokenAudience)
      .setIssuedAt(now)
      .setExpirationTime(options.expirationTime ?? now + 900)
      .sign(privateKey)
  }

  return { publicJwk, signToken }
}

function activeCredential(): ServiceTokenCredentialRecord {
  return {
    serviceClientId,
    serviceClientStatus: 'active',
    currentCredentialId: credentialId,
    credentialId,
    credentialStatus: 'active',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  }
}

function stateLoader(input: {
  credential?: ServiceTokenCredentialRecord | null
  grants?: Array<{ resourceCode: string, action: string }>
  credentialError?: Error
  grantError?: Error
  calls?: string[]
} = {}): ServiceTokenStatusLoader {
  const calls = input.calls || []
  return {
    async loadCredential(identity) {
      calls.push(`credential:${identity.credentialId}:${identity.clientId}`)
      if (input.credentialError) throw input.credentialError
      if (identity.credentialId !== credentialId || identity.clientId !== clientId) return null
      return input.credential === undefined ? activeCredential() : input.credential
    },
    async loadActiveGrants(loadedServiceClientId) {
      calls.push(`grants:${loadedServiceClientId}`)
      if (input.grantError) throw input.grantError
      return input.grants === undefined
        ? [{ resourceCode: 'altoc:service_ticket:delivery-result', action: 'sync' }]
        : input.grants
    }
  }
}

test('signed service JWT follows the production credential and grant verification path', async (t) => {
  const fixture = await createSignedServiceTokenFixture()
  const token = await fixture.signToken()

  await t.test('active current credential and grant are accepted', async () => {
    const calls: string[] = []
    const payload = await verifyActiveServiceAccessTokenWithState({
      token,
      issuer,
      audience,
      publishedJwks: [fixture.publicJwk],
      ...stateLoader({ calls })
    })

    assert.equal(payload.client_id, clientId)
    assert.equal(payload.scope, scope)
    assert.deepEqual(calls, [
      `credential:${credentialId}:${clientId}`,
      `grants:${serviceClientId}`
    ])
  })

  await t.test('credential rotation and revocation are inactive 401 outcomes', async () => {
    for (const credential of [
      { ...activeCredential(), currentCredentialId: credentialId + 1 },
      { ...activeCredential(), credentialStatus: 'revoked' },
      { ...activeCredential(), serviceClientStatus: 'revoked' }
    ]) {
      const error = await rejectedError(() => verifyActiveServiceAccessTokenWithState({
        token,
        issuer,
        audience,
        publishedJwks: [fixture.publicJwk],
        ...stateLoader({ credential })
      }))
      assert.equal(errorStatus(error), 401)
      assert.deepEqual(resolveServiceTokenIntrospectionFailure(error), { active: false })
    }
  })

  await t.test('grant revocation is an inactive 401 outcome', async () => {
    const error = await rejectedError(() => verifyActiveServiceAccessTokenWithState({
      token,
      issuer,
      audience,
      publishedJwks: [fixture.publicJwk],
      ...stateLoader({ grants: [] })
    }))
    assert.equal(errorStatus(error), 401)
    assert.deepEqual(resolveServiceTokenIntrospectionFailure(error), { active: false })
  })

  await t.test('credential and grant loader failures remain fail-closed 503 outcomes', async () => {
    for (const loader of [
      stateLoader({ credentialError: new Error('credential database unavailable') }),
      stateLoader({ grantError: new Error('grant database unavailable') })
    ]) {
      const verificationError = await rejectedError(() => verifyActiveServiceAccessTokenWithState({
        token,
        issuer,
        audience,
        publishedJwks: [fixture.publicJwk],
        ...loader
      }))
      const introspectionError = await rejectedError(async () => resolveServiceTokenIntrospectionFailure(verificationError))
      assert.equal(errorStatus(introspectionError), 503)
      assert.match(String((introspectionError as Error).message), /introspection_unavailable/)
    }
  })

  await t.test('wrong audience is rejected as inactive before state loaders run', async () => {
    const calls: string[] = []
    const wrongAudienceToken = await fixture.signToken('assets')
    const error = await rejectedError(() => verifyActiveServiceAccessTokenWithState({
      token: wrongAudienceToken,
      issuer,
      audience,
      publishedJwks: [fixture.publicJwk],
      ...stateLoader({ calls })
    }))
    assert.equal(errorStatus(error), 401)
    assert.deepEqual(calls, [])
    assert.deepEqual(resolveServiceTokenIntrospectionFailure(error), { active: false })
  })

  await t.test('expired token and invalid signing-key metadata are rejected before state loaders run', async () => {
    const now = Math.floor(Date.now() / 1000)
    const cases = [
      {
        token: await fixture.signToken(audience, { expirationTime: now - 1 }),
        publishedJwks: [fixture.publicJwk]
      },
      {
        token: await fixture.signToken(audience, { keyId: 'unknown-service-key' }),
        publishedJwks: [fixture.publicJwk]
      },
      {
        token,
        publishedJwks: [{ ...fixture.publicJwk, alg: 'RS256' }]
      }
    ]

    for (const invalid of cases) {
      const calls: string[] = []
      const error = await rejectedError(() => verifyActiveServiceAccessTokenWithState({
        token: invalid.token,
        issuer,
        audience,
        publishedJwks: invalid.publishedJwks,
        ...stateLoader({ calls })
      }))
      assert.equal(errorStatus(error), 401)
      assert.deepEqual(calls, [])
      assert.deepEqual(resolveServiceTokenIntrospectionFailure(error), { active: false })
    }
  })
})
