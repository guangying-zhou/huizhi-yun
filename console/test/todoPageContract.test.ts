import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

describe('unified actionable todo page', () => {
  const page = readFileSync(new URL('../app/pages/todos/index.vue', import.meta.url), 'utf8')
  const list = readFileSync(new URL('../../foundation/app/components/TodoList.vue', import.meta.url), 'utf8')

  test('loads only safe pending envelopes and resolves detail on click', () => {
    assert.match(page, /\/api\/v1\/console\/notifications\/todos/)
    assert.ok(list.indexOf('await loadDetail(item.notificationId)') < list.indexOf('await navigateTo(actionUrl'))
    assert.match(list, /resolveNotificationActionUrl\(detail, apps\.value, window\.location\.origin, hostNotificationTarget\(\)\)/)
    assert.doesNotMatch(list, /item\.(actionUrl|bizType|bizId|businessKey|actionableKey|metadata)/)
  })

  test('keeps loading, failure and empty states distinct', () => {
    assert.match(list, /loading && !items\.length/)
    assert.match(list, /error && !items\.length/)
    assert.match(list, /当前没有待处理事项/)
    assert.match(list, /重新加载/)
  })
})
