import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('status route invokes dedicated authenticated handler before generic forwarding', async () => {
  const exports: Record<string, (event: unknown) => Promise<unknown>> = {}
  let calls = 0
  runInNewContext(compiled, { exports, defineEventHandler: (handler: unknown) => handler, require: (name: string) => {
    if (name === 'h3') return { createError, getRequestURL: () => ({ pathname: '/api/v1/service/product-feedback/status' }) }
    if (name.endsWith('/productFeedbackStatusService')) return { handleProductFeedbackStatusService: async () => {
      calls++
      return { code: 0 }
    } }
    if (name.endsWith('/tenantRuntimeProxy')) return { maybeProxyCurrentApiToTenantRuntime: () => {
      throw new Error('generic proxy must not receive status command')
    } }
    return {}
  } })
  await exports.default!({ method: 'POST' })
  assert.equal(calls, 1)
})
