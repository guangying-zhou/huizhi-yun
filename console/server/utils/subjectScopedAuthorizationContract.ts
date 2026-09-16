import {
  parseSubjectEligibilityRequest,
  SubjectEligibilityError,
  type SubjectEligibilityActor
} from './subjectEligibilityContract'

// Separate from notification eligibility: these purposes return scoped grants
// for a target application's own command handler, never an arbitrary resource.
const targets = new Map([
  ['aims|product_feedback_create', { resourceCode: 'product_requests', action: 'create' }],
  ['assets|product_adoption_deliveries', { resourceCode: 'deliveries', action: 'view' }],
  ['assets|product_adoption_environments', { resourceCode: 'environments', action: 'view' }],
  ['finance|product_cost_read', { resourceCode: 'project_accounting', action: 'view' }],
  ['finance|product_cost_rules_edit', { resourceCode: 'project_accounting', action: 'edit' }]
])

export function resolveSubjectScopedAuthorizationRequest(
  actor: SubjectEligibilityActor,
  binding: { tenantId: string, deploymentId: string },
  body: unknown
) {
  const request = parseSubjectEligibilityRequest(body)
  if (actor.actorType !== 'service' || !actor.actorId || !actor.appCode
    || !actor.tenantCode || !actor.deploymentCode) {
    throw new SubjectEligibilityError(403, 'subject_scoped_identity_incomplete', 'Service identity is incomplete')
  }
  if (actor.tenantCode !== binding.tenantId || actor.deploymentCode !== binding.deploymentId) {
    throw new SubjectEligibilityError(403, 'subject_scoped_binding_mismatch', 'Tenant or deployment binding mismatch')
  }
  const target = targets.get(`${actor.appCode}|${request.purpose}`)
  if (!target) throw new SubjectEligibilityError(403, 'subject_scoped_purpose_unregistered', 'Purpose is not registered for caller')
  return { ...request, ...target, targetAppCode: actor.appCode, ...binding }
}
