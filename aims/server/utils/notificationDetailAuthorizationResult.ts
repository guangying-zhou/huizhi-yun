import { createError } from 'h3'

export type AimsNotificationAuthorizationScopeBasis
  = 'unscoped'
    | 'tenant_global'
    | 'department'
    | 'project_code'
    | 'project_member'
    | 'project_owner'

export interface AimsNotificationAuthorizationChallenge {
  appCode: 'aims'
  resourceCode: 'projects'
  action: 'admin'
  objectRevision: string
  factsHash: string
  object: {
    projectCode: string
    projectId: string
    departmentCode?: string
    confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  }
}

export interface AimsNotificationAuthorizationDecisionBinding {
  allowed: true
  appCode: 'aims'
  resourceCode: 'projects'
  action: 'admin'
  factsHash: string
  policyRevision: number | null
  policyBundleHash: string
  scopeBasis: AimsNotificationAuthorizationScopeBasis[]
}

export interface AimsNotificationDetailAuthorizationResult {
  authorized: boolean
  reasonCode: string
  resource: 'work_item' | 'integration_operation'
  id: string
  authorizationChallenge?: AimsNotificationAuthorizationChallenge
  authorizationEvidence?: {
    factsHash: string
    objectRevision: string
    policyRevision: number | null
    policyBundleHash: string
    scopeBasis: AimsNotificationAuthorizationScopeBasis[]
  }
}

export interface AimsIntegrationOperationNotificationDescriptor {
  resource: 'integration_operation'
  id: string
}

const INTEGRATION_OPERATION_REJECTION_REASONS = new Set([
  'not_found',
  'not_recipient',
  'stale_notification'
])

const SCOPE_BASIS = new Set<AimsNotificationAuthorizationScopeBasis>([
  'unscoped',
  'tenant_global',
  'department',
  'project_code',
  'project_member',
  'project_owner'
])

function unavailable(): never {
  throw createError({ statusCode: 503, message: 'Aims notification authorization is unavailable.' })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown) {
  return String(value || '').trim()
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n')
}

function sha256(value: unknown) {
  return /^[a-f0-9]{64}$/.test(text(value))
}

function integrationOperationId(value: unknown) {
  const result = text(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)
    ? result
    : ''
}

export function requireAimsIntegrationOperationNotificationDescriptor(
  value: unknown
): AimsIntegrationOperationNotificationDescriptor {
  const descriptor = record(value)
  const id = integrationOperationId(descriptor?.id)
  if (
    !descriptor
    || !exactKeys(descriptor, ['resource', 'id'])
    || descriptor.resource !== 'integration_operation'
    || !id
  ) unavailable()
  return { resource: 'integration_operation', id }
}

function requireAimsIntegrationOperationAuthorizationResult(
  value: unknown,
  expected: AimsIntegrationOperationNotificationDescriptor
): AimsNotificationDetailAuthorizationResult {
  const result = record(value)
  if (
    !result
    || !exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id'])
    || result.resource !== expected.resource
    || result.id !== expected.id
  ) unavailable()
  if (result.authorized === true && result.reasonCode === 'allowed') {
    return { authorized: true, reasonCode: 'allowed', ...expected }
  }
  if (
    result.authorized === false
    && INTEGRATION_OPERATION_REJECTION_REASONS.has(text(result.reasonCode))
  ) {
    return { authorized: false, reasonCode: text(result.reasonCode), ...expected }
  }
  unavailable()
}

function scopeBasis(value: unknown): AimsNotificationAuthorizationScopeBasis[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > SCOPE_BASIS.size) unavailable()
  const result = value.map(item => text(item) as AimsNotificationAuthorizationScopeBasis)
  if (result.some(item => !SCOPE_BASIS.has(item))) unavailable()
  const canonical = [...new Set(result)].sort()
  if (canonical.join('\n') !== result.join('\n')) unavailable()
  return result
}

export function requireAimsNotificationAuthorizationChallenge(
  value: unknown
): AimsNotificationAuthorizationChallenge {
  const challenge = record(value)
  const object = record(challenge?.object)
  if (
    !challenge
    || !object
    || !exactKeys(challenge, ['appCode', 'resourceCode', 'action', 'objectRevision', 'factsHash', 'object'])
    || !exactKeys(object, [
      'projectCode',
      'projectId',
      ...(object.departmentCode === undefined ? [] : ['departmentCode']),
      'confidentialityLevel'
    ])
    || challenge.appCode !== 'aims'
    || challenge.resourceCode !== 'projects'
    || challenge.action !== 'admin'
    || !text(challenge.objectRevision)
    || text(challenge.objectRevision).length > 128
    || !sha256(challenge.factsHash)
    || !text(object.projectCode)
    || text(object.projectCode).length > 64
    || !/^[1-9]\d{0,18}$/.test(text(object.projectId))
    || !['L0', 'L1', 'L2', 'L3'].includes(text(object.confidentialityLevel))
    || (object.departmentCode !== undefined && (!text(object.departmentCode) || text(object.departmentCode).length > 64))
  ) unavailable()

  return {
    appCode: 'aims',
    resourceCode: 'projects',
    action: 'admin',
    objectRevision: text(challenge.objectRevision),
    factsHash: text(challenge.factsHash),
    object: {
      projectCode: text(object.projectCode),
      projectId: text(object.projectId),
      ...(object.departmentCode === undefined ? {} : { departmentCode: text(object.departmentCode) }),
      confidentialityLevel: text(object.confidentialityLevel) as 'L0' | 'L1' | 'L2' | 'L3'
    }
  }
}

