import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

describe('Console work calendar service endpoint permissions', () => {
  test('service-token middleware delegates work calendar tokens to the exact route guard', () => {
    const middleware = source('../foundation/server/middleware/console-auth.ts')

    assert.match(middleware, /pathname\.startsWith\('\/api\/v1\/console\/service\/work-calendar\/'\)/)
  })

  test('month service API requires system_settings:view service actor before reading calendar data', () => {
    const content = source('server/api/v1/console/service/work-calendar/month.get.ts')

    assert.match(content, /requireConsoleServiceActor\(event, 'system_settings', 'system_settings:view'\)/)
    assert.doesNotMatch(content, /requireSystemSettingsAccess\(event, 'view'\)/)
    assertBefore(
      content,
      'requireConsoleServiceActor(event, \'system_settings\', \'system_settings:view\')',
      'getConsoleWorkCalendarMonth(event, getQuery(event))'
    )
  })
})
