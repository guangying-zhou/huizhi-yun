import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Altoc contract activation scoped authorization', () => {
  test('local activate-delivery orchestration passes scoped contract edit query to runtime writes', () => {
    const content = source('server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts')

    assert.match(content, /async function requireActivateDeliveryAccess\(event: H3Event\)/)
    assert.match(content, /hasActivateDeliveryServiceScope\(auth\.scopes \|\| \[\]\)/)
    assert.match(content, /!\['altoc', 'workflow'\]\.includes\(sourceApp\(auth\)\)/)
    assert.match(content, /await requirePermission\(event, 'contract', 'edit'\)/)
    assertBefore(content, 'await requireActivateDeliveryAccess(event)', 'const actorUid = trustedActorUid(event)')
    assertBefore(content, 'await requireActivateDeliveryAccess(event)', 'const body = objectBody(await readBody(event))')
    assert.match(content, /resolveActivateDeliveryDataAccessQuery\(event, actorUid\)/)
    assert.match(content, /current_user_altoc_access: 'all'/)
    assert.match(content, /current_user_data_access: 'all'/)
    assert.match(content, /query,\s*\n\s*body/)
    assert.match(content, /\/v1\/altoc\/contracts\/\$\{encodeURIComponent\(contractCode\)\}\/activation\/execute[\s\S]+dataAccessQuery/)
    assert.match(content, /\/v1\/altoc\/service\/contracts\/\$\{encodeURIComponent\(contractCode\)\}\/activate-delivery[\s\S]+dataAccessQuery/)
    assert.match(content, /'altoc_activate_contract', 'succeeded'[\s\S]+dataAccessQuery\)/)
    assert.match(content, /executeContractActivationOperationsForRequest\(event, frozenOperations, dataAccessQuery\)/)
    assert.match(content, /expectedContractActivationOperationsSucceeded\([\s\S]+aims-project\.v1/)
    assert.match(content, /expectedContractActivationOperationsSucceeded\([\s\S]+aims-milestones\.v1/)
    assert.match(content, /const aimsOperationsSucceeded = projectOperationsSucceeded && milestoneOperationsSucceeded/)
    assert.match(content, /assets_delivery_assets_plan'\) && aimsOperationsSucceeded/)
    assert.match(content, /if \(activationOperationsPending\) setResponseStatus\(event, 202\)/)
    assert.match(content, /'assets_delivery_assets_plan', 'succeeded'[\s\S]+dataAccessQuery\)/)
  })
})
