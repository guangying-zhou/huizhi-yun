import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  withWorkflowEffectCheckpointTokenDenial,
  workflowEffectCheckpointTokenDenials
} from '../server/utils/effectCheckpointTokenDenials.ts'

function failWith(error: unknown) {
  return async () => {
    throw error
  }
}

test('a 403 checkpoint failure increments the token-denied counter, logs a fixed code and is rethrown unchanged', async () => {
  const before = workflowEffectCheckpointTokenDenials()
  const logged: unknown[] = []
  const denial = Object.assign(new Error('Console service token request failed: Bearer eyJsecret'), {
    statusCode: 403, data: { code: 'insufficient_scope', message: 'private' }
  })
  await assert.rejects(
    withWorkflowEffectCheckpointTokenDenial('callback', failWith(denial), (_message, detail) => logged.push(detail)),
    error => error === denial
  )
  assert.equal(workflowEffectCheckpointTokenDenials(), before + 1)
  assert.deepEqual(logged, [{ code: 'workflow_effect_checkpoint_token_denied', kind: 'callback', causeStatus: 403, causeCode: 'insufficient_scope' }])
  assert.doesNotMatch(JSON.stringify(logged), /secret|private/)
})

test('401 counts, while other checkpoint failures and successes do not', async () => {
  const before = workflowEffectCheckpointTokenDenials()
  const logged: unknown[] = []
  const log = (_message: string, detail: unknown) => logged.push(detail)
  await assert.rejects(withWorkflowEffectCheckpointTokenDenial('notification', failWith({ response: { status: 401 } }), log))
  await assert.rejects(withWorkflowEffectCheckpointTokenDenial('actionable', failWith(Object.assign(new Error('x'), { statusCode: 503 })), log))
  await assert.rejects(withWorkflowEffectCheckpointTokenDenial('actionable', failWith(new Error('workflow_callback_ack_failed')), log))
  assert.equal(await withWorkflowEffectCheckpointTokenDenial('actionable', async () => 'ok', log), 'ok')
  assert.equal(workflowEffectCheckpointTokenDenials(), before + 1)
  assert.deepEqual(logged, [{ code: 'workflow_effect_checkpoint_token_denied', kind: 'notification', causeStatus: 401 }])
})

test('every effect checkpoint is counted and the drain exposes the counter without changing outcomes', () => {
  const runtimeClient = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
  const endpoint = readFileSync(new URL('../server/api/internal/integration-operations/drain.post.ts', import.meta.url), 'utf8')
  for (const [kind, path] of [['notification', 'notification-effects'], ['actionable', 'actionable-lifecycle-effects'], ['callback', 'callback-effects']]) {
    assert.match(runtimeClient, new RegExp(`withWorkflowEffectCheckpointTokenDenial\\('${kind}', \\(\\) => maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>\\(\\s*event,\\s*\`/v1/workflow/${path}/\\$\\{effectId\\}/\\$\\{outcome\\}\``))
  }
  assert.match(endpoint, /checkpointTokenDenied: \{\s*drain: tokenDeniedTotal - tokenDeniedBefore,\s*processTotal: tokenDeniedTotal\s*\}/)
})
