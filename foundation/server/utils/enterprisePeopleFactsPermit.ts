// Ordered intent only: no independent policy algorithm or transport identity.
export const peopleFactsOperations = {
  'directory-operations-list': ['integration_operations', 'view', '/v1/enterprise/people/directory-operations:list'],
  'directory-operations-view': ['integration_operations', 'view', '/v1/enterprise/people/directory-operations:view'],
  'directory-operations-replay': ['integration_operations', 'replay', '/v1/enterprise/people/directory-operations:replay'],
  'offboarding-list': ['offboarding_tasks', 'view', '/v1/enterprise/people/offboarding-cases:list'],
  'offboarding-view': ['offboarding_tasks', 'view', '/v1/enterprise/people/offboarding-cases:view'],
  'offboarding-create': ['offboarding_tasks', 'admin', '/v1/enterprise/people/offboarding-cases:create'],
  'offboarding-arrange': ['offboarding_tasks', 'admin', '/v1/enterprise/people/offboarding-cases:arrange'],
  'offboarding-confirm': ['offboarding_tasks', 'confirm', '/v1/enterprise/people/offboarding-cases:confirm'],
  'offboarding-cancel': ['offboarding_tasks', 'cancel', '/v1/enterprise/people/offboarding-cases:cancel'],

  'hr-state': ['hr_source_sync', 'view', '/v1/enterprise/people/hr-source:hr-state'],
  'hr-mappings-prepare': ['hr_source_sync', 'admin', '/v1/enterprise/people/hr-source:hr-mappings-prepare'],
  'hr-mappings-confirm': ['hr_source_sync', 'admin', '/v1/enterprise/people/hr-source:hr-mappings-confirm'],
  'hr-changes-prepare': ['hr_source_sync', 'admin', '/v1/enterprise/people/hr-source:hr-changes-prepare'],
  'hr-changes-confirm': ['hr_source_sync', 'admin', '/v1/enterprise/people/hr-source:hr-changes-confirm'],
  'hr-jobs-start-prepare': ['hr_source_sync', 'execute', '/v1/enterprise/people/hr-source:hr-jobs-start-prepare'],
  'hr-jobs-start-confirm': ['hr_source_sync', 'execute', '/v1/enterprise/people/hr-source:hr-jobs-start-confirm'],
  'hr-jobs-cancel-prepare': ['hr_source_sync', 'execute', '/v1/enterprise/people/hr-source:hr-jobs-cancel-prepare'],
  'hr-jobs-cancel-confirm': ['hr_source_sync', 'execute', '/v1/enterprise/people/hr-source:hr-jobs-cancel-confirm'],
  'hr-jobs-retry-prepare': ['hr_source_sync', 'execute', '/v1/enterprise/people/hr-source:hr-jobs-retry-prepare'],
  'hr-jobs-retry-confirm': ['hr_source_sync', 'execute', '/v1/enterprise/people/hr-source:hr-jobs-retry-confirm'],

  'onboarding-begin-provisioning': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:begin-provisioning'],
  'onboarding-reserved': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:reserved'],
  'onboarding-provisioning': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:provisioning'],
  'onboarding-failure': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:failure'],
  'onboarding-cancel': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:cancel'],
  'onboarding-aggregate-status': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:aggregate-status'],
  'onboarding-activate': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:activate'],
  'onboarding-prepare-reserve': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:prepare-reserve'],
  'onboarding-prepare-release': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:prepare-release'],
  'onboarding-prepare-provision': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:prepare-provision'],
  'onboarding-prepare-status': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:prepare-status'],
  'onboarding-prepare-activation-link': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:prepare-activation-link'],

  'employees-create': ['employees', 'edit', '/v1/enterprise/people/employees:create'],
  'employees-update': ['employees', 'edit', '/v1/enterprise/people/employees:update'],
  'assignments-create': ['assignments', 'edit', '/v1/enterprise/people/assignments:create'],
  'assignments-request-workflow': ['assignments', 'edit', '/v1/enterprise/people/assignments:request-workflow'],
  'assignments-update': ['assignments', 'edit', '/v1/enterprise/people/assignments:update'],
  'assignments-delete': ['assignments', 'edit', '/v1/enterprise/people/assignments:delete'],
  'assignments-change': ['assignments', 'edit', '/v1/enterprise/people/assignments:change'],
  'assignments-attach-workflow': ['assignments', 'edit', '/v1/enterprise/people/assignments:attach-workflow'],
  'onboarding-list': ['employees', 'view', '/v1/enterprise/people/onboarding-cases:list'],
  'onboarding-view': ['employees', 'view', '/v1/enterprise/people/onboarding-cases:view'],
  'onboarding-create': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:create'],
  'onboarding-update': ['employees', 'edit', '/v1/enterprise/people/onboarding-cases:update']
} as const
export type PeopleFactsOperation = keyof typeof peopleFactsOperations
export interface PeopleFactsInput { id: string, employeeUid: string, page: number, pageSize: number, search: string, payload: Record<string, unknown>, sensitiveAllowed: boolean }
function canonicalFactsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalFactsValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalFactsValue((value as Record<string, unknown>)[k])]))
  return value
}
export function peopleFactsIntent(f: PeopleFactsInput) {
  return [f.id, f.employeeUid, f.page, f.pageSize, f.search, Object.keys(f.payload).sort().map(k => [k, canonicalFactsValue(f.payload[k])]), f.sensitiveAllowed]
}
