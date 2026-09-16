import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { productMemberInstant, productMemberLocalTime } from '../app/utils/productMemberTime.ts'

const previousTimezone = process.env.TZ
process.env.TZ = 'America/New_York'
after(() => {
  if (previousTimezone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimezone
})
test('unchanged member expiry preserves the second occurrence of a repeated local time', () => {
  const original = '2026-11-01T06:30:00.123Z'
  assert.equal(productMemberLocalTime(original), '2026-11-01T01:30:00.123')
  assert.equal(productMemberInstant('2026-11-01T01:30:00.123', original), original)
  assert.equal(productMemberInstant('2026-11-01T01:30:00.123'), '2026-11-01T05:30:00.123Z')
})
test('member times reject skipped DST time and invalid calendar dates', () => {
  for (const input of ['2026-03-08T02:30', '2026-02-30T12:00', '2026-01-01T25:00', 'invalid', '2026-01-01T12:00Z']) {
    assert.equal(productMemberInstant(input), null)
  }
  assert.equal(productMemberInstant('2026-03-08T03:30'), '2026-03-08T07:30:00.000Z')
})
test('browser omission of seconds does not change an existing expiry', () => {
  assert.equal(productMemberInstant('2026-11-01T01:30', '2026-11-01T06:30:00.000Z'), '2026-11-01T06:30:00.000Z')
})
