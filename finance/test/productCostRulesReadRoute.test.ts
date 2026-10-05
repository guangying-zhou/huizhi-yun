import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
test('cost rules route requires its dedicated handler without generic forwarding fallback', async () => {
  for (const denied of [false, true]) {
    const exports: Record<string, (event: unknown) => Promise<unknown>> = {}
    let calls = 0
    runInNewContext(compiled, { exports, defineEventHandler: (handler: unknown) => handler, require: (name: string) => {
      if (name === 'h3') return { createError, getRequestURL: () => ({ pathname: '/api/v1/finance/service/product-cost/read-rules' }) }
      if (name.endsWith('/productCostRulesReadService')) return { handleProductCostRulesReadService: async () => {
        calls++
        if (denied) throw createError({ statusCode: 403 })
        return { code: 0 }
      } }
      if (name.endsWith('/dataRuntime')) return { maybeCallCurrentFinanceDataRuntime: () => {
        throw new Error('generic proxy must not receive cost command')
      } }
      return {}
    } })
    const promise = exports.default!({ method: 'POST' })
    if (denied) await assert.rejects(promise, { statusCode: 403 })
    else await promise
    assert.equal(calls, 1)
  }
})
