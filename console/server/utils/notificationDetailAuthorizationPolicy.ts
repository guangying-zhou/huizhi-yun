export interface NotificationDetailAuthorizationPolicyDescriptor {
  resource: string
  id: string
  bizKey?: string
}

export type NotificationDetailAuthorizationPolicyCode
  = 'notification_detail_restricted'
    | 'notification_detail_unavailable'

export class NotificationDetailAuthorizationPolicyError extends Error {
  code: NotificationDetailAuthorizationPolicyCode

  constructor(code: NotificationDetailAuthorizationPolicyCode) {
    super(code)
    this.name = 'NotificationDetailAuthorizationPolicyError'
    this.code = code
  }
}

export interface NotificationDetailAuthorizationPolicyInput<TContext = unknown> {
  sourceAppCode: string
  descriptor: NotificationDetailAuthorizationPolicyDescriptor
  context: TContext
}

export interface NotificationDetailAuthorizationPolicyResponse {
  authorized?: unknown
  resource?: unknown
  id?: unknown
  reasonCode?: unknown
  authorizationChallenge?: unknown
  authorizationEvidence?: unknown
}

export type NotificationDetailAuthorizationPolicyVerifier<TContext = unknown> = (
  input: NotificationDetailAuthorizationPolicyInput<TContext>
) => Promise<NotificationDetailAuthorizationPolicyResponse>

export type NotificationDetailScopeBasis
  = 'unscoped'
    | 'tenant_global'
    | 'department'
    | 'project_code'
    | 'project_member'
    | 'project_owner'

export interface NotificationDetailSubjectScopedDecision {
  allowed: boolean
  policyRevision: number | null
  policyBundleHash: string
  matchedScopes?: Array<{
    dimension?: unknown
    predicate?: unknown
    value?: unknown
  }>
}

export interface NotificationDetailAuthorizationChallenge {
  appCode: 'aims'
  resourceCode: 'projects'
  action: 'admin'
  objectRevision: string
  factsHash: string
  object: {
    projectCode: string
    projectId?: string
    departmentCode?: string
    confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  }
}

export interface NotificationDetailSubjectScopedAuthorizationInput<TContext = unknown> {
  sourceAppCode: 'aims'
  subjectUid: string
  appCode: 'aims'
  resourceCode: 'projects'
  action: 'admin'
  object: {
    actorUid: string
    projectCode: string
    projectId?: string
    departmentCode?: string
    projectMemberUids: string[]
    matchedRelations: string[]
    confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  }
  challenge: NotificationDetailAuthorizationChallenge
  context: TContext
}

export interface NotificationDetailFinalizeBinding {
  allowed: true
  appCode: 'aims'
  resourceCode: 'projects'
  action: 'admin'
  factsHash: string
  policyRevision: number | null
  policyBundleHash: string
  scopeBasis: NotificationDetailScopeBasis[]
}

export type NotificationDetailSubjectScopedAuthorizer<TContext = unknown> = (
  input: NotificationDetailSubjectScopedAuthorizationInput<TContext>
) => Promise<NotificationDetailSubjectScopedDecision>

export type NotificationDetailAuthorizationFinalizer<TContext = unknown> = (
  input: NotificationDetailAuthorizationPolicyInput<TContext>,
  challenge: NotificationDetailAuthorizationChallenge,
  binding: NotificationDetailFinalizeBinding
) => Promise<NotificationDetailAuthorizationPolicyResponse>

const CHALLENGE_KEYS = ['action', 'appCode', 'factsHash', 'object', 'objectRevision', 'resourceCode']
const CHALLENGE_OBJECT_KEYS = [
  'confidentialityLevel',
  'departmentCode',
  'projectCode',
  'projectId'
]

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasExactKeys(record: Record<string, unknown>, allowed: string[], required: string[]) {
  const keys = Object.keys(record).sort()
  return keys.every(key => allowed.includes(key))
    && required.every(key => Object.prototype.hasOwnProperty.call(record, key))
}

function boundedFact(value: unknown, maxLength = 256) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const normalized = stringValue(value)
  if (!normalized || normalized.length > maxLength) return ''
  return [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
    ? ''
    : normalized
}

function optionalFact(record: Record<string, unknown>, key: string, maxLength = 256) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined
  return boundedFact(record[key], maxLength) || null
}

