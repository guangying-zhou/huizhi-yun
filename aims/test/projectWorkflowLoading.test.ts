import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const navbarSource = readFileSync(
  new URL('../app/components/project/ProjectNavbar.vue', import.meta.url),
  'utf8'
)

test('project settings leaves workflow instance loading to its single approval panel', () => {
  assert.match(
    navbarSource,
    /const isProjectSettingsRoute = computed\(\(\) => route\.path === `\/projects\/\$\{projectId\.value\}\/settings`\)/
  )
  assert.match(navbarSource, /if \(!isProjectSettingsRoute\.value\) \{\s+syncApprovalStatus\(\)/)
  assert.match(navbarSource, /<WorkflowBadge\s+v-if="!isProjectSettingsRoute"/)
})
