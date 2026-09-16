import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const route = readFileSync(
  new URL('../server/api/work-calendars/[calendarCode]/days.get.ts', import.meta.url),
  'utf8'
)

test('project weekly reports load Console work calendars through the trusted service binding', () => {
  assert.match(route, /fetchConsoleServiceJson<ServiceEnvelope<WorkCalendarDayPage>>/)
  assert.match(route, /fetchConsoleServiceJson<ServiceEnvelope<WorkCalendarMonth>>/)
  assert.match(route, /console\/service\/work-calendar\/\$\{encodeURIComponent\(calendarCode\)\}\/days/)
  assert.match(route, /trustedServiceRequestHeaders\(event\)/)
  assert.doesNotMatch(route, /function forwardedContextHeaders/)
  assert.doesNotMatch(route, /\$fetch<ServiceEnvelope<WorkCalendarDayPage>>/)
})
