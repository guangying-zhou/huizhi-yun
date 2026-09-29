/* eslint-disable @typescript-eslint/no-explicit-any -- BFF VM invokes real authorization/operation selection with boundary adapters. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/enterpriseAimsWorkItemWrite.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function bff(mode = '', action = 'complete') {
  const calls: any[] = [], exports: any = {}
  const raw: any = action === 'completion-replay' ? { projectId: '2', expectedOperationVersion: 4, reason: '已修复审批配置' } : { projectId: '2', expectedVersion: 'a'.repeat(64) }
  if (mode === 'raw-status') raw.status = 'completed'
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getQuery: () => ({}), getHeader: () => 'stable-key', getRouterParam: () => '9', readBody: async () => raw, setHeader: () => {} }
    if (name.endsWith('/enterpriseRuntimeClient')) return { requireEnterpriseUser: async () => ({ uid: 'U1', tenant: 'T1', deployment: 'HOST' }), enterpriseRuntimePermitExpiresAt: () => 12345, prepareEnterpriseRuntime: async (_event: any, operation: string) => {
      calls.push({ prepared: operation })
    }, callEnterpriseRuntime: async (_event: any, operation: string, body: any, options: any) => {
      calls.push({ operation, body, options })
      return { accepted: true }
    } }
    if (name.endsWith('/platformBundleAuthorization')) return { loadScopedAuthorizationFromConsoleRuntime: async (_event: any, _uid: string, app: string, options: any) => {
      calls.push({ app, options })
      return { decision: { allowed: mode !== 'denied' } }
    } }
    if (name === './enterpriseAimsPersonnel') return { enterpriseAimsPersonnel: async () => {
      throw Error('Completion must not borrow a Directory identity or personnel permit')
    } }
    if (name === './enterpriseAimsProjects') return { enterpriseAimsProjectScope: async () => {
      throw Error('Completion must not borrow a project-wide scope')
    } }
    throw Error(name)
  } })
  return { execute: () => exports.enterpriseAimsWorkItemWrite({}, action), calls }
}
test('Enterprise completion freezes exact user/Host/project/object permit and queues source operation using stable key', async () => {
  const { execute, calls } = bff()
  await execute()
  assert.equal(calls[0].app, 'aims')
  assert.equal(calls[0].options.resourceCode, 'work_items')
  assert.equal(calls[0].options.action, 'edit')
  assert.equal(calls.at(-1).operation, 'aims.work-item-complete')
  assert.equal(calls.at(-1).body.authorization.actorUid, 'U1')
  assert.equal(calls.at(-1).body.authorization.tenant, 'T1')
  assert.equal(calls.at(-1).body.authorization.deployment, 'HOST')
  assert.equal(calls.at(-1).body.authorization.projectId, '2')
  assert.equal(calls.at(-1).body.authorization.workItemId, '9')
  assert.equal(calls.at(-1).options.idempotencyKey, 'stable-key')
  assert.equal(calls.at(-1).body.personnel.length, 0)
})
test('matter completion keeps the exact completion capability and object permit', async () => {
  const { execute, calls } = bff('', 'matter-complete')
  await execute()
  assert.equal(calls[0].options.resourceCode, 'work_items')
  assert.equal(calls[0].options.action, 'edit')
  assert.equal(calls.at(-1).operation, 'aims.work-item-matter-complete')
  assert.equal(calls.at(-1).body.authorization.workItemId, '9')
  assert.equal(calls.at(-1).body.personnel.length, 0)
})
test('missing user grant or raw status prevents preparation and Runtime dispatch', async () => {
  for (const mode of ['denied', 'raw-status']) {
    const { execute, calls } = bff(mode)
    await assert.rejects(execute())
    assert.equal(calls.some(call => call.prepared || call.operation), false)
  }
})
test('manual replay has its own exact integration-operation permission and operation, without personnel or external credentials', async () => {
  const { execute, calls } = bff('', 'completion-replay')
  await execute()
  assert.equal(calls[0].options.resourceCode, 'integration_operations')
  assert.equal(calls[0].options.action, 'replay')
  assert.equal(calls.at(-1).operation, 'aims.work-item-completion-replay')
  assert.equal(calls.at(-1).body.authorization.resource, 'integration_operations')
  assert.equal(calls.at(-1).body.input.expectedOperationVersion, 4)
  assert.equal(calls.at(-1).body.personnel.length, 0)
})
