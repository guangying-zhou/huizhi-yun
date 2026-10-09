import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
// Disposable source/target/Directory schemas only. Never consume an existing
// Runtime socket, profile, dotenv, snapshot, DB or secret.
const testRun = process.argv[2]
if (process.argv.length > 3 || (testRun && testRun.length > 200)) throw new Error('invalid isolated test selection')
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async ({ socketPath }) => {
  await new Promise((done, reject) => {
    const child = spawn('go', ['test', '-timeout=20m', '-race', './internal/migrations/wizbiztool', './internal/migrations/wizbiztool/independentverify', '-count=1', '-v', ...(testRun ? ['-run', testRun] : [])], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit', env: { ...process.env, HZY_W2_TEST_SOCKET: socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? done() : reject(new Error(`W2 isolated test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
