export interface SubjectEligibilityRequest {
  subjectUid: string
  targetAppCode: string
  resourceCode: string
  action: 'view' | 'approve' | 'reject' | 'delegate' | 'cancel' | 'resubmit'
  purpose: string
  tenantId: string
  deploymentId: string
}
export interface SubjectEligibilityClientRequest { subjectUid: string, purpose: string }

export interface SubjectEligibilityResponse {
  active: boolean
  allowed: boolean
  reason: 'allowed' | 'subject_inactive' | 'permission_denied'
  policyRevision: number | null
}

export interface SubjectEligibilityActor {
  actorType: string
  actorId: string | null
  appCode?: string | null
  tenantCode?: string | null
  deploymentCode?: string | null
}

/**
 * Console-owned detail eligibility is deliberately separate from the public
 * producer-purpose registry below.  The detail descriptor comes from the
 * persisted notification row and this table is the only place that turns it
 * into a policy permission.  Neither a browser nor a source verifier can
 * choose the resource/action that is evaluated first.
 */
export interface NotificationDetailEligibilityTarget {
  targetAppCode: string
  resourceCode: string
  action: 'view'
}

export class SubjectEligibilityError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'SubjectEligibilityError'
    this.statusCode = statusCode
    this.code = code
  }
}

const registry = new Map<string, Pick<SubjectEligibilityRequest, 'resourceCode' | 'action'>>([
  ['aims|response_due', { resourceCode: 'work_items', action: 'view' }],
  ['aims|resolution_due', { resourceCode: 'work_items', action: 'view' }],
  ['aims|work_item_due', { resourceCode: 'work_items', action: 'view' }],
  ['assets|resource_expiry', { resourceCode: 'asset_items', action: 'view' }],
  ['assets|ip_expiry', { resourceCode: 'ip_assets', action: 'view' }],
  ['assets|delivery_expiry', { resourceCode: 'deliveries', action: 'view' }],
  ['assets|delivery_warranty', { resourceCode: 'deliveries', action: 'view' }],
  ['assets|delivery_support', { resourceCode: 'deliveries', action: 'view' }],
  ['assets|offboarding_unrecovered', { resourceCode: 'offboarding_recoveries', action: 'view' }],
  ['people|offboarding_handover_due', { resourceCode: 'offboarding_tasks', action: 'view' }],
  ['people|offboarding_asset_recovery_due', { resourceCode: 'offboarding_tasks', action: 'view' }],
  ['workflow|task_actionable', { resourceCode: 'workflow_tasks', action: 'view' }],
  ['workflow|instance_actionable', { resourceCode: 'workflow_instances', action: 'view' }],
  ['workflow|instance_status', { resourceCode: 'workflow_instances', action: 'view' }],
  ['workflow|task_approve', { resourceCode: 'workflow_tasks', action: 'approve' }],
  ['workflow|task_reject', { resourceCode: 'workflow_tasks', action: 'reject' }],
  ['workflow|task_delegate', { resourceCode: 'workflow_tasks', action: 'delegate' }],
  ['workflow|instance_cancel', { resourceCode: 'workflow_instances', action: 'cancel' }],
  ['workflow|instance_resubmit', { resourceCode: 'workflow_instances', action: 'resubmit' }],
  ['finance|invoice_issuance_due', { resourceCode: 'invoices', action: 'view' }],
  ['finance|receipt_reconciliation_due', { resourceCode: 'receipts', action: 'view' }],
  ['altoc|receivable_plan_due', { resourceCode: 'receivable', action: 'view' }]
])

const notificationDetailRegistry = new Map([
  ['workflow|workflow_task', 'workflow_tasks'],
  ['workflow|workflow_instance', 'workflow_instances'],
  ['aims|work_item', 'work_items'],
  ['aims|webdev_issue', 'work_items'],
  ['aims|integration_operation', 'integration_operations'],
  ['assets|asset_item', 'asset_items'],
  ['assets|ip_asset', 'ip_assets'],
  ['assets|customer_delivery_asset', 'deliveries'],
  ['assets|offboarding_recovery_case', 'offboarding_recoveries'],
  ['assets|integration_operation', 'integration_operations'],
  ['people|offboarding_task', 'offboarding_tasks'],
  ['people|integration_operation', 'integration_operations'],
  ['finance|invoice_request', 'invoices'],
  ['finance|finance_receipt', 'receipts'],
  ['finance|integration_operation', 'integration_operations'],
  ['altoc|receivable_plan', 'receivable'],
  ['altoc|integration_operation', 'integration_operations']
])

