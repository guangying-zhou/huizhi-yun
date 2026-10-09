import { createError } from 'h3'
import type { JWK, JWTPayload } from 'jose'

type JoseModule = typeof import('jose')

let joseModulePromise: Promise<JoseModule> | null = null

function loadJose() {
  joseModulePromise ||= import('jose')
  return joseModulePromise
}

export interface ServiceTokenCredentialStatus {
  serviceClientStatus: string
  currentCredentialId: number | null
  credentialId: number
  credentialStatus: string
  expiresAt: string | null
}

export type LocalServiceTokenCredential = ServiceTokenCredentialStatus & {
  serviceClientId: number
  clientId: string
  clientCode: string
  clientName: string
  clientType: string
  appCode: string | null
}

export type LocalServiceTokenGrant = {
  resourceCode: string
  action: string
}

export type ServiceTokenCredentialRecord = ServiceTokenCredentialStatus & {
  serviceClientId: number
}

export type ServiceTokenStatusLoader = {
  loadCredential: (identity: { credentialId: number, clientId: string }) => Promise<ServiceTokenCredentialRecord | null>
  loadActiveGrants: (serviceClientId: number) => Promise<LocalServiceTokenGrant[]>
}

export type ActiveServiceTokenVerificationInput = ServiceTokenStatusLoader & {
  token: string
  issuer: string
  audience?: string
  publishedJwks: JWK[]
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export function serviceTokenVerificationIsInactive(error: unknown) {
  const candidate = error as {
    statusCode?: number
    status?: number
    response?: { statusCode?: number, status?: number }
  }
  return Number(
    candidate?.statusCode
    || candidate?.status
    || candidate?.response?.statusCode
    || candidate?.response?.status
    || 0
  ) === 401
}

export function resolveServiceTokenIntrospectionFailure(error: unknown) {
  if (serviceTokenVerificationIsInactive(error)) {
    return { active: false as const }
  }
  throw createError({
    statusCode: 503,
    statusMessage: 'Service token introspection unavailable',
    message: 'service_token_introspection_unavailable'
  })
}

export function serviceTokenCredentialIsActive(status: ServiceTokenCredentialStatus | null, now = Date.now()) {
  return Boolean(
    status
    && status.serviceClientStatus === 'active'
    && status.credentialStatus === 'active'
    && status.currentCredentialId === status.credentialId
    && (!status.expiresAt || new Date(status.expiresAt).getTime() > now)
  )
}

export function serviceTokenScopesRemainActive(
  tokenScope: unknown,
  grants: Array<{ resourceCode: string, action: string }>
) {
  const allowedScopes = new Set(grants.map(grant => `${grant.resourceCode}:${grant.action}`))
  const tokenScopes = stringValue(tokenScope).split(/\s+/).filter(Boolean)
  return tokenScopes.length > 0 && tokenScopes.every(scope => allowedScopes.has(scope))
}

function invalidServiceToken(message: string) {
  return createError({ statusCode: 401, message: `invalid_token: ${message}` })
}

/**
 * Production service-token verification core. Cryptographic JWT checks and
 * current credential/grant checks intentionally share this path; only the
 * state loaders are injected so tests do not need a real Console database.
 * Loader failures are deliberately not converted to 401: the introspection
 * route maps them to fail-closed 503 so callers can distinguish revocation
 * from a temporary control-plane outage.
 */
export async function verifyActiveServiceAccessTokenWithState(
  input: ActiveServiceTokenVerificationInput
): Promise<JWTPayload> {
  let payload: JWTPayload
  try {
    const { decodeProtectedHeader, importJWK, jwtVerify } = await loadJose()
    const header = decodeProtectedHeader(input.token)
    const kid = stringValue(header.kid)
    const algorithm = stringValue(header.alg)
    const jwk = kid ? input.publishedJwks.find(candidate => stringValue(candidate.kid) === kid) : null
    const publishedAlgorithm = stringValue(jwk?.alg)
    if (!jwk || !algorithm || (publishedAlgorithm && publishedAlgorithm !== algorithm)) {
      throw new Error('signing key not found')
    }
    const key = await importJWK(jwk, algorithm)
    const verified = await jwtVerify(input.token, key, {
      issuer: input.issuer,
      ...(input.audience ? { audience: input.audience } : {})
    })
    payload = verified.payload
  } catch {
    throw invalidServiceToken('signature, issuer, audience, or expiry rejected')
  }

  if (payload.token_use !== 'service') {
    throw invalidServiceToken('service token required')
  }

  const clientId = stringValue(payload.client_id)
  const credentialId = Number((payload.hzy as Record<string, unknown> | undefined)?.credentialId)
  if (!clientId || !Number.isSafeInteger(credentialId) || credentialId <= 0) {
    throw invalidServiceToken('service credential identity missing')
  }

  const credential = await input.loadCredential({ credentialId, clientId })
  if (!credential || !serviceTokenCredentialIsActive(credential)) {
    throw invalidServiceToken('service credential revoked or expired')
  }

  const activeGrants = await input.loadActiveGrants(credential.serviceClientId)
  if (!serviceTokenScopesRemainActive(payload.scope, activeGrants)) {
    throw invalidServiceToken('service grant revoked')
  }

  return payload
}

export function resolveLocalServiceTokenSubject(
  credential: LocalServiceTokenCredential | null,
  scope: string,
  activeGrants: LocalServiceTokenGrant[],
  now = Date.now()
) {
  if (!credential || !serviceTokenCredentialIsActive(credential, now)) {
    return { ok: false as const, reason: 'credential_inactive' as const }
  }
  if (!serviceTokenScopesRemainActive(scope, activeGrants)) {
    return { ok: false as const, reason: 'grant_inactive' as const }
  }
  return {
    ok: true as const,
    serviceClient: {
      clientId: credential.clientId,
      clientCode: credential.clientCode,
      clientName: credential.clientName,
      clientType: credential.clientType,
      appCode: credential.appCode,
      credentialId: credential.credentialId
    }
  }
}
