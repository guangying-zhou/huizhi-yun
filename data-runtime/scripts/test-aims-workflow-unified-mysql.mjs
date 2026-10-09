import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const run = (packages, pattern, env) => new Promise((done, reject) => {
    const child = spawn('go', ['test', '-race', ...packages, '-run', pattern, '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit', env: { ...process.env, ...env }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? done() : reject(new Error(`Workflow unified isolated test exited ${code}`)))
  })
  await run(['./internal/enterprise', './internal/migrations/unified', './internal/apps/workflow'],
    '^(TestWorkflowUnified.*MySQL|TestAimsCompletionApprovalTransactionMySQL)$',
    { HZY_AIMS_WORKFLOW_UNIFIED_SOCKET: context.socketPath, HZY_WORKFLOW_COMPLETION_SOCKET: context.socketPath })
  // Reuse the canonical Aims writer fixture, not a hand-written receipt table.
  await run(['./internal/apps/aims'], '^TestEnterpriseProjectMembersMySQL$/^work_item_completion_reliable_source_contract$',
    { HZY_PROJECT_MEMBER_SOCKET: context.socketPath })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