const allowedKeys = new Set([
  'subjectUid', 'purpose'
])
const text = (value: unknown) => String(value || '').trim()
const hasControlCharacter = (value: string) => [...value].some((character) => {
  const code = character.codePointAt(0) || 0
  return code < 32 || code === 127
})

export function parseSubjectEligibilityRequest(body: unknown): SubjectEligibilityClientRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SubjectEligibilityError(400, 'subject_eligibility_request_invalid', 'request body must be an object')
  }
  const raw = body as Record<string, unknown>
  if (Object.keys(raw).some(key => !allowedKeys.has(key))) {
    throw new SubjectEligibilityError(400, 'subject_eligibility_request_invalid', 'request contains unsupported fields')
  }
  const request = {
    subjectUid: text(raw.subjectUid),
    purpose: text(raw.purpose)
  }
  if (!request.subjectUid || !request.purpose) {
    throw new SubjectEligibilityError(400, 'subject_eligibility_request_invalid', 'all eligibility fields are required')
  }
  if (
    request.subjectUid.length > 64
    || hasControlCharacter(request.subjectUid)
    || request.subjectUid.toLowerCase() === '@all'
    || /^(?:(?:system|service)$|(?:system|service|client|svc):)/i.test(request.subjectUid)
  ) {
    throw new SubjectEligibilityError(400, 'subject_eligibility_subject_invalid', 'subjectUid must identify one user')
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.purpose)) {
    throw new SubjectEligibilityError(400, 'subject_eligibility_purpose_invalid', 'purpose is invalid')
  }
  return request
}

export function resolveBoundSubjectEligibilityRequest(
  actor: SubjectEligibilityActor,
  binding: { tenantId: string, deploymentId: string },
  request: SubjectEligibilityClientRequest
): SubjectEligibilityRequest {
  if (actor.actorType !== 'service' || !actor.actorId || !actor.appCode || !actor.tenantCode || !actor.deploymentCode) {
    throw new SubjectEligibilityError(403, 'subject_eligibility_identity_incomplete', 'service identity is incomplete')
  }
  if (
    actor.tenantCode !== binding.tenantId
    || actor.deploymentCode !== binding.deploymentId
  ) {
    throw new SubjectEligibilityError(403, 'subject_eligibility_runtime_binding_mismatch', 'tenant or deployment binding mismatch')
  }
  const target = registry.get(`${actor.appCode}|${request.purpose}`)
  if (!target) {
    throw new SubjectEligibilityError(403, 'subject_eligibility_tuple_unregistered', 'eligibility purpose is not registered for caller')
  }
  return {
    ...request,
    targetAppCode: actor.appCode,
    ...target,
    tenantId: binding.tenantId,
    deploymentId: binding.deploymentId
  }
}

export async function decideSubjectEligibility(
  request: SubjectEligibilityRequest,
  dependencies: {
    loadDirectoryStatus: (uid: string) => Promise<string | null>
    evaluatePermission: (request: SubjectEligibilityRequest) => Promise<{ allowed: boolean, policyRevision: number | null }>
  }
): Promise<SubjectEligibilityResponse> {
  const status = text(await dependencies.loadDirectoryStatus(request.subjectUid)).toLowerCase()
  if (status !== 'active') {
    return { active: false, allowed: false, reason: 'subject_inactive', policyRevision: null }
  }
  const decision = await dependencies.evaluatePermission(request)
  return {
    active: true,
    allowed: decision.allowed,
    reason: decision.allowed ? 'allowed' : 'permission_denied',
    policyRevision: decision.policyRevision
  }
}

export function subjectEligibilityRegistry() {
  return new Map(registry)
}

export function notificationDetailEligibilityRegistry() {
  return new Map(notificationDetailRegistry)
}

export function notificationDetailEligibilityTarget(
  sourceAppCodeInput: unknown,
  descriptorResourceInput: unknown
): NotificationDetailEligibilityTarget | null {
  const sourceAppCode = text(sourceAppCodeInput).toLowerCase()
  const descriptorResource = text(descriptorResourceInput)
  const resourceCode = notificationDetailRegistry.get(`${sourceAppCode}|${descriptorResource}`)
  if (!resourceCode) return null
  return { targetAppCode: sourceAppCode, resourceCode, action: 'view' }
}
