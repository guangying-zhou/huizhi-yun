import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackSubmission.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function setup(input: unknown, mode = '') {
  const exports: any = {}
  const calls: any[] = []
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === './productFeedbackDispatch') return { dispatchProductFeedback: async () => {
      if (mode === 'resume') calls.push('dispatch')
      return false
    } }
    if (name === 'h3') return { createError, getQuery: () => mode === 'query' ? { actor: 'fake' } : {}, getRouterParam: () => 'ST-1', readBody: async () => input, setHeader: () => {}, setResponseStatus: (_: unknown, status: number) => calls.push(status) }
    if (name === './checkPermission') return { requirePermission: async () => {
      if (mode === 'denied') throw createError({ statusCode: 403 })
      calls.push('authorized')
    } }
    if (name === './authIdentity') return { getRequestUid: () => mode === 'anonymous' ? '' : 'pm' }
    if (name === './altocScopedAuthorization') return { resolveCurrentAltocDataAccessQuery: async () => ({ current_user_altoc_access: 'self' }) }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, options: any) => {
      calls.push({ path, options })
      return { handled: true, data: { code: 0, data: { submitted: mode !== 'no-submission', submissionId: 'submission', requestBizId: 'request', productCode: 'P1', status: 'pending', created: true, decisionStatus: 'merged', canonicalRequestBizId: 'canonical', sourceRevision: 6, operationId: 'internal', command: { secret: true } } } }
    } }
    throw new Error(name)
  } })
  return { calls, run: (submit: boolean | 'resume' = true) => exports.handleProductFeedbackSubmission({}, submit) }
}

test('feedback BFF freezes only expected digest with current scoped authorization', async () => {
  const fixture = setup({ expectedSourceSha256: 'a'.repeat(64) })
  const response = await fixture.run()
  assert.equal(fixture.calls[0], 'authorized')
  const runtime = fixture.calls[1]
  assert.equal(runtime.path, '/v1/altoc/service-tickets/ST-1/product-request:freeze')
  assert.equal(runtime.options.scope, 'altoc.write altoc:service_ticket:edit')
  assert.deepEqual(Object.keys(runtime.options.body), ['expectedSourceSha256'])
  assert.equal(runtime.options.query.current_user_altoc_access, 'self')
  assert.equal(fixture.calls[2], 202)
  assert.equal(response.data.command, undefined)
  assert.equal(response.data.operationId, undefined)
})

test('feedback BFF rejects overrides and missing authorization before runtime', async () => {
  for (const input of [{ expectedSourceSha256: 'bad' }, { expectedSourceSha256: 'a'.repeat(64), productCode: 'OTHER' }, null, []]) {
    const fixture = setup(input)
    await assert.rejects(fixture.run(), { statusCode: 400 })
    assert.equal(fixture.calls.filter(item => typeof item === 'object').length, 0)
  }
  for (const [mode, statusCode] of [['denied', 403], ['anonymous', 401], ['query', 400]] as const) {
    const fixture = setup({ expectedSourceSha256: 'a'.repeat(64) }, mode)
    await assert.rejects(fixture.run(), { statusCode })
    assert.equal(fixture.calls.filter(item => typeof item === 'object').length, 0)
  }
})

test('resume reloads the authorized binding and never freezes another submission', async () => {
  const fixture = setup({}, 'resume')
  await fixture.run('resume')
  const runtime = fixture.calls.find(item => typeof item === 'object')
  assert.equal(runtime.path, '/v1/altoc/service-tickets/ST-1/product-request')
  assert.equal(runtime.options.method, 'GET')
  assert.equal(runtime.options.body, undefined)
  assert.ok(fixture.calls.includes('dispatch'))
  const missing = setup({}, 'no-submission')
  await assert.rejects(missing.run('resume'), { statusCode: 409 })
  const injected = setup({ productCode: 'OTHER' }, 'resume')
  await assert.rejects(injected.run('resume'), { statusCode: 400 })
  assert.equal(injected.calls.filter(item => typeof item === 'object').length, 0)
})

test('feedback read exposes latest decision without internal operation data', async () => {
  const fixture = setup({})
  const response = await fixture.run(false)
  assert.equal(response.data.decisionStatus, 'merged')
  assert.equal(response.data.canonicalRequestBizId, 'canonical')
  assert.equal(response.data.sourceRevision, 6)
  assert.equal(response.data.operationId, undefined)
  assert.equal(response.data.command, undefined)
})
