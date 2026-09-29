import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { createHash } from 'node:crypto'

function loadFunction(path: string, start: string, end: string, name: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const section = source.slice(source.indexOf(start), source.indexOf(end)).replace(/^export /, '')
  assert.ok(section.includes(name))
  const js = ts.transpile(section, { target: ts.ScriptTarget.ES2022 })
  return new Function(...Object.keys(dependencies), `${js}; return ${name}`)(...Object.values(dependencies))
}
const createError = (input: object) => Object.assign(new Error('safe fixture error'), input)
const claims = { token_use: 'access', sid: 'fixture-session', sub: 'fixture-user', hzy: { subjectType: 'user' } }

for (const status of [0, 200, 401, 503]) {
  test(`JWKS dependency status ${status} stays separate from invalid user credentials`, async () => {
    const fetchKey = Symbol('fetch')
    const load = loadFunction('../../foundation/server/utils/consoleOidc.ts', 'function getIssuerJwks(',
      'function issuerCandidates(', 'getIssuerJwks', {
        trimTrailingSlash: (s: string) => s, consoleOidcReadHeaders: () => ({}),
        consoleServiceBinding: () => null, createHash, jwksByIssuer: new Map(), customFetch: fetchKey,
        createRemoteJWKSet: (_url: URL, options: Record<symbol, unknown>) => options[fetchKey],
        logAuthDependencyFailure: () => {}, fetch: async () => {
          if (!status) throw new TypeError('fetch failed')
          return Response.json({ keys: [] }, { status })
        }, createError
      })
    const fetcher = load({}, 'https://fixture.test')
    if (status === 200) assert.equal((await fetcher('https://fixture.test/.well-known/jwks.json')).status, 200)
    else await assert.rejects(fetcher('https://fixture.test/.well-known/jwks.json'), {
      statusCode: 503, data: { code: 'console_session_verification_unavailable' }
    })
  })
}

for (const status of [0, 401, 403, 429, 500, 502, 503]) {
  test(`Host session dependency status ${status} cannot become a false logout`, async () => {
    let cleared = 0
    const load = loadFunction('../../foundation/server/utils/consoleOidc.ts',
      'async function loadConsoleAuthContext(', 'export async function requireConsoleAuthContext(', 'loadConsoleAuthContext', {
        getConsoleOidcConfig: () => ({ enabled: true, clientId: 'enterprise', issuer: 'fixture' }),
        getBearerToken: () => 'fixture-token', resolveConsoleOidcEndpointBaseUrl: () => 'fixture',
        decodeJwt: () => claims, jwtVerify: async () => ({ payload: claims }),
        getIssuerJwks: () => ({}), issuerCandidates: () => ['fixture'],
        validateConsoleOidcSession: async () => { throw Object.assign(new Error('private upstream details'), { response: { status } }) },
        clearConsoleOidcCookies: () => { cleared++ }, createError,
        console: { warn: () => {} }, tokenValidationDiagnostics: () => ({}), isExpiredJwt: () => false
      })
    if (status === 401) {
      const result = await load({})
      assert.equal(result.authenticated, false)
      assert.equal(result.reason, 'revoked_session')
      assert.equal(cleared, 1)
    } else {
      await assert.rejects(load({}), { statusCode: 503, data: { code: 'console_session_verification_unavailable' } })
      assert.equal(cleared, 0)
    }
  })
  test(`Console Runtime session status ${status} preserves the authentication/availability boundary`, async () => {
    const verify = loadFunction('../server/utils/oidc.ts', 'export async function verifyAccessToken(',
      'export async function revokeRefreshToken(', 'verifyAccessToken', {
        getPublishedJwks: async () => ({ keys: [{ kid: 'fixture' }] }), stringValue: String,
        loadJose: async () => ({ importJWK: async () => ({}), jwtVerify: async () => ({ payload: claims }) }),
        getOidcIssuer: () => 'fixture', resolveConsoleAuthSession: async () => { throw { statusCode: status } },
        logAuthDependencyFailure: () => {}, createError
      })
    const token = `${Buffer.from(JSON.stringify({ kid: 'fixture', alg: 'EdDSA' })).toString('base64url')}.fixture.fixture`
    await assert.rejects(verify({}, token), { statusCode: status === 401 ? 401 : 503 })
  })
}
