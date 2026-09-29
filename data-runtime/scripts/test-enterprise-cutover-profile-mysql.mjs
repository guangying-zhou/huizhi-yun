// K2: profile-parameterized cutover protocol on an isolated temporary MySQL.
// Runs the synthetic production-tenant happy path, the production refusals and
// the unchanged C000001/test CLI compatibility test through the real CLIs.
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async ({ socketPath, port }) => {
  await new Promise((resolveRun, reject) => {
    const child = spawn('go', ['test', '-race', './internal/migrations/cutoverprofile', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'),
      stdio: 'inherit',
      env: { ...process.env, HZY_CUTOVER_PROFILE_SOCKET: socketPath, HZY_CUTOVER_PROFILE_PORT: String(port) }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`cutover profile test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
