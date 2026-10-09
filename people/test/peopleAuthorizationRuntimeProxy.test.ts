import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function readText(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('independent employee and standard cost scopes complete before query forwarding', () => {
  const source = readText('../server/middleware/tenant-runtime.ts')
  const block = source.slice(source.indexOf('const needsStandardCosts'), source.indexOf('if (isEmployeeProfileContext(context))'))
  assert.match(block, /const \[scopedQuery, standardCostQuery\] = await Promise.all/)
  assert.match(block, /needsStandardCosts\s*\? resolvePeopleEmployeeAccessQuery\(\s*context.event,\s*context.currentUser,\s*context.method === 'GET' \|\| isEmployeeSearchContext\(context\) \? 'view' : 'admin',\s*'standard_costs'\s*\)\s*: Promise.resolve\(null\)/)
  assert.match(block, /employeeRuntimeAction\(context, resourceCode\)/)
  assert.match(block, /'standard_costs'/)
  assert.match(block, /if \(standardCostQuery\)/)
  assert.match(block, /accessKey: 'current_user_standard_cost_access'/)
  assert.doesNotMatch(block, /\.catch\(/)
  assert.ok(block.indexOf('Object.assign(sanitizedQuery, scopedQuery)') > block.indexOf('])'))
})

test('People browser and server permission checks use the verified Console Runtime authorization channel', () => {
  const browserRoute = readText('../server/api/auth/permissions.get.ts')
  const serverGuard = readText('../server/utils/peoplePermissions.ts')

  for (const source of [browserRoute, serverGuard]) {
    assert.match(source, /requireFoundationSessionUid\(event/)
    assert.match(source, /loadAuthorizationSnapshotFromConsoleRuntime\(uid, appCode, event\)/)
    assert.doesNotMatch(source, /\/api\/auth\/permissions/)
    assert.doesNotMatch(source, /configuredConsoleOrigin/)
    assert.doesNotMatch(source, /forwardHeaders/)
    assert.doesNotMatch(source, /\$fetch/)
  }
})
