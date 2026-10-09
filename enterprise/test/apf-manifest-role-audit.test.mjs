import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const manifests = Object.fromEntries(['altoc', 'finance', 'people'].map(app => [app, JSON.parse(read(`${app}/app.manifest.json`))]))
const roles = app => manifests[app].recommendedRoles
const permissions = (app, role) => roles(app).find(row => row.code === role).suggestedPermissions
const covered = (app, resource, action) => roles(app).some(role => role.suggestedPermissions.some(p => p === `${app}:${resource}:${action}` || (['view', 'edit'].includes(action) && p === `${app}:${resource}:admin`)))
const table = (file, name) => runInNewContext(`(${read(file).match(new RegExp(`export const ${name} = ([\\s\\S]*?) as const`))[1]})`)
const utility = name => `enterprise/server/utils/${name}.ts`
const ledger = table(utility('enterpriseFinanceLedger'), 'financeLedgerOperations')
const finance = table(utility('enterpriseFinance'), 'financeOperations')
const costs = table(utility('enterpriseFinanceCost'), 'financeCostOperations')
const receivables = table('enterprise/shared/altoc-receivables.ts', 'receivableOperations')
const sales = table(utility('enterpriseAltocSales'), 'salesOperations')
const people = table(utility('enterprisePeople'), 'peopleOperations')
const facts = table('foundation/server/utils/enterprisePeopleFactsPermit.ts', 'peopleFactsOperations')
function files(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(row => row.isDirectory() ? files(`${dir}/${row.name}`) : [`${dir}/${row.name}`])
}

