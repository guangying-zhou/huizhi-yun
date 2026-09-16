import { createError } from 'h3'
import type { PlatformLifecycleActionablePhase } from './platformLifecycleActionable'

export interface PlatformLifecycleRetryIdentity {
  phase: PlatformLifecycleActionablePhase
  uid: string
}

const supportedPhases = new Set<PlatformLifecycleActionablePhase>([
  'employment_authorization_sync',
  'offboarding_authorization_reclaim'
])

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Browser retries are deliberately an identity-only command. Position,
 * department, actor, reason, idempotency and integration-operation fields are
 * source-owned facts and must never be supplied (or overridden) by a browser.
 */
export function parsePlatformLifecycleRetryIdentity(value: unknown): PlatformLifecycleRetryIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, message: 'retry body must be an object' })
  }
  const body = value as Record<string, unknown>
  const unexpected = Object.keys(body).filter(key => key !== 'phase' && key !== 'uid')
  if (unexpected.length > 0) {
    throw createError({ statusCode: 400, message: 'retry body accepts only phase and uid' })
  }

  const phase = text(body.phase) as PlatformLifecycleActionablePhase
  if (!supportedPhases.has(phase)) {
    throw createError({ statusCode: 400, message: 'phase must be employment_authorization_sync or offboarding_authorization_reclaim' })
  }
  const uid = text(body.uid)
  if (!uid || uid.length > 128) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }
  return { phase, uid }
}
