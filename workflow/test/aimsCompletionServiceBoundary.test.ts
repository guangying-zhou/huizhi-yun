/* eslint-disable @typescript-eslint/no-explicit-any -- isolated BFF boundary captures verified helper inputs. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/api/v1/service/aims-work-item-completion-approval.post.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function boundary(mode = '') {
  const calls: any[] = [], exports: any = {}
  const auth: any = { authenticated: true, subjectType: 'service', tokenUse: 'service', appCode: 'aims', clientCode: 'aims.runtime', tenant: 'T1', deployment: 'AIMS', scopes: ['workflow:work-item-complete:create'] }
  const envelope: any = { targetApp: 'workflow', operationCode: 'aims.work-item.completion.workflow-submit.v1', requiredCapability: 'workflow:work-item-complete:create', commandSchemaVersion: 'v1', commandSha256: 'hash', command: { actorUid: 'U1' } }
  if (mode === 'no-cap') auth.scopes = []
  if (mode === 'wrong-client') auth.clientCode = 'enterprise.runtime'
  if (mode === 'wrong-actor') envelope.command.actorUid = 'U2'
  if (mode === 'wrong-operation') envelope.operationCode = 'other'
  if (mode === 'wrong-hash') envelope.commandSha256 = 'forged'
  if (mode === 'matter') {
    envelope.commandSchemaVersion = 'v2'
    envelope.command.kind = 'matter'
    envelope.command.formData = { kind: 'matter' }
  }
  if (mode === 'matter-wrong-schema') {
    envelope.command.kind = 'matter'
    envelope.command.formData = { kind: 'matter' }
  }
  if (mode === 'matter-v3') {
    envelope.commandSchemaVersion = 'v3'
    envelope.command.kind = 'matter'
    envelope.command.formData = { kind: 'matter' }
  }
  if (mode === 'target-v2') envelope.commandSchemaVersion = 'v2'
  if (mode === 'target-v3') envelope.commandSchemaVersion = 'v3'
  if (mode === 'target-explicit-kind') {
    envelope.command.kind = 'target'
    envelope.command.formData = { kind: 'target' }
  }
  const gateway = { tenant: mode === 'wrong-tenant' ? 'T2' : 'T1', appCode: 'workflow', deployment: 'WORKFLOW' }
  runInNewContext(compiled, { exports, defineEventHandler: (handler: any) => handler, require: (name: string) => {
    if (name === 'h3') return { createError, getRequestURL: () => new URL('https://test.invalid/api/v1/service/aims-work-item-completion-approval'), getHeader: (_event: any, key: string) => ({ 'authorization': 'Bearer verified-token', 'x-hzy-actor-uid': 'U1', 'x-request-id': 'request-1' }[key]), readBody: async () => ({ serviceCommand: envelope }) }
    if (name.endsWith('/authIdentity')) return { ensureWorkflowConsoleAuth: async () => auth }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => gateway }
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload: async () => 'hash', verifyServiceCommandRuntimeHeaders: async (input: any) => {
      calls.push({ verify: input })
      if (['missing-signature', 'wrong-signature', 'wrong-source-deployment'].includes(mode)) throw createError({ statusCode: 403, message: 'invalid signature context' })
    } }
    if (name.endsWith('/initiatorContext')) return { collectWorkflowInitiatorContext: async () => {
      calls.push({ directory: true })
      return {}
    } }
    if (name.endsWith('/dataRuntime')) return { maybeCallWorkflowDataRuntime: async (_event: any, path: string, options: any) => {
      calls.push({ runtime: { path, options } })
      return { handled: true, data: { code: 0, data: { result: {} } } }
    }, runWorkflowRuntimeEffects: async () => [] }
    throw Error(name)
  } })
  return { handler: exports.default, calls }
}
test('completion BFF binds verified source and target context before directory lookup and Runtime actor delegation', async () => {
  const { handler, calls } = boundary()
  await handler({})
  assert.deepEqual(calls.map(call => Object.keys(call)[0]), ['verify', 'directory', 'runtime'])
  for (const [key, value] of Object.entries({ token: 'verified-token', tenantCode: 'T1', sourceDeploymentCode: 'AIMS', targetDeploymentCode: 'WORKFLOW', sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'workflow', requestId: 'request-1', method: 'POST' })) assert.equal(calls[0].verify[key], value)
  assert.equal(calls[2].runtime.options.serviceCommandActor.uid, 'U1')
})
test('completion BFF accepts target v1 and matter v2 schema pairs', async () => {
  const target = boundary()
  await target.handler({})
  assert.equal(target.calls.some(call => call.runtime), true)
  const { handler, calls } = boundary('matter')
  await handler({})
  assert.equal(calls.some(call => call.runtime), true)
})
test('completion BFF invalid command, scope, binding or signature never dispatches directory or Runtime', async () => {
  for (const mode of ['no-cap', 'wrong-client', 'wrong-actor', 'wrong-operation', 'wrong-hash', 'wrong-tenant', 'missing-signature', 'wrong-signature', 'wrong-source-deployment', 'matter-wrong-schema', 'matter-v3', 'target-v2', 'target-v3', 'target-explicit-kind']) {
    const { handler, calls } = boundary(mode)
    await assert.rejects(handler({}), { statusCode: 403 })
    assert.equal(calls.some(call => call.directory || call.runtime), false, mode)
  }
})
