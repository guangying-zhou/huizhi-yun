import { actionSatisfies } from '@hzy/authz-core'
import {
  createRoleSimulationSessionPayload,
  createUserSimulationSessionPayload,
  writeAuthorizationSimulationAudit,
  writeAuthorizationSimulationSession
} from '~~/server/utils/authorizationSimulation'
import { resolveConsoleSession } from '~~/server/utils/authSession'
import { loadPolicyAuthorizationSnapshot } from '~~/server/utils/policyAuthorization'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value
  const normalized = stringValue(value).toLowerCase()
  if (!normalized) return fallback
  return !['0', 'false', 'no', 'off'].includes(normalized)
}

function numberValue(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function hasCapability(resources: Record<string, string[]>, resourceCode: string, action: string) {
  return (resources[resourceCode] || []).some(held => actionSatisfies(held, action))
}

export default defineEventHandler(async (event) => {
  const session = await resolveConsoleSession(event)
  const body = await readBody<Record<string, unknown>>(event)
  const mode = stringValue(body.mode) || 'role_simulation'
  const isRoleSimulation = mode === 'role_simulation'
  const isUserSimulation = mode === 'user_simulation'

  if (!isRoleSimulation && !isUserSimulation) {
    await writeAuthorizationSimulationAudit(event, {
      action: 'denied',
      actorUid: session.uid,
      mode,
      roleCode: stringValue(body.roleCode),
      subjectCode: stringValue(body.subjectCode),
      failureReason: `unsupported simulation mode: ${mode}`
    })
    throw createError({ statusCode: 400, message: `unsupported simulation mode: ${mode}` })
  }

  const roleCode = stringValue(body.roleCode)
  const subjectCode = stringValue(body.subjectCode)
  if (isRoleSimulation && !roleCode) {
    await writeAuthorizationSimulationAudit(event, {
      action: 'denied',
      actorUid: session.uid,
      mode,
      failureReason: 'roleCode is required'
    })
    throw createError({ statusCode: 400, message: 'roleCode is required' })
  }
  if (isUserSimulation && !subjectCode) {
    await writeAuthorizationSimulationAudit(event, {
      action: 'denied',
      actorUid: session.uid,
      mode,
      failureReason: 'subjectCode is required'
    })
    throw createError({ statusCode: 400, message: 'subjectCode is required' })
  }

  const snapshot = await loadPolicyAuthorizationSnapshot(session.uid, 'platform', event, {
    ignoreSimulationSession: true
  })
  const requiredAction = isUserSimulation ? 'simulate-user' : 'simulate-role'
  if (!hasCapability(snapshot.resources, 'authorization', requiredAction)) {
    await writeAuthorizationSimulationAudit(event, {
      action: 'denied',
      actorUid: session.uid,
      mode,
      roleCode,
      subjectCode,
      failureReason: `platform:authorization:${requiredAction} is required`
    })
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `platform:authorization:${requiredAction} is required`
    })
  }

  const includeBaseline = isRoleSimulation ? booleanValue(body.includeBaseline, true) : true
  const reason = stringValue(body.reason)
  const ttlMinutes = numberValue(body.ttlMinutes)
  const payload = isUserSimulation
    ? createUserSimulationSessionPayload({
        actorUid: session.uid,
        subjectCode,
        ttlMinutes,
        reason,
        policyBundleVersion: snapshot.bundleVersion,
        policyBundleHash: snapshot.bundleHash
      })
    : createRoleSimulationSessionPayload({
        actorUid: session.uid,
        roleCode,
        includeBaseline,
        ttlMinutes,
        reason,
        policyBundleVersion: snapshot.bundleVersion,
        policyBundleHash: snapshot.bundleHash
      })

  try {
    writeAuthorizationSimulationSession(event, payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeAuthorizationSimulationAudit(event, {
      action: 'failed',
      actorUid: session.uid,
      sessionId: payload.sid,
      mode: payload.mode,
      roleCode: payload.roleCode,
      subjectCode: payload.subjectCode,
      includeBaseline: payload.includeBaseline,
      reason,
      failureReason: message,
      expiresAt: payload.expiresAt,
      policyBundleVersion: payload.policyBundleVersion,
      policyBundleHash: payload.policyBundleHash
    })
    throw createError({ statusCode: 500, message })
  }

  await writeAuthorizationSimulationAudit(event, {
    action: 'create',
    actorUid: session.uid,
    sessionId: payload.sid,
    mode: payload.mode,
    roleCode: payload.roleCode,
    subjectCode: payload.subjectCode,
    includeBaseline: payload.includeBaseline,
    reason,
    expiresAt: payload.expiresAt,
    policyBundleVersion: payload.policyBundleVersion,
    policyBundleHash: payload.policyBundleHash
  })

  return {
    code: 0,
    data: {
      sid: payload.sid,
      mode: payload.mode,
      actorUid: payload.actorUid,
      roleCode: payload.roleCode,
      subjectCode: payload.subjectCode,
      includeBaseline: payload.includeBaseline,
      reason: payload.reason,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      policyBundleVersion: payload.policyBundleVersion,
      policyBundleHash: payload.policyBundleHash
    }
  }
})
