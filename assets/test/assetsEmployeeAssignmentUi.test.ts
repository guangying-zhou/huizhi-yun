import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Assets employee assignment UI', () => {
  test('assignment list gates request, maintenance and approval controls independently', () => {
    const page = source('app/pages/operations/assignments.vue')

    assert.match(page, /hasPermission\('assignments', 'request'\)/)
    assert.match(page, /hasPermission\('assignments', 'edit'\)/)
    assert.match(page, /hasPermission\('assignments', 'approve'\)/)
    assert.match(page, /v-if="canCreateAssignment"/)
    assert.match(page, /:request-only="requestOnly"/)
    assert.match(page, /canApproveAssignment[\s\S]*conflict_actions/)
  })

  test('self-service modal exposes only claim, return and release and omits controlled fields', () => {
    const modal = source('app/components/assets/AssignmentCreateModal.vue')

    assert.match(modal, /requestOnly/)
    assert.match(modal, /selfServiceActionTypes/)
    assert.match(modal, /\['claim', 'return', 'release'\]/)
    assert.match(modal, /v-if="!requestOnly"[\s\S]*目标类型/)
    assert.match(modal, /v-if="!requestOnly"[\s\S]*操作状态/)
    assert.match(modal, /v-if="!requestOnly"[\s\S]*流程实例号/)
    assert.match(modal, /v-if="!requestOnly"[\s\S]*计划生效时间/)
    assert.match(modal, /requestOnly \? '发起资产申请' : '新增资产操作'/)
  })

  test('asset detail lets self-service users request only the bounded operation menu', () => {
    const detail = source('app/pages/items/[id].vue')

    assert.match(detail, /hasPermission\('assignments', 'request'\)/)
    assert.match(detail, /hasPermission\('assignments', 'edit'\)/)
    assert.match(detail, /selfServiceActionTypes/)
    assert.match(detail, /:request-only="requestOnlyAssignment"/)
  })
})
