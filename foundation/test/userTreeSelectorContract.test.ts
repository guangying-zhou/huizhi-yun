import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = readFileSync(
  new URL('../app/components/UserTreeSelector.vue', import.meta.url),
  'utf8'
)

test('UserTreeSelector skips membership APIs when committees are hidden', () => {
  const loadData = component.slice(
    component.indexOf('async function loadData()'),
    component.indexOf('onMounted(loadData)')
  )

  assert.match(loadData, /const shouldLoadMemberships = !props\.hideCommittees/)
  assert.match(
    loadData,
    /shouldLoadMemberships\s*\?\s*\$fetch<UserDeptsResp>\('\/api\/directory\/user-departments'\)/
  )
  assert.match(
    loadData,
    /if \(shouldLoadMemberships\) \{[\s\S]*await loadCommitteeMembersFallback\(committeeCodes\)[\s\S]*\}/
  )
})
