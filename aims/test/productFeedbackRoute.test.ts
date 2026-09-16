/* eslint-disable @typescript-eslint/no-explicit-any -- Middleware dependencies are isolated for route dispatch verification. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

test('feedback exact service route enters dedicated handler after Console auth resolution', async () => {
  const exports: any = {}, calls: string[] = []
  runInNewContext(compiled, { exports, defineEventHandler: (handler: unknown) => handler, require: (name: string) => {
    if (name === 'h3') return { createError, getRequestURL: () => ({ pathname: '/api/v1/service/product-requests/from-feedback' }) }
    if (name.endsWith('/consoleSessionBridge')) return { resolveConsoleAuthWithSessionBridge: async () => {
      calls.push('auth')
      return { authenticated: true }
    } }
    if (name.endsWith('/productFeedbackService')) return { handleProductFeedbackService: async (event: any) => {
      calls.push('feedback')
      assert.equal(event.context.consoleAuth.authenticated, true)
      return { code: 0 }
    } }
    if (name.endsWith('/tenantRuntimeProxy')) return { maybeProxyCurrentApiToTenantRuntime: () => {
      throw new Error('must not use generic proxy')
    } }
    return {}
  } })
  const result = await exports.default({ context: {}, node: { req: { method: 'POST' } } })
  assert.equal(result.code, 0)
  assert.deepEqual(calls, ['auth', 'feedback'])
})