export function requireAimsNotificationAuthorizationDecisionBinding(
  value: unknown,
  challenge: AimsNotificationAuthorizationChallenge
): AimsNotificationAuthorizationDecisionBinding {
  const decision = record(value)
  if (
    !decision
    || !exactKeys(decision, ['allowed', 'appCode', 'resourceCode', 'action', 'factsHash', 'policyRevision', 'policyBundleHash', 'scopeBasis'])
    || decision.allowed !== true
    || decision.appCode !== 'aims'
    || decision.resourceCode !== 'projects'
    || decision.action !== 'admin'
    || text(decision.factsHash) !== challenge.factsHash
    || (decision.policyRevision !== null && (!Number.isSafeInteger(decision.policyRevision) || Number(decision.policyRevision) < 0))
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(text(decision.policyBundleHash))
  ) unavailable()
  return {
    allowed: true,
    appCode: 'aims',
    resourceCode: 'projects',
    action: 'admin',
    factsHash: challenge.factsHash,
    policyRevision: decision.policyRevision as number | null,
    policyBundleHash: text(decision.policyBundleHash),
    scopeBasis: scopeBasis(decision.scopeBasis)
  }
}

export function parseAimsNotificationFinalizeBinding(value: unknown) {
  const input = record(value) || {}
  const challenge = requireAimsNotificationAuthorizationChallenge(input.authorizationChallenge)
  return {
    challenge,
    decision: requireAimsNotificationAuthorizationDecisionBinding(input.decisionBinding, challenge)
  }
}

function exactDescriptorResult(result: Record<string, unknown>, descriptor: Record<string, unknown>) {
  return result.resource === 'work_item'
    && text(result.resource) === text(descriptor.resource)
    && text(result.id) === text(descriptor.id)
}

export function requireAimsNotificationDetailAuthorizationResult(
  value: unknown,
  descriptor: Record<string, unknown>
): AimsNotificationDetailAuthorizationResult {
  if (descriptor.resource === 'integration_operation') {
    const expected = requireAimsIntegrationOperationNotificationDescriptor(descriptor)
    return requireAimsIntegrationOperationAuthorizationResult(value, expected)
  }
  const result = record(value)
  if (!result || !exactDescriptorResult(result, descriptor)) unavailable()

  if (result.authorized === true) {
    if (!exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id']) || result.reasonCode !== 'allowed') unavailable()
    return { authorized: true, reasonCode: 'allowed', resource: 'work_item', id: text(result.id) }
  }
  if (result.authorized !== false) unavailable()
  if (result.reasonCode === 'scoped_authorization_required') {
    if (!exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id', 'authorizationChallenge'])) unavailable()
    return {
      authorized: false,
      reasonCode: 'scoped_authorization_required',
      resource: 'work_item',
      id: text(result.id),
      authorizationChallenge: requireAimsNotificationAuthorizationChallenge(result.authorizationChallenge)
    }
  }
  if (!exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id']) || result.reasonCode !== 'not_found') unavailable()
  return { authorized: false, reasonCode: 'not_found', resource: 'work_item', id: text(result.id) }
}

export function requireAimsNotificationDetailFinalizeResult(
  value: unknown,
  descriptor: Record<string, unknown>,
  challenge: AimsNotificationAuthorizationChallenge,
  decision: AimsNotificationAuthorizationDecisionBinding
): AimsNotificationDetailAuthorizationResult {
  const result = record(value)
  if (!result || !exactDescriptorResult(result, descriptor)) unavailable()
  if (result.authorized === false) {
    if (!exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id']) || !text(result.reasonCode)) unavailable()
    return {
      authorized: false,
      reasonCode: text(result.reasonCode),
      resource: 'work_item',
      id: text(result.id)
    }
  }
  const evidence = record(result.authorizationEvidence)
  if (
    result.authorized !== true
    || result.reasonCode !== 'allowed'
    || !exactKeys(result, ['authorized', 'reasonCode', 'resource', 'id', 'authorizationEvidence'])
    || !evidence
    || !exactKeys(evidence, ['factsHash', 'objectRevision', 'policyRevision', 'policyBundleHash', 'scopeBasis'])
    || text(evidence.factsHash) !== challenge.factsHash
    || text(evidence.objectRevision) !== challenge.objectRevision
    || evidence.policyRevision !== decision.policyRevision
    || text(evidence.policyBundleHash) !== decision.policyBundleHash
  ) unavailable()
  const evidenceScopeBasis = scopeBasis(evidence.scopeBasis)
  if (evidenceScopeBasis.join('\n') !== decision.scopeBasis.join('\n')) unavailable()
  return {
    authorized: true,
    reasonCode: 'allowed',
    resource: 'work_item',
    id: text(result.id),
    authorizationEvidence: {
      factsHash: challenge.factsHash,
      objectRevision: challenge.objectRevision,
      policyRevision: decision.policyRevision,
      policyBundleHash: decision.policyBundleHash,
      scopeBasis: evidenceScopeBasis
    }
  }
}
