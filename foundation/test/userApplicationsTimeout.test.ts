import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { userApplicationsTimeoutMs } from '../server/utils/userApplicationsTimeout'

test('applications timeout is bounded and defaults to the production deadline', () => {
  for (const value of [undefined, null, '', 0, -1, 999, 15001, Infinity, 'bad', 3000.5]) {
    assert.equal(userApplicationsTimeoutMs(value), 3000)
  }
  for (const value of [1000, 3000, '15000']) assert.equal(userApplicationsTimeoutMs(value), Number(value))
})

test('disabled workflow gates both approval entry and pending requests, not server authorization', () => {
  const sidebar = readFileSync(new URL('../app/components/LayoutSidebar.vue', import.meta.url), 'utf8')
  assert.match(sidebar, /showApprovalEntry = ref\(Boolean\(workflowEnabled &&/)
  assert.match(sidebar, /async function loadPendingCount\(force = false\) \{\s+if \(!workflowEnabled\) return/)
  const applications = readFileSync(new URL('../server/api/user/applications.get.ts', import.meta.url), 'utf8')
  assert.match(applications, /statusCode: 503/)
  assert.match(applications, /fetchConsoleServiceJson/)
})
