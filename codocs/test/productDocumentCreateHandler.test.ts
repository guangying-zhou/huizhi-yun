/* eslint-disable @typescript-eslint/no-explicit-any -- VM executes a transpiled Nuxt handler; boundary payloads intentionally include invalid types. */
import test from 'node:test'
import { createHash } from 'node:crypto'
import { uploadPreparedProductDocument } from '../server/utils/productDocumentCreationUpload'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as policy from '../server/lib/serviceAuthPolicy'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '../../foundation/server/utils/tenantRuntimeClient'

const uuid = '00000000-0000-4000-8000-000000000001'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentCreateService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { receiptMismatch?: boolean, uploadFailure?: boolean, completed?: boolean, eligibilityDenied?: number, storageFailure?: boolean, recovery?: boolean, scopes?: string[], badSignature?: boolean, tenant?: string, app?: string, bodyPatch?: object, hash?: string, runtimeFailure?: boolean, realSignature?: boolean, tamper?: string } = {}) {
  const calls: string[] = [], signed: any[] = [], runtime: any[] = [], exports: any = {}
  const headers: Record<string, string> = { 'authorization': 'Bearer test-token', 'x-hzy-tenant': options.tenant ?? 'TENANT', 'x-hzy-deployment': 'custom-codocs', 'x-hzy-app-code': options.app ?? 'codocs', 'x-request-id': 'request-1' }
  const command = { actorUid: 'reader', productCode: 'P', documentUuid: uuid, templateUuid: '00000000-0000-4000-8000-000000000002', title: 'Spec', action: 'create', ...options.bodyPatch }
  const envelope = { operationId: '00000000-0000-4000-8000-000000000003', targetApp: 'codocs', operationCode: 'aims.codocs.product-document.create.v1', requiredCapability: 'codocs:product-document:create', idempotencyKey: 'key-1', commandSchemaVersion: 'product-document-create.v1', commandSha256: options.hash ?? 'hash', command }
  runInNewContext(compiled, { exports, defineEventHandler: (fn: unknown) => fn, require: (name: string) => {
    if (name === 'h3') return { createError, setHeader: () => {}, getHeader: (_: unknown, key: string) => headers[key], getQuery: () => ({}), getRouterParam: () => uuid, getRequestURL: () => new URL('https://codocs.example/api/v1/service/product-documents/create'), readBody: async () => {
      calls.push('body')
      return { serviceCommand: envelope }
    } }
    if (name.endsWith('/consoleOidc')) return { requireConsoleAuthContext: async () => {
      calls.push('auth')
      return { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'aims', clientCode: 'aims.runtime', scopes: options.scopes ?? ['codocs:product-document:create'], tenant: 'TENANT', deployment: 'custom-aims' }
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
      if (path.endsWith('/template')) return { uuid: command.templateUuid, docType: 'product', ossPath: 'private-template' }
      if (path.endsWith('/prepare')) return { operationId: envelope.operationId, documentUuid: uuid, content: '# Frozen', contentSha256: createHash('sha256').update('# Frozen').digest('hex'), state: options.completed ? 'completed' : 'prepared', publishedPath: options.completed ? `product-creations/${envelope.operationId}/00000000-0000-4000-8000-000000000005.md` : '' }
      return { operationId: envelope.operationId, operationCode: envelope.operationCode, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: options.receiptMismatch ? 'wrong' : envelope.commandSha256, receiptId: '00000000-0000-4000-8000-000000000004', receiptStatus: 'succeeded', idempotent: false, targetBizType: 'product_document', targetBizCode: uuid, responseSummarySha256: 'a'.repeat(64), result: { uuid, title: 'Spec', productCode: 'P' }, secret: 'hidden' }
    } }
    if (name.endsWith('/oss')) return { uploadDocument: async (path: string, content: string, type: string) => {
      calls.push('upload')
      assert.equal(content, '# Frozen')
      assert.equal(type, 'product')
      assert.ok(path.startsWith(`product-creations/${envelope.operationId}/`))
      if (options.uploadFailure) throw new Error('private upload failure')
    }, downloadDocument: async () => {
      calls.push('storage')
      if (options.storageFailure) throw new Error('private storage path')
      return options.recovery ? '' : '# Hello'
    } }
    if (name.endsWith('/yjsMarkdownRecovery')) return { hasMeaningfulMarkdownContent: () => !options.recovery, recoverMarkdownFromYjsSnapshot: async () => '# Recovered' }
    if (name.endsWith('/productDocumentCreateEligibility')) return { requireProductDocumentCreateEligibility: async () => {
      calls.push('eligibility')
      if (options.eligibilityDenied === calls.filter(call => call === 'eligibility').length) throw createError({ statusCode: 403 })
    } }
    if (name.endsWith('/productDocumentCreationUpload')) return { uploadPreparedProductDocument }
    throw new Error(name)
  } })
  return { calls, signed, runtime, run: async () => {
    if (options.realSignature) {
      envelope.commandSha256 = await hashServiceCommandPayload(command)
      Object.assign(headers, await buildServiceCommandRuntimeHeaders({
        token: 'test-token', method: 'POST', requestTarget: '/api/v1/service/product-documents/create', requestId: 'request-1',
        tenantCode: 'TENANT', sourceDeploymentCode: 'custom-aims', targetDeploymentCode: 'custom-codocs', sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs', envelope
      }))
      if (options.tamper === 'actor') {
        command.actorUid = 'other-reader'
        envelope.commandSha256 = await hashServiceCommandPayload(command)
      } else if (options.tamper) headers[options.tamper] = 'tampered'
    }
    return exports.default({ method: 'POST' })
  } }
}

