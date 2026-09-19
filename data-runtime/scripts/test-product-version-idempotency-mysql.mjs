import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  await new Promise((resolveRun, reject) => {
    const child = spawn('go', [
      'test',
      './internal/apps/aims/productcenter',
      '-run',
      '^TestMySQLVersionCreateReplaysCommittedResultAfterResponseLoss$',
      '-count=1',
      '-v'
    ], {
      cwd: resolve(rootDir, 'data-runtime'),
      stdio: 'inherit',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HZY_PRODUCT_CENTER_TEST_SOCKET: context.socketPath
      }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveRun()
      : reject(new Error(`Product version idempotency MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
