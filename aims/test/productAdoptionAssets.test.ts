import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'
import { createError } from 'h3'
import { parseProductAdoptionResponse } from '../server/utils/productAdoptionResponse.ts'
import { crossDependencyProductCode } from '../server/utils/productCrossDependencyInput.ts'
import { productAdoptionServiceFailure, productAdoptionTokenFailure, productAdoptionUpstreamStatus } from '../server/utils/productAdoptionFailure.ts'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productAdoptionAssets.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
test('AIMS adoption checks product access before obtaining exact Assets service token', async () => {
  for (const mode of ['valid', 'denied', 'route', 'wrong-result', 'scope-denied', 'service-rejected', 'token-failure']) {
    const exports: Record<string, (event: unknown, product: string, page: number, pageSize: number) => Promise<unknown>> = {}
    const calls: string[] = []
    const context = { exports, crypto: webcrypto, URL, console, $fetch: async (url: string, options: { headers: Record<string, string>, body: { serviceCommand: { command: { actorUid: string } } } }) => {
      calls.push('fetch')
      assert.equal(url, 'https://assets.test/api/v1/service/product-adoption/read')
      // Assets 的两种 403：原用户对象范围被拒 vs 服务身份/签名被拒。
      if (mode === 'scope-denied') throw createError({ statusCode: 403, message: '无权查看产品采用涉及的交付资产或环境', data: { statusCode: 403, data: { reason: 'assets_object_scope_denied' } } })
      if (mode === 'service-rejected') throw createError({ statusCode: 403, message: '产品采用查询的服务身份或部署绑定无效', data: { statusCode: 403, data: { reason: 'product_adoption_service_identity_invalid' } } })
      assert.equal(options.headers['x-hzy-deployment'], 'ASSETS')
      assert.equal(options.headers['x-hzy-app-code'], 'assets')
      assert.equal(options.headers['x-forwarded-prefix'], '/assets')
      assert.equal(options.body.serviceCommand.command.actorUid, 'U1')
      return { code: 0, data: { productCode: mode === 'wrong-result' ? 'OTHER' : 'PROD', page: 1, pageSize: 20, total: 0, items: [], queriedAt: new Date().toISOString(), summary: { instances: 0, environments: 0, customers: 0, productionInstances: 0, unknownVersionInstances: 0, conflictingVersionInstances: 0 } } }
    }, require: (name: string) => {
      if (name.endsWith('/appServiceBinding')) return { serviceAppFetch: (_event: unknown, app: string, url: string, options: { headers: Record<string, string>, body: { serviceCommand: { command: { actorUid: string } } } }) => {
        assert.equal(app, 'assets')
        return context.$fetch(url, options)
      } }
      if (name === 'h3') return { createError, getHeader: () => '' }
      if (name === './productAdoptionResponse') return { parseProductAdoptionResponse }
      if (name === './productAdoptionFailure') return { productAdoptionServiceFailure, productAdoptionTokenFailure, productAdoptionUpstreamStatus }
      if (name === './productCrossDependencyInput') return { crossDependencyProductCode }
      if (name === './productAuthorization') return { requireProductPermission: async (_event: unknown, product: string, resource: string, action: string) => {
        calls.push('permission')
        assert.equal(product, 'PROD')
        assert.equal(resource, 'products')
        assert.equal(action, 'view')
        if (mode === 'denied') throw createError({ statusCode: 403 })
        return { product_code: product, actor_uid: 'U1' }
      } }
      if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => ({ tenant: 'T', deployment: 'AIMS', appCode: 'aims' }) }
      if (name.endsWith('/serviceAppUrl')) return { resolveTrustedServiceAppRoute: () => mode === 'route' ? null : { baseUrl: 'https://assets.test', deploymentCode: 'ASSETS' } }
      if (name.endsWith('/serviceOidc')) return { requestServiceAccessToken: async (input: { audience: string, scope: string }) => {
        calls.push('token')
        assert.equal(input.audience, 'assets')
        assert.equal(input.scope, 'assets:product-adoption:read')
        if (mode === 'token-failure') throw createError({ statusCode: 403, message: 'Console service token request failed: insufficient_scope' })
        return 'token'
      }, trustedServiceRequestHeaders: () => ({ 'x-hzy-deployment': 'ASSETS', 'x-hzy-app-code': 'assets', 'x-forwarded-prefix': '/assets' }) }
      if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload: async () => 'hash', buildServiceCommandRuntimeHeaders: async (input: { sourceDeploymentCode: string, targetDeploymentCode: string }) => {
        calls.push('sign')
        assert.equal(input.sourceDeploymentCode, 'AIMS')
        assert.equal(input.targetDeploymentCode, 'ASSETS')
        return {}
      } }
      throw new Error(name)
    } }
    runInNewContext(compiled, context)
    const promise = exports.readProductAdoptionFromAssets!({}, 'PROD', 1, 20)
    if (mode === 'valid') {
      await promise
    } else {
      // 只有 Aims 本地拒绝和 Assets 明确拒绝原用户对象范围才是 403；
      // 服务身份、签名或令牌问题必须保持 503，不能提示用户去申请权限。
      const expected = ['denied', 'scope-denied'].includes(mode) ? 403 : 503
      await assert.rejects(promise, (error: { statusCode?: number, data?: { reason?: string }, message?: string }) => {
        assert.equal(error.statusCode, expected, mode)
        if (mode === 'scope-denied') assert.equal(error.data?.reason, 'assets_object_scope_denied')
        if (mode === 'service-rejected') assert.equal(error.data?.reason, 'product_adoption_service_rejected')
        if (mode === 'token-failure') {
          assert.equal(error.data?.reason, 'product_adoption_token_unavailable')
          assert.doesNotMatch(String(error.message), /insufficient_scope/)
        }
        return true
      })
    }
    const expectedCalls = ['denied', 'route'].includes(mode)
      ? ['permission']
      : mode === 'token-failure' ? ['permission', 'token'] : ['permission', 'token', 'sign', 'fetch']
    assert.deepEqual(calls, expectedCalls, mode)
  }
})
