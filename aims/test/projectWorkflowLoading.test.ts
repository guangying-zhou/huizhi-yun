import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

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
  assert.match(navbarSource, /<WorkflowBadge\s+v-if="!hosted && !isProjectSettingsRoute"/)
})

test('Host never polls project approvals or performs client lifecycle compensation; standalone still polls', async () => {
  const start = navbarSource.indexOf('async function syncApprovalStatus()')
  const code = ts.transpileModule(`${navbarSource.slice(start, navbarSource.indexOf('</script>', start))}\nreturn syncApprovalStatus;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  for (const hosted of [true, false]) {
    const reads: unknown[] = []
    const writes: unknown[] = []
    const run = new Function('hosted', 'project', 'projectWorkflowActionOrder', 'fetchInstanceByBiz', 'deriveProjectLifecycleFromWorkflow', 'projectStore', 'projectId', code)(
      hosted, { value: { id: 257, lifecycleStatus: 'active' } }, ['initiation'],
      async (query: unknown) => {
        reads.push(query)
        return { code: 0, data: null }
      },
      () => 'approval_pending', { updateProject: async (...args: unknown[]) => { writes.push(args) } }, { value: 257 })
    await run()
    assert.equal(reads.length, hosted ? 0 : 1)
    assert.equal(writes.length, hosted ? 0 : 1)
  }
})
