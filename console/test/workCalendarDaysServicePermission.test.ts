import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const route = readFileSync(
  new URL('../server/api/v1/console/service/work-calendar/[calendarCode]/days.get.ts', import.meta.url),
  'utf8'
)

test('work calendar day service endpoint requires the exact read-only service capability', () => {
  assert.match(route, /requireConsoleServiceActor\(event, 'system_settings', 'system_settings:view'\)/)
  assert.match(route, /getConsoleWorkCalendarDays/)
  assert.match(route, /getRouterParam\(event, 'calendarCode'\)/)
  assert.doesNotMatch(route, /requireSystemSettingsAccess/)
})
