import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertServerActorOverridesBody(path: string, actorVariable: string) {
  const content = source(path)

  assert.doesNotMatch(content, /operatorUid:\s*body\.operatorUid/, path)
  assert.doesNotMatch(content, /operatorUid:\s*body\.operator_uid/, path)
  assert.doesNotMatch(content, /operator_uid:\s*body\.operator_uid/, path)
  assert.doesNotMatch(content, /current_user:\s*body\.current_user/, path)
  assert.match(content, new RegExp(`operatorUid:\\s*${actorVariable}`), path)
  assert.match(content, new RegExp(`operator_uid:\\s*${actorVariable}`), path)
  assert.match(content, new RegExp(`current_user:\\s*${actorVariable}`), path)
}

describe('Altoc local orchestration trusted actor context', () => {
  test('scoped runtime query carries the verified user actor for local BFF calls', () => {
    const content = source('server/utils/altocScopedAuthorization.ts')

    assert.match(content, /query\.current_user = normalizedUid/)
    assert.match(content, /query\.operator_uid = normalizedUid/)
    assert.match(content, /query\.current_user_dept_code = currentDeptCodeValues\[0\]/)
    assert.match(content, /query\.current_user_dept_codes = currentDeptCodeValues\.join\(','\)/)
  })

  test('invoice request orchestration does not trust browser supplied actor fields', () => {
    const retired = source('server/api/v1/contracts/[id]/invoice-request.post.ts')
    assert.match(retired, /statusCode:\s*410/)
    assert.doesNotMatch(retired, /readBody|operatorUid|current_user/)
    assertServerActorOverridesBody('server/api/v1/receivable-plans/[code]/invoice-request.post.ts', 'actorUid')
  })

  test('contract activation orchestration derives actor from verified session or service token', () => {
    const content = source('server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts')

    assert.match(content, /function trustedActorUid\(event: H3Event\)/)
    assert.match(content, /return text\(auth\.subjectCode \|\| `service:\$\{sourceApp\(auth\) \|\| 'unknown'\}`\)/)
    assert.match(content, /resolveActivateDeliveryDataAccessQuery\(event, actorUid\)/)
    assertServerActorOverridesBody('server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts', 'actorUid')
  })

  test('manual overdue scan does not trust browser supplied operator fields', () => {
    assertServerActorOverridesBody('server/api/v1/payments/scan-overdue.post.ts', 'uid')
  })
})
