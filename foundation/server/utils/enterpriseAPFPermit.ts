import { peopleFactsIntent, peopleFactsOperations, type PeopleFactsInput } from './enterprisePeopleFactsPermit'
// Shared ordered canonicalization; transport signs with the fresh service token.
// No object, role or policy decision is made here.
export function enterpriseAPFPermitCanonical(method: string, target: string, body: Record<string, unknown>) {
  const p = body.authorization as Record<string, unknown>
  const scope = p.scope as Record<string, unknown>
  const fields: unknown[] = [
    'hzy-enterprise-apf-permit.v1', method, target,
    ...['actorUid', 'tenant', 'deployment', 'resource', 'action', 'operation', 'objectId', 'allowed', 'expiresAt', 'bundleVersion', 'bundleHash', 'policyRevision'].map(key => p[key]),
    scope.access, scope.departmentCodes || [],
    body.id || '', body.code || '', body.name || '', body.rowVersion || 0, body.page || 0, body.pageSize || 0, body.search || ''
  ]
  if (body.cost) {
    const c = body.cost as Record<string, unknown>
    const costScope = p.costScope as Record<string, unknown>
    const salary = costScope.salary as Record<string, unknown>
    fields.push([c.projectCode, c.periodMonth, c.code, c.page, c.pageSize, c.search, c.expectedVersion, c.expectedInputHash])
    fields.push([costScope.access, costScope.projectCodes, salary.access, salary.departmentCodes])
  }
  if (body.peopleFacts) fields.push(peopleFactsIntent(body.peopleFacts as unknown as PeopleFactsInput))
  if (body.people) {
    const p = body.people as Record<string, unknown>
    const payload = p.payload as Record<string, unknown> || {}
    const cost = p.costScope as Record<string, unknown>
    fields.push([p.id, p.page, p.pageSize, p.search, Object.keys(payload).sort().map(key => [key, payload[key]]), p.costAllowed, cost.access, cost.departmentCodes || []])
  }
  if (body.finance) {
    const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string, unknown>)[key])])) : value
    const f = body.finance as Record<string, unknown>
    const payload = f.payload as Record<string, unknown> || {}
    const intent: unknown[] = [f.code, f.page, f.pageSize, f.search, f.status, f.accountCode, f.startDate, f.endDate, Object.keys(payload).sort().map(key => [key, ordered(payload[key])])]
    if (f.accountCountAllowed === true) intent.push(['accountCountAllowed', true])
    for (const key of ['legalEntityCode', 'accountType', 'complete', 'asOfDate', 'staleBefore', 'balanceState', 'currencyCode']) if (f[key] === true || (typeof f[key] === 'string' && f[key] !== '')) intent.push([key, f[key]])
    fields.push(intent)
  }
  if (body.customer) {
    const c = body.customer as Record<string, unknown>
    const payload = c.payload as Record<string, unknown> || {}
    fields.push([c.customerId, c.childCode, Object.keys(payload).sort().map(key => [key, payload[key]])])
  }
  if (body.migrationResolve) {
    const m = body.migrationResolve as Record<string, unknown>
    const customerScope = m.customerScope as { access?: unknown, departmentCodes?: unknown } | undefined
    fields.push([m.id, m.expectedVersion, m.method, m.reason || '', m.customerId || '', m.contactCode || '', customerScope ? [customerScope.access, customerScope.departmentCodes || []] : [], m.accountCode || '', m.amount || ''])
  }
  if (body.migrationIdentity) {
    const m = body.migrationIdentity as Record<string, unknown>
    fields.push([m.sourceUserId, m.expectedStatus, m.directoryUid || ''])
  }
  if (body.migrationApply) {
    const m = body.migrationApply as Record<string, unknown>
    const scope = (value: unknown) => {
      const v = value as { access?: unknown, departmentCodes?: unknown }
      return [v.access, v.departmentCodes || []]
    }
    fields.push([m.sourceUserId, m.limit, scope(m.customerScope), scope(m.contractScope)])
  }
  if (body.quotation) {
    const q = body.quotation as Record<string, unknown>
    const payload = q.payload as Record<string, unknown> || {}
    const items = (q.items || []) as Record<string, unknown>[]
    fields.push([q.id, q.customerId, q.page, q.pageSize, q.version, Object.keys(payload).sort().map(key => [key, payload[key]]), items.map(i => ['item_name', 'specification', 'unit', 'quantity', 'unit_price', 'discount_rate', 'tax_rate'].map(key => i[key] ?? null))])
  }
  if (body.contract) {
    const c = body.contract as Record<string, unknown>
    const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.keys(v).sort().map(k => [k, ordered((v as Record<string, unknown>)[k])]) : v
    fields.push([c.id, c.customerId, c.quotationId, c.page, c.pageSize, ordered(c.payload || {}), (c.rows as unknown[] || []).map(ordered), (c.projects as unknown[] || []).map(ordered), (c.aimsPermits as unknown[] || []).map(ordered)])
  }
  if (body.sales) {
    const s = body.sales as Record<string, unknown>
    const payload = s.payload as Record<string, unknown> || {}
    fields.push([s.id, Object.keys(payload).sort().map(k => [k, payload[k]])])
  }
  if (body.migrationQuery) {
    const q = body.migrationQuery as Record<string, unknown>
    fields.push([q.objectSearch || '', q.createdFrom || '', q.createdTo || '', q.sort || '', q.eventsFor || ''])
  }
  return JSON.stringify(fields).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
}
export const apfUserPaths = [
  '/v1/enterprise/finance/historical-finance:page',
  '/v1/enterprise/finance/historical-finance:preview',
  '/v1/enterprise/finance/historical-finance:activate',
  '/v1/enterprise/finance/historical-finance:history-page',
  '/v1/enterprise/finance/allocation:candidates',
  '/v1/enterprise/finance/allocation-batches:page',
  '/v1/enterprise/finance/allocation-batches:detail',
  '/v1/enterprise/finance/reconciliation:allocate-batch',
  '/v1/enterprise/finance/allocation-batches:reverse',
  '/v1/enterprise/finance/receivable-adjustments:page',
  '/v1/enterprise/finance/receivable-adjustments:detail',
  '/v1/enterprise/finance/receivable-adjustments:create',
  '/v1/enterprise/finance/receivable-adjustments:confirm',
  '/v1/enterprise/finance/receivable-adjustments:reverse',

  '/v1/enterprise/altoc/receivables:page',
  '/v1/enterprise/altoc/receivables:detail',
  '/v1/enterprise/altoc/receivables:aging-summary',
  '/v1/enterprise/altoc/receivables:set-collection-owner',
  '/v1/enterprise/altoc/receivables:set-due-date',
  '/v1/enterprise/altoc/receivables:followup-create',
  '/v1/enterprise/altoc/customer-service-finance-summary',
  '/v1/enterprise/altoc/service-cost-summary-view',
  '/v1/enterprise/altoc/product-feedback-view',
  '/v1/enterprise/altoc/product-feedback-submit',
  '/v1/enterprise/altoc/product-feedback-resume',

  '/v1/enterprise/finance/project-accounting:page',
  '/v1/enterprise/finance/project-accounting:view',
  '/v1/enterprise/finance/project-labor:preview',
  '/v1/enterprise/finance/project-labor:recalculate',
  '/v1/enterprise/finance/project-labor:history-page',
  '/v1/enterprise/finance/project-labor:history-view',
  '/v1/enterprise/finance/project-cost-allocations:page',
  '/v1/enterprise/finance/project-cost-allocations:view',
  '/v1/enterprise/finance/employee-costs:page',
  '/v1/enterprise/finance/employee-costs:view',
  '/v1/enterprise/finance/project-cost-period:view',
  '/v1/enterprise/finance/project-cost-period:confirm-zero',
  '/v1/enterprise/finance/project-cost-period:close',

  '/v1/enterprise/altoc/customer-assets-summary',
  '/v1/enterprise/altoc/customer-documents-page',
  '/v1/enterprise/altoc/service-ticket-knowledge-link',
  '/v1/enterprise/altoc/service-ticket-knowledge-resume',
  '/v1/enterprise/altoc/service-ticket-knowledge-view',

  '/v1/enterprise/altoc/renewals:page',
  '/v1/enterprise/altoc/renewals:view',
  '/v1/enterprise/altoc/renewals:create',
  '/v1/enterprise/altoc/renewals:update',
  '/v1/enterprise/altoc/service-tickets:page',
  '/v1/enterprise/altoc/service-tickets:view',
  '/v1/enterprise/altoc/service-tickets:create',
  '/v1/enterprise/altoc/service-tickets:update',
  '/v1/enterprise/altoc/service-tickets:close',
  '/v1/enterprise/altoc/service-tickets:reopen',
  '/v1/enterprise/altoc/service-ticket:dispatch',
  '/v1/enterprise/altoc/service-ticket:dispatch-resume',
  '/v1/enterprise/altoc/service-ticket:dispatch-view',
  '/v1/enterprise/altoc/service-agreements:page',
  '/v1/enterprise/altoc/service-agreements:view',
  '/v1/enterprise/altoc/service-agreements:create',
  '/v1/enterprise/altoc/service-agreements:update',
  '/v1/enterprise/altoc/service-coverages:page',
  '/v1/enterprise/altoc/service-coverages:create',
  '/v1/enterprise/altoc/service-coverages:resolve',
  '/v1/enterprise/altoc/service-coverages:suspend',
  '/v1/enterprise/altoc/service-coverages:end',
  '/v1/enterprise/altoc/service-projects:page',
  '/v1/enterprise/altoc/service-projects:bind',
  '/v1/enterprise/altoc/service-projects:set-default',
  '/v1/enterprise/altoc/service-projects:suspend',
  '/v1/enterprise/altoc/service-projects:end',

  '/v1/enterprise/altoc/tenders:page',
  '/v1/enterprise/altoc/tenders:view',
  '/v1/enterprise/altoc/tenders:create',
  '/v1/enterprise/altoc/tenders:update',
  '/v1/enterprise/altoc/tender-agencies:page',
  '/v1/enterprise/altoc/tender-agencies:create',
  '/v1/enterprise/altoc/tender-members:add',
  '/v1/enterprise/altoc/tender-members:remove',
  '/v1/enterprise/altoc/tender-milestones:create',
  '/v1/enterprise/altoc/tender-milestones:update',

  '/v1/enterprise/altoc/lead-activities:list',
  '/v1/enterprise/altoc/opportunity-activities:list',
  '/v1/enterprise/altoc/opportunity-contact-roles:list',
  '/v1/enterprise/altoc/opportunity-contact-roles:create',
  '/v1/enterprise/altoc/opportunity-contact-roles:update',
  '/v1/enterprise/altoc/opportunity-contact-roles:delete',
  '/v1/enterprise/altoc/opportunity-stages:list',
  '/v1/enterprise/altoc/opportunity-stage-history:list',
  '/v1/enterprise/altoc/lead-documents:list',
  '/v1/enterprise/altoc/lead-documents:create',
  '/v1/enterprise/altoc/lead-documents:delete',
  '/v1/enterprise/altoc/opportunity-documents:list',
  '/v1/enterprise/altoc/opportunity-documents:create',
  '/v1/enterprise/altoc/opportunity-documents:delete',

  '/v1/enterprise/finance/payment-requests:page',
  '/v1/enterprise/finance/payment-requests:detail',
  '/v1/enterprise/finance/payment-requests:create',
  '/v1/enterprise/finance/payment-requests:update',
  '/v1/enterprise/finance/payment-requests:cancel',
  '/v1/enterprise/finance/payment-requests:submit',
  '/v1/enterprise/finance/payment-requests:confirm',
  '/v1/enterprise/finance/expense-types:page',
  '/v1/enterprise/finance/expense-types:create',
  '/v1/enterprise/finance/expense-types:update',
  '/v1/enterprise/finance/income-types:page',
  '/v1/enterprise/finance/income-types:create',
  '/v1/enterprise/finance/income-types:update',
  '/v1/enterprise/finance/subjects:page',
  '/v1/enterprise/finance/subjects:create',
  '/v1/enterprise/finance/subjects:update',
  '/v1/enterprise/finance/subject-mappings:page',
  '/v1/enterprise/finance/subject-mappings:create',
  '/v1/enterprise/finance/subject-mappings:update',
  '/v1/enterprise/finance/accounting-objects:page',
  '/v1/enterprise/finance/accounting-objects:create',
  '/v1/enterprise/finance/accounting-objects:update',
  '/v1/enterprise/finance/audit-logs:page',
  '/v1/enterprise/finance/approval-instances:page',
  '/v1/enterprise/finance/expenses:page',
  '/v1/enterprise/finance/expenses:detail',
  '/v1/enterprise/finance/expenses:create',
  '/v1/enterprise/finance/expenses:update',
  '/v1/enterprise/finance/expenses:delete',
  '/v1/enterprise/finance/expenses:confirm',
  '/v1/enterprise/finance/claims:page',
  '/v1/enterprise/finance/claims:detail',
  '/v1/enterprise/finance/claims:create',
  '/v1/enterprise/finance/claims:update',
  '/v1/enterprise/finance/claims:cancel',
  '/v1/enterprise/finance/claims:submit',
  '/v1/enterprise/finance/claims:confirm',
  '/v1/enterprise/finance/project-requests:page',
  '/v1/enterprise/finance/project-requests:detail',
  '/v1/enterprise/finance/project-requests:create',
  '/v1/enterprise/finance/project-requests:update',
  '/v1/enterprise/finance/project-requests:cancel',
  '/v1/enterprise/finance/project-requests:submit',
  '/v1/enterprise/finance/project-requests:confirm',
  '/v1/enterprise/altoc/leads:create',
  '/v1/enterprise/altoc/leads:update',
  '/v1/enterprise/altoc/leads:assign',
  '/v1/enterprise/altoc/leads:disqualify',
  '/v1/enterprise/altoc/leads:convert',
  '/v1/enterprise/altoc/lead-activities:create',
  '/v1/enterprise/altoc/opportunities:create',
  '/v1/enterprise/altoc/opportunities:update',
  '/v1/enterprise/altoc/opportunities:assign',
  '/v1/enterprise/altoc/opportunities:transition',
  '/v1/enterprise/altoc/opportunities:close-won',
  '/v1/enterprise/altoc/opportunities:close-lost',
  '/v1/enterprise/altoc/opportunities:pause',
  '/v1/enterprise/altoc/opportunities:reopen',
  '/v1/enterprise/altoc/opportunity-activities:create',

  '/v1/enterprise/finance/invoice-approval:request',
  '/v1/enterprise/finance/invoice-approval:bind',
  '/v1/enterprise/finance/invoice-requests:from-altoc',
  '/v1/enterprise/finance/invoice-requests:page',
  '/v1/enterprise/finance/invoice-requests:detail',
  '/v1/enterprise/finance/invoice-requests:create',
  '/v1/enterprise/finance/invoice-requests:update',
  '/v1/enterprise/finance/invoice-requests:assign-issuance',
  '/v1/enterprise/finance/invoice-requests:issue',
  '/v1/enterprise/finance/invoices:page',
  '/v1/enterprise/finance/invoices:detail',
  '/v1/enterprise/finance/invoices:update',
  '/v1/enterprise/finance/invoices:void',
  '/v1/enterprise/finance/invoices:red-reverse',
  '/v1/enterprise/finance/receipts:page',
  '/v1/enterprise/finance/receipts:detail',
  '/v1/enterprise/finance/receipts:create',
  '/v1/enterprise/finance/receipts:update',
  '/v1/enterprise/finance/receipts:confirm',
  '/v1/enterprise/finance/receipts:classify',
  '/v1/enterprise/finance/receipts:delete',
  '/v1/enterprise/finance/reconciliation:page',
  '/v1/enterprise/finance/reconciliation:create',
  '/v1/enterprise/finance/reconciliation:void',
  '/v1/enterprise/finance/invoice-files:attach',
  '/v1/enterprise/finance/invoice-files:read',

  '/v1/enterprise/altoc/quotation-approval:request',
  '/v1/enterprise/altoc/quotation-approval:bind',
  '/v1/enterprise/altoc/contract-approval:request',
  '/v1/enterprise/altoc/contract-approval:bind',

  '/v1/enterprise/people/employees:create',
  '/v1/enterprise/people/employees:update',
  '/v1/enterprise/people/assignments:create',
  '/v1/enterprise/people/assignments:update',
  '/v1/enterprise/people/assignments:delete',
  '/v1/enterprise/people/assignments:change',
  '/v1/enterprise/people/assignments:attach-workflow',
  '/v1/enterprise/people/onboarding-cases:list',
  '/v1/enterprise/people/onboarding-cases:view',
  '/v1/enterprise/people/onboarding-cases:create',
  '/v1/enterprise/people/onboarding-cases:update',

  '/v1/enterprise/people/employees-private-profiles:view',
  '/v1/enterprise/people/employees-private-profiles:update',
  '/v1/enterprise/altoc/contracts:create',
  '/v1/enterprise/altoc/contracts-from:quotation',
  '/v1/enterprise/altoc/contracts:update',
  '/v1/enterprise/altoc/contract-lines:replace',
  '/v1/enterprise/altoc/payment-terms:replace',
  '/v1/enterprise/altoc/obligations:replace',
  '/v1/enterprise/altoc/obligations:transition',
  '/v1/enterprise/altoc/billing-schedules:list',
  '/v1/enterprise/altoc/contracts:sign',
  '/v1/enterprise/altoc/contracts:annotate',
  '/v1/enterprise/altoc/contracts:complete',
  '/v1/enterprise/altoc/contracts:terminate',
  '/v1/enterprise/altoc/contracts:activate',
  '/v1/enterprise/altoc/contract-projects:bind',
  '/v1/enterprise/altoc/contract-projects:list',

  '/v1/enterprise/altoc/quotations:create',
  '/v1/enterprise/altoc/quotations:update',
  '/v1/enterprise/altoc/quotation-items:replace',
  '/v1/enterprise/altoc/quotation-versions:list',
  '/v1/enterprise/altoc/quotation-versions:view',
  '/v1/enterprise/altoc/quotations:transition',

  '/v1/enterprise/altoc/customers:create',
  '/v1/enterprise/altoc/customers:update',
  '/v1/enterprise/altoc/customers:set-owner',
  '/v1/enterprise/altoc/customers:set-parent',
  '/v1/enterprise/altoc/customers:set-primary-contact',
  '/v1/enterprise/altoc/contacts:create',
  '/v1/enterprise/altoc/contacts:update',
  '/v1/enterprise/altoc/contacts:delete',
  '/v1/enterprise/altoc/invoice-profiles:create',
  '/v1/enterprise/altoc/invoice-profiles:update',
  '/v1/enterprise/altoc/invoice-profiles:delete',
  '/v1/enterprise/altoc/invoice-profiles:set-default',

  '/v1/enterprise/finance/bank-accounts:page',
  '/v1/enterprise/finance/bank-accounts:detail',
  '/v1/enterprise/finance/bank-accounts:create',
  '/v1/enterprise/finance/bank-accounts:update',
  '/v1/enterprise/finance/bank-accounts:reveal-account-no',
  '/v1/enterprise/finance/balance-entries:list',
  '/v1/enterprise/finance/balance-entries:create',
  '/v1/enterprise/altoc/migration-exceptions:page',
  '/v1/enterprise/altoc/migration-identities:page',
  '/v1/enterprise/finance/migration-exceptions:page',
  '/v1/enterprise/altoc/migration-exceptions:resolve',
  '/v1/enterprise/altoc/migration-identities:confirm',
  '/v1/enterprise/altoc/migration-identities:reject',
  '/v1/enterprise/altoc/migration-identities:apply',
  '/v1/enterprise/altoc/contracts:set-owner',
  '/v1/enterprise/finance/migration-exceptions:resolve',
  '/v1/enterprise/finance/legal-entities:list',
  '/v1/enterprise/finance/legal-entities:view',
  '/v1/enterprise/finance/legal-entities:create',
  '/v1/enterprise/finance/legal-entities:update',
  '/v1/enterprise/finance/balance-snapshots:list',
  '/v1/enterprise/finance/people-cost-parameters:list',
  '/v1/enterprise/finance/people-cost-parameters:view',
  '/v1/enterprise/finance/people-cost-parameters:create',
  '/v1/enterprise/finance/people-cost-parameters:update',
  '/v1/enterprise/finance/people-cost-parameters:history',
  '/v1/enterprise/altoc/apf-customers:list', '/v1/enterprise/altoc/apf-customers:view', '/v1/enterprise/altoc/apf-customers:save',
  '/v1/enterprise/finance/bank-accounts:list', '/v1/enterprise/finance/bank-accounts:view', '/v1/enterprise/finance/bank-accounts:save',
  '/v1/enterprise/people/positions:create',
  '/v1/enterprise/people/positions:update',
  '/v1/enterprise/people/positions:delete',
  '/v1/enterprise/people/ranks:list',
  '/v1/enterprise/people/ranks:view',
  '/v1/enterprise/people/ranks:create',
  '/v1/enterprise/people/ranks:update',
  '/v1/enterprise/people/ranks:delete',
  '/v1/enterprise/people/standard-costs:list',
  '/v1/enterprise/people/standard-costs:view',
  '/v1/enterprise/people/standard-costs:create',
  '/v1/enterprise/people/standard-costs:update',
  '/v1/enterprise/people/employees:search',
  '/v1/enterprise/people/employees:profile',
  '/v1/enterprise/people/assignments:list',
  '/v1/enterprise/people/assignments:view',
  '/v1/enterprise/people/positions:list', '/v1/enterprise/people/positions:view'
] as const
export function isAPFPermitPath(path: string) {
  return (apfUserPaths as readonly string[]).includes(path)
    // Every People facts operation is signed; its catalog is the single path source.
    || Object.values(peopleFactsOperations).some(([, , opPath]) => opPath === path)
    || /^\/v1\/(altoc|finance|people)\/notification-details\/authorize$/.test(path)
}
