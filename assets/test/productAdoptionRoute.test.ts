import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function loadMiddleware(pathname: string, handler: () => Promise<unknown>) {
  const exports: Record<string, (event: unknown) => Promise<unknown>> = {}
  runInNewContext(compiled, { exports, defineEventHandler: (fn: unknown) => fn, require: (name: string) => {
    if (name === 'h3') return { createError, getRequestURL: () => ({ pathname }) }
    if (name.endsWith('/productAdoptionService')) return { handleProductAdoptionService: handler }
    if (name.endsWith('/authIdentity')) return { ensureAssetsConsoleAuth: async () => {} }
    if (name.endsWith('/tenantRuntimeProxy')) return { maybeProxyCurrentApiToTenantRuntime: () => {
      throw new Error('generic proxy must not receive adoption command')
    } }
    return {}
  } })
  return exports.default!
}

// Gateway and Service Binding both keep the /assets base path; the route must
// match on the /api/v1 suffix like every other path check in this middleware.
test('adoption route requires its dedicated handler without generic forwarding fallback', async () => {
  for (const pathname of ['/api/v1/service/product-adoption/read', '/assets/api/v1/service/product-adoption/read']) {
    for (const denied of [false, true]) {
      let calls = 0
      const middleware = loadMiddleware(pathname, async () => {
        calls++
        if (denied) throw createError({ statusCode: 403 })
        return { code: 0 }
      })
      const promise = middleware({ method: 'POST', node: { req: { method: 'POST' } } })
      if (denied) await assert.rejects(promise, { statusCode: 403 })
      else await promise
      assert.equal(calls, 1, pathname)
    }
  }
})

test('lookalike adoption paths never reach the adoption handler', async () => {
  for (const pathname of ['/assets/api/v1/service/product-adoption/read/extra', '/assets/api/v1/service/product-adoption/reader']) {
    let calls = 0
    const middleware = loadMiddleware(pathname, async () => {
      calls++
    })
    await assert.rejects(middleware({ method: 'POST', node: { req: { method: 'POST' } } }), { statusCode: 403 })
    assert.equal(calls, 0, pathname)
  }
})
