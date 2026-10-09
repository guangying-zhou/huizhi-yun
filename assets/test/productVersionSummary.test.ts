import { extractServiceOperationStatus } from '../../foundation/server/utils/serviceOperation.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { productVersionSummaries } from '../server/utils/productVersionSummary.ts'

test('asset version summaries omit internal projects, actors, work totals and feature content', () => {
  const rows = productVersionSummaries([{ id: 1, product_code: 'P1', version_code: 'v1.0', status: 'released', name: '公开版本', feature_count: '2', delivered_feature_count: 1,
    projects: [{ customerCode: 'PRIVATE' }], owner_project_name: 'PRIVATE', actor_uid: 'PRIVATE', features: [{ description: 'PRIVATE' }], target_count: 10, progress_percent: 25 }], 'P1')
  assert.deepEqual(rows, [{ id: 1, product_code: 'P1', version_code: 'v1.0', status: 'released', name: '公开版本', feature_count: 2, delivered_feature_count: 1 }])
  assert.equal(JSON.stringify(rows).includes('PRIVATE'), false)
  assert.throws(() => productVersionSummaries([{ id: 1, product_code: 'OTHER', version_code: 'v1', status: 'released' }], 'P1'))
  assert.throws(() => productVersionSummaries(undefined, 'P1'))
  assert.deepEqual(productVersionSummaries([], 'P1'), [])
})

test('version adapter uses target binding and does not forward incoming runtime credentials', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../server/api/v1/products/[id]/versions.get.ts', import.meta.url), 'utf8')
  assert.match(source, /scope: 'aims:product-version-summary:read'/)
  assert.match(source, /\/version-summaries/)
  assert.match(source, /serviceAppFetch<RuntimeEnvelope<AimsVersionsResponse>>/)
  assert.match(source, /trustedServiceRequestHeaders\(event, 'aims'\)/)
  assert.match(source, /productVersionSummaries\(response.data\?\.items, productCode\)/)
  assert.doesNotMatch(source, /x-hzy-(tenant|data)-runtime-token|forwardedContextHeaders|\$fetch/)
})

test('version lookup checks current product permission before obtaining service authority', async () => {
  const { readFileSync } = await import('node:fs')
  const { Script, createContext } = await import('node:vm')
  const { default: ts } = await import('typescript')
  const source = readFileSync(new URL('../server/api/v1/products/[id]/versions.get.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace('export default ', 'globalThis.handler = ')
  const calls: string[] = []
  let allowed = false
  let runtimeFailure: unknown = null
  let serviceFailure: unknown = null
  const context = createContext({
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: () => '7',
    requirePermission: async (_event: unknown, resource: string, action: string) => {
      calls.push('permission')
      assert.equal(resource, 'products')
      assert.equal(action, 'view')
      if (!allowed) throw new Error('forbidden')
    },
    requireRequestUid: () => 'verified-user',
    resolveAssetsObjectScopeQuery: async () => ({ current_user_assets_object_access: 'all' }),
    maybeCallTenantRuntime: async (_event: unknown, _path: string, options: { query: { current_user: string } }) => {
      calls.push('local')
      assert.equal(options.query.current_user, 'verified-user')
      return { handled: true, data: runtimeFailure || { code: 0, data: { product_code: 'P1' } } }
    },
    requestServiceAccessToken: async () => {
      calls.push('token')
      return 'test-token'
    },
    resolveServiceAppBaseUrl: () => 'https://aims.invalid',
    trustedServiceRequestHeaders: () => ({}),
    serviceAppFetch: async () => serviceFailure || ({ code: 0, data: { items: [] } }),
    extractServiceOperationStatus,
    createError: (input: { statusCode: number, message: string }) => Object.assign(new Error(input.message), input),
    productVersionSummaries
  })
  new Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
  await assert.rejects(context.handler({}), /forbidden/)
  assert.deepEqual(calls, ['permission'])
  calls.length = 0
  allowed = true
  await context.handler({})
  assert.deepEqual(calls, ['permission', 'local', 'token'])
  for (const stage of ['runtime', 'service']) {
    for (const upstream of [401, 403, 404, 409, 429, 500]) {
      const failure = { code: 1, message: 'PRIVATE diagnostic', data: { upstreamStatus: upstream } }
      runtimeFailure = stage === 'runtime' ? failure : null
      serviceFailure = stage === 'service' ? failure : null
      calls.length = 0
      await assert.rejects(context.handler({}), (error: unknown) => {
        assert.equal((error as { statusCode: number }).statusCode, upstream === 500 ? 503 : upstream)
        assert.equal(String(error).includes('PRIVATE'), false)
        return true
      })
      if (stage === 'runtime') assert.deepEqual(calls, ['permission', 'local'])
    }
  }
})
