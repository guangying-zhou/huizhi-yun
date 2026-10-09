import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { productModelPageInput } from '../server/utils/productModelInput.ts'
import { crossDependencyProductCode } from '../server/utils/productCrossDependencyInput.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productAdoptionRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
test('adoption user API only accepts product and pagination, delegating identity to server authorization', async () => {
  for (const mode of ['valid', 'method', 'product', 'page', 'actor']) {
    const exports: Record<string, (event: unknown) => Promise<{ code: number }>> = {}
    let called = false
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError, setHeader: () => {}, getRouterParam: () => mode === 'product' ? '../P' : 'PROD', getQuery: () => mode === 'actor' ? { actorUid: 'OTHER' } : { page: mode === 'page' ? '0' : '2', pageSize: '10' } }
      if (name === './productModelInput') return { productModelPageInput }
      if (name === './productCrossDependencyInput') return { crossDependencyProductCode }
      if (name === './productAdoptionAssets') return { readProductAdoptionFromAssets: async (_event: unknown, product: string, page: number, size: number) => {
        called = true
        assert.equal(product, 'PROD')
        assert.equal(page, 2)
        assert.equal(size, 10)
        return { items: [] }
      } }
      throw new Error(name)
    } })
    const promise = exports.handleProductAdoption!({ method: mode === 'method' ? 'POST' : 'GET' })
    if (mode === 'valid') assert.equal((await promise).code, 0)
    else await assert.rejects(promise, { statusCode: mode === 'method' ? 405 : 400 })
    assert.equal(called, mode === 'valid')
  }
})
