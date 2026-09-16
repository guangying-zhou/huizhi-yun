/* eslint-disable @typescript-eslint/no-explicit-any -- VM executes a transpiled Nuxt handler; boundary payloads intentionally include invalid types. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as policy from '../server/lib/serviceAuthPolicy'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '../../foundation/server/utils/tenantRuntimeClient'

const uuid = '00000000-0000-4000-8000-000000000001'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentSearchService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { scopes?: string[], badSignature?: boolean, tenant?: string, app?: string, bodyPatch?: object, hash?: string, runtimeFailure?: boolean, realSignature?: boolean, tamper?: string } = {}) {
  const calls: string[] = [], signed: any[] = [], runtime: any[] = [], exports: any = {}
  const headers: Record<string, string> = { 'authorization': 'Bearer test-token', 'x-hzy-tenant': options.tenant ?? 'TENANT', 'x-hzy-deployment': 'custom-codocs', 'x-hzy-app-code': options.app ?? 'codocs', 'x-request-id': 'request-1' }
  const command = { actorUid: 'reader', productCode: 'P', search: '', page: 1, pageSize: 20, action: 'search', ...options.bodyPatch }
  const envelope = { operationId: 'operation-1', targetApp: 'codocs', operationCode: 'aims.codocs.product-document.search.v1', requiredCapability: 'codocs:product-document:read', idempotencyKey: 'key-1', commandSchemaVersion: 'aims.codocs.product-document.search.v1', commandSha256: options.hash ?? 'hash', command }
  runInNewContext(compiled, { exports, defineEventHandler: (fn: unknown) => fn, require: (name: string) => {
    if (name === 'h3') return { createError, setHeader: () => {}, getHeader: (_: unknown, key: string) => headers[key], getQuery: () => ({}), getRouterParam: () => uuid, getRequestURL: () => new URL('https://codocs.example/api/v1/service/product-documents/search'), readBody: async () => {
      calls.push('body')
      return { serviceCommand: envelope }
    } }
    if (name.endsWith('/consoleOidc')) return { requireConsoleAuthContext: async () => {
      calls.push('auth')
      return { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'aims', clientCode: 'aims.runtime', scopes: options.scopes ?? ['codocs:product-document:read'], tenant: 'TENANT', deployment: 'custom-aims' }
    } }
    if (name.endsWith('/serviceAuthGuard')) return policy
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload: options.realSignature ? hashServiceCommandPayload : async () => 'hash', verifyServiceCommandRuntimeHeaders: async (args: any) => {
      calls.push('signature')
      signed.push(args)
      if (options.badSignature) throw createError({ statusCode: 403 })
      if (options.realSignature) await verifyServiceCommandRuntimeHeaders(args)
    } }
    if (name.endsWith('/codocsRuntime')) return { callCodocsTenantRuntime: async (_: unknown, path: string, args: any) => {
      calls.push('runtime')
      runtime.push({ path, args })
      if (options.runtimeFailure) throw createError({ statusCode: 503 })
      return { items: [{ uuid, title: '产品说明', doc_type: 'product', updated_at: '2026-09-08', oss_path: 'must-not-leak' }], total: 1, page: 1, pageSize: 20 }
    } }
    throw new Error(name)
  } })
  return { calls, signed, runtime, run: async () => {
    if (options.realSignature) {
      envelope.commandSha256 = await hashServiceCommandPayload(command)
      Object.assign(headers, await buildServiceCommandRuntimeHeaders({
        token: 'test-token', method: 'POST', requestTarget: '/api/v1/service/product-documents/search', requestId: 'request-1',
        tenantCode: 'TENANT', sourceDeploymentCode: 'custom-aims', targetDeploymentCode: 'custom-codocs', sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs', envelope
      }))
      if (options.tamper === 'actor') {
        command.actorUid = 'other-reader'
        envelope.commandSha256 = await hashServiceCommandPayload(command)
      } else if (options.tamper) headers[options.tamper] = 'tampered'
    }
    return exports.default({})
  } }
}

test('search handler validates real HMAC and exposes only paginated metadata', async () => {
  const h = harness({ realSignature: true })
  const result = await h.run()
  assert.deepEqual(h.calls, ['auth', 'body', 'signature', 'runtime'])
  assert.equal(h.runtime[0].path, '/v1/codocs/service/product-documents/search')
  assert.equal(h.runtime[0].args.scope, 'codocs.read codocs:product-document:read')
  assert.equal(h.runtime[0].args.serviceTokenSourceBinding, 'service-client-policy')
  assert.equal(result.data.total, 1)
  assert.deepEqual(Object.keys(result.data.items[0]).sort(), ['doc_type', 'title', 'updated_at', 'uuid'])
  for (const tamper of ['actor', 'x-request-id', 'x-hzy-service-command-target-deployment']) {
    const bad = harness({ realSignature: true, tamper })
    await assert.rejects(bad.run(), { statusCode: 403 })
    assert.equal(bad.runtime.length, 0)
  }
})
test('search handler rejects invalid bounds, injected scope and unauthorized callers', async () => {
  const denied = harness({ scopes: ['codocs:*'] })
  await assert.rejects(denied.run(), { statusCode: 403 })
  assert.deepEqual(denied.calls, ['auth'])
  for (const bodyPatch of [{ page: '1' }, { pageSize: 101 }, { search: null }, { search: 'bad\n' }, { role: 'admin' }]) {
    const h = harness({ bodyPatch })
    await assert.rejects(h.run(), { statusCode: 403 })
    assert.equal(h.runtime.length, 0)
  }
  await assert.rejects(harness({ runtimeFailure: true }).run(), { statusCode: 503 })
})
