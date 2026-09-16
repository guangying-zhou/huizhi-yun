import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { crossDependencyProductCode } from '../server/utils/productCrossDependencyInput.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
test('cost user API only accepts product, project and period, delegating identity to server authorization', async () => {
  for (const mode of ['valid', 'method', 'product', 'period', 'actor']) {
    const exports: Record<string, (event: unknown) => Promise<{ code: number }>> = {}
    let called = false
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError, setHeader: () => {}, getRouterParam: () => mode === 'product' ? '../P' : 'PROD', getQuery: () => ({ projectCode: 'PRJ1', periodMonth: mode === 'period' ? '2026-13' : '2026-09', ...(mode === 'actor' ? { actorUid: 'OTHER' } : {}) }) }
      if (name === './productCrossDependencyInput') return { crossDependencyProductCode }
      if (name === './productCostFinance') return { readProductCostFromFinance: async (_event: unknown, product: string, project: string, period: string) => {
        called = true
        assert.equal(product, 'PROD')
        assert.equal(project, 'PRJ1')
        assert.equal(period, '2026-09')
        return { items: [] }
      } }
      throw new Error(name)
    } })
    const promise = exports.handleProductCost!({ method: mode === 'method' ? 'POST' : 'GET' })
    if (mode === 'valid') assert.equal((await promise).code, 0)
    else await assert.rejects(promise, { statusCode: mode === 'method' ? 405 : 400 })
    assert.equal(called, mode === 'valid')
  }
})
