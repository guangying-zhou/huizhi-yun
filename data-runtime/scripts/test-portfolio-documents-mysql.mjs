import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

// Portfolio document policy (DOC-05, 5b-1) against a throwaway MySQL instance:
// canonical Codocs tables, the real candidate migration and the real policy
// SQL. Never a shared database. The Aims side (relations, list filtering) runs
// inside test-enterprise-project-members-mysql.mjs.
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  await new Promise((done, reject) => {
    const child = spawn('go', ['test', '-race', './internal/apps/codocs', '-run', '^TestPortfolioDocumentPolicyMySQL$', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { ...process.env, HZY_PORTFOLIO_DOCUMENT_SOCKET: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? done() : reject(new Error(`Portfolio document MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
