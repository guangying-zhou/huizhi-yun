import type { H3Event } from 'h3'
import { deleteCookie, getCookie, getHeader, setCookie } from 'h3'
import { useRuntimeConfig } from '#imports'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { execute } from '~~/server/utils/db'
import { getAuthRequestIp } from '~~/server/utils/authAudit'
import {
  createAuthorizationSimulationId,
  inspectAuthorizationSimulationToken,
  signAuthorizationSimulationToken,
  type AuthorizationSimulationTokenInvalidReason,
  type AuthorizationSimulationTokenPayload
} from '~~/server/utils/authorizationSimulationToken'

export const AUTHORIZATION_SIMULATION_COOKIE = 'hzy_authorization_simulation'

export interface CreateRoleSimulationSessionInput {
  actorUid: string
  roleCode: string
  reason?: string | null
  includeBaseline?: boolean
  ttlMinutes?: number | null
  policyBundleVersion?: string | null
  policyBundleHash?: string | null
}

export interface CreateUserSimulationSessionInput {
  actorUid: string
  subjectCode: string
  reason?: string | null
  ttlMinutes?: number | null
  policyBundleVersion?: string | null
  policyBundleHash?: string | null
}

export interface AuthorizationSimulationAuditInput {
  action: 'create' | 'delete' | 'denied' | 'failed' | 'blocked' | 'expired' | 'invalidated'
  actorUid?: string | null
  sessionId?: string | null
  mode?: string | null
  roleCode?: string | null
  subjectCode?: string | null
  includeBaseline?: boolean | null
  reason?: string | null
  result?: 'success' | 'failed'
  failureReason?: string | null
  resourceCode?: string | null
  permissionAction?: string | null
  restrictionReason?: string | null
  expiresAt?: string | null
  policyBundleVersion?: string | null
  policyBundleHash?: string | null
  expectedPolicyBundleVersion?: string | null
  expectedPolicyBundleHash?: string | null
}

export type AuthorizationSimulationSessionInvalidReason
  = | AuthorizationSimulationTokenInvalidReason
    | 'actor_mismatch'
    | 'policy_changed'

export interface AuthorizationSimulationPolicyFingerprint {
  bundleVersion?: string | null
  bundleHash?: string | null
}

export interface AuthorizationSimulationSessionInspection {
  session: AuthorizationSimulationTokenPayload | null
  reason: AuthorizationSimulationSessionInvalidReason | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function isHttps(event: H3Event) {
  const proto = String(getHeader(event, 'x-forwarded-proto') || '').toLowerCase()
  return proto === 'https'
}

function runtimeValue(event: H3Event, path: string[]) {
  let value: unknown = useRuntimeConfig(event)
  for (const key of path) {
    if (!value || typeof value !== 'object') return ''
    value = (value as Record<string, unknown>)[key]
  }
  return stringValue(value)
}

function simulationSecret(event: H3Event) {
  const explicit = stringValue(process.env.CONSOLE_AUTH_SIMULATION_SECRET)
    || stringValue(process.env.HZY_CONSOLE_AUTH_SIMULATION_SECRET)
    || runtimeValue(event, ['auth', 'simulationSecret'])
  if (explicit) return explicit

  const runMode = stringValue(process.env.HZY_CONSOLE_RUN_MODE || process.env.CONSOLE_RUN_MODE || runtimeValue(event, ['consoleRuntime', 'runMode'])).toLowerCase()
  if (runMode === 'dev') {
    return stringValue(process.env.CONSOLE_AUTH_SIGNING_PRIVATE_JWK)
      || 'hzy-console-dev-authorization-simulation'
  }

  return ''
}

function cookieOptions(event: H3Event, maxAge?: number) {
  return getAuthCookieOptions(event, {
    httpOnly: true,
    secure: isHttps(event),
    ...(typeof maxAge === 'number' ? { maxAge } : {})
  })
}

function ttlSeconds(input: number | null | undefined) {
  const minutes = Number(input || 30)
  const bounded = Math.min(30, Math.max(1, Number.isFinite(minutes) ? Math.floor(minutes) : 30))
  return bounded * 60
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000)
}