test('each APF Host browser write gate is declared and has a recommended role', (t) => {
  const checked = []
  const check = (file, app, resource, action) => {
    assert.ok(manifests[app].resources.some(row => row.code === resource && row.actions.includes(action)), `${file}: undeclared ${app}:${resource}:${action}`)
    assert.ok(covered(app, resource, action), `${file}: no role covers ${app}:${resource}:${action}`)
    checked.push(file)
  }
  for (const [app, dir] of [['altoc', 'enterprise/server/routes/altoc/api/v1'], ['finance', 'enterprise/server/routes/finance/api/v1'], ['people', 'enterprise/server/routes/enterprise/api/apf/people']]) {
    for (const file of files(dir).filter(f => /\.(post|put|patch|delete)\.ts$/.test(f) && !f.includes('/service/'))) {
      const source = read(file)
      if (/statusCode: 410/.test(source)) continue // Explicitly retired entry, no user authorization to add.
      const call = source.match(/(enterprise\w+)\(event, '([^']+)'/)
      let gate
      if (call) {
        const [, fn, op] = call
        if (fn === 'enterpriseFinanceLedger') gate = [ledger[op].resource, ledger[op].action]
        else if (fn === 'enterpriseFinance') gate = [finance[op].resource, finance[op].action]
        else if (fn === 'enterpriseFinanceCost') gate = ['project_accounting', costs[op]]
        else if (fn === 'enterpriseAltocReceivables') gate = ['receivable', receivables[op][0]]
        else if (fn === 'enterpriseAltocSales') gate = sales[op]
        else if (fn === 'enterprisePeople') gate = people[op]
        else if (fn === 'enterprisePeopleFacts' || fn === 'enterprisePeopleOffboarding') gate = facts[op]
        else if (fn === 'enterprisePeopleHRWrite') gate = ['hr_source_sync', ['mappings', 'changes'].includes(op) ? 'admin' : 'execute']
        else if (fn === 'enterpriseAltocTenders') gate = ['opportunity', 'edit']
        else if (fn === 'enterpriseAltocServiceAgreements') gate = ['contract', 'edit']
        else if (fn === 'enterpriseAltocContract') gate = ['contract', ['contracts-complete', 'contracts-terminate'].includes(op) ? 'close' : 'edit']
        else if (fn === 'enterpriseAltocRenewals') gate = ['renewal_opportunity', 'edit']
        else if (fn === 'enterpriseAltocQuotation') gate = ['quotation', 'edit']
        else if (fn === 'enterpriseAltocCustomerWrite') gate = ['customer', 'edit']
        else if (fn === 'enterpriseAltocServiceTickets') gate = ['service_ticket', op.endsWith('-close') ? 'close' : op.endsWith('-reopen') ? 'reopen' : 'edit']
        else if (fn === 'enterpriseAltocFeedback' || fn === 'enterpriseAltocKnowledge') gate = ['service_ticket', 'edit']
        else if (fn === 'enterpriseAltocSalesSupport') gate = [op.startsWith('lead-') ? 'lead' : 'opportunity', 'edit']
        else if (fn === 'enterprisePeopleDirectoryRecovery') {
          assert.equal(op, 'replay', `${file}: recovery browser writes must use the fixed replay action`)
          gate = ['integration_operations', 'replay']
        } else if (fn === 'enterprisePeopleProvisioning') gate = ['employees', 'edit']
      }
      if (!gate && /submitFinanceApproval/.test(source)) gate = [file.includes('invoice-requests') ? 'invoices' : 'expenses', 'edit']
      if (!gate && /enterpriseAltocContractSubmit|submitAltocApproval/.test(source)) gate = ['contract', 'edit']
      if (!gate && /attachFinanceFile/.test(source)) gate = ['invoices', 'edit']
      if (!gate && /enterpriseFinanceRevealAccountNo/.test(source)) gate = ['bank_accounts', 'reveal-account-no']
      if (!gate && /enterpriseFinanceBalanceEntryCreate/.test(source)) gate = ['bank_accounts', 'edit']
      if (!gate && /enterprise(?:Altoc|Finance)Migration(?:Resolve|IdentityConfirm|IdentityReject|IdentityApply)/.test(source)) gate = ['migration_exceptions', 'resolve']
      if (!gate && /enterprisePeopleAssignmentSubmit|enterprisePeopleAssignmentRecover/.test(source)) gate = ['assignments', 'edit']
      if (!gate && /activateEnterpriseAltocContractDelivery/.test(source)) gate = ['contract', 'edit']
      if (!gate && /createFinanceRequestFromAltoc/.test(source)) {
        check(file, 'finance', 'invoices', 'edit')
        gate = ['contract', 'edit']
      }
      assert.ok(gate, `${file}: unclassified Host write gate; audit its owning authorization before adding coverage`)
      check(file, app, ...gate)
    }
  }
  assert.ok(checked.length > 120, 'coverage must include the actual registered browser write routes')
  t.diagnostic(`${new Set(checked).size} Host routes, ${checked.length} owning permission checks`)
})

test('sensitive human actions have explicit roles; service-only actions are never recommended to people', () => {
  const serviceOnly = new Set(['altoc:contract:finance-summary:sync', 'altoc:receivable:mark-billable', 'altoc:service_ticket:delivery-result:sync', 'altoc:product-feedback:update-status', 'altoc:product-feedback:update-progress', 'altoc:integration_operation:execute', 'finance:product-cost:read', 'finance:product-cost:replace-rules', 'finance:product-cost:read-rules'])
  for (const [app, manifest] of Object.entries(manifests)) {
    for (const role of roles(app)) for (const p of role.suggestedPermissions) {
      assert.ok(!serviceOnly.has(p), `${role.code} must not receive service-only ${p}`)
      const resource = manifest.resources.find(row => p.startsWith(`${app}:${row.code}:`))
      assert.ok(resource?.actions.includes(p.slice(`${app}:${resource?.code}:`.length)), `unknown permission ${p}`)
      assert.ok(!p.includes('*'))
    }
    for (const resource of manifest.resources) for (const action of resource.actions.filter(a => !['view', 'edit', 'admin'].includes(a))) {
      const p = `${app}:${resource.code}:${action}`
      if (serviceOnly.has(p)) continue
      assert.ok(roles(app).some(role => role.suggestedPermissions.includes(p)), `missing explicit role for ${p}`)
    }
  }
  for (const action of ['assign', 'disqualify', 'convert', 'activity']) assert.ok(permissions('altoc', 'altoc:admin').includes(`altoc:lead:${action}`))
  for (const action of ['assign', 'transition', 'activity']) assert.ok(permissions('altoc', 'altoc:admin').includes(`altoc:opportunity:${action}`))
  assert.ok(permissions('altoc', 'altoc:admin').includes('altoc:service_ticket:reopen'))
})

