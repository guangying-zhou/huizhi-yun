import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Finance instance conflict explanation integration', () => {
  test('uses Foundation Console runtime helper and never reads local Finance DB directly', () => {
    const content = source('server/utils/financeInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /maybeCallFinanceDataRuntime/)
    assert.match(content, /buildFinanceRuntimeAuthQuery/)
    assert.doesNotMatch(content, /from '\.\/db'/)
    assert.doesNotMatch(content, /queryRow/)
    assert.doesNotMatch(content, /getFinanceRecord/)
  })

  test('maps high-risk Finance objects to their tenant-runtime detail APIs', () => {
    const content = source('server/utils/financeInstanceConflictExplanation.ts')

    assert.match(content, /\/v1\/finance\/expense-claims\/\$\{encodeURIComponent\(code\)\}/)
    assert.match(content, /\/v1\/finance\/project-expense-requests\/\$\{encodeURIComponent\(code\)\}/)
    assert.match(content, /\/v1\/finance\/payment-requests\/\$\{encodeURIComponent\(code\)\}/)
    assert.match(content, /\/v1\/finance\/expenses\/\$\{encodeURIComponent\(code\)\}/)
    assert.match(content, /readScope: 'finance\.expense_claims\.read'/)
    assert.match(content, /readScope: 'finance\.payment_requests\.read'/)
    assert.match(content, /readScope: 'finance\.expenses\.read'/)
  })

  test('derives principals from runtime object facts instead of trusting caller-provided users', () => {
    const content = source('server/utils/financeInstanceConflictExplanation.ts')

    assert.match(content, /primaryPrincipalUid\(target\.targetType, row\)/)
    assert.match(content, /applicant_user_id/)
    assert.match(content, /handler_user_id/)
    assert.match(content, /principals = financePrincipals\(target, row\)/)
    assert.match(content, /resourceCode: 'expenses'/)
    assert.match(content, /object: financeObjectContext\(uid, target, code, row\)/)
  })

  test('exposes a local orchestration API guarded by Finance permissions', () => {
    const route = source('server/api/v1/finance/authorization/instance-conflict-explain.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')
    const permissions = source('server/utils/financePermissionRoutes.ts')

    assert.match(route, /explainFinanceInstanceConflicts/)
    assert.match(middleware, /apiPath === '\/api\/v1\/finance\/authorization\/instance-conflict-explain'/)
    assert.match(permissions, /path === 'authorization\/instance-conflict-explain'/)
    assert.match(permissions, /resource: 'expenses', action: 'view'/)
  })

  test('Finance list page exposes instance conflict explanation for supported objects', () => {
    const page = source('app/pages/[...slug].vue')

    assert.match(page, /instanceConflictTargetsBySlug/)
    assert.match(page, /'expenses\/claims': \{ targetType: 'expense_claim', action: 'approve'/)
    assert.match(page, /'expenses\/project-requests': \{ targetType: 'project_expense_request', action: 'approve'/)
    assert.match(page, /'payments\/requests': \{ targetType: 'payment_request', action: 'approve'/)
    assert.match(page, /'expenses': \{ targetType: 'finance_expense', action: 'confirm'/)
    assert.match(page, /financeApiPath\('\/authorization\/instance-conflict-explain'\)/)
    assert.match(page, /openInstanceConflictExplanation/)
    assert.match(page, /#conflict_actions-cell/)
    assert.match(page, /职责冲突解释/)
  })
})
