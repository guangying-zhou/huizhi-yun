import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  await new Promise((resolveRun, reject) => {
    const child = spawn('go', ['test', '-race', './internal/apps/aims', '-run', '^Test(?:TimeEntry(?:Pagination|ReviewPagination)|WeeklySummaryPagination)IsolatedMySQL$', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { ...process.env, HZY_TIME_ENTRY_PAGINATION_SOCKET: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Time entry pagination MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
