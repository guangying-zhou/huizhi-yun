import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type AuthorizationSimulationMode = 'role_simulation' | 'user_simulation'

export interface AuthorizationSimulationTokenPayload {
  v: 1
  sid: string
  actorUid: string
  mode: AuthorizationSimulationMode
  roleCode?: string | null
  subjectCode?: string | null
  includeBaseline?: boolean
  reason?: string | null
  policyBundleVersion?: string | null
  policyBundleHash?: string | null
  issuedAt: string
  expiresAt: string
  exp: number
}

export type AuthorizationSimulationTokenInvalidReason
  = | 'missing_secret'
    | 'missing_token'
    | 'malformed'
    | 'invalid_signature'
    | 'invalid_payload'
    | 'expired'

export type AuthorizationSimulationTokenInspection
  = | { valid: true, payload: AuthorizationSimulationTokenPayload }
    | {
      valid: false
      reason: AuthorizationSimulationTokenInvalidReason
      payload?: AuthorizationSimulationTokenPayload | null
    }

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function hmac(input: string, secret: string) {
  return createHmac('sha256', secret).update(input).digest('base64url')
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function createAuthorizationSimulationId() {
  return `asim_${randomBytes(18).toString('base64url')}`
}

export function signAuthorizationSimulationToken(payload: AuthorizationSimulationTokenPayload, secret: string) {
  const normalizedSecret = String(secret || '').trim()
  if (!normalizedSecret) {
    throw new Error('authorization simulation secret is required')
  }

  const body = base64UrlEncode(JSON.stringify(payload))
  return `${body}.${hmac(body, normalizedSecret)}`
}

function normalizeAuthorizationSimulationPayload(payload: Partial<AuthorizationSimulationTokenPayload>) {
  if (payload.v !== 1) return null
  if (payload.mode !== 'role_simulation' && payload.mode !== 'user_simulation') return null
  if (!payload.sid || !payload.actorUid || !payload.expiresAt) return null
  if (payload.mode === 'role_simulation' && !payload.roleCode) return null
  if (payload.mode === 'user_simulation' && !payload.subjectCode) return null

  const exp = Number(payload.exp)
  if (!Number.isFinite(exp)) return null

  return {
    v: 1,
    sid: String(payload.sid),
    actorUid: String(payload.actorUid),
    mode: payload.mode,
    roleCode: payload.roleCode == null ? null : String(payload.roleCode),
    subjectCode: payload.subjectCode == null ? null : String(payload.subjectCode),
    includeBaseline: Boolean(payload.includeBaseline),
    reason: payload.reason == null ? null : String(payload.reason),
    policyBundleVersion: payload.policyBundleVersion == null ? null : String(payload.policyBundleVersion),
    policyBundleHash: payload.policyBundleHash == null ? null : String(payload.policyBundleHash),
    issuedAt: String(payload.issuedAt || ''),
    expiresAt: String(payload.expiresAt),
    exp
  } satisfies AuthorizationSimulationTokenPayload
}

export function inspectAuthorizationSimulationToken(
  token: string,
  secret: string,
  nowMs = Date.now()
): AuthorizationSimulationTokenInspection {
  const normalizedSecret = String(secret || '').trim()
  const normalizedToken = String(token || '').trim()
  if (!normalizedSecret) return { valid: false, reason: 'missing_secret' }
  if (!normalizedToken) return { valid: false, reason: 'missing_token' }

  const [body, signature, extra] = normalizedToken.split('.')
  if (!body || !signature || extra !== undefined) return { valid: false, reason: 'malformed' }
  if (!safeEqual(signature, hmac(body, normalizedSecret))) return { valid: false, reason: 'invalid_signature' }

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as Partial<AuthorizationSimulationTokenPayload>
    const normalizedPayload = normalizeAuthorizationSimulationPayload(payload)
    if (!normalizedPayload) return { valid: false, reason: 'invalid_payload' }
    if (normalizedPayload.exp * 1000 <= nowMs) {
      return { valid: false, reason: 'expired', payload: normalizedPayload }
    }

    return { valid: true, payload: normalizedPayload }
  } catch {
    return { valid: false, reason: 'invalid_payload' }
  }
}

export function verifyAuthorizationSimulationToken(token: string, secret: string, nowMs = Date.now()) {
  const inspection = inspectAuthorizationSimulationToken(token, secret, nowMs)
  return inspection.valid ? inspection.payload : null
}
