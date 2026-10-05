import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const endpoint = readFileSync(
  new URL('../server/api/internal/integration-operations/drain.post.ts', import.meta.url),
  'utf8'
)
const runtimeClient = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
const lifecycleClient = readFileSync(new URL('../server/utils/runtimeActionableLifecycles.ts', import.meta.url), 'utf8')

test('Workflow durable outboxes have a trusted Tenant Gateway scheduled drain', () => {
  assert.match(endpoint, /requireTenantGatewaySchedulerRequest\(event, 'workflow'\)/)
  assert.match(endpoint, /await drainWorkflowNotificationOutbox\(event\)/)
  assert.ok(endpoint.indexOf('drainWorkflowNotificationOutbox(event)') < endpoint.indexOf('drainWorkflowActionableLifecycleOutbox(event)'),
    'creation notifications must drain before lifecycle CAS')
  assert.match(endpoint, /await drainWorkflowActionableLifecycleOutbox\(event\)/)
  assert.match(endpoint, /await drainWorkflowCallbackOutbox\(event\)/)
  assert.match(endpoint, /await workflowDeliveryDiagnostics\(event\)/)
  assert.doesNotMatch(endpoint, /readBody|getQuery|Authorization/)
})

test('all seven outbox claim, checkpoint and diagnostic calls request only the precise scheduler scope', () => {
  assert.equal(runtimeClient.match(/scope: 'workflow:integration_operation:execute'/g)?.length, 7)
  for (const path of ['notification-effects', 'actionable-lifecycle-effects', 'callback-effects']) {
    assert.match(runtimeClient, new RegExp(`/v1/workflow/${path}/pending`))
    assert.match(runtimeClient, new RegExp(`/v1/workflow/${path}/\\$\\{effectId\\}/\\$\\{outcome\\}`))
  }
  assert.doesNotMatch(runtimeClient, /scope: 'workflow\.(?:read|write)'/)
})

test('the scheduler scope is requested unprefixed so Runtime effect auth accepts it', () => {
  // Without capabilityFormat the Foundation client audience-qualifies the scope
  // (data-runtime:workflow:...), which Runtime workflow_effect_auth rejects with 403.
  assert.match(runtimeClient, /options\.scope === 'workflow:integration_operation:execute' \? \{ capabilityFormat: 'business' as const \}/)
  assert.equal(runtimeClient.match(/maybeCallTenantRuntime</g)?.length, 1, 'all effect calls must go through maybeCallWorkflowDataRuntime')
})

test('cron/manual drain and synchronous Workflow decisions checkpoint the observed effect version', () => {
  const middleware = readFileSync(new URL('../server/middleware/data-runtime.ts', import.meta.url), 'utf8')
  for (const path of [
    '../server/api/v1/service/aims-work-item-completion-approval.post.ts',
    '../server/api/v1/service/codocs-publish-approval.post.ts',
    '../server/api/v1/service/finance-invoice-approval.post.ts'
  ]) {
    assert.match(readFileSync(new URL(path, import.meta.url), 'utf8'), /runWorkflowRuntimeEffects\(event,/)
  }
  assert.match(middleware, /runWorkflowRuntimeEffects\(event, runtime\.data\.effects\)/)
  assert.match(endpoint, /drainWorkflowNotificationOutbox\(event\)[\s\S]*drainWorkflowActionableLifecycleOutbox\(event\)[\s\S]*drainWorkflowCallbackOutbox\(event\)/)
  assert.match(runtimeClient, /checkpointWorkflowNotification\(event, effectId, versionNo,/)
  assert.match(runtimeClient, /checkpointWorkflowActionableLifecycle\(event: H3Event, effectId: number, versionNo: number,/)
  assert.match(runtimeClient, /checkpointWorkflowCallback\(event, callback\.effectId, callback\.versionNo,/)
  assert.match(lifecycleClient, /dependencies\.checkpoint\(event, effectId, versionNo, 'ack'\)/)
  assert.match(lifecycleClient, /dependencies\.checkpoint\(event, effectId, versionNo, 'fail'/)
  assert.equal(runtimeClient.match(/expectedEffectVersion: versionNo/g)?.length, 6)
})