export function normalizeNotificationDetailAuthorizationChallenge(
  input: NotificationDetailAuthorizationPolicyInput,
  response: NotificationDetailAuthorizationPolicyResponse,
  subjectUidInput: string
): NotificationDetailSubjectScopedAuthorizationInput['object'] & {
  challenge: NotificationDetailAuthorizationChallenge
} | null {
  const subjectUid = boundedFact(subjectUidInput, 191)
  if (
    input.sourceAppCode !== 'aims'
    || input.descriptor.resource !== 'work_item'
    || !subjectUid
    || response.authorized !== false
    || stringValue(response.resource) !== input.descriptor.resource
    || stringValue(response.id) !== input.descriptor.id
    || stringValue(response.reasonCode) !== 'scoped_authorization_required'
  ) return null

  const raw = recordValue(response.authorizationChallenge)
  if (!raw || !hasExactKeys(raw, CHALLENGE_KEYS, CHALLENGE_KEYS)) return null
  if (raw.appCode !== 'aims' || raw.resourceCode !== 'projects' || raw.action !== 'admin') return null
  const object = recordValue(raw.object)
  if (!object || !hasExactKeys(object, CHALLENGE_OBJECT_KEYS, ['projectCode', 'confidentialityLevel'])) return null

  const projectCode = boundedFact(object.projectCode, 128)
  const projectId = optionalFact(object, 'projectId', 64)
  const departmentCode = optionalFact(object, 'departmentCode', 128)
  const objectRevision = boundedFact(raw.objectRevision, 128)
  const factsHash = boundedFact(raw.factsHash, 64).toLowerCase()
  const confidentialityLevel = stringValue(object.confidentialityLevel)
  if (
    !projectCode
    || projectId === null
    || departmentCode === null
    || !objectRevision
    || !/^[a-f0-9]{64}$/.test(factsHash)
    || !['L0', 'L1', 'L2', 'L3'].includes(confidentialityLevel)
  ) return null

  const challenge: NotificationDetailAuthorizationChallenge = {
    appCode: 'aims',
    resourceCode: 'projects',
    action: 'admin',
    objectRevision,
    factsHash,
    object: {
      projectCode,
      ...(projectId ? { projectId } : {}),
      ...(departmentCode ? { departmentCode } : {}),
      confidentialityLevel: confidentialityLevel as NotificationDetailAuthorizationChallenge['object']['confidentialityLevel']
    }
  }
  return {
    actorUid: subjectUid,
    projectCode,
    ...(projectId ? { projectId } : {}),
    ...(departmentCode ? { departmentCode } : {}),
    projectMemberUids: [],
    matchedRelations: [],
    confidentialityLevel: challenge.object.confidentialityLevel,
    challenge
  }
}

export function notificationDetailScopeBasis(
  scopes: NotificationDetailSubjectScopedDecision['matchedScopes'] = []
): NotificationDetailScopeBasis[] | null {
  if (!scopes.length) return ['unscoped']
  const result = new Set<NotificationDetailScopeBasis>()
  for (const scope of scopes) {
    const dimension = stringValue(scope.dimension)
    const predicate = stringValue(scope.predicate)
    if (dimension === 'tenant' && predicate === 'global') result.add('tenant_global')
    else if (dimension === 'department' && ['self', 'tree'].includes(predicate)) result.add('department')
    else if (dimension === 'project' && predicate === 'member') result.add('project_member')
    else if (dimension === 'project' && predicate === 'owner') result.add('project_owner')
    else if (dimension === 'project' && predicate === 'code' && boundedFact(scope.value, 128)) result.add('project_code')
    else return null
  }
  return [...result].sort()
}

function isAimsDomainDecisionAllowed(
  challenge: NotificationDetailAuthorizationChallenge,
  decision: NotificationDetailSubjectScopedDecision,
  scopeBasis: NotificationDetailScopeBasis[]
) {
  if (!decision.allowed) return false
  return challenge.object.confidentialityLevel !== 'L3' || !scopeBasis.includes('department')
}

function finalizeResponseMatches(
  descriptor: NotificationDetailAuthorizationPolicyDescriptor,
  response: NotificationDetailAuthorizationPolicyResponse,
  challenge: NotificationDetailAuthorizationChallenge,
  binding: NotificationDetailFinalizeBinding
) {
  if (!notificationAuthorizationResponseMatches(descriptor, response)) return false
  const evidence = recordValue(response.authorizationEvidence)
  if (!evidence || !hasExactKeys(evidence, ['factsHash', 'objectRevision', 'policyBundleHash', 'policyRevision', 'scopeBasis'], [
    'factsHash', 'objectRevision', 'policyBundleHash', 'policyRevision', 'scopeBasis'
  ])) return false
  return evidence.factsHash === challenge.factsHash
    && evidence.objectRevision === challenge.objectRevision
    && evidence.policyRevision === binding.policyRevision
    && evidence.policyBundleHash === binding.policyBundleHash
    && Array.isArray(evidence.scopeBasis)
    && evidence.scopeBasis.length === binding.scopeBasis.length
    && evidence.scopeBasis.every((value, index) => value === binding.scopeBasis[index])
}

