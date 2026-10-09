import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  await new Promise((done, fail) => {
    const child = spawn('go', ['test', '-race', './internal/apps/codocs', '-run', '^TestMySQLDepartmentDirectoryCrossSchemaLock$', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, HZY_PRODUCT_CENTER_TEST_SOCKET: context.socketPath }
    })
    child.once('error', fail)
    child.once('exit', code => code === 0 ? done() : fail(new Error(`Cross-schema Directory test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