test('create service validates signed user before template and again before completion', async () => {
  const h = harness({ realSignature: true })
  const result = await h.run()
  assert.deepEqual(h.calls, ['auth', 'body', 'signature', 'eligibility', 'runtime', 'storage', 'runtime', 'upload', 'eligibility', 'runtime'])
  assert.equal(h.runtime.length, 3)
  assert.equal(h.runtime[0].args.scope, 'codocs.write codocs:product-document:create')
  assert.equal(h.runtime[0].args.serviceCommandActor.uid, 'reader')
  assert.equal(h.runtime[1].args.body.templateContent, '# Hello')
  assert.equal(result.data.result.uuid, uuid)
  assert.equal(JSON.stringify(result).includes('hidden'), false)
})
test('create service refuses read scope or tampered actor before storage', async () => {
  const denied = harness({ scopes: ['codocs:product-document:read'] })
  await assert.rejects(denied.run(), { statusCode: 403 })
  assert.deepEqual(denied.calls, ['auth'])
  const changed = harness({ realSignature: true, tamper: 'actor' })
  await assert.rejects(changed.run(), { statusCode: 403 })
  assert.equal(changed.calls.includes('runtime'), false)
})

test('complete service composition skips uploads on replay and stops on upload or eligibility failure', async () => {
  const replay = harness({ realSignature: true, completed: true })
  await replay.run()
  assert.equal(replay.calls.includes('upload'), false)
  assert.equal(replay.runtime.at(-1).args.body.uploadedPath.endsWith('00000000-0000-4000-8000-000000000005.md'), true)
  const failed = harness({ uploadFailure: true })
  await assert.rejects(failed.run(), { statusCode: 503 })
  assert.equal(failed.runtime.some(call => call.path.endsWith('/complete')), false)
  for (const eligibilityDenied of [1, 2]) {
    const denied = harness({ eligibilityDenied })
    await assert.rejects(denied.run(), { statusCode: 403 })
    assert.equal(denied.runtime.some(call => call.path.endsWith('/complete')), false)
    if (eligibilityDenied === 1) assert.equal(denied.calls.includes('storage'), false)
  }
})

test('create service rejects a receipt for a different frozen command', async () => {
  await assert.rejects(harness({ realSignature: true, receiptMismatch: true }).run(), { statusCode: 503 })
})
