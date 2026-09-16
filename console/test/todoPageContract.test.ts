import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

describe('unified actionable todo page', () => {
  const page = readFileSync(new URL('../app/pages/todos/index.vue', import.meta.url), 'utf8')
  const dashboard = readFileSync(new URL('../app/pages/index.vue', import.meta.url), 'utf8')

  test('loads only safe pending envelopes and resolves detail on click', () => {
    assert.match(page, /\/api\/v1\/console\/notifications\/todos/)
    assert.ok(page.indexOf('await loadDetail(item.notificationId)') < page.indexOf('await navigateTo(actionUrl'))
    assert.match(page, /resolveNotificationActionUrl\(detail, apps\.value, window\.location\.origin\)/)
    assert.doesNotMatch(page, /item\.(actionUrl|bizType|bizId|businessKey|actionableKey|metadata)/)
  })

  test('keeps loading, failure and empty states distinct', () => {
    assert.match(page, /loading && !items\.length/)
    assert.match(page, /error && !items\.length/)
    assert.match(page, /当前没有待处理事项/)
    assert.match(page, /重新加载/)
  })

  test('dashboard cards link to the unified todo page and do not hide summary failures as zero', () => {
    assert.match(dashboard, /to: '\/todos'/)
    assert.match(dashboard, /to: '\/todos\?todoKind=follow_up'/)
    assert.match(dashboard, /todoSummaryError\.value = true/)
    assert.match(dashboard, /待办摘要加载失败/)
  })
})
