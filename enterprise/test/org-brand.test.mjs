import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

const source = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const compiled = file => ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('brand Host handler authenticates before its one fixed operation and strips other fields', async () => {
  const calls = []
  let authenticated = true
  const context = { exports: {}, require(name) {
    if (name === 'h3') return { defineEventHandler: fn => fn, setHeader: () => {} }
    return {
      requireEnterpriseUser: async () => { if (!authenticated) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 }) },
      callEnterpriseRuntime: async (_event, operation, body) => {
        calls.push({ operation, body })
        return { code: 0, data: { shortName: '企业', displayName: '企业全称', legalName: 'private' } }
      }
    }
  } }
  vm.runInNewContext(compiled('../server/routes/enterprise/api/org-brand.get.ts'), context)
  const result = await context.exports.default({})
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { code: 0, data: { shortName: '企业', displayName: '企业全称' } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].operation, 'console.org-brand-view')
  assert.equal(JSON.stringify(calls[0].body), '{}')
  authenticated = false
  await assert.rejects(context.exports.default({}), error => error.statusCode === 401)
  assert.equal(calls.length, 1)
})

test('brand state caches once, falls back silently and discards responses from a previous login', async () => {
  const states = new Map([['enterprise-cache-scope', { value: 'tenant/user-a' }]])
  const callbacks = []
  const pending = []
  const tenant = { value: 'C000001' }
  const context = {
    exports: {}, useAuth: () => ({ tenant }),
    useState: (key, initial) => {
      if (!states.has(key)) states.set(key, { value: initial() })
      return states.get(key)
    },
    computed: fn => ({ get value() { return fn() } }),
    watch: (_scope, fn) => { callbacks.push(fn) },
    $fetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  }
  vm.runInNewContext(compiled('../app/composables/useEnterpriseBrand.ts'), context)
  const brand = context.exports.useEnterpriseBrand()
  assert.equal(brand.name.value, 'C000001')
  const first = callbacks[0]('tenant/user-a')
  await callbacks[0]('tenant/user-a')
  assert.equal(pending.length, 1)
  states.get('enterprise-cache-scope').value = 'tenant/user-b'
  const second = callbacks[0]('tenant/user-b')
  pending[0].resolve({ code: 0, data: { shortName: '旧企业', displayName: '' } })
  await first
  assert.equal(brand.name.value, 'C000001')
  pending[1].resolve({ code: 0, data: { shortName: ' 企业简称 ', displayName: '全称' } })
  await second
  assert.equal(brand.name.value, '企业简称')
  states.get('enterprise-cache-scope').value = 'tenant/user-c'
  const third = callbacks[0]('tenant/user-c')
  pending[2].reject(new Error('unavailable'))
  await third
  assert.equal(brand.name.value, 'C000001')
  await callbacks[0]('tenant/user-c')
  assert.equal(pending.length, 3)
  states.get('enterprise-cache-scope').value = ''
  await callbacks[0]('')
  states.get('enterprise-cache-scope').value = 'tenant/user-c'
  const relogin = callbacks[0]('tenant/user-c')
  assert.equal(pending.length, 4)
  pending[3].resolve({ code: 0, data: { shortName: '', displayName: '企业显示名' } })
  await relogin
  assert.equal(brand.name.value, '企业显示名')
})

test('brand fixed operation and GET gateway/readiness match without opening write methods', () => {
  assert.match(source('../../foundation/server/utils/enterpriseRuntimeClient.ts'), /'console.org-brand-view': \{ path: '\/v1\/enterprise\/console\/org-brand:view' \}/)
  assert.match(source('../app/layouts/default.vue'), /name: enterpriseName.*useEnterpriseBrand/)
  assert.equal(isBusinessApiReady('GET', '/enterprise/api/org-brand'), true)
  assert.equal(resolveEnterprisePilotPath('/enterprise/api/org-brand', '', 'GET').kind, 'api')
  assert.equal(resolveEnterprisePilotPath('/enterprise/api/org-brand', '', 'POST').kind, 'unavailable')
})

test('actual Foundation operation selects only Console Host execute and rejects cross-tenant sessions before transport', async () => {
  const calls = []
  let gateway = null
  const context = {
    exports: {}, useRuntimeConfig: () => ({ public: { appCode: 'enterprise' } }),
    require(module) {
      if (module === 'h3') return { createError: failure => Object.assign(new Error(failure.message), failure) }
      if (module.includes('consoleSessionBridge')) return { resolveConsoleAuthWithSessionBridge: async () => ({ authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'u1', tenant: 't1', deployment: 'console1' }) }
      if (module.includes('tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => gateway }
      if (module.includes('tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_event, path, options) => {
        calls.push({ path, options })
        return { handled: true, data: { code: 0, data: { shortName: '简称', displayName: '显示名' } } }
      } }
      return {}
    }
  }
  vm.runInNewContext(compiled('../../foundation/server/utils/enterpriseRuntimeClient.ts'), context)
  await context.exports.callEnterpriseRuntime({ context: {} }, 'console.org-brand-view', {})
  assert.equal(calls[0].path, '/v1/enterprise/console/org-brand:view')
  assert.equal(calls[0].options.scope, 'console:enterprise-host:execute')
  assert.equal(calls[0].options.appCode, 'enterprise')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(JSON.stringify(calls[0].options.body), '{}')
  gateway = { appCode: 'enterprise', tenant: 'other', deployment: 'enterprise1' }
  await assert.rejects(context.exports.callEnterpriseRuntime({ context: {} }, 'console.org-brand-view', {}), error => error.statusCode === 403)
  assert.equal(calls.length, 1)
})
