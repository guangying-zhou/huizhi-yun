import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Assets instance conflict explanation', () => {
  test('server helper loads purchase order facts from tenant-runtime and calls Console runtime', () => {
    const content = source('server/utils/assetsInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /maybeCallTenantRuntime/)
    assert.match(content, /\/v1\/assets\/purchase-orders\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /resourceCode: 'purchase_orders'/)
    assert.match(content, /action,\n\s+includeBaseline/)
    assert.match(content, /applicant_uid/)
    assert.match(content, /kind: 'applicant'/)
    assert.match(content, /kind: 'requester'/)
  })

  test('server helper supports asset assignment operation facts', () => {
    const content = source('server/utils/assetsInstanceConflictExplanation.ts')

    assert.match(content, /targetType: 'assignment'/)
    assert.match(content, /resourceCode: 'assignments'/)
    assert.match(content, /\/v1\/assets\/assignments\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /requested_by/)
    assert.match(content, /target_type/)
    assert.match(content, /kind: 'operator'/)
    assert.match(content, /kind: 'target_user'/)
    assert.match(content, /assignedUid/)
  })

  test('local API route and middleware keep explanation as BFF orchestration', () => {
    const route = source('server/api/v1/authorization/instance-conflict-explain.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(route, /targetType === 'assignment' \? 'assignments' : 'purchase_orders'/)
    assert.match(route, /requirePermission\(event,[\s\S]*'approve'\)/)
    assert.match(route, /explainAssetsInstanceConflicts/)
    assert.match(middleware, /authorization\\\/instance-conflict-explain/)
    assert.match(middleware, /api\\\/v1\\\/authorization\\\/instance-conflict-explain/)
  })

  test('purchase order page exposes an inline conflict explanation entry', () => {
    const content = source('app/pages/procurement/orders/index.vue')

    assert.match(content, /\/api\/v1\/authorization\/instance-conflict-explain/)
    assert.match(content, /targetType: 'purchase_order'/)
    assert.match(content, /#conflict_actions-cell/)
    assert.match(content, /职责冲突解释/)
    assert.match(content, /conflictResult\.explanation\.rules/)
    assert.match(content, /hasPermission\('purchase_orders', 'approve'\)/)
    assert.match(content, /canApprovePurchaseOrder[\s\S]*conflict_actions/)
  })

  test('assignment page exposes an inline conflict explanation entry', () => {
    const content = source('app/pages/operations/assignments.vue')

    assert.match(content, /\/api\/v1\/authorization\/instance-conflict-explain/)
    assert.match(content, /targetType: 'assignment'/)
    assert.match(content, /#conflict_actions-cell/)
    assert.match(content, /资产操作审批风险解释/)
    assert.match(content, /target_user/)
    assert.match(content, /hasPermission\('assignments', 'approve'\)/)
  })
})
