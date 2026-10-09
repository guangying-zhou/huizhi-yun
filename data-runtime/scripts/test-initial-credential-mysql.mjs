import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkReadinessTemplate } from '../../deploy/test-env/enterprise-readiness-policy.mjs'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
// Validate the exact current Host capability set before testing its grants.
checkReadinessTemplate(JSON.parse(readFileSync(resolve(rootDir, 'deploy/test-env/enterprise-readiness.template.json'), 'utf8')), rootDir)
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  await new Promise((resolveRun, reject) => {
    const child = spawn('go', ['test', '-race', './internal/apps/console', '-run', '^TestInitialServiceCredentialMySQL$', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { ...process.env, HZY_INITIAL_CREDENTIAL_TEST_SOCKET: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Initial credential MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
