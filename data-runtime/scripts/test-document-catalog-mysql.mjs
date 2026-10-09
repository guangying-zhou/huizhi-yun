import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

// Document catalog (DOC-07) against a throwaway MySQL instance: the real
// migration, the real view and the real reconcile SQL. Never a shared database.
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  await new Promise((done, reject) => {
    const child = spawn('go', ['test', '-race', './internal/documentcatalog', '-run', '^TestDocumentCatalogMySQL$', '-count=1', '-v'], {
      cwd: resolve(rootDir, 'data-runtime'), stdio: 'inherit',
      env: { ...process.env, HZY_DOCUMENT_CATALOG_SOCKET: context.socketPath }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? done() : reject(new Error(`Document catalog MySQL test exited ${code}`)))
  })
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
