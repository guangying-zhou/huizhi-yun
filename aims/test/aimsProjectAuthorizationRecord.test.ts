import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { requireAimsProjectAuthorizationRecord } from '../server/utils/aimsProjectAuthorizationRecord'

const valid = { id: 42, project_code: 'P-42', created_by: 'owner', dept_code: null, leader_uid: null, members: [] }

test('complete authorization facts accept a real empty membership and nullable relationships', () => {
  assert.equal(requireAimsProjectAuthorizationRecord(valid, '42'), valid)
  const members = { ...valid, members: [{ uid: 'member', status: 'active' }, { uid: 'former', status: 'inactive' }] }
  assert.equal(requireAimsProjectAuthorizationRecord(members, '42'), members)
})

test('missing, malformed and mismatched facts fail closed instead of inventing project context', () => {
  for (const value of [null, undefined, {}, [], { ...valid, id: 43 }, { ...valid, id: '42' },
    { ...valid, project_code: '' }, { ...valid, members: undefined }, { ...valid, members: {} },
    { ...valid, dept_code: undefined }, { ...valid, leader_uid: undefined }, { ...valid, created_by: undefined },
    { ...valid, members: [null] }, { ...valid, members: [{ uid: 'member' }] },
    { ...valid, members: [{ uid: '', status: 'active' }] }]) {
    assert.throws(() => requireAimsProjectAuthorizationRecord(value, '42'), { statusCode: 503 })
  }
})

test('strict resolver uses only the dedicated endpoint and preserves upstream failures', async () => {
  const source = readFileSync(new URL('../server/utils/aimsScopedAuthorization.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  for (const scenario of [
    { response: { handled: false }, status: 503 },
    { response: { handled: true, data: { code: 0, data: null } }, status: 503 },
    { response: { handled: true, data: {} }, status: 503 },
    { response: { handled: true, data: { code: 403 } }, status: 403 },
    { error: createError({ statusCode: 503 }), status: 503 },
    { response: { handled: true, data: { code: 0, data: valid } }, status: 0 }
  ]) {
    const paths: string[] = []
    const exports: Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>> = {}
    runInNewContext(compiled, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './aimsProjectAuthorizationRecord') return { requireAimsProjectAuthorizationRecord }
      if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: (value: { code: number }) => createError({ statusCode: value.code }) }
      if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_event: unknown, path: string) => {
        paths.push(path)
        if (scenario.error) throw scenario.error
        return scenario.response
      } }
      return {}
    } })
    const result = exports.resolveAimsProjectAuthorizationObject!({}, { projectId: '42', uid: 'owner', requireCompleteFacts: true })
    if (scenario.status) await assert.rejects(result, { statusCode: scenario.status })
    else assert.equal((await result).projectCode, 'P-42')
    assert.deepEqual(paths, ['/v1/aims/projects/42/authorization-object'])
  }
})