test('recommended roles separate request/approval, issue, payment and reconciliation duties', () => {
  const has = (perms, app, resource, action) => perms.includes(`${app}:${resource}:${action}`) || (['view', 'edit'].includes(action) && perms.includes(`${app}:${resource}:admin`))
  for (const role of roles('finance')) {
    const p = role.suggestedPermissions
    for (const resource of ['invoices', 'expenses']) assert.ok(!(has(p, 'finance', resource, 'edit') && has(p, 'finance', resource, 'approve')), role.code)
    assert.ok(!(has(p, 'finance', 'invoices', 'edit') && has(p, 'finance', 'invoices', 'issue')), `${role.code}: D-01`)
    assert.ok(!(has(p, 'finance', 'expenses', 'edit') && has(p, 'finance', 'expenses', 'confirm')), `${role.code}: payment separation`)
    assert.ok(!(has(p, 'finance', 'receipts', 'confirm') && has(p, 'finance', 'reconciliation', 'confirm')), `${role.code}: D-02`)
  }
  for (const role of roles('altoc')) for (const r of ['customer', 'quotation', 'contract']) assert.ok(!(has(role.suggestedPermissions, 'altoc', r, 'edit') && has(role.suggestedPermissions, 'altoc', r, 'approve')), role.code)
  for (const role of roles('people')) for (const r of ['assignments', 'cost_snapshots', 'performance_cycles', 'standard_costs']) assert.ok(!(has(role.suggestedPermissions, 'people', r, 'edit') && has(role.suggestedPermissions, 'people', r, 'approve')), role.code)
})

test('Host fixed resource gates used by the route audit match their owning permit calls', () => {
  for (const [helper, resource] of [['enterpriseAltocTenders', 'opportunity'], ['enterpriseAltocServiceAgreements', 'contract'], ['enterpriseAltocRenewals', 'renewal_opportunity']]) {
    assert.ok(read(utility(helper)).includes(`user, '${resource}', read ? undefined : 'edit'`), helper)
  }
  for (const [helper, resource] of [['enterpriseAltocQuotation', 'quotation'], ['enterpriseAltocContract', 'contract']]) {
    const file = helper === 'enterpriseAltocQuotation' ? 'enterpriseAltocQuotations' : 'enterpriseAltocContracts'
    assert.ok(read(utility(file)).includes(helper === 'enterpriseAltocContract' ? `input, user, '${resource}', close ? 'close' : undefined)` : `input, user, '${resource}')`), helper)
  }
  assert.ok(read(utility('enterpriseAltocContracts')).includes('const close = [\'contracts-complete\', \'contracts-terminate\'].includes(operation)'))
  assert.match(read(utility('enterpriseAPF')), /altoc: \{ resource: 'customer', write: 'edit'/)
  assert.ok(read(utility('enterpriseAltocServiceTickets')).includes('operation === \'service-tickets-close\' ? \'close\' : operation === \'service-tickets-reopen\' ? \'reopen\' : \'edit\''))
  assert.ok(read(utility('enterpriseAltocFeedback')).includes('user, \'service_ticket\', \'edit\''))
  assert.ok(read(utility('enterpriseAltocKnowledge')).includes('user, customer ? undefined : \'service_ticket\', write ? \'edit\' : undefined'))
})
