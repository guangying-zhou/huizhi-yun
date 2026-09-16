import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const source = readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
const start = source.indexOf('export default defineEventHandler(async (event) => {')
const end = source.indexOf('  const costRulesStatusPath', start)
assert.ok(start >= 0 && end > start)
const normalizerStart = source.indexOf('function normalizedApiV1Path(')
const normalizerEnd = source.indexOf('\n}', normalizerStart) + 2
const normalizerCode = ts.transpileModule(source.slice(normalizerStart, normalizerEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const normalize = runInNewContext(normalizerCode + '\nnormalizedApiV1Path', { API_PREFIX: '/api/v1' })
const code = ts.transpileModule(source.slice(start, end) + '\n})', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('visibility middleware authenticates before dispatch and decodes product route once', async () => {
  const calls: string[] = []
  const exports: Record<string, (event: unknown) => Promise<unknown>> = {}
  runInNewContext(code, {
    exports, createError, defineEventHandler: (handler: unknown) => handler,
    getRequestURL: (event: { path: string }) => ({ pathname: event.path }),
    isApiV1Path: () => true,
    normalizedApiV1Path: normalize,
    ensureConsoleAuthContext: async () => { calls.push('auth') },
    handleProductVersionScope: async (event: { context: { params: unknown } }, action: string) => {
      calls.push(action)
      return event.context.params
    }
  })
  for (const prefix of ['', '/aims']) {
    calls.length = 0
    const params = await exports.default!({ path: `${prefix}/api/v1/products/${encodeURIComponent('产品 A')}/versions/12/features/7/visibility`, method: 'POST', context: {} })
    assert.deepEqual(JSON.parse(JSON.stringify(params)), { productCode: '产品 A', versionId: '12', scopeId: '7' })
    assert.deepEqual(calls, ['auth', 'visibility'])
  }
  for (const [product, method, status] of [['P1', 'GET', 405], ['%ZZ', 'POST', 400]] as const) {
    calls.length = 0
    await assert.rejects(exports.default!({ path: `/api/v1/products/${product}/versions/12/features/7/visibility`, method, context: {} }), (error: unknown) => (error as { statusCode: number }).statusCode === status)
    assert.deepEqual(calls, ['auth'])
  }
})
