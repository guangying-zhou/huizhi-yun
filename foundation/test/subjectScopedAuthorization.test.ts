import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/subjectScopedAuthorization.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
test('subject scope client uses service binding helper and rejects mismatched snapshots', async () => {
  for (const mode of ['valid', 'long-budget', 'runtime', 'uid', 'appCode', 'purpose', 'resourceCode', 'action', 'authorizationMode', 'grants', 'outage', 'timeout']) {
    const exports: Record<string, (input: unknown) => Promise<Record<string, unknown>>> = {}
    let requested = false
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './consoleRuntime') return { getConsoleRuntimeConfig: async () => ({ app: { appCode: 'aims' }, console: { baseUrl: 'https://console.test' }, tenant: { tenantCode: mode === 'runtime' ? '' : 'T' }, deployment: { deploymentCode: 'D' } }) }
      if (name === './serviceOidc') return {
        trustedServiceRequestHeaders: () => ({ 'x-hzy-tenant': 'T' }),
        requestWithServiceAccessToken: async (options: { audience: string, scope: string, request: (token: string) => Promise<unknown> }) => {
          requested = true
          assert.equal(options.audience, 'console')
          assert.equal(options.scope, 'console:subject-authorization:read')
          return options.request('test-token')
        },
        fetchConsoleServiceJson: async (_event: unknown, url: string, options: { body: Record<string, unknown>, headers: Record<string, string>, timeout: number }) => {
          assert.equal(options.timeout, mode === 'long-budget' ? 100000 : 10000)
          assert.equal(url, 'https://console.test/api/v1/console/service/authorization/subject-scoped')
          assert.equal(options.headers.authorization, 'Bearer test-token')
          assert.equal(options.headers['x-hzy-tenant'], 'T')
          assert.deepEqual(Object.keys(options.body).sort(), ['purpose', 'subjectUid'])
          if (mode === 'outage') throw createError({ statusCode: 503 })
          if (mode === 'timeout') throw Object.assign(new Error('deadline exceeded'), { name: 'TimeoutError' })
          const data: Record<string, unknown> = { uid: 'U1', appCode: 'aims', purpose: 'product_feedback_create', resourceCode: 'product_requests', action: 'create', authorizationMode: 'merged', policyRevision: 1, bundleVersion: 'v1', grants: [], departmentCodes: [], departmentTree: {} }
          if (mode in data) data[mode] = mode === 'grants' ? [{ permissions: [{ appCode: 'assets', resourceCode: 'deliveries' }] }] : 'other'
          return { code: 0, data }
        }
      }
      throw new Error(name)
    } })
    const promise = exports.loadSubjectScopedAuthorizationByService!({ event: {}, subjectUid: 'U1', purpose: 'product_feedback_create', resourceCode: 'product_requests', action: 'create', ...(mode === 'long-budget' ? { timeoutMs: 100000 } : {}) })
    if (mode === 'valid' || mode === 'long-budget') assert.equal((await promise).uid, 'U1')
    else await assert.rejects(promise, { statusCode: 503 })
    assert.equal(requested, mode !== 'runtime')
  }
})
