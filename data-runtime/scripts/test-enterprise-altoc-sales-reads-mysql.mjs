import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  for (const [pkg, name, key] of [['./internal/apps/altoc', 'TestSalesReadsIsolatedMySQL', 'HZY_ALTOC_SALES_SOCKET'], ['./internal/server', 'TestEnterpriseAltocSalesReadsHTTPMySQL', 'HZY_ALTOC_SALES_HTTP_SOCKET']]) await new Promise((resolveRun, reject) => {
    const child = spawn('go', ['test', '-race', pkg, '-run', `^${name}$`, '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { ...process.env, [key]: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Altoc ${name} MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
