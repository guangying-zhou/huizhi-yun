import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const route = (path: string) => new URL(`../server/api/v1/console/${path}`, import.meta.url)
const pagePath = new URL('../app/pages/work-calendar.vue', import.meta.url)
const clientPath = new URL('../../foundation/server/utils/consoleTenantRuntimeClient.ts', import.meta.url)

describe('Console work-calendar tenant-runtime migration', () => {
  test('all work-calendar BFF routes use the Foundation runtime client without DB helpers', async () => {
    const paths = [
      'work-calendars/index.get.ts',
      'work-calendars/import-year.post.ts',
      'work-calendars/[calendarCode]/months.get.ts',
      'work-calendars/[calendarCode]/days.get.ts',
      'work-calendars/[calendarCode]/days/[workDate].patch.ts',
      'service/work-calendar/month.get.ts'
    ]
    for (const path of paths) {
      const source = await readFile(route(path), 'utf8')
      assert.match(source, /consoleTenantRuntimeClient/)
      assert.doesNotMatch(source, /queryRow|queryRows|execute|withTransaction|server\/utils\/db|utils\/workCalendar/)
    }
  })

  test('mutations require idempotency and preserve local authorization checks', async () => {
    const importSource = await readFile(route('work-calendars/import-year.post.ts'), 'utf8')
    const daySource = await readFile(route('work-calendars/[calendarCode]/days/[workDate].patch.ts'), 'utf8')
    for (const source of [importSource, daySource]) {
      assert.match(source, /requireSystemSettingsAccess\(event, 'edit'\)/)
      assert.match(source, /requireIdempotencyKey\(event\)/)
    }
  })

  test('Foundation freezes semantic paths and narrow work-calendar capabilities', async () => {
    const source = await readFile(clientPath, 'utf8')
    assert.match(source, /'\/v1\/console\/work-calendars'/)
    assert.match(source, /'\/v1\/console\/work-calendars\/import-year'/)
    assert.match(source, /scope: 'console:work-calendar:view'/)
    assert.match(source, /scope: 'console:work-calendar:edit'/)
    assert.match(source, /scope: 'console:work-calendar:import'/)
  })

  test('page sends CAS revisions and idempotency keys for both mutations', async () => {
    const source = await readFile(pagePath, 'utf8')
    assert.match(source, /expectedRevision: selectedCalendar\.value\?\.revision \|\| 0/)
    assert.match(source, /expectedRevision: day\.revision/)
    assert.match(source, /console:work-calendar:import:/)
    assert.match(source, /console:work-calendar:day:/)
  })
})
