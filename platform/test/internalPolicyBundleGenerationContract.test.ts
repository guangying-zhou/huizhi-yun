import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync('server/api/platform/internal/tenants/[tenantCode]/bundles.post.ts', 'utf8')
const middleware = readFileSync('server/middleware/platform-access.ts', 'utf8')

test('policy bundle regeneration is available only behind Platform internal authentication', () => {
  assert.match(route, /_handlers\/ops\/tenants\/\[tenantCode\]\/bundles\.post/)
  assert.match(middleware, /const INTERNAL_PREFIX = '\/api\/platform\/internal\/'/)
  assert.match(middleware, /internal access denied: invalid service token/)
  assert.match(middleware, /event\.context\.platformAccessScope = 'internal'/)
})
