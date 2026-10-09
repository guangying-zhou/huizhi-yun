import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { productModelPageInput } from '../server/utils/productModelInput'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentSearchRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(query: Record<string, unknown> = {}, method = 'GET', failure = 0) {
  const exports: { handleProductDocumentSearch?: (event: unknown) => Promise<unknown> } = {}
  const calls: unknown[][] = []
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getQuery: () => query, getRouterParam: () => 'P', setHeader: () => {} }
    if (name.endsWith('/productModelInput')) return { productModelPageInput }
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: () => true }
    if (name.endsWith('/productDocumentCodocs')) return { searchProductDocuments: async (...args: unknown[]) => {
      calls.push(args)
      if (failure) throw createError({ statusCode: failure })
      return { items: [], total: 0, page: args[3], pageSize: args[4] }
    } }
    throw new Error(name)
  } })
  return { calls, run: () => exports.handleProductDocumentSearch!({ method }) }
}
test('search BFF passes bounded pagination and normalized search without actor overrides', async () => {
  const h = harness({ search: ' 说明 ', page: '2', pageSize: '10' })
  await h.run()
  assert.deepEqual(h.calls[0]?.slice(1), ['P', '说明', 2, 10])
  for (const query of [{ actorUid: 'other' }, { page: '0' }, { pageSize: '101' }, { search: ['a', 'b'] }]) {
    const invalid = harness(query)
    await assert.rejects(invalid.run(), { statusCode: 400 })
    assert.equal(invalid.calls.length, 0)
  }
  await assert.rejects(harness({}, 'POST').run(), { statusCode: 405 })
  for (const status of [403, 503]) await assert.rejects(harness({}, 'GET', status).run(), { statusCode: status })
})
