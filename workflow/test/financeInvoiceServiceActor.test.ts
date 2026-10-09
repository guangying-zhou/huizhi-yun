import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync(new URL('../server/api/v1/service/finance-invoice-approval.post.ts', import.meta.url), 'utf8')

test('service token identity is not used as the Finance business actor', () => {
  assert.match(route, /getHeader\(event, 'x-hzy-actor-uid'\)/)
  assert.match(route, /serviceCommandActor:\s*\{ uid: actorUid \}/)
  assert.doesNotMatch(route, /getRequestUid/)
})

test('forged actor header differing from frozen command is rejected', () => {
  assert.match(route, /frozenCommand\?\.actorUid/)
  assert.match(route, /statusCode:\s*403/)
})