function policyFingerprintChanged(
  payload: AuthorizationSimulationTokenPayload,
  expectedPolicy?: AuthorizationSimulationPolicyFingerprint | null
) {
  const expectedVersion = stringValue(expectedPolicy?.bundleVersion)
  const expectedHash = stringValue(expectedPolicy?.bundleHash)
  if (!expectedVersion && !expectedHash) return false

  const payloadVersion = stringValue(payload.policyBundleVersion)
  const payloadHash = stringValue(payload.policyBundleHash)

  if (expectedVersion && payloadVersion !== expectedVersion) return true
  if (expectedHash && payloadHash !== expectedHash) return true
  return false
}

export function createRoleSimulationSessionPayload(input: CreateRoleSimulationSessionInput): AuthorizationSimulationTokenPayload {
  const ttl = ttlSeconds(input.ttlMinutes)
  const expiresAt = addSeconds(ttl)
  const actorUid = stringValue(input.actorUid)
  const roleCode = stringValue(input.roleCode)

  if (!actorUid) {
    throw new Error('actorUid is required')
  }
  if (!roleCode) {
    throw new Error('roleCode is required')
  }

  return {
    v: 1,
    sid: createAuthorizationSimulationId(),
    actorUid,
    mode: 'role_simulation',
    roleCode,
    subjectCode: null,
    includeBaseline: input.includeBaseline !== false,
    reason: stringValue(input.reason).slice(0, 500) || null,
    policyBundleVersion: stringValue(input.policyBundleVersion) || null,
    policyBundleHash: stringValue(input.policyBundleHash) || null,
    issuedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    exp: Math.floor(expiresAt.getTime() / 1000)
  }
}

export function createUserSimulationSessionPayload(input: CreateUserSimulationSessionInput): AuthorizationSimulationTokenPayload {
  const ttl = ttlSeconds(input.ttlMinutes)
  const expiresAt = addSeconds(ttl)
  const actorUid = stringValue(input.actorUid)
  const subjectCode = stringValue(input.subjectCode)

  if (!actorUid) {
    throw new Error('actorUid is required')
  }
  if (!subjectCode) {
    throw new Error('subjectCode is required')
  }

  return {
    v: 1,
    sid: createAuthorizationSimulationId(),
    actorUid,
    mode: 'user_simulation',
    roleCode: null,
    subjectCode,
    includeBaseline: true,
    reason: stringValue(input.reason).slice(0, 500) || null,
    policyBundleVersion: stringValue(input.policyBundleVersion) || null,
    policyBundleHash: stringValue(input.policyBundleHash) || null,
    issuedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    exp: Math.floor(expiresAt.getTime() / 1000)
  }
}

export function writeAuthorizationSimulationSession(event: H3Event, payload: AuthorizationSimulationTokenPayload) {
  const secret = simulationSecret(event)
  if (!secret) {
    throw new Error('CONSOLE_AUTH_SIMULATION_SECRET is required for authorization simulation sessions')
  }

  const maxAge = Math.max(1, Math.floor((payload.exp * 1000 - Date.now()) / 1000))
  const token = signAuthorizationSimulationToken(payload, secret)
  setCookie(event, AUTHORIZATION_SIMULATION_COOKIE, token, cookieOptions(event, maxAge))
}

export function clearAuthorizationSimulationSession(event: H3Event) {
  deleteCookie(event, AUTHORIZATION_SIMULATION_COOKIE, cookieOptions(event, 0))
}

export function inspectAuthorizationSimulationSession(
  event: H3Event,
  actorUid?: string | null,
  expectedPolicy?: AuthorizationSimulationPolicyFingerprint | null
): AuthorizationSimulationSessionInspection {
  const token = stringValue(getCookie(event, AUTHORIZATION_SIMULATION_COOKIE))
  if (!token) return { session: null, reason: null }

  const inspection = inspectAuthorizationSimulationToken(token, simulationSecret(event))
  const expectedActorUid = stringValue(actorUid)

  if (inspection.valid) {
    if (expectedActorUid && inspection.payload.actorUid !== expectedActorUid) {
      return { session: null, reason: 'actor_mismatch' }
    }
    if (policyFingerprintChanged(inspection.payload, expectedPolicy)) {
      return { session: inspection.payload, reason: 'policy_changed' }
    }

    return { session: inspection.payload, reason: null }
  }

  if (inspection.reason === 'expired' && inspection.payload) {
    if (expectedActorUid && inspection.payload.actorUid !== expectedActorUid) {
      return { session: null, reason: 'actor_mismatch' }
    }

    return { session: inspection.payload, reason: 'expired' }
  }

  return { session: null, reason: inspection.reason }
}

