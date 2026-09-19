import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  await new Promise((resolveRun, reject) => {
    const child = spawn('go', [
      'test', '-race', './internal/enterprisescheduler',
      '-run', '^(TestDeliverOrRecover.*|TestSchedulerRegistryMapped(Claim|Completion)MySQL)$',
      '-count=1', '-v'
    ], {
      cwd: resolve(rootDir, 'data-runtime'),
      stdio: 'inherit',
      env: { ...process.env, HZY_ENTERPRISE_SCHEDULER_TEST_SOCKET: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`External ACK recovery MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
