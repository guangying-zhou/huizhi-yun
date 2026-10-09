import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { authorizationResourcesAllow } from '../../foundation/shared/utils/authorizationActions'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentCreateEligibility.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(actions: string[], wrongActor = false, unavailable = false) {
  const calls: unknown[][] = []
  const exports: { requireProductDocumentCreateEligibility?: (event: object, actor: string) => Promise<void> } = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name.endsWith('/authorizationActions')) return { authorizationResourcesAllow }
    if (name.endsWith('/platformBundleAuthorization')) return { loadAuthorizationSnapshotFromConsoleRuntime: async (...args: unknown[]) => {
      calls.push(args)
      if (unavailable) throw createError({ statusCode: 503 })
      return { uid: wrongActor ? 'service-client' : 'reader', resources: { documents: actions } }
    } }
    throw new Error(name)
  } })
  return { calls, run: (actor = 'reader') => exports.requireProductDocumentCreateEligibility!({}, actor) }
}
test('signed user needs explicit document create eligibility, not read/edit/service capability', async () => {
  const allowed = harness(['view', 'create'])
  await allowed.run()
  assert.deepEqual(allowed.calls[0]?.slice(0, 2), ['reader', 'codocs'])
  for (const actions of [[], ['view'], ['edit'], ['admin'], ['codocs:product-document:create']]) await assert.rejects(harness(actions).run(), { statusCode: 403 })
  await assert.rejects(harness(['create'], true).run(), { statusCode: 503 })
  await assert.rejects(harness(['create'], false, true).run(), { statusCode: 503 })
  for (const actor of ['', ' reader', 'reader\n', 'x'.repeat(65)]) {
    const invalid = harness(['create'])
    await assert.rejects(invalid.run(actor), { statusCode: 403 })
    assert.equal(invalid.calls.length, 0)
  }
})
