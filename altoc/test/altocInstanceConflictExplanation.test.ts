import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Altoc instance conflict explanation', () => {
  test('server helper loads quotation facts from tenant-runtime and calls Console runtime', () => {
    const content = source('server/utils/altocInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /maybeCallTenantRuntime/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery/)
    assert.match(content, /\/v1\/altoc\/quotes\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /resourceCode: 'quotation'/)
    assert.match(content, /defaultAction: 'approve'/)
    assert.match(content, /push\('requester', requesterUid\)/)
    assert.match(content, /push\('owner', ownerUid\)/)
  })

  test('server helper supports contract approval and receivable confirmation facts', () => {
    const content = source('server/utils/altocInstanceConflictExplanation.ts')

    assert.match(content, /\/v1\/altoc\/contracts\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /resourceCode: 'contract'/)
    assert.match(content, /\/v1\/altoc\/payments\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /resourceCode: 'receivable'/)
    assert.match(content, /defaultAction: 'confirm'/)
    assert.match(content, /push\('maker', requesterUid\)/)
    assert.match(content, /push\('collector', collectorUid\)/)
    assert.match(content, /push\('confirmer', confirmedBy\)/)
  })

  test('server helper keeps target detail loading scoped to current user access', () => {
    const content = source('server/utils/altocInstanceConflictExplanation.ts')

    assert.match(content, /scope: `altoc\.read altoc:\$\{target\.resourceCode\}:view`/)
    assert.match(content, /query: await resolveCurrentAltocDataAccessQuery\(event, target\.resourceCode, 'view' as PermissionAction\)/)
    assert.match(content, /actorUid: uid/)
    assert.match(content, /matchedRelations/)
    assert.match(content, /altoc:\$\{target\.targetType\}:\$\{code\}/)
  })

  test('local API route and middleware keep explanation as BFF orchestration', () => {
    const route = source('server/api/v1/authorization/instance-conflict-explain.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(route, /viewResourceForTargetType/)
    assert.match(route, /targetType === 'quotation'/)
    assert.match(route, /targetType === 'contract'/)
    assert.match(route, /targetType === 'receivable'/)
    assert.match(route, /requirePermission\(event, viewResourceForTargetType\(body\.targetType\), 'view'\)/)
    assert.match(route, /explainAltocInstanceConflicts/)
    assert.match(middleware, /api\/v1\/authorization\/instance-conflict-explain/)
  })

  test('frontend uses one composable and modal for inline explanations', () => {
    const composable = source('app/composables/useAltocInstanceConflictExplanation.ts')
    const modal = source('app/components/AltocInstanceConflictExplanationModal.vue')

    assert.match(composable, /\/api\/v1\/authorization\/instance-conflict-explain/)
    assert.match(composable, /targetType: options\.targetType/)
    assert.match(composable, /action: options\.action/)
    assert.match(composable, /isConflictLoading/)
    assert.match(modal, /职责冲突解释/)
    assert.match(modal, /result\.explanation\.rules/)
    assert.match(modal, /principalLabel/)
  })

  test('payments page exposes an inline receivable conflict explanation entry', () => {
    const content = source('app/pages/payments/index.vue')

    assert.match(content, /useAltocInstanceConflictExplanation/)
    assert.match(content, /targetType: 'receivable'/)
    assert.match(content, /action: 'confirm'/)
    assert.match(content, /#conflict_actions-cell/)
    assert.match(content, /AltocInstanceConflictExplanationModal/)
  })

  test('quotation and contract lists expose inline approval conflict entries', () => {
    const quotes = source('app/pages/quotes/index.vue')
    const contracts = source('app/pages/contracts/index.vue')

    assert.match(quotes, /useAltocInstanceConflictExplanation/)
    assert.match(quotes, /targetType: 'quotation'/)
    assert.match(quotes, /action: 'approve'/)
    assert.match(quotes, /#conflict_actions-cell/)
    assert.match(quotes, /AltocInstanceConflictExplanationModal/)

    assert.match(contracts, /useAltocInstanceConflictExplanation/)
    assert.match(contracts, /targetType: 'contract'/)
    assert.match(contracts, /action: 'approve'/)
    assert.match(contracts, /#conflict_actions-cell/)
    assert.match(contracts, /AltocInstanceConflictExplanationModal/)
  })
})
