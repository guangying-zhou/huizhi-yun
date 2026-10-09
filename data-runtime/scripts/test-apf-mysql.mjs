import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async ({ socketPath }) => {
  await new Promise((done, reject) => {
    const child = spawn('go', ['test', '-race', './internal/enterprise/domaininstall', './internal/enterpriseapf', './internal/server', '-run', 'TestAPF', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit', env: { ...process.env, HZY_DOMAIN_INSTALL_SOCKET: socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? done() : reject(new Error(`APF isolated test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