function responseStatusCode(error: unknown) {
  const candidate = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
  }
  return Number(candidate?.statusCode || candidate?.status || candidate?.response?.status || 0)
}

function policyError(code: NotificationDetailAuthorizationPolicyCode) {
  return new NotificationDetailAuthorizationPolicyError(code)
}

export function notificationAuthorizationResponseMatches(
  descriptor: NotificationDetailAuthorizationPolicyDescriptor,
  response: NotificationDetailAuthorizationPolicyResponse
) {
  return response.authorized === true
    && String(response.resource || '').trim() === descriptor.resource
    && String(response.id || '').trim() === descriptor.id
}

export async function authorizeNotificationDetail<TContext>(
  input: NotificationDetailAuthorizationPolicyInput<TContext>,
  verifier: NotificationDetailAuthorizationPolicyVerifier<TContext> | null,
  subjectUid = '',
  subjectScopedAuthorizer: NotificationDetailSubjectScopedAuthorizer<TContext> | null = null,
  finalizer: NotificationDetailAuthorizationFinalizer<TContext> | null = null
) {
  if (!verifier) throw policyError('notification_detail_unavailable')

  let response: NotificationDetailAuthorizationPolicyResponse
  try {
    response = await verifier(input)
  } catch (error) {
    if ([401, 403, 404].includes(responseStatusCode(error))) {
      throw policyError('notification_detail_restricted')
    }
    throw policyError('notification_detail_unavailable')
  }

  if (notificationAuthorizationResponseMatches(input.descriptor, response)) return

  if (
    response.authorized !== false
    || String(response.resource || '').trim() !== input.descriptor.resource
    || String(response.id || '').trim() !== input.descriptor.id
  ) {
    throw policyError('notification_detail_restricted')
  }

  if (stringValue(response.reasonCode) !== 'scoped_authorization_required') {
    throw policyError('notification_detail_restricted')
  }

  const normalized = normalizeNotificationDetailAuthorizationChallenge(input, response, subjectUid)
  if (!normalized || !subjectScopedAuthorizer || !finalizer) {
    throw policyError('notification_detail_unavailable')
  }

  let decision: NotificationDetailSubjectScopedDecision
  try {
    decision = await subjectScopedAuthorizer({
      sourceAppCode: 'aims',
      subjectUid: normalized.actorUid,
      appCode: 'aims',
      resourceCode: 'projects',
      action: 'admin',
      object: {
        actorUid: normalized.actorUid,
        projectCode: normalized.projectCode,
        ...(normalized.projectId ? { projectId: normalized.projectId } : {}),
        ...(normalized.departmentCode ? { departmentCode: normalized.departmentCode } : {}),
        projectMemberUids: normalized.projectMemberUids,
        matchedRelations: normalized.matchedRelations,
        confidentialityLevel: normalized.confidentialityLevel
      },
      challenge: normalized.challenge,
      context: input.context
    })
  } catch {
    throw policyError('notification_detail_unavailable')
  }

  const scopeBasis = notificationDetailScopeBasis(decision.matchedScopes)
  const policyBundleHash = boundedFact(decision.policyBundleHash, 128)
  if (
    !scopeBasis
    || !policyBundleHash
    || !/^[A-Za-z0-9._:-]+$/.test(policyBundleHash)
    || (decision.policyRevision !== null && !Number.isSafeInteger(decision.policyRevision))
  ) {
    throw policyError('notification_detail_unavailable')
  }
  if (!isAimsDomainDecisionAllowed(normalized.challenge, decision, scopeBasis)) {
    throw policyError('notification_detail_restricted')
  }

  let finalized: NotificationDetailAuthorizationPolicyResponse
  try {
    const binding: NotificationDetailFinalizeBinding = {
      allowed: true,
      appCode: 'aims',
      resourceCode: 'projects',
      action: 'admin',
      factsHash: normalized.challenge.factsHash,
      policyRevision: decision.policyRevision,
      policyBundleHash,
      scopeBasis
    }
    finalized = await finalizer(input, normalized.challenge, binding)
    if (!finalizeResponseMatches(input.descriptor, finalized, normalized.challenge, binding)) {
      throw policyError('notification_detail_restricted')
    }
  } catch (error) {
    if (error instanceof NotificationDetailAuthorizationPolicyError) throw error
    if ([401, 403, 404].includes(responseStatusCode(error))) {
      throw policyError('notification_detail_restricted')
    }
    throw policyError('notification_detail_unavailable')
  }
}