export function readAuthorizationSimulationSession(event: H3Event, actorUid?: string | null) {
  const inspection = inspectAuthorizationSimulationSession(event, actorUid)
  return inspection.reason ? null : inspection.session
}

export async function expireAuthorizationSimulationSessionIfNeeded(
  event: H3Event,
  actorUid?: string | null,
  expectedPolicy?: AuthorizationSimulationPolicyFingerprint | null
) {
  const inspection = inspectAuthorizationSimulationSession(event, actorUid, expectedPolicy)
  if ((inspection.reason !== 'expired' && inspection.reason !== 'policy_changed') || !inspection.session) {
    return inspection
  }

  const simulation = inspection.session
  const policyChanged = inspection.reason === 'policy_changed'
  clearAuthorizationSimulationSession(event)
  await writeAuthorizationSimulationAudit(event, {
    action: policyChanged ? 'invalidated' : 'expired',
    actorUid: simulation.actorUid,
    sessionId: simulation.sid,
    mode: simulation.mode,
    roleCode: simulation.roleCode,
    subjectCode: simulation.subjectCode,
    includeBaseline: simulation.includeBaseline,
    reason: simulation.reason,
    result: 'failed',
    failureReason: policyChanged
      ? 'authorization simulation session invalidated by policy bundle change'
      : 'authorization simulation session expired',
    expiresAt: simulation.expiresAt,
    policyBundleVersion: simulation.policyBundleVersion,
    policyBundleHash: simulation.policyBundleHash,
    expectedPolicyBundleVersion: expectedPolicy?.bundleVersion,
    expectedPolicyBundleHash: expectedPolicy?.bundleHash
  })

  return inspection
}

export async function writeAuthorizationSimulationAudit(event: H3Event, input: AuthorizationSimulationAuditInput) {
  try {
    await execute(
      `INSERT INTO operation_logs (
         domain_code, action, target_type, target_key, actor_type, actor_id, request_id, detail_json, created_at
       ) VALUES ('authorization_simulation', ?, ?, ?, 'human', ?, ?, CAST(? AS JSON), NOW())`,
      [
        `simulation.${input.action}`,
        input.mode || 'authorization_simulation',
        stringValue(input.roleCode) || stringValue(input.subjectCode) || null,
        stringValue(input.actorUid) || null,
        stringValue(input.sessionId) || null,
        JSON.stringify({
          result: input.result || (input.action === 'denied' || input.action === 'failed' || input.action === 'expired' || input.action === 'invalidated' ? 'failed' : 'success'),
          mode: stringValue(input.mode) || null,
          roleCode: stringValue(input.roleCode) || null,
          subjectCode: stringValue(input.subjectCode) || null,
          includeBaseline: typeof input.includeBaseline === 'boolean' ? input.includeBaseline : null,
          reason: stringValue(input.reason) || null,
          failureReason: stringValue(input.failureReason) || null,
          resourceCode: stringValue(input.resourceCode) || null,
          permissionAction: stringValue(input.permissionAction) || null,
          restrictionReason: stringValue(input.restrictionReason) || null,
          expiresAt: stringValue(input.expiresAt) || null,
          policyBundleVersion: stringValue(input.policyBundleVersion) || null,
          policyBundleHash: stringValue(input.policyBundleHash) || null,
          expectedPolicyBundleVersion: stringValue(input.expectedPolicyBundleVersion) || null,
          expectedPolicyBundleHash: stringValue(input.expectedPolicyBundleHash) || null,
          ipAddress: getAuthRequestIp(event)
        })
      ]
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[AuthorizationSimulation] Failed to write audit log: ${message}`)
  }
}
