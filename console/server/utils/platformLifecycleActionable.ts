import { createHash } from 'node:crypto'

export type PlatformLifecycleActionablePhase = 'employment_authorization_sync' | 'offboarding_authorization_reclaim'

export interface PlatformLifecycleActionableIdentity {
  operationId: string
  uid: string
  phase: PlatformLifecycleActionablePhase
  generation: number
  actionableKey: string
  objectVersion: string
  idempotencyKey: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function digest(values: unknown[]) {
  return createHash('sha256').update(values.map(text).join('\n')).digest('hex')
}

/**
 * This identity is source-owned. It intentionally excludes operation_key,
 * command content, command hashes and failure summaries from every portal
 * fact. A future dead-letter generation must use a different generation.
 */
export function platformLifecycleActionableIdentity(input: {
  operationId: unknown
  uid: unknown
  phase: PlatformLifecycleActionablePhase
  generation?: unknown
}): PlatformLifecycleActionableIdentity {
  const operationId = text(input.operationId).toLowerCase()
  const uid = text(input.uid)
  const generation = Number(input.generation || 1)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) {
    throw new Error('platform lifecycle operationId is invalid')
  }
  if (!uid || uid.length > 128 || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('platform lifecycle actionable identity is invalid')
  }
  const stable = digest(['console', 'platform-lifecycle', operationId, String(generation)])
  return {
    operationId,
    uid,
    phase: input.phase,
    generation,
    actionableKey: `console:platform-lifecycle:${stable.slice(0, 48)}:g${generation}`,
    objectVersion: `dead-letter:g${generation}`,
    idempotencyKey: `console:platform-lifecycle-dead-letter:${stable}`
  }
}

export function platformLifecycleActionableMetadata(identity: PlatformLifecycleActionableIdentity) {
  return {
    actionableState: 'pending' as const,
    actionableKey: identity.actionableKey,
    objectVersion: identity.objectVersion,
    eventVersion: identity.objectVersion,
    targetAppCode: 'console',
    actionTargetAppCode: 'console',
    // Production publication resolves its URL from the current signed catalog
    // before this marker is written; callers must never provide this metadata.
    actionTargetCatalogBinding: 'catalog-v1',
    bizKey: `console:people_lifecycle_authorization:${identity.uid}`,
    authorizationDescriptor: {
      resource: 'people_lifecycle_authorization',
      id: identity.uid
    },
    generation: identity.generation
  }
}

export function platformLifecycleClosure(identity: PlatformLifecycleActionableIdentity, state: 'resolved' | 'cancelled') {
  return {
    sourceAppCode: 'console',
    actionableKey: identity.actionableKey,
    expectedVersion: identity.objectVersion,
    nextVersion: `${identity.objectVersion}:${state}`,
    state
  }
}
