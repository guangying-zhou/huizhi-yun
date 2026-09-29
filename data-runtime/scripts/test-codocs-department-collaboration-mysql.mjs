import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

// Directory and Codocs are installed as two different schemas of one disposable
// server, exactly as in production. Nothing outside the temporary datadir is touched.
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  await new Promise((resolveRun, reject) => {
    const child = spawn('go', ['test', '-race', './internal/apps/codocs', '-run', '^TestMySQLDepartmentCollaboration', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, HZY_CODOCS_DEPT_COLLAB_TEST_SOCKET: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Codocs department collaboration MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
