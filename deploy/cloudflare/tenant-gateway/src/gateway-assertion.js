import { canonicalGatewayScope, GATEWAY_ASSERTION_TYPE, GATEWAY_EXCHANGE_PATH, gatewayExchangeWithLegacy } from '../../../../foundation/shared/contracts/gatewayAssertion.mjs'

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const appIdentifier = /^[a-z][a-z0-9-]{0,63}$/
const encoder = new TextEncoder()
const maxBodyBytes = 65536
// Only these freshly generated headers can cross the signing lane. No Cookie,
// Authorization, actor, scheduler, login secret or arbitrary forwarding header.
const trustedHeaders = new Set(['accept', 'content-type', 'x-request-id',
  'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
  'x-hzy-gateway', 'x-hzy-gateway-token', 'x-hzy-tenant', 'x-hzy-environment',
  'x-hzy-app-code', 'x-hzy-deployment', 'x-hzy-data-runtime-url',
  'x-hzy-data-runtime-code', 'x-hzy-data-runtime-token', 'x-hzy-data-runtime-audience'])

function fail(status, code) {
  return Response.json({ code }, { status, headers: { 'cache-control': 'no-store' } })
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid encoding')
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0))
  if (base64url(bytes) !== value) throw new Error('non canonical encoding')
  return bytes
}
async function bodyBytes(request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('empty body')
  let length = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBodyBytes) throw new Error('body too large')
      chunks.push(value)
    }
  } finally {
    // A cloned stream is a tee: awaiting cancellation can wait for the unused
    // original branch forever on a rejected oversized body.
    void reader.cancel().catch(() => {})
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

// Public JWK+private d are provisioned together as ONE Worker secret by ops.
// No key generation, public-key registration, self-enrollment or logging here.
export async function signGatewayAssertion(env, facts, request, now = Date.now()) {
  const identity = JSON.parse(env.HZY_GATEWAY_ASSERTION_IDENTITY_JSON || '{}')
  const key = JSON.parse(env.HZY_GATEWAY_ASSERTION_PRIVATE_JWK || '{}')
  if (!identifier.test(identity.deploymentCode || '')
    || identity.tenantCode !== facts.tenant || identity.environment !== facts.environment
    || !identifier.test(facts.tenant) || !identifier.test(facts.environment)
    || !identifier.test(facts.runtimeCode) || !appIdentifier.test(facts.appCode)
    || !identifier.test(facts.deployment) || !identifier.test(request.clientId)
    || !identifier.test(request.audience) || !request.scope || request.scope.length > 4096
    || key.kty !== 'OKP' || key.crv !== 'Ed25519' || key.alg && key.alg !== 'EdDSA'
    || decode(key.x).length !== 32 || decode(key.d).length !== 32) throw new Error('gateway_assertion_configuration_invalid')
  const publicKey = decode(key.x)
  const kid = [...new Uint8Array(await crypto.subtle.digest('SHA-256', publicKey))].map(b => b.toString(16).padStart(2, '0')).join('')
  const privateKey = await crypto.subtle.importKey('jwk', { kty: key.kty, crv: key.crv, x: key.x, d: key.d, ext: false }, { name: 'Ed25519' }, false, ['sign'])
  // Verify the provisioned x matches d rather than relying on importer behavior.
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const publicCryptoKey = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify'])
  if (!await crypto.subtle.verify('Ed25519', publicCryptoKey, await crypto.subtle.sign('Ed25519', privateKey, challenge), challenge)) throw new Error('gateway_assertion_configuration_invalid')
  const seconds = Math.floor(now / 1000)
  const claims = {
    iss: `gateway:${identity.deploymentCode}`, sub: `gateway:${identity.deploymentCode}`,
    aud: GATEWAY_EXCHANGE_PATH, tenant: facts.tenant, environment: facts.environment,
    gateway_deployment: identity.deploymentCode, runtime_code: facts.runtimeCode,
    source_app: facts.appCode, source_deployment: facts.deployment,
    oauth_audience: request.audience, scope: canonicalGatewayScope(request.scope), client_id: request.clientId,
    source_binding: 'trusted-gateway', method: 'POST', path: GATEWAY_EXCHANGE_PATH,
    iat: seconds, nbf: seconds, exp: seconds + 60,
    jti: base64url(crypto.getRandomValues(new Uint8Array(16)))
  }
  const signingInput = `${base64url(encoder.encode(JSON.stringify({ alg: 'EdDSA', typ: GATEWAY_ASSERTION_TYPE, kid })))}.${base64url(encoder.encode(JSON.stringify(claims)))}`
  return { assertion: `${signingInput}.${base64url(await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(signingInput)))}`, gatewayDeployment: identity.deploymentCode }
}

// Rollout selector, not an authorization grant. Only registry-verified source
// facts may select this lane; malformed configuration disables the entire lane.
export function gatewayAssertionSourceEnabled(env, appCode) {
  if (env.HZY_GATEWAY_ASSERTION_ENABLED !== 'true') return false
  const entries = String(env.HZY_GATEWAY_ASSERTION_SOURCE_APPS || '').split(',').map(value => value.trim())
  return entries.every(value => /^[a-z][a-z0-9-]*$/.test(value)) && entries.includes(appCode)
}

export async function gatewayTokenLane(request, env, facts, forwardHeaders, send) {
  // Invalid trusted source context must never be signed or silently rerouted.
  if (env.HZY_GATEWAY_ASSERTION_ENABLED === 'true'
    && String(env.HZY_GATEWAY_ASSERTION_SOURCE_APPS || '').split(',').some(app => gatewayAssertionSourceEnabled(env, app.trim()))
    && !facts?.appCode) return fail(403, 'gateway_exchange_source_binding_invalid')
  // Disabled lane and credential-backed calls retain the original transport.
  if (!gatewayAssertionSourceEnabled(env, facts?.appCode) || request.headers.has('authorization')
    || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null
  let body
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bodyBytes(request.clone()))) }
  catch { return fail(400, 'gateway_exchange_request_invalid') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'gateway_exchange_request_invalid')
  if (body.grant_type !== 'client_credentials' || body.client_secret) return null
  if (!facts.appCode || !facts.deployment || !facts.tenant || !facts.environment) return fail(403, 'gateway_exchange_source_binding_invalid')
  if (!env.HZY_CONSOLE_SERVICE?.fetch) return fail(503, 'gateway_exchange_binding_unavailable')
  if (typeof body.client_id !== 'string' || typeof body.audience !== 'string' || typeof body.scope !== 'string'
    || body.source_binding && body.source_binding !== 'trusted-gateway'
    || body.app_code && body.app_code !== facts.appCode) return fail(400, 'gateway_exchange_request_invalid')
  const tokenRequest = { clientId: body.client_id.trim(), audience: body.audience.trim(), scope: canonicalGatewayScope(body.scope) }
  let signed
  try { signed = await signGatewayAssertion(env, facts, tokenRequest) }
  catch { return fail(503, 'gateway_assertion_configuration_invalid') }
  const headers = new Headers()
  for (const name of trustedHeaders) {
    const value = forwardHeaders.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('content-type', 'application/json')
  headers.set('accept', 'application/json')
  headers.set('x-hzy-gateway-deployment', signed.gatewayDeployment)
  headers.set('x-hzy-data-runtime-code', facts.runtimeCode)
  const payload = JSON.stringify({ grant_type: 'client_credentials', client_id: tokenRequest.clientId,
    audience: tokenRequest.audience, scope: tokenRequest.scope, app_code: facts.appCode, source_binding: 'trusted-gateway' })
  let response
  try {
    return await gatewayExchangeWithLegacy(async () => {
      const exchangeHeaders = new Headers(headers)
      exchangeHeaders.set('x-hzy-gateway-service-assertion', signed.assertion)
      response = await send(exchangeHeaders, payload)
      if (response.status === 200) return { status: 200, result: response }
      // Only the dedicated machine code is inspected, never error text.
      let error
      try { error = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bodyBytes(response.clone()))) } catch { /* no fallback */ }
      return { status: response.status, code: error?.data?.code ?? error?.code }
    }, async () => {
      headers.delete('x-hzy-gateway-service-assertion')
      headers.delete('x-hzy-gateway-deployment')
      return await send(headers, payload)
    })
  } catch {
    return response || fail(503, 'gateway_exchange_transport_unavailable')
  }
}
