import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = readFileSync(
  new URL('../app/components/UserTreeSelector.vue', import.meta.url),
  'utf8'
)

test('Enterprise Host and hidden committees skip membership APIs while retaining department and user lists', () => {
  const loadData = component.slice(
    component.indexOf('async function loadData()'),
    component.indexOf('onMounted(loadData)')
  )

  assert.match(component, /const hosted = useRuntimeConfig\(\)\.public\.appCode === 'enterprise'/)
  assert.match(loadData, /const shouldLoadMemberships = !hosted && !props\.hideCommittees/)
  assert.match(loadData, /\$fetch<DeptsResp>\('\/api\/directory\/departments'\)/)
  assert.match(loadData, /\$fetch<UsersResp>\('\/api\/directory\/users'/)
  assert.match(
    loadData,
    /shouldLoadMemberships\s*\?\s*\$fetch<UserDeptsResp>\('\/api\/directory\/user-departments'\)/
  )
  assert.match(
    loadData,
    /if \(shouldLoadMemberships\) \{[\s\S]*await loadCommitteeMembersFallback\(committeeCodes\)[\s\S]*\}/
  )
  assert.match(component, /\(hosted \|\| props\.hideCommittees\) && n\.orgType === 'committee'/)
})
