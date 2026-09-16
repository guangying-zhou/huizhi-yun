import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../app/components/WorkflowPanel.vue', import.meta.url),
  'utf8'
)
const pageWorkflowSource = readFileSync(
  new URL('../app/composables/usePageWorkflow.ts', import.meta.url),
  'utf8'
)
const sidebarSource = readFileSync(
  new URL('../app/components/LayoutSidebar.vue', import.meta.url),
  'utf8'
)

test('rejected workflow resubmission reuses page completeness checks', () => {
  const handlerStart = source.indexOf('async function handleLaunchSubmit()')
  const approveStart = source.indexOf('async function handleApprove()')
  const handler = source.slice(handlerStart, approveStart)
  const resubmitStart = source.indexOf('<!-- 重新提交 -->')
  const cancelStart = source.indexOf('<!-- 撤销 -->', resubmitStart)
  const resubmit = source.slice(resubmitStart, cancelStart)

  assert.match(handler, /!props\.launchPayload \|\| props\.canSubmit === false/)
  assert.match(resubmit, /completenessIssues && completenessIssues\.length > 0/)
  assert.match(resubmit, /v-for="issue in completenessIssues"/)
  assert.match(resubmit, /:disabled="canSubmit === false"/)
  assert.match(resubmit, /@click="handleLaunchSubmit"/)
})

test('launch mode renders an existing instance from the by-biz response without a second detail request', () => {
  const launchStart = source.indexOf('} else if (props.launchPayload) {')
  const launchEnd = source.indexOf('async function handleLaunchSubmit()', launchStart)
  const launchLoading = source.slice(launchStart, launchEnd)

  assert.match(launchLoading, /const bizRes = await fetchInstanceByBiz/)
  assert.match(launchLoading, /tasks\.value = data\.tasks \|\| \[\]/)
  assert.match(launchLoading, /actions\.value = data\.actions \|\| \[\]/)
  assert.match(launchLoading, /capabilities\.value = data\.capabilities \|\| null/)
  assert.doesNotMatch(launchLoading, /fetchInstanceDetail/)
})

test('WorkflowPanel reloads only when the stable workflow business identity changes', () => {
  assert.match(source, /const workflowLoadKey = computed\(\(\) => JSON\.stringify\(\[/)
  assert.match(source, /props\.launchPayload\?\.appCode/)
  assert.match(source, /props\.launchPayload\?\.resourceCode/)
  assert.match(source, /props\.launchPayload\?\.actionCode/)
  assert.match(source, /props\.launchPayload\?\.bizId/)
  assert.match(source, /watch\(workflowLoadKey, loadData\)/)
  assert.doesNotMatch(source, /watch\(\(\) => \[props\.taskId, props\.instanceId, props\.launchPayload\]/)
})

test('page workflow renders an immediate loading panel before its business entity is ready', () => {
  assert.match(pageWorkflowSource, /const isInitializing = computed/)
  assert.match(pageWorkflowSource, /cfg\.initializing\?\.value/)
  assert.match(pageWorkflowSource, /actions\.value\.length > 0 \|\| isInitializing\.value/)
  assert.match(sidebarSource, /v-else-if="isPageWorkflowInitializing"/)
  assert.match(sidebarSource, /\{\{ pageWorkflowLoadingTitle \}\}/)
  assert.match(sidebarSource, /加载审批信息\.\.\./)
})
