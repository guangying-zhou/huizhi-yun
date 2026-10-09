import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  await new Promise((done, reject) => {
    const child = spawn('go', ['test', '-race', './internal/apps/workflow', '-run', '^(TestCompletionCallbackCurrentRoundMySQL|TestAimsCompletionApprovalTransactionMySQL)$', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { ...process.env, HZY_WORKFLOW_COMPLETION_SOCKET: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? done() : reject(new Error(`Workflow completion MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
