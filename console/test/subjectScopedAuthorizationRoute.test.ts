import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { resolveSubjectScopedAuthorizationRequest } from '../server/utils/subjectScopedAuthorizationContract.ts'
import { SubjectEligibilityError } from '../server/utils/subjectEligibilityContract.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/api/v1/console/service/authorization/subject-scoped.post.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
test('subject scoped route authorizes before reading body or loading policy', async () => {
  for (const mode of ['valid', 'unauthorized', 'query', 'purpose', 'override']) {
    const exports: Record<string, (event: unknown) => Promise<{ code: number }>> = {}
    const calls: string[] = []
    runInNewContext(code, { exports, defineEventHandler: (handler: unknown) => handler, require: (name: string) => {
      if (name === 'h3') return { createError, setHeader: () => {}, getQuery: () => mode === 'query' ? { subjectUid: 'other' } : {}, readBody: async () => {
        calls.push('body')
        return { subjectUid: 'U1', purpose: mode === 'purpose' ? 'unknown' : 'product_feedback_create', ...(mode === 'override' ? { action: 'admin' } : {}) }
      } }
      if (name.endsWith('/vault')) return { requireConsoleServiceActor: async (_event: unknown, audience: string, scope: string, options: { requireBoundTargetApp: boolean }) => {
        calls.push('auth')
        assert.equal(audience, 'console')
        assert.equal(scope, 'console:subject-authorization:read')
        assert.equal(options.requireBoundTargetApp, true)
        if (mode === 'unauthorized') throw createError({ statusCode: 403 })
        return { actorType: 'service', actorId: 'client', appCode: 'aims', tenantCode: 'T', deploymentCode: 'D' }
      } }
      if (name.endsWith('/consoleRuntimeBinding')) return { resolveConsoleRuntimeBinding: () => ({ tenantId: 'T', deploymentId: 'D' }) }
      if (name.endsWith('/subjectScopedAuthorizationContract')) return { resolveSubjectScopedAuthorizationRequest }
      if (name.endsWith('/subjectEligibilityContract')) return { SubjectEligibilityError }
      if (name.endsWith('/subjectScopedAuthorization')) return { loadSubjectScopedAuthorization: async (_event: unknown, request: { resourceCode: string }) => {
        calls.push('policy')
        assert.equal(request.resourceCode, 'product_requests')
        return { uid: 'U1', grants: [] }
      } }
      throw new Error(name)
    } })
    const promise = exports.default!({})
    if (mode === 'valid') {
      assert.equal((await promise).code, 0)
      assert.deepEqual(calls, ['auth', 'body', 'policy'])
    } else {
      await assert.rejects(promise, { statusCode: ['unauthorized', 'purpose'].includes(mode) ? 403 : 400 })
      assert.ok(!calls.includes('policy'))
      if (['unauthorized', 'query'].includes(mode)) assert.deepEqual(calls, ['auth'])
    }
  }
})
