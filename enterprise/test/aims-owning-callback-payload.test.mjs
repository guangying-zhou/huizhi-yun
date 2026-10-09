import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

// Use the real owning entry with only its transport mocked: no business write.
test('owning callback preserves the official Workflow payload and original key, rejects extra fields', async () => {
  const calls = []
  globalThis.__owningCallbackTransport = async (_event, operation, body) => {
    calls.push({ operation, body })
    return { code: 0 }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const mocks = {
      '@hzy/foundation/server/utils/owningModuleHttp': 'export const owningCreateError = input => Object.assign(new Error(input.message), input)',
      '@hzy/foundation/server/utils/enterpriseRuntimeChannels': 'export const callEnterpriseSystemRuntime = (...args) => globalThis.__owningCallbackTransport(...args)'
    }
    if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true }
    return next(specifier, context)
  } })
  globalThis.useRuntimeConfig = () => ({ hzy: { enterprise: { enableMilestoneReceivable: false } } })
  try {
    const { receiveWorkflowCallback } = await import('../../aims/layer/server/internal/callbacks.ts')
    const payload = {
      event: 'flow_completed', instance_id: 30, instance_no: 'fixture-30', app_code: 'aims',
      resource_code: 'tasks', action_code: 'complete', biz_id: 'fixture-request', status: 'approved',
      initiator_uid: 'fixture-initiator', completed_at: '2026-10-07T00:00:00Z', form_data: {},
      approval_actor_uids: ['fixture-reviewer'], non_self_approval_actor_uids: ['fixture-reviewer'],
      approval_operator_uid: 'fixture-reviewer', idempotencyKey: 'workflow:callback:30:flow_completed:approved'
    }
    // All producer fields must cross the Host entry; no frozen payload editing.
    const producer = readFileSync(new URL('../../data-runtime/internal/apps/workflow/runtime.go', import.meta.url), 'utf8')
      .split('func callbackEffect(')[1].split('// Workflow callbacks')[0]
    for (const [, key] of producer.matchAll(/"([a-z_]+)":/g)) assert.ok(Object.hasOwn(payload, key), key)
    for (const [kind, operation] of [['completion', 'aims.completion-callback'], ['standard', 'aims.workflow-callback']]) {
      await receiveWorkflowCallback({}, kind, payload)
      assert.deepEqual(calls.at(-1), { operation, body: payload })
      assert.equal(calls.at(-1).body, payload)
    }
    const before = calls.length
    for (const extra of [{ unregistered_field: true }, { hzy_runtime_trusted: true }, { actor_uid: 'other' }]) {
      await assert.rejects(receiveWorkflowCallback({}, 'completion', { ...payload, ...extra }), { statusCode: 400 })
    }
    await assert.rejects(receiveWorkflowCallback({}, 'completion', { ...payload, app_code: 'other' }), { statusCode: 403 })
    await assert.rejects(receiveWorkflowCallback({}, 'completion', []), { statusCode: 400 })
    assert.equal(calls.length, before, 'rejected fields cannot reach Runtime')
  } finally {
    hooks.deregister()
    delete globalThis.__owningCallbackTransport
    delete globalThis.useRuntimeConfig
  }
})
